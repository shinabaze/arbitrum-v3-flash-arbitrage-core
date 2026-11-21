import { LocalQuoter } from "./quoter.js";
import { DEFAULT_EXECUTION_CONFIG } from "./config.js";

/**
 * Arbitrage Pipeline & Execution Harness
 *
 * Coordinates route pre-screening, optimal size discovery, and trade payload formulation.
 *
 * NOTE: Production systems utilize proprietary concave dynamic optimization with live
 * orderbook tick-depth integration. This module provides the clean open-core pipeline
 * interface and reference sizing algorithm for simulation and evaluation.
 */
export class ArbitragePipeline {
  constructor(config = DEFAULT_EXECUTION_CONFIG) {
    this.config = config;
  }

  /**
   * Search for optimal borrow size along a concave return curve
   * @param {Array<Object>} steps - Trade route
   * @param {Array<number>} stepPrices - Step execution prices
   * @param {bigint} minBorrow - Minimum flash loan size
   * @param {bigint} maxBorrow - Maximum flash loan size
   * @returns {Object} - { bestBorrow, estimatedProfit, quotesCount }
   */
  findOptimalSize(steps, stepPrices, minBorrow = 10n ** 18n, maxBorrow = 100n * (10n ** 18n)) {
    let bestBorrow = minBorrow;
    let maxProfit = -1n * (10n ** 30n);
    let quotesCount = 0;

    // Golden-ratio / geometric progression test sizes
    const testMultipliers = [1n, 2n, 5n, 10n, 25n, 50n, 100n];

    for (const mult of testMultipliers) {
      const candidateBorrow = minBorrow * mult;
      if (candidateBorrow > maxBorrow) break;

      const { grossProfit } = LocalQuoter.quoteRoute(steps, candidateBorrow, stepPrices);
      quotesCount++;

      if (grossProfit > maxProfit) {
        maxProfit = grossProfit;
        bestBorrow = candidateBorrow;
      }
    }

    return {
      bestBorrow,
      estimatedProfit: maxProfit,
      quotesCount,
    };
  }

  /**
   * Build ABI-compliant TradeParams payload for ArbProfitBot.sol
   * @param {string} flashToken - Address of token to flash-borrow
   * @param {bigint} borrowAmount - Optimal borrow amount in wei
   * @param {Array<Object>} steps - Route steps
   * @param {bigint} minProfit - Minimum net profit threshold (reverts if not met)
   * @param {bigint} bribeAmount - Builder bribe tip
   * @returns {Object} TradeParams struct
   */
  formatTradeParams(flashToken, borrowAmount, steps, minProfit, bribeAmount = 0n) {
    const formattedSteps = steps.map((s) => ({
      pool: s.pool,
      tokenIn: s.tokenIn,
      tokenOut: s.tokenOut,
      kind: s.kind || 0,
      i: s.i || 0,
      j: s.j || 0,
    }));

    return {
      flashToken,
      borrowAmount,
      steps: formattedSteps,
      minProfit,
      bribeAmount,
    };
  }

  /**
   * Evaluate whether a route clears execution criteria
   */
  evaluateOpportunity(steps, stepPrices, flashToken) {
    const { bestBorrow, estimatedProfit, quotesCount } = this.findOptimalSize(steps, stepPrices);

    if (estimatedProfit <= 0n) {
      return {
        viable: false,
        reason: "Negative gross yield",
        bestBorrow,
        estimatedProfit,
      };
    }

    const minRequiredProfit = 10n ** 15n; // 0.001 ETH threshold
    if (estimatedProfit < minRequiredProfit) {
      return {
        viable: false,
        reason: "Profit below minimum hurdle threshold",
        bestBorrow,
        estimatedProfit,
      };
    }

    const tradeParams = this.formatTradeParams(
      flashToken,
      bestBorrow,
      steps,
      minRequiredProfit,
      0n
    );

    return {
      viable: true,
      bestBorrow,
      estimatedProfit,
      quotesCount,
      tradeParams,
    };
  }
}
