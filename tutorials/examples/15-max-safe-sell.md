# The Sell Overflow Guard

> What `maxSafeSellAmount` really bounds, why the old u64-derived limit refused 83% of sells the chain accepted, and how to tell a width limit apart from an intermittent slippage failure.

## What you'll build

A pre-flight check for sell instructions, and a diagnostic method that is worth more than the check.

Two failures look identical from the outside. Both surface as a sell that does not go through. Their causes have nothing in common:

1. **An unrepresentable amount.** The number does not fit the field the program stores it in. This is deterministic: the same amount against the same reserves fails every single time.
2. **Slippage and reserve drift.** Your quote was computed against reserves that moved before your transaction landed, so the program cannot deliver your `minSolOutput` and aborts with `AnchorError 6024` (Overflow). This is intermittent by nature.

Telling them apart is the whole skill, and getting it wrong is expensive. This SDK once shipped a `maxSafeSellAmount` derived from `u64::MAX`, on the theory that the on-chain multiply `amount * virtualSolReserves` had to fit in 64 bits. It does not: the program widens to u128 for that multiply. The consequence of the wrong bound was severe. **Sampling live mainnet trade events, 344 of 417 landed sells (83%) exceeded the old limit, some by more than 2000x.** The SDK was refusing, offline, transactions that mainnet was accepting all day.

This example runs the corrected guard and shows the reasoning that corrected it.

## Prerequisites

- Node 18 or newer, `npm install` run.
- Fully offline. No RPC, no wallet.
- Helpful context: [example 12](./12-sell-quote-offline.md) for the sell quote, [example 14](./14-target-sol.md) for where the ceiling shows up in exit planning.

Everything is `BN`, and here that is not stylistic. `u64::MAX` is 18,446,744,073,709,551,615 and `u128::MAX` is a 39-digit number. A JavaScript `number` loses exactness above about 9e15, so any reasoning about these bounds done in floats is reasoning about the wrong numbers.

## Walkthrough

### 1. Imports and the two widths

```ts
import {
  SellOverflowError,
  maxSafeSellAmount,
  validateSellAmount,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

import type { BondingCurve } from "@nirholas/pump-sdk";

import { curveAtVirtualSol, launchBondingCurve, mainnetGlobal } from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
```

```ts
/** u64::MAX: the on-chain width of a token amount. */
export const U64_MAX = new BN("18446744073709551615");

/** u128::MAX: the width the program multiplies in. */
export const U128_MAX = new BN("340282366920938463463374607431768211455");
```

Two constants, two different roles, and confusing them is the original defect in one line:

- **u64** is the width of a token amount as a field. `amount` is a `u64` in the instruction data and in the account state. A value above `u64::MAX` cannot be expressed at all.
- **u128** is the width the sell formula computes in. The deployed program casts to u128 before multiplying `amount * virtualSolReserves`, so the intermediate product has 128 bits of room even though its inputs are 64-bit.

The old bound assumed the product had to fit u64. It never did.

### 2. The check

```ts
export interface SellSafetyCheck {
  amount: BN;
  /** amount * virtualSolReserves, the on-chain intermediate product. */
  product: BN;
  /** Largest amount the SDK will let through for these reserves. */
  maxSafeAmount: BN;
  safe: boolean;
  /** Present when the check failed; the SDK's structured error. */
  error?: SellOverflowError;
}
```

```ts
export function checkSellSafety(
  bondingCurve: BondingCurve,
  amount: BN,
): SellSafetyCheck {
  const result: SellSafetyCheck = {
    amount,
    product: amount.mul(bondingCurve.virtualSolReserves),
    maxSafeAmount: maxSafeSellAmount(bondingCurve.virtualSolReserves),
    safe: true,
  };
  try {
    validateSellAmount(amount, bondingCurve);
  } catch (err) {
    if (err instanceof SellOverflowError) {
      result.safe = false;
      result.error = err;
      return result;
    }
    throw err;
  }
  return result;
}
```

This turns a throwing validator into a report. Three details worth copying:

**It computes the intermediate product itself** so you can see the number the on-chain math would hold, rather than trusting a claim about it.

