# Fee Tiers

> How the Pump protocol dynamically adjusts protocol and creator fees based on a token's market cap, and how the SDK selects the right tier for every quote.

## Overview

The fee system uses market-cap-based tiers to determine protocol and creator fees. As a token's market cap grows, different fee rates may apply. The SDK handles this automatically when you use `getBuyTokenAmountFromSolAmount`, `getSellSolAmountFromTokenAmount`, and related functions.

## Fee Structure

Each trade incurs two types of fees:

| Fee Type | Recipient | Description |
|----------|-----------|-------------|
| **Protocol fee** | Pump protocol | Goes to the protocol treasury |
| **Creator fee** | Token creator | Goes to the creator's vault (or fee sharing config) |

Both are expressed in **basis points** (bps), where 1 bps = 0.01%.

> **Note:** LP fees (`lpFeeBps`) are also defined in the fee config but only apply after graduation to the AMM pool.

## How Tier Selection Works

The SDK selects fees in this order:

1. **If `FeeConfig` is available** (fetched via `sdk.fetchFeeConfig()`):
   - Compute the token's current market cap from its bonding curve reserves
   - Walk through `feeTiers` (highest threshold first) to find the matching tier
   - If market cap is below the first tier's threshold, use the first tier's fees

2. **If `FeeConfig` is null** (fallback):
   - Use `global.feeBasisPoints` for protocol fees
   - Use `global.creatorFeeBasisPoints` for creator fees

```typescript
// Internal logic: you don't need to call this directly
import { calculateFeeTier, computeFeesBps } from "@nirholas/pump-sdk";

// computeFeesBps selects the right tier automatically
const { protocolFeeBps, creatorFeeBps } = computeFeesBps({
  global,
  feeConfig,
  mintSupply,
  virtualSolReserves,
  virtualTokenReserves,
});
```

## The `FeeConfig` Type

Fetched from on-chain state:

```typescript
interface FeeConfig {
  admin: PublicKey;         // Admin authority
  flatFees: Fees;           // Default flat fee rates
  feeTiers: FeeTier[];      // Market-cap-dependent tiers
}

interface FeeTier {
  marketCapLamportsThreshold: BN;  // Market cap threshold in lamports
  fees: Fees;                       // Fee rates for this tier
}

interface Fees {
  lpFeeBps: BN;            // LP fee (AMM only, post-graduation)
  protocolFeeBps: BN;      // Protocol fee in basis points
  creatorFeeBps: BN;       // Creator fee in basis points
}
```

## Fetching the FeeConfig

```typescript
const feeConfig = await sdk.fetchFeeConfig();
```

The `FeeConfig` is stored at the `PUMP_FEE_CONFIG_PDA` address and can be decoded offline:

```typescript
const accountInfo = await connection.getAccountInfo(PUMP_FEE_CONFIG_PDA);
const feeConfig = PUMP_SDK.decodeFeeConfig(accountInfo);
```

## Tier Selection Algorithm

The `calculateFeeTier` function processes tiers as follows:

```typescript
function calculateFeeTier({ feeTiers, marketCap }): Fees {
  const firstTier = feeTiers[0];
  if (!firstTier) throw new Error("feeTiers must not be empty");

  // If below the first tier's threshold, use the first tier
  if (marketCap.lt(firstTier.marketCapLamportsThreshold)) {
    return firstTier.fees;
  }

  // Walk tiers from highest to lowest, find the first one where
  // marketCap >= threshold
  for (const tier of feeTiers.slice().reverse()) {
    if (marketCap.gte(tier.marketCapLamportsThreshold)) {
      return tier.fees;
    }
  }

  // Fallback to first tier
  return firstTier.fees;
}
```

In practice, `feeTiers` is sorted by ascending `marketCapLamportsThreshold`. The algorithm finds the highest tier whose threshold the token has exceeded.

### Mayhem mode and mint supply

For the market-cap calculation inside `getFee`, standard tokens always use the fixed `ONE_BILLION_SUPPLY` constant (1B tokens at 6 decimals) regardless of the actual mint supply. Mayhem-mode tokens (`bondingCurve.isMayhemMode === true`) use the real mint supply instead. If a mayhem token's fee quotes look off, check that you are passing the actual supply.

## Market Cap Calculation

The market cap used for tier selection is computed from bonding curve reserves:

$$marketCap = \frac{virtualSolReserves \times mintSupply}{virtualTokenReserves}$$

```typescript
import { bondingCurveMarketCap } from "@nirholas/pump-sdk";

const mcap = bondingCurveMarketCap({
  mintSupply: bondingCurve.tokenTotalSupply,
  virtualSolReserves: bondingCurve.virtualSolReserves,
  virtualTokenReserves: bondingCurve.virtualTokenReserves,
});
```

## Fee Application

Fees are applied differently for buys and sells:

### Buy Fees

Fees are deducted from the input SOL **before** calculating how many tokens the user receives:

```
Input SOL → deduct fees → remaining SOL buys tokens from the curve
```

### Sell Fees

Fees are deducted from the output SOL **after** calculating how much SOL the tokens are worth:

```
Tokens sold into the curve → SOL amount → deduct fees → user receives remainder
```

### Creator Fee Conditions

Creator fees are only charged when a creator address is set on the bonding curve:

```typescript
const creatorFee = isNewBondingCurve || !PublicKey.default.equals(bondingCurve.creator)
  ? fee(amount, creatorFeeBps)
  : new BN(0);
```

- **New tokens** (created in the same transaction): always charge creator fee
- **Tokens with a creator set** (`creator !== PublicKey.default`): charge creator fee
- **Tokens with no creator**: no creator fee

## Fee Recipients

Protocol fees are sent to a randomly selected fee recipient. The SDK's buy/sell builders pick one from the on-chain `Global` config via `getFeeRecipient`:

```typescript
import { getFeeRecipient, getStaticRandomFeeRecipient } from "@nirholas/pump-sdk";

// From live Global state (what buyInstructions/sellInstructions use internally)
const recipient = getFeeRecipient(global, /* mayhemMode */ false);

// Or from the hardcoded static list, when no Global state is at hand
const staticRecipient = getStaticRandomFeeRecipient();
```

In [Mayhem mode](./mayhem-mode.md), fees are routed to `reservedFeeRecipient` / `reservedFeeRecipients` instead.

Separately, since the 2026-04-28 program upgrade every buy/sell instruction also carries one of 8 designated "breaking" fee recipient accounts as a trailing account. The SDK appends it automatically; see `pickBreakingFeeRecipient` in the [API Reference](./api-reference.md).

## Usage in SDK Functions

You never need to call fee functions directly. Pass `feeConfig` to the math functions and they handle everything:

```typescript
const tokenAmount = getBuyTokenAmountFromSolAmount({
  global,
  feeConfig,     // tier selection happens here
  mintSupply: bondingCurve.tokenTotalSupply,
  bondingCurve,
  amount: solAmount,
});
```

If you pass `feeConfig: null`, the SDK falls back to the global flat fee rates.

## Runnable examples

Curve Math & Fees examples 11-20 include fee-aware quotes and market-cap math; run `npm run example 11` to see tier-aware buy quoting live.

## Related

- [Bonding Curve Math](./bonding-curve-math.md): price calculation formulas
- [Fee Sharing](./fee-sharing.md): splitting creator fees among shareholders
- [Mayhem Mode](./mayhem-mode.md): alternate fee routing
- [API Reference](./api-reference.md): full function signatures

