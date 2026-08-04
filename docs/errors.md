# Error Reference

> Every custom error class the SDK throws, what causes it, and how to recover, plus the common on-chain Anchor errors.

All SDK error classes are exported from `@nirholas/pump-sdk` and extend `Error`, so `instanceof` checks work.

---

## Fee Sharing Errors

Thrown by `updateFeeShares` (and the wrappers that call it) when validating a shareholder list. All shares must total exactly **10,000 BPS** (100%).

### NoShareholdersError

```
No shareholders provided
```

**Cause:** Empty `newShareholders` array.
**Fix:** Provide at least one shareholder.

---

### TooManyShareholdersError

```
Too many shareholders. Maximum allowed is 10, got 12
```

**Cause:** More than `MAX_SHAREHOLDERS` (10) shareholders in the config.
**Fix:** Reduce to 10 or fewer shareholders. Properties: `count`, `max`.

---

### ZeroShareError

```
Zero or negative share not allowed for address BYsXqJ...
```

**Cause:** A shareholder has `shareBps` of 0 or negative.
**Fix:** Every shareholder must have a positive share. Property: `address`.

---

### InvalidShareTotalError

```
Invalid share total. Must equal 10,000 basis points (100%). Got 9500
```

**Cause:** Shares don't sum to exactly 10,000 BPS.
**Fix:** Adjust shares so they total 10,000. Property: `total`.

---

### DuplicateShareholderError

```
Duplicate shareholder addresses not allowed
```

**Cause:** Same address appears more than once in the shareholders array.
**Fix:** Merge duplicate entries into a single shareholder with combined BPS.

---

### ShareCalculationOverflowError

```
Share calculation overflow - total shares exceed maximum value
```

**Cause:** Internal arithmetic overflow during share calculation.
**Fix:** Reduce share values. This typically indicates a bug; file an issue.

---

### PoolRequiredForGraduatedError

```
Pool parameter is required for graduated coins (bondingCurve.complete = true)
```

**Cause:** A fee-sharing operation on a graduated token was attempted without supplying the AMM pool address.
**Fix:** Pass the pool, e.g. `pool: canonicalPumpPoolPda(mint)`, when the token has graduated. Pass `pool: null` only while the token is still on its bonding curve.

---

## Trading Errors

### SellOverflowError

```
Sell amount ... would overflow the on-chain arithmetic for
virtualSolReserves=... . Max safe chunk is ... raw token units. Use
OnlinePumpSdk.sellChunked() or split the sell into smaller chunks.
```

**Cause:** The amount does not fit the arithmetic the program can represent. The sell multiply `amount * virtualSolReserves` is widened to u128 on-chain, so in practice the binding limit is the token amount's own u64 field width. This throws only for genuinely unrepresentable amounts.

**This is not the cause of an intermittent 6024.** If your sells succeed most of the time and fail occasionally at similar sizes, the cause is slippage and state drift, not arithmetic width: a function of `(amount, reserves)` would fail every time. See [Sell fails intermittently](#sell-fails-intermittently-anchorerror-6024) below.

**Fix:** Split the sell. Either call `OnlinePumpSdk.sellChunked()` (refetches state between chunks and sends each via your `sendTx` callback) or cap each sell at `maxSafeSellAmount(bondingCurve.virtualSolReserves)`. Properties: `amount`, `virtualSolReserves`, `maxSafeAmount`.

Pre-flight check without triggering the throw:

```typescript
import { maxSafeSellAmount, validateSellAmount } from "@nirholas/pump-sdk";

const max = maxSafeSellAmount(bondingCurve.virtualSolReserves);
if (amount.gt(max)) {
  // chunk the sell instead of sending one oversized instruction
}
// or let it throw:
validateSellAmount(amount, bondingCurve);
```

---

## Vanity Mint Errors

Thrown by `generateVanityMint` (see the [CLI Guide](./cli-guide.md) for the standalone generators).

| Error | Cause |
|-------|-------|
| `VanityMintPatternError` | Pattern contains non-Base58 characters (`0`, `O`, `I`, `l`) or exceeds `MAX_VANITY_PATTERN_LENGTH` (6) |
| `VanityMintMaxAttemptsError` | `maxAttempts` was reached before a matching keypair was found |

Both extend the shared base class `VanityError`, which carries a `type` field (`VanityErrorType`).

---

## Handling Errors

```typescript
import {
  PUMP_SDK,
  NoShareholdersError,
  TooManyShareholdersError,
  ZeroShareError,
  InvalidShareTotalError,
  DuplicateShareholderError,
} from "@nirholas/pump-sdk";

try {
  const ix = await PUMP_SDK.updateFeeShares({
    authority: wallet,
    mint: tokenMint,
    currentShareholders: [],
    newShareholders: shares,
  });
} catch (err) {
  if (err instanceof InvalidShareTotalError) {
    console.error(`Shares total ${err.total}, need 10000`);
  } else if (err instanceof TooManyShareholdersError) {
    console.error(`${err.count} shareholders, max ${err.max}`);
  } else if (err instanceof ZeroShareError) {
    console.error(`Zero share for ${err.address}`);
  }
}
```

---

## On-Chain Errors

The Anchor programs also return errors via transaction logs. Common on-chain errors:

| Error | Program | Cause |
|-------|---------|-------|
| `InsufficientFunds` | Pump | Not enough SOL for buy |
| `SlippageExceeded` / `TooLittleSolReceived` | Pump/PumpAMM | Price moved beyond slippage tolerance |
| `BondingCurveComplete` | Pump | Token already graduated; use AMM |
| `Overflow` (6024) | Pump | Intermittent: slippage and reserve drift between quote and landing. Consistent at one size: see `SellOverflowError` above |
| `Unauthorized` | All | Wrong authority/signer |
| `AccountNotFound` | All | PDA doesn't exist yet |

These are standard Anchor errors and appear in transaction logs, not as SDK exceptions.

---

## Related

- [Fee Sharing](./fee-sharing.md): share configuration
- [Troubleshooting](./TROUBLESHOOTING.md): symptom-driven fixes
- [API Reference](./api-reference.md): full SDK API

Runnable examples: see Curve Math & Fees examples 11-20 (`npm run example 15` covers the max-safe-sell limit).