**It catches only `SellOverflowError` and rethrows everything else.** A bare `catch` that swallows unknown errors turns an unrelated bug into a silent "unsafe". Narrow your catches to the class you can actually handle.

**It uses the SDK's own validator.** `validateSellAmount` is what `sellInstructions` calls internally, so this pre-flight cannot disagree with the enforcement path. Reimplementing the comparison would create a second bound that drifts from the first.

### 3. The corrected formula

```ts
  heading("The limit formula");
  console.log("maxSafeSellAmount = min(u64::MAX, floor(0.9 * u128::MAX / vSol))");
  console.log("The 10% margin absorbs reserve drift between quote and execution.");
```

The implementation in [`src/bondingCurve.ts`](../../src/bondingCurve.ts):

```ts
const SELL_SAFETY_MARGIN = U128_MAX.muln(9).divn(10);

export function maxSafeSellAmount(virtualSolReserves: BN): BN {
  if (virtualSolReserves.isZero()) return U64_MAX;
  return BN.min(U64_MAX, SELL_SAFETY_MARGIN.div(virtualSolReserves));
}
```

Read it as: take the largest amount whose product with the reserves still fits comfortably inside u128 (with 10% of headroom for reserves moving between quote and execution), then cap that at the largest amount a u64 field can hold at all.

The `min` is the point. **Two independent constraints, and the tighter one wins.** On any curve with meaningful reserves the u128-derived term is astronomically large, so `u64::MAX` wins and the bound is simply "the amount must be expressible".

The zero-reserve branch is not a special case for its own sake: a migrated curve has zero virtual reserves, cannot be sold on at all, and dividing by it would throw. Returning `u64::MAX` keeps the function total and lets the real "this curve is done" check happen where it belongs.

### 4. The u128 headroom, measured

```ts
  heading("The u128 product bound is never the constraint on a real curve");
  for (const vSol of [
    new BN("30000000000"), // 30 SOL
    new BN("60000000000"), // 60 SOL
    new BN("115000000000"), // ~graduation
  ]) {
    const productBound = U128_MAX.muln(9).divn(10).div(vSol);
    row(
      formatSol(vSol, 0),
      `product bound ${productBound.toString()} is ${productBound.div(U64_MAX).toString()}x wider than u64::MAX`,
    );
  }
```

Three reserve levels spanning a curve's entire life, from launch through graduation, with the product bound computed for each and expressed as a multiple of `u64::MAX`.

This is how you retire a wrong belief: **measure it across the whole realistic range rather than arguing about it.** The multiples come out in the hundreds of millions. There is no reserve level a Pump bonding curve reaches at which the u128 product is the binding constraint.

Note `productBound.div(U64_MAX)` is itself integer division on two enormous numbers, producing an exact quotient. No float could report "553402322x" correctly here.

### 5. The reported failure that was not a width problem

```ts
  heading("So does the amount from issue #6");
  const reported = checkSellSafety(mid, new BN("6325344957752"));
  row("Amount", formatTokens(reported.amount, 0));
  row("Safe", reported.safe);
```

6,325,344,957,752 base units, about 6.3M whole tokens, an ordinary position. It was reported as failing with `AnchorError 6024`, and the SDK at the time refused it outright.

The reporter supplied the detail that settles it: **it failed about one time in four.**

That single fact is decisive, and the reasoning is worth stating precisely because it generalizes far past this SDK:

> `maxSafeSellAmount(amount, reserves)` is a pure function. Given the same amount and the same reserves it returns the same answer every time, deterministically. A pure function cannot fail one attempt in four. Therefore an intermittent failure is not caused by it.

Whatever was aborting those transactions varied between attempts. Amount did not vary. The bound did not vary. **Reserves did**, because other people were trading the same curve in the same slots.

The corroborating evidence is the mainnet sample: 83% of landed sells exceeded the old bound. A limit that a large majority of successful transactions violate is not describing the chain's behavior; it is describing a mistaken belief about the chain's behavior.

### 6. What an intermittent 6024 actually is

