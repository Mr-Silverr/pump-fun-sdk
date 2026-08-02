# Bonding Curve Math

> How the Pump protocol prices tokens with a constant-product bonding curve, and the SDK functions that mirror the on-chain math exactly.

## Overview

The Pump bonding curve uses a **constant-product AMM formula** (similar to Uniswap) to determine token prices. When a token is created, it starts with virtual reserves that define the initial price. As users buy tokens, the price increases along the curve. When the curve is "complete," the token graduates to a full AMM pool.

## Key Concepts

### Virtual vs Real Reserves

The bonding curve tracks two sets of reserves:

| Reserve | Purpose |
|---------|---------|
| `virtualTokenReserves` | Token side of the constant-product formula; includes both real and virtual liquidity |
| `virtualSolReserves` | SOL side of the constant-product formula; includes both real and virtual liquidity |
| `realTokenReserves` | Actual tokens available for purchase; decreases as users buy |
| `realSolReserves` | Actual SOL deposited by buyers; increases as users buy |

The "virtual" reserves are larger than the "real" reserves. This virtual liquidity ensures the price starts at a reasonable level instead of zero.

### Initial State

When a new token is created, its bonding curve is initialized from the `Global` config:

```typescript
import { newBondingCurve } from "@nirholas/pump-sdk";

const curve = newBondingCurve(global);
// {
//   virtualTokenReserves: global.initialVirtualTokenReserves,
//   virtualSolReserves: global.initialVirtualSolReserves,
//   realTokenReserves: global.initialRealTokenReserves,
//   realSolReserves: BN(0),
//   tokenTotalSupply: global.tokenTotalSupply,
//   complete: false,
//   creator: PublicKey.default,
//   isMayhemMode: global.mayhemModeEnabled,
//   isCashbackCoin: false,
// }
```

### The Constant Product

The core invariant is:

$$k = virtualTokenReserves \times virtualSolReserves$$

This product $k$ stays approximately constant across trades. When a user buys tokens with SOL:
- `virtualSolReserves` increases (more SOL in the pool)
- `virtualTokenReserves` decreases (tokens leave the pool)
- The ratio changes → price goes up

## Buy Math

### How many tokens do I get for X SOL?

The SDK provides `getBuyTokenAmountFromSolAmount`:

```typescript
import { getBuyTokenAmountFromSolAmount } from "@nirholas/pump-sdk";

const tokensOut = getBuyTokenAmountFromSolAmount({
  global,
  feeConfig,
  mintSupply: bondingCurve.tokenTotalSupply, // or null for new tokens
  bondingCurve,                               // or null for new tokens
  amount: solAmount,                          // SOL in lamports
});
```

**Under the hood**, the calculation works in three steps:

1. **Deduct fees** from the input SOL amount:

$$inputAmount = \frac{(solAmount - 1) \times 10000}{(protocolFeeBps + creatorFeeBps) + 10000}$$

2. **Apply constant-product formula**:

$$tokensOut = \frac{inputAmount \times virtualTokenReserves}{virtualSolReserves + inputAmount}$$

3. **Cap at real reserves**: you can never buy more than `realTokenReserves`:

$$result = \min(tokensOut, realTokenReserves)$$

### How much SOL to buy X tokens?

The inverse: `getBuySolAmountFromTokenAmount`:

```typescript
import { getBuySolAmountFromTokenAmount } from "@nirholas/pump-sdk";

const solNeeded = getBuySolAmountFromTokenAmount({
  global,
  feeConfig,
  mintSupply: bondingCurve.tokenTotalSupply,
  bondingCurve,
  amount: tokenAmount,
});
```

**Formula:**

$$solCost = \frac{\min(amount, realTokenReserves) \times virtualSolReserves}{virtualTokenReserves - \min(amount, realTokenReserves)} + 1$$

Then fees are added on top:

$$totalCost = solCost + fees(solCost)$$

## Sell Math

### How much SOL do I get for X tokens?

The SDK provides `getSellSolAmountFromTokenAmount`:

```typescript
import { getSellSolAmountFromTokenAmount } from "@nirholas/pump-sdk";

const solOut = getSellSolAmountFromTokenAmount({
  global,
  feeConfig,
  mintSupply: bondingCurve.tokenTotalSupply,
  bondingCurve,
  amount: tokenAmount,
});
```

**Formula:**

$$solOut_{raw} = \frac{tokenAmount \times virtualSolReserves}{virtualTokenReserves + tokenAmount}$$

Then fees are subtracted:

$$solOut = solOut_{raw} - fees(solOut_{raw})$$

The result is clamped to 0: for dust amounts, ceiling-rounded fees can exceed the gross SOL.

### The u64 sell overflow limit

The deployed pump program computes `amount * virtualSolReserves` as a u64 before dividing. If that intermediate product would exceed `u64::MAX` (~1.84e19), the program aborts on-chain with AnchorError 6024 (Overflow). The SDK mirrors this bound offline:

```typescript
import { maxSafeSellAmount, validateSellAmount, getTokenAmountForTargetSol } from "@nirholas/pump-sdk";

// Largest amount sellable in one instruction (with a 10% safety margin)
const max = maxSafeSellAmount(bondingCurve.virtualSolReserves);

// Throws SellOverflowError if amount is too large; sellInstructions calls this for you
validateSellAmount(amount, bondingCurve);
```

For oversized positions, split the sell with `OnlinePumpSdk.sellChunked()`. To sell "enough tokens to get X SOL", `getTokenAmountForTargetSol({ global, feeConfig, mintSupply, bondingCurve, targetSol })` binary-searches the amount and stays inside the safe limit.

## Market Cap

The bonding curve market cap is computed as:

$$marketCap = \frac{virtualSolReserves \times mintSupply}{virtualTokenReserves}$$

```typescript
import { bondingCurveMarketCap } from "@nirholas/pump-sdk";

const mcap = bondingCurveMarketCap({
  mintSupply: bondingCurve.tokenTotalSupply,
  virtualSolReserves: bondingCurve.virtualSolReserves,
  virtualTokenReserves: bondingCurve.virtualTokenReserves,
});
// Returns BN in lamports
```

The market cap is used by the [fee tier system](./fee-tiers.md) to determine which fee rates apply.

## Graduation

A bonding curve is "complete" when `realTokenReserves` reaches zero: all available tokens have been purchased. At that point:

1. `bondingCurve.complete` becomes `true`
2. The token is eligible for migration to a PumpAMM pool
3. No more buy/sell operations are possible on the bonding curve
4. Use `migrateInstruction()` to move the token to an AMM pool

```typescript
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

if (bondingCurve.complete) {
  // Token has graduated: migrate to AMM
  const ix = await PUMP_SDK.migrateInstruction({
    withdrawAuthority: global.withdrawAuthority,
    mint,
    user: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
}
```

Track progress toward graduation without any extra math:

```typescript
import { getGraduationProgress } from "@nirholas/pump-sdk";

const progress = getGraduationProgress(global, bondingCurve, feeConfig);
// { progressBps, isGraduated, tokensRemaining, tokensTotal, solAccumulated, solNeededToGraduate }
```

## Migrated Curves

Once a bonding curve has been migrated, its `virtualTokenReserves` is set to zero. All SDK math functions return `BN(0)` when they detect this:

```typescript
// migrated bonding curve
if (bondingCurve.virtualTokenReserves.eq(new BN(0))) {
  return new BN(0); // No more bonding curve trading
}
```

## Worked Example

Starting with typical initial reserves:

| Parameter | Value |
|-----------|-------|
| `initialVirtualTokenReserves` | 1,073,000,000,000,000 |
| `initialVirtualSolReserves` | 30,000,000,000 (30 SOL) |
| `initialRealTokenReserves` | 793,100,000,000,000 |
| `tokenTotalSupply` | 1,000,000,000,000,000 (1B tokens) |

**Initial price per token:**

$$price = \frac{virtualSolReserves}{virtualTokenReserves} = \frac{30 \times 10^9}{1.073 \times 10^{15}} \approx 0.000028 \text{ SOL}$$

**Buying 0.1 SOL worth of tokens (ignoring fees):**

$$tokens = \frac{0.1 \times 10^9 \times 1.073 \times 10^{15}}{30 \times 10^9 + 0.1 \times 10^9} = 3,564,784,053,156$$

That is about 3.56M whole tokens (raw units at 6 decimals). After this trade, the new reserves would be:
- `virtualTokenReserves` = 1,069,435,215,946,844
- `virtualSolReserves` = 30,100,000,000

The price has increased slightly because the ratio changed.

## Price Impact

Larger trades cause more price impact (slippage). The constant-product formula naturally provides:

- **Small trades**: minimal price impact
- **Large trades**: significant price impact
- **Approaching graduation**: very high price impact (fewer `realTokenReserves` left)

Quantify it before trading with `calculateBuyPriceImpact` / `calculateSellPriceImpact` (offline) or `OnlinePumpSdk.quoteBuy` / `quoteSell` (fetches state for you). Use the `slippage` parameter in `buyInstructions()` / `sellInstructions()` to set the maximum acceptable slippage as a percentage.

## Runnable examples

Curve Math & Fees examples 11-20 exercise everything on this page: offline buy/sell quotes, market cap, target-SOL sells, and the max-safe-sell limit. Run them with `npm run example 11` through `npm run example 20`.

## Related

- [Fee Tiers](./fee-tiers.md): how fee rates are determined by market cap
- [API Reference](./api-reference.md): complete function signatures
- [Examples](./examples.md): the full example catalog

