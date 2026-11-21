import assert from "node:assert";
import { LocalQuoter } from "../src/quoter.js";
import { ArbitragePipeline } from "../src/pipeline.js";
import { CANONICAL_TOKENS } from "../src/config.js";

console.log("Testing Arbitrage Off-Chain Pipeline...");

// Test 1: Single Step Quoter
{
  const step = {
    pool: "0xC6962004f452bE9203591991D15f6b388e09E8D0",
    tokenIn: CANONICAL_TOKENS.WETH,
    tokenOut: CANONICAL_TOKENS.USDC,
    fee: 500, // 0.05%
  };
  const amountIn = 10n ** 18n; // 1 WETH
  const price = 3000.0; // 3000 USDC per WETH
  const amountOut = LocalQuoter.quoteStep(step, amountIn, price);

  assert(amountOut > 0n, "amountOut must be greater than zero");
  // 1 WETH * (1 - 0.0005) * 3000 = 2998.5 USDC
  const approxExpected = 29985n * (10n ** 17n);
  const diff = amountOut > approxExpected ? amountOut - approxExpected : approxExpected - amountOut;
  assert(diff < 10n ** 17n, "Quoted price should match within 0.1 margin");
  console.log("✓ Single step quoter accurate with fees");
}

// Test 2: Multi-Hop Route Quoter (Arbitrage loop: WETH -> USDC -> ARB -> WETH)
{
  const steps = [
    { pool: "0x1", tokenIn: CANONICAL_TOKENS.WETH, tokenOut: CANONICAL_TOKENS.USDC, fee: 500 },
    { pool: "0x2", tokenIn: CANONICAL_TOKENS.USDC, tokenOut: CANONICAL_TOKENS.ARB, fee: 500 },
    { pool: "0x3", tokenIn: CANONICAL_TOKENS.ARB, tokenOut: CANONICAL_TOKENS.WETH, fee: 500 },
  ];

  // Profitable price scenario (+1.5% edge)
  const profitablePrices = [3000.0, 1.25, 1.0 / 3650.0]; // Net multiplier > 1.0
  const initialBorrow = 10n ** 18n;

  const result = LocalQuoter.quoteRoute(steps, initialBorrow, profitablePrices);
  assert(result.isProfitable === true, "Route should be identified as profitable");
  assert(result.grossProfit > 0n, "Gross profit must be positive");
  console.log("✓ Multi-hop arbitrage route correctly prices profitable spread");
}

// Test 3: Unprofitable Route Rejection
{
  const steps = [
    { pool: "0x1", tokenIn: CANONICAL_TOKENS.WETH, tokenOut: CANONICAL_TOKENS.USDC, fee: 500 },
    { pool: "0x2", tokenIn: CANONICAL_TOKENS.USDC, tokenOut: CANONICAL_TOKENS.ARB, fee: 500 },
    { pool: "0x3", tokenIn: CANONICAL_TOKENS.ARB, tokenOut: CANONICAL_TOKENS.WETH, fee: 500 },
  ];

  // Flat prices minus 3 pool fees = loss
  const flatPrices = [3000.0, 1.0 / 3000.0, 1.0];
  const initialBorrow = 10n ** 18n;

  const result = LocalQuoter.quoteRoute(steps, initialBorrow, flatPrices);
  assert(result.isProfitable === false, "Route should be rejected due to fee drag");
  console.log("✓ Multi-hop route accurately rejects fee-drag losses");
}

// Test 4: Pipeline Size Discovery & Payload Formatting
{
  const pipeline = new ArbitragePipeline();
  const steps = [
    { pool: "0xPoolA", tokenIn: CANONICAL_TOKENS.WETH, tokenOut: CANONICAL_TOKENS.USDC, kind: 0 },
    { pool: "0xPoolB", tokenIn: CANONICAL_TOKENS.USDC, tokenOut: CANONICAL_TOKENS.WETH, kind: 0 },
  ];
  const stepPrices = [3050.0, 1.0 / 3000.0]; // ~1.6% price discrepancy

  const evaluation = pipeline.evaluateOpportunity(steps, stepPrices, CANONICAL_TOKENS.WETH);
  assert(evaluation.viable === true, "Pipeline should deem viable opportunity");
  assert(evaluation.tradeParams.borrowAmount > 0n, "Optimal borrow amount calculated");
  assert.equal(evaluation.tradeParams.steps.length, 2, "Steps correctly mapped into TradeParams");
  assert.equal(evaluation.tradeParams.flashToken, CANONICAL_TOKENS.WETH, "Flash token address preserved");
  console.log("✓ Pipeline successfully evaluates opportunity and builds TradeParams payload");
}

console.log("All off-chain pipeline tests passed successfully!");
