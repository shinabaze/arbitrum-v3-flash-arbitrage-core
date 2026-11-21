// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ArbProfitBot (Titan Core Engine)
 * @notice Low-latency flash-loan triangular arbitrage execution engine for Arbitrum One.
 *
 * ARCHITECTURAL DESIGN:
 * 1. Zero-Capital Borrow: Utilizes Balancer V2 Vault's 0% flash-loan facility.
 * 2. Multi-DEX Concentrated Liquidity: Interacts directly with Uniswap V3, Camelot Algebra,
 *    and PancakeSwap V3 pools via their native swap callbacks.
 * 3. Curve Integration: Supports Curve stableswap and cryptoswap exchange venues with
 *    atomic balance delta verification.
 * 4. Yul Memory Safety: Assembly-optimized token transfers and balance queries preserving
 *    the Solidity free memory pointer (0x40).
 * 5. Atomic Execution & Dust Retention: Unprofitable trades revert atomically; net profits
 *    accumulate on contract balance and are swept in batch via sweepAll() to eliminate
 *    per-trade gas overhead.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IVault {
    function flashLoan(
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IFlashLoanRecipient {
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
}

contract ArbProfitBot is IFlashLoanRecipient {
    address public owner;
    IVault public constant VAULT = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    mapping(address => bool) public authorizedPools;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    uint8 public constant KIND_V3 = 0;           // Uniswap V3 / Camelot Algebra / Pancake V3
    uint8 public constant KIND_CURVE_INT128 = 1;   // Curve Stableswap
    uint8 public constant KIND_CURVE_UINT = 2;     // Curve Cryptoswap

    struct TradeStep {
        address pool;
        address tokenIn;
        address tokenOut;
        uint8 kind;
        int128 i;
        int128 j;
    }

    struct TradeParams {
        address flashToken;
        uint256 borrowAmount;
        TradeStep[] steps;
        uint256 minProfit;
        uint256 bribeAmount;
    }

    event ArbitrageExecuted(address indexed token, uint256 borrowAmount, uint256 profit);
    event PoolAuthorizationUpdated(address indexed pool, bool authorized);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor() {
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAuthorizedPool(address pool, bool status) external onlyOwner {
        authorizedPools[pool] = status;
        emit PoolAuthorizationUpdated(pool, status);
    }

    function batchSetAuthorizedPools(address[] calldata pools, bool status) external onlyOwner {
        for (uint256 i = 0; i < pools.length; ) {
            authorizedPools[pools[i]] = status;
            emit PoolAuthorizationUpdated(pools[i], status);
            unchecked { ++i; }
        }
    }

    function executeArbitrage(TradeParams calldata params) external payable onlyOwner {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(params.flashToken);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.borrowAmount;

        bytes memory userData = abi.encode(params);
        VAULT.flashLoan(address(this), tokens, amounts, userData);
    }

    function receiveFlashLoan(
        IERC20[] calldata,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata userData
    ) external override nonReentrant {
        require(msg.sender == address(VAULT), "Not Balancer Vault");
        require(tx.origin == owner, "Not owner");

        TradeParams memory params = abi.decode(userData, (TradeParams));
        uint256 currentBalance = amounts[0];

        uint256 stepCount = params.steps.length;
        for (uint256 i = 0; i < stepCount; ) {
            TradeStep memory step = params.steps[i];
            currentBalance = step.kind == KIND_V3
                ? _swapV3(step, currentBalance)
                : _swapCurve(step, currentBalance);
            unchecked { ++i; }
        }

        uint256 totalDebt = amounts[0] + feeAmounts[0];
        address flashToken = params.flashToken;

        uint256 finalBalance;
        assembly {
            mstore(0x00, 0x70a08231)
            mstore(0x20, address())
            let success := staticcall(gas(), flashToken, 0x1c, 0x24, 0x00, 0x20)
            if iszero(success) { revert(0, 0) }
            finalBalance := mload(0x00)
        }

        require(finalBalance >= totalDebt + params.minProfit, "Titan: Insufficient Profit");
        uint256 profit = finalBalance - totalDebt;

        // Repay flash loan principal + fee to Balancer Vault
        _safeTransfer(flashToken, address(VAULT), totalDebt);

        // Optional miner/builder tip
        if (params.bribeAmount > 0) {
            require(address(this).balance >= params.bribeAmount, "Insufficient ETH for bribe");
            (bool success, ) = block.coinbase.call{value: params.bribeAmount}("");
            require(success, "Bribe failed");
        }

        emit ArbitrageExecuted(flashToken, params.borrowAmount, profit);
    }

    function _swapV3(TradeStep memory step, uint256 currentBalance) internal returns (uint256) {
        bool zeroForOne = step.tokenIn < step.tokenOut;
        uint160 sqrtPriceLimitX96 = zeroForOne
            ? 4295128739 + 1
            : 1461446703485210103287273052203988822378723970342 - 1;

        (int256 amount0, int256 amount1) = IUniswapV3Pool(step.pool).swap(
            address(this),
            zeroForOne,
            int256(currentBalance),
            sqrtPriceLimitX96,
            abi.encode(step.pool, step.tokenIn)
        );

        return uint256(-(zeroForOne ? amount1 : amount0));
    }

    function _swapCurve(TradeStep memory step, uint256 amountIn) internal returns (uint256) {
        require(authorizedPools[step.pool], "Curve: unauthorized pool");
        _ensureAllowance(step.tokenIn, step.pool, amountIn);

        uint256 balBefore = _selfBalance(step.tokenOut);

        bytes memory payload = step.kind == KIND_CURVE_INT128
            ? abi.encodeWithSelector(0x3df02124, step.i, step.j, amountIn, uint256(0))
            : abi.encodeWithSelector(0x5b41b908, uint256(int256(step.i)), uint256(int256(step.j)), amountIn, uint256(0));

        (bool ok, ) = step.pool.call(payload);
        require(ok, "Curve: exchange failed");

        uint256 received = _selfBalance(step.tokenOut) - balBefore;
        require(received > 0, "Curve: zero out");
        return received;
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        _handleCallback(amount0Delta, amount1Delta, data);
    }

    function algebraSwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        _handleCallback(amount0Delta, amount1Delta, data);
    }

    function pancakeV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        _handleCallback(amount0Delta, amount1Delta, data);
    }

    function _handleCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) internal {
        (address callerPool, address tokenIn) = abi.decode(data, (address, address));
        require(msg.sender == callerPool, "Callback: pool mismatch");
        require(authorizedPools[msg.sender], "Callback: unauthorized pool");
        require(tx.origin == owner, "Callback: unauthorized origin");

        uint256 amountToPay;
        if (amount0Delta > 0) {
            amountToPay = uint256(amount0Delta);
        } else if (amount1Delta > 0) {
            amountToPay = uint256(amount1Delta);
        } else {
            return;
        }

        _safeTransfer(tokenIn, msg.sender, amountToPay);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        assembly {
            let fmp := mload(0x40)
            mstore(0x00, 0xa9059cbb)
            mstore(0x20, to)
            mstore(0x40, amount)

            let success := call(gas(), token, 0, 0x1c, 0x44, 0x00, 0x20)
            if iszero(success) { revert(0, 0) }

            if returndatasize() {
                if iszero(mload(0x00)) { revert(0, 0) }
            }
            mstore(0x40, fmp)
        }
    }

    function _selfBalance(address token) internal view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        require(ok && ret.length >= 32, "balanceOf failed");
        return abi.decode(ret, (uint256));
    }

    function _ensureAllowance(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0xdd62ed3e, address(this), spender));
        uint256 current = (ok && ret.length >= 32) ? abi.decode(ret, (uint256)) : 0;
        if (current >= amount) return;
        if (current != 0) _safeApprove(token, spender, 0);
        _safeApprove(token, spender, type(uint256).max);
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "Approve failed");
    }

    function version() external pure returns (string memory) {
        return "TITAN-V6-CORE";
    }

    function withdraw(address token) external onlyOwner {
        uint256 bal = _selfBalance(token);
        if (bal > 0) {
            _safeTransfer(token, owner, bal);
        }
    }

    function withdrawETH() external onlyOwner {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = owner.call{value: bal}("");
            require(ok, "ETH transfer failed");
        }
    }

    function sweepAll(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; ) {
            uint256 bal;
            address token = tokens[i];
            bool ok;
            assembly {
                mstore(0x00, 0x70a08231)
                mstore(0x20, address())
                ok := staticcall(gas(), token, 0x1c, 0x24, 0x00, 0x20)
                bal := mload(0x00)
            }
            if (ok && bal > 0) {
                _safeTransfer(token, owner, bal);
            }
            unchecked { ++i; }
        }
    }

    receive() external payable {}
}
