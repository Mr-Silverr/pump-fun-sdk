# Sell Enough Tokens to Extract N SOL

> Plan an exit backwards from the SOL you want: binary-search the token amount whose net proceeds hit a target, and find the ceiling one sell instruction can reach.

## What you'll build

Every other quote in this SDK runs forward: you name an amount, it tells you the result. Exit planning runs backward. A trader does not think "what does 47,213,766 tokens fetch?", they think "I want 4.78 SOL out, how many tokens is that?"

Inverting a constant-product formula with fees applied on top is unpleasant analytically and easy numerically, so the SDK binary-searches it. This example wraps `getTokenAmountForTargetSol`, checks the answer by quoting it forward again, and surfaces the two ceilings a plan can run into:

- **The curve's own inventory.** You cannot sell more tokens than `realTokenReserves`.
- **The single-instruction safety limit**, `maxSafeSellAmount(virtualSolReserves)`, which keeps the amount inside what the on-chain arithmetic can represent.

At mainnet reserve sizes the first one binds and the second one never comes close. Understanding why is worth more than the plan itself, and [example 15](./15-max-safe-sell.md) takes that apart in full.

## Prerequisites

- Node 18 or newer with `npm install` run.
- Fully offline: no RPC, no wallet, no funds.
- Read [example 12](./12-sell-quote-offline.md) first if you have not. This tutorial inverts the quote that one explains.

Targets are lamports as `BN`. Token amounts are 6-decimal base units as `BN`. Nothing here is a `number`.

## Walkthrough

### 1. Imports

```ts
import {
  getSellSolAmountFromTokenAmount,
  getTokenAmountForTargetSol,
  maxSafeSellAmount,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

import type { BondingCurve, Global } from "@nirholas/pump-sdk";

import { curveAtVirtualSol, mainnetGlobal } from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
```

Three SDK functions: the inverse solver, the forward quote used to verify it, and the safety ceiling.

### 2. Planning one target

```ts
export interface TargetSolPlan {
  targetSol: BN;
  /** Tokens to sell, clamped to the single-instruction safe limit. */
  tokenAmount: BN;
  /** Net SOL those tokens actually yield after fees. */
  actualSolOut: BN;
  /** True when the target exceeds what one safe sell can extract. */
  capped: boolean;
}
```

```ts
export function planTargetSol(
  global: Global,
  bondingCurve: BondingCurve,
  targetSol: BN,
): TargetSolPlan {
  const mintSupply = global.tokenTotalSupply;
  const tokenAmount = getTokenAmountForTargetSol({
    global,
    feeConfig: null,
    mintSupply,
    bondingCurve,
    targetSol,
  });
  const actualSolOut = getSellSolAmountFromTokenAmount({
    global,
    feeConfig: null,
    mintSupply,
    bondingCurve,
    amount: tokenAmount,
  });
  return {
    targetSol,
    tokenAmount,
    actualSolOut,
    capped: actualSolOut.lt(targetSol),
  };
}
```

The shape of this function is the lesson. **Solve, then verify with the forward function, then compare.**

`getTokenAmountForTargetSol` returns a token amount. It does not return "and here is what it yields", and it does not throw when the target is out of reach. Re-quoting the answer with `getSellSolAmountFromTokenAmount` costs nothing offline and tells you both things you actually need: the real proceeds, and whether the solver hit a wall (`actualSolOut < targetSol`).

That verify-the-answer habit is what makes the `capped` flag meaningful rather than a guess. It is also the pattern to reach for any time you use a numerical solver: the solver's contract is "closest amount within bounds", not "your target, guaranteed".

### 3. Inside the search

From [`src/bondingCurve.ts`](../../src/bondingCurve.ts):

```ts
const safeMax = maxSafeSellAmount(bondingCurve.virtualSolReserves);
const upper = BN.min(bondingCurve.realTokenReserves, safeMax);

if (upper.isZero()) return new BN(0);

const maxOut = getSellSolAmountFromTokenAmount({
  global, feeConfig, mintSupply, bondingCurve, amount: upper,
});

// Target unreachable within a single safe sell — return the ceiling
if (maxOut.lte(targetSol)) return upper;

let lo = new BN(0);
let hi = upper;

while (hi.sub(lo).gtn(1)) {
  const mid = lo.add(hi).divn(2);
  const solOut = getSellSolAmountFromTokenAmount({
    global, feeConfig, mintSupply, bondingCurve, amount: mid,
  });
  if (solOut.gte(targetSol)) {
    hi = mid;
  } else {
    lo = mid;
  }
}

return hi;
```

Four things to notice.

**The upper bound is the smaller of two limits.** `min(realTokenReserves, maxSafeSellAmount(vSol))`. Inventory and arithmetic width, whichever bites first. On any real Pump curve, inventory bites first by an enormous margin.