```ts
  heading("What an intermittent 6024 really means");
  console.log("Reserves move between your quote and your landing slot. If the");
  console.log("curve drains, the sell can no longer produce your minSolOutput");
  console.log("and the program aborts. The fix is slippage headroom and quoting");
  console.log("close to send time, not a smaller sell.");
```

The sequence behind a real 6024:

1. You quote against reserves as of slot N.
2. Your instruction encodes a `minSolOutput` derived from that quote.
3. Between slot N and the slot your transaction lands in, other sells drain the curve.
4. Your sell now yields less than `minSolOutput`, and the program aborts.

The fix is on the slippage side, not the size side:

- **Widen slippage tolerance.** `sellInstructions` takes a `slippage` percentage; a tighter number is a stricter `minSolOutput` and a higher failure rate.
- **Quote as close to send time as possible.** A quote from thirty seconds ago describes a curve that no longer exists.
- **Re-quote on retry.** Retrying the identical instruction against moved reserves reproduces the same failure.

Shrinking the sell does not help, and is precisely the wrong reaction: it makes exits slower and increases the number of transactions exposed to the same drift.

[Error Reference](../../docs/errors.md) says the same thing in its `SellOverflowError` entry: "If your sells succeed most of the time and fail occasionally at similar sizes, the cause is slippage and state drift, not arithmetic width."

### 7. The rejection that is still real

```ts
  heading("A genuinely unrepresentable amount is still rejected");
  const tooWide = checkSellSafety(mid, U64_MAX.addn(1));
  row("Amount", "u64::MAX + 1");
  row("Safe", tooWide.safe);
  if (tooWide.error) {
    row("Error class", tooWide.error.constructor.name);
    row("Max safe amount", tooWide.error.maxSafeAmount.toString());
  }
```

Correcting a bound does not mean deleting it. `u64::MAX + 1` cannot be encoded in the instruction at all, so the guard still fires, and `SellOverflowError` still carries `amount`, `virtualSolReserves`, and `maxSafeAmount` so a caller can split the sell into representable chunks or call `OnlinePumpSdk.sellChunked()`.

What changed is the bound's tightness, not its existence. The guard now refuses only what is genuinely impossible.

### 8. The regression tests

[`examples/__tests__/11-16-curve-math.test.ts`](../../examples/__tests__/11-16-curve-math.test.ts) encodes all three cases so the old bound cannot come back:

```ts
it("flags an amount wider than the on-chain u64 token field", () => {
  const check = checkSellSafety(makeBondingCurve(), U64_MAX.addn(1));
  expect(check.safe).toBe(false);
  expect(check.maxSafeAmount.lte(U64_MAX)).toBe(true);
  expect(check.error).toBeDefined();
});

it("accepts the issue #6 amount that the old u64-derived bound refused", () => {
  const curve = makeBondingCurve({ virtualSolReserves: new BN("60000000000") });
  expect(checkSellSafety(curve, new BN("6325344957752")).safe).toBe(true);
});

it("passes ordinary position sizes", () => {
  // 1M tokens (6 decimals) against a fresh curve: an everyday exit, and
  // the size class the old u64-derived bound used to refuse.
  const check = checkSellSafety(makeBondingCurve(), new BN("1000000000000"));
  expect(check.safe).toBe(true);
  expect(check.error).toBeUndefined();
});
```

The middle test is named after the report it closes. That is the right way to write a regression test: the name states which real-world failure it prevents, so nobody has to reconstruct the history from a diff.

## Run it

```bash
npm run example 15
```

Real output from this repository:

```
What the guard actually bounds
------------------------------
The sell formula multiplies amount * virtualSolReserves before
dividing. The program widens to u128 for that multiply, so the
product has enormous headroom. The binding limit in practice is
the token amount's own u64 field width.

The limit formula
-----------------
maxSafeSellAmount = min(u64::MAX, floor(0.9 * u128::MAX / vSol))
The 10% margin absorbs reserve drift between quote and execution.

Limit at launch reserves (30 SOL)
---------------------------------
Virtual SOL reserves         30.0000 SOL
Max safe sell                18446744073709551615 base units
Which bound binds            u64 amount width

The u128 product bound is never the constraint on a real curve
--------------------------------------------------------------
30 SOL                       product bound 10208471007628153903901238222 is 553402322x wider than u64::MAX
60 SOL                       product bound 5104235503814076951950619111 is 276701161x wider than u64::MAX
115 SOL                      product bound 2663079393294301018409018666 is 144365823x wider than u64::MAX

An everyday exit passes
-----------------------
Amount                       1,000,000.00 tokens
Product                      60000000000000000000000
Safe                         true

So does the amount from issue #6
--------------------------------
Amount                       6,325,344 tokens
Safe                         true

That sell was reported as failing with AnchorError 6024, and the
SDK once refused this size outright. The reporter also said it
failed only about one time in four, which rules out a function of
(amount, reserves): that would fail every time. Sampling live
mainnet trade events, 83% of landed sells exceeded the old bound,
so the SDK was refusing transactions the chain accepts.

What an intermittent 6024 really means
--------------------------------------
Reserves move between your quote and your landing slot. If the
curve drains, the sell can no longer produce your minSolOutput
and the program aborts. The fix is slippage headroom and quoting
close to send time, not a smaller sell.

A genuinely unrepresentable amount is still rejected
----------------------------------------------------
Amount                       u64::MAX + 1
Safe                         false
Error class                  SellOverflowError
Max safe amount              18446744073709551615
```

The four numbers that carry the argument:

- **`Which bound binds: u64 amount width`.** At launch reserves the limit is `u64::MAX` itself. The product term is not close.
- **553402322x.** The u128 product bound at 30 SOL reserves is over half a billion times `u64::MAX`. Even at graduation reserves it is 144 million times wider. No realistic curve gets near it.
- **Product 60000000000000000000000 for an everyday 1M-token exit.** That is 6e22, which overflows u64 (about 1.8e19) by more than three orders of magnitude, and sits comfortably inside u128 (about 3.4e38). A u64-derived bound would refuse this trade. Mainnet executes it constantly.
- **Safe: true for the issue #6 amount.** The size that was once refused now passes, which is the whole point of the correction.

Deterministic and offline, so these digits reproduce exactly on any machine. The offline suite covers the same functions:

```bash
npm run test:examples
```

## Going further

**Related documentation**

- [Error Reference](../../docs/errors.md): the `SellOverflowError` entry, its properties, and the "Sell fails intermittently (AnchorError 6024)" distinction.
- [Bonding Curve Math](../../docs/bonding-curve-math.md): "The sell amount limit", with the same 83% mainnet sampling figure.
- [Troubleshooting](../../docs/TROUBLESHOOTING.md): symptom-driven fixes for failing transactions.
- [Tutorial 33: Error Handling Patterns](../33-error-handling-patterns.md): structured SDK errors and how to branch on them.

**Related examples**

- [Example 14: Sell Enough Tokens to Extract N SOL](./14-target-sol.md): where this ceiling bounds an exit plan, and where inventory binds first.
- [Example 12: Sell Quotes and Fee Impact](./12-sell-quote-offline.md): the quote whose `minSolOutput` a 6024 is really about.

**SDK surface used**

| Symbol | Role |
|--------|------|
| `maxSafeSellAmount(virtualSolReserves)` | `min(u64::MAX, floor(0.9 * u128::MAX / vSol))` |
| `validateSellAmount(amount, bondingCurve)` | Throws `SellOverflowError` for unrepresentable amounts |
| `SellOverflowError` | Carries `amount`, `virtualSolReserves`, `maxSafeAmount` |
| `OnlinePumpSdk.sellChunked` | Splits an oversized position, refetching state between chunks |

**Things to try next**

1. Compute the old bound (`u64::MAX / virtualSolReserves`) alongside the current one at 60 SOL reserves and count how many everyday position sizes fall between them. That interval is exactly what was being refused.
2. Feed `checkSellSafety` a range of amounts from 1e12 to 1e20 base units and find the exact crossover where `safe` flips. Confirm it lands on `u64::MAX`, not on anything reserve-dependent.
3. Next time you hit a 6024, before touching the amount, log the reserves at quote time and the reserves at landing. If they moved, you have your answer and the size was never the issue.
