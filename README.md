# Arbitrum V3 Flash-Loan Arbitrage Core

An institutional execution engine and smart contract harness for flash-loan triangular arbitrage on Arbitrum One.

> **Confidentiality & Production Architecture Notice:**
> This repository contains the public core execution engine, smart contracts, and test harness of our live Arbitrum arbitrage system.
> The production repository remains private to safeguard active trading capital, live discovery targets, private sequencer telemetry, and operational alpha.
> Full private repository access can be provided directly to the Arbitrum Foundation / Offchain Labs review committee upon request.

---

## Architecture Overview

Arbitrum One presents unique advantages for high-frequency algorithmic arbitrage:
- **Direct Sequencer Execution:** No public mempool front-running by third parties.
- **Zero-Capital Flash Loans:** Leverages Balancer V2 Vault's 0% fee flash-loan facility to eliminate upfront capital requirements.
- **Concentrated Liquidity Integration:** Atomic multi-hop routing across Uniswap V3, Camelot Algebra, and PancakeSwap V3.
- **Yul Memory Optimization:** Low-level assembly handling for token transfers and balance evaluations that preserves the Solidity free memory pointer.

```
       [ Off-Chain Market Monitor & Local Quoter ]
                           │
       Calculates optimal concave trade sizing
                           │
                           ▼
          [ ArbProfitBot.executeArbitrage() ]
                           │
             1. Borrow flash-loan asset
                           │
                           ▼
              [ Balancer V2 Vault (0%) ]
                           │
             2. receiveFlashLoan() callback
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │  Multi-Hop Execution Pipeline        │
        │  Hop 1: Uniswap V3 concentrated pool │
        │  Hop 2: Camelot Algebra pool         │
        │  Hop 3: PancakeSwap V3 / Curve       │
        └──────────────────────────────────────┘
                           │
             3. Atomic profit hurdle check
             4. Repay Vault debt + fee
             5. Retain net surplus on contract
```

---

## Core Components

- **`contracts/ArbProfitBot.sol`**: Production-ready Solidity contract implementing Balancer `IFlashLoanRecipient`, multi-DEX callbacks, reentrancy guards, and access-controlled profit sweeping.
- **`src/quoter.js`**: Off-chain price and liquidity quoter simulating multi-hop swaps locally without RPC gas cost or latency.
- **`src/pipeline.js`**: Sizing engine and payload builder generating ABI-encoded execution calls.
- **`test/contract.test.cjs`**: Hardhat test suite validating ownership controls, authorization matrices, callbacks, and withdrawals.
- **`test/engine.test.js`**: Unit test suite verifying route profitability logic, spread detection, and hurdle checks.

---

## Getting Started

### Prerequisites
- Node.js v18+
- npm

### Installation
```bash
npm install
```

### Running Tests
Execute the complete test suite (smart contracts and off-chain pipeline):
```bash
npm test
```

To compile smart contracts:
```bash
npm run compile
```

---

## License

MIT License. Copyright 2026 Shinabaze Ajiya.
