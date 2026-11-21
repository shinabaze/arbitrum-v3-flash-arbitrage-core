/**
 * Arbitrum One Canonical Constants and Execution Parameters
 */

export const ARBITRUM_CHAIN_ID = 42161;

export const BALANCER_V2_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export const CANONICAL_TOKENS = {
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDC_E: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
};

export const PROTOCOL_ROUTERS = {
  UNISWAP_V3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  CAMELOT_ALGEBRA: "0x1F721E2E82F6676FCE4eA07A5958cF098D339e18",
  PANCAKESWAP_V3: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
};

export const DEFAULT_EXECUTION_CONFIG = {
  minProfitUsd: 1.50,           // Minimum gross edge before submission
  bribeShareBps: 1000,          // 10% bribe tip to builder/miner
  maxSlippageBps: 30,           // 0.30% maximum allowable tick slippage
  gasLimitDefault: 450000n,     // Standard 3-hop multicall gas ceiling
  gasPriceFloorGwei: 0.1,       // Arbitrum base fee floor
};