**Unreachable targets return the ceiling, not an error.** If selling the entire upper bound still misses the target, the solver hands back the upper bound. Your caller gets the best achievable plan plus enough information to detect the shortfall, which is strictly more useful than an exception.

**The search is integer bisection over `BN`.** `lo.add(hi).divn(2)` and a `hi - lo > 1` termination condition. It converges in about 50 iterations over a 1e15-wide space, and every iteration is exact: no epsilon, no oscillation, no "close enough" tolerance. Binary search on integers terminates in a way binary search on floats does not.

**It returns `hi`, the side that satisfies the target.** The invariant maintained by the loop is that `hi` always yields at least `targetSol` and `lo` always yields less. Returning `hi` means the plan meets or beats the target, never undershoots by a lamport. Sellers care about that asymmetry.

Roughly 50 forward quotes run per plan. Offline, that is microseconds. This is a concrete argument for offline math: the same solver against an RPC-backed quote would be 50 network round trips per plan.

### 4. The single-sell ceiling

```ts
export function maxSingleSellExtraction(
  global: Global,
  bondingCurve: BondingCurve,
): { tokenAmount: BN; solOut: BN } {
  const tokenAmount = BN.min(
    bondingCurve.realTokenReserves,
    maxSafeSellAmount(bondingCurve.virtualSolReserves),
  );
  const solOut = getSellSolAmountFromTokenAmount({
    global,
    feeConfig: null,
    mintSupply: global.tokenTotalSupply,
    bondingCurve,
    amount: tokenAmount,
  });
  return { tokenAmount, solOut };
}
```

The same `min` the solver uses, exposed so a caller can ask "what is the most one sell can do here?" before planning anything.

`maxSafeSellAmount` is `min(u64::MAX, floor(0.9 * u128::MAX / virtualSolReserves))`. The on-chain sell multiply `amount * virtualSolReserves` is widened to u128, so the product bound is astronomically loose; what actually binds is the token amount's own u64 field width. Run the numbers at 60 SOL virtual reserves and the product bound is over 276 million times wider than `u64::MAX`, which is why the run below reports a ceiling of 256,600,000 tokens: that is `realTokenReserves`, the inventory limit, not any arithmetic limit.

If you take one thing from this section: **on a real curve, the ceiling is the curve's inventory.** [Example 15](./15-max-safe-sell.md) is the full treatment of the arithmetic bound and of the intermittent `AnchorError 6024` that is often mistaken for it.

### 5. Verification in the tests

[`examples/__tests__/11-16-curve-math.test.ts`](../../examples/__tests__/11-16-curve-math.test.ts) locks down both paths:

```ts
it("plans a sell that nets at least the target", () => {
  const plan = planTargetSol(global, curve, SOL(1));
  expect(plan.capped).toBe(false);
  expect(plan.tokenAmount.gtn(0)).toBe(true);
  expect(plan.actualSolOut.gte(SOL(1))).toBe(true);
});

it("caps an impossible target at the safe maximum", () => {
  const plan = planTargetSol(global, curve, SOL(1_000_000));
  expect(plan.capped).toBe(true);
  const max = maxSingleSellExtraction(global, curve);
  expect(plan.actualSolOut.lte(max.solOut)).toBe(true);
});
```

`actualSolOut.gte(SOL(1))`, exactly, with no tolerance: the plan meets or beats the target. And a million-SOL target on a curve holding tens of SOL sets `capped` and never exceeds the measured ceiling.

### 6. What `main()` demonstrates

```ts
  const global = mainnetGlobal();
  // Mid-curve state: 30 SOL already raised, so there is real SOL to extract.
  const curve = curveAtVirtualSol(global, new BN("60000000000"));
```

A launch curve holds zero real SOL, so there would be nothing to extract. `curveAtVirtualSol` slides the state to 60 SOL virtual, which means 30 SOL of real deposits are sitting in the curve. See [example 13](./13-market-cap.md) for how that derivation works.

```ts
  const targets = [
    ceiling.solOut.divn(10), // 10% of the ceiling
    ceiling.solOut.divn(4), // 25%
    ceiling.solOut.divn(2), // 50%
    ceiling.solOut.muln(9).divn(10), // 90%
  ];
```

Targets are expressed as fractions **of the measured ceiling**, in `BN`, rather than as hardcoded SOL figures. That way the demonstration stays meaningful if the curve state changes: every target is reachable by construction, so the binary search is exercised rather than the clamp path.

## Run it

```bash
npm run example 14
```

Real output from this repository:

