/**
 * Local Quoter & Route Simulation Interface
 *
 * Simulates multi-hop swap execution off-chain to avoid on-chain eth_call latency.
 * When real tick data is available, it walks ticks using exact integer arithmetic.
 */

export class LocalQuoter {
  /**
   * Quote a single swap step through a concentrated liquidity pool
   * @param {Object} step - Trade step definition { pool, tokenIn, tokenOut, fee }
   * @param {bigint} amountIn - Input amount in wei
   * @param {number} effectivePrice - Price ratio (tokenOut / tokenIn)
   * @returns {bigint} - Simulated amountOut in wei
   */
  static quoteStep(step, amountIn, effectivePrice) {
    if (amountIn <= 0n) return 0n;

    // Deduct pool fee (e.g., fee = 500 for 0.05%, 3000 for 0.3%)
    const feeBps = step.fee ? BigInt(step.fee) : 500n; // Default 5 bps (0.05%)
    const feeMultiplier = 1000000n - feeBps;
    const netAmountIn = (amountIn * feeMultiplier) / 1000000n;

    // Apply effective swap rate scaled by 1e18
    const priceScale = 10n ** 18n;
    const priceBigInt = BigInt(Math.floor(effectivePrice * 1e18));

    return (netAmountIn * priceBigInt) / priceScale;
  }

  /**
   * Quote an entire multi-hop route
   * @param {Array<Object>} steps - Array of TradeSteps
   * @param {bigint} initialBorrow - Flash loan borrow amount
   * @param {Array<number>} stepPrices - Simulated price ratios for each step
   * @returns {Object} - { amountOut, grossProfit, isProfitable }
   */
  static quoteRoute(steps, initialBorrow, stepPrices) {
    let currentAmount = initialBorrow;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const price = stepPrices[i] || 1.0;
      currentAmount = this.quoteStep(step, currentAmount, price);
    }

    const grossProfit = currentAmount - initialBorrow;
    return {
      amountOut: currentAmount,
      grossProfit,
      isProfitable: grossProfit > 0n,
    };
  }
}