```
Curve state (mid-curve, 30 SOL raised)
--------------------------------------
Virtual SOL reserves         60.0000 SOL
Real SOL in the curve        30.0000 SOL
Real tokens left             256,600,000 tokens

The single-sell ceiling
-----------------------
Max safe token amount        256,600,000.00 tokens
SOL that extracts            19121245742 lamports (19.121245742 SOL)

The SDK caps every sell at maxSafeSellAmount so the on-chain
amount * virtualSolReserves multiply cannot overflow u64 (example 15).

Binary-searched plans for reachable targets
-------------------------------------------
Target 1912124574 lamports   sell 17,938,327.43 tokens  nets 1912124574 lamports
Target 4780311435 lamports   sell 47,213,766.37 tokens  nets 4780311435 lamports
Target 9560622871 lamports   sell 103,539,335.13 tokens  nets 9560622871 lamports
Target 17209121167 lamports  sell 220,398,658.72 tokens  nets 17209121167 lamports

An unreachable target gets clamped
----------------------------------
Target                       1.0000 SOL
Clamped token amount         9,234,079.18 tokens
Best possible net            1000000000 lamports
Capped                       false
```

(The example prints a closing paragraph after that about re-planning between chunks.)

Reading the output carefully, including one place where it is worth reading past the section heading:

- **The ceiling is 256,600,000 tokens, which is exactly `realTokenReserves`.** Inventory binds, not arithmetic. The console line above it still describes the ceiling in terms of a u64 product overflow; that framing is the older story, and [example 15](./15-max-safe-sell.md) has the corrected one. The multiply is widened to u128 on-chain, and the amount's own u64 width is the real bound, which at these reserves is many orders of magnitude above the 256.6M tokens the curve holds.
- **Every reachable plan lands on its target to the lamport.** Target 4780311435, nets 4780311435. Not "approximately", not "within 0.1%". Integer bisection over an integer-valued monotone function can hit the exact boundary, and it does.
- **The plans are not linear in the target.** 10% of the ceiling takes 17.9M tokens; 90% takes 220.4M, twelve times as many for nine times the SOL. Price impact means each additional lamport of proceeds costs more tokens than the last, which is the same convexity [example 13](./13-market-cap.md) shows from the valuation side.
- **The last section does not clamp, and that is honest output.** With a ceiling of 19.12 SOL, a 1 SOL target is comfortably reachable: `capped` is `false` and the net is exactly 1000000000 lamports. The clamp path is real, and the test above exercises it with a 1,000,000 SOL target. To see it here, edit the target to something above the ceiling, for example `new BN("25000000000")` (25 SOL), and the token amount will come back as the full 256.6M with `capped: true`.

That last point is worth internalizing: **whether a target is reachable is a property of the curve state, not of the target's size.** On a curve early in its life, 1 SOL might genuinely be unreachable. Always check `capped` rather than assuming.

The offline suite covers the same functions:

```bash
npm run test:examples
```

## Going further

**Related documentation**

- [Bonding Curve Math](../../docs/bonding-curve-math.md): the sell formula, the safe sell limit, and `getTokenAmountForTargetSol` in reference form.
- [Error Reference](../../docs/errors.md): `SellOverflowError`, and why an intermittent `AnchorError 6024` is slippage rather than arithmetic width.
- [Tutorial 5: Bonding Curve Math Deep Dive](../05-bonding-curve-math.md): the surrounding math in narrative form.

**Related examples**

- [Example 12: Sell Quotes and Fee Impact](./12-sell-quote-offline.md): the forward quote this example inverts.
- [Example 15: The Sell Overflow Guard](./15-max-safe-sell.md): the corrected story on `maxSafeSellAmount`, and how to diagnose a 6024.
- [Example 13: Market Cap Along the Curve](./13-market-cap.md): where the mid-curve state used here comes from.

**SDK surface used**

| Symbol | Role |
|--------|------|
| `getTokenAmountForTargetSol` | Integer binary search for the token amount meeting a lamport target |
| `getSellSolAmountFromTokenAmount` | Forward quote used to verify every plan |
| `maxSafeSellAmount` | Single-instruction amount ceiling for given reserves |
| `OnlinePumpSdk.sellChunked` | The online path for exits larger than one instruction can carry |

**Things to try next**

1. Set a target above the ceiling (25 SOL against this curve) and confirm `capped` flips to `true` with the token amount pinned at `realTokenReserves`.
2. Chunk a large exit: plan a target, apply the sell to the reserves the way [example 16](./16-launch-price-ladder.md) applies buys, then re-plan the remainder against the updated state. The second chunk always needs more tokens than the first for the same SOL.
3. Compare the total tokens needed for one 10 SOL exit against four 2.5 SOL exits on the same starting curve. The difference is the cost of walking down your own price.
