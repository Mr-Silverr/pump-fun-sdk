# Sell Quotes and Fee Impact

> Quote a bonding curve sell offline and split it into gross proceeds, fees taken, and the net SOL a seller actually keeps.

## What you'll build

A sell quote that a PnL screen can trust. The SDK gives you one number, the net proceeds, because that is the number the chain pays out. But "you will receive 0.272853 SOL" answers only half the question a trader is asking. The other half is "and what did that cost me?"

This example decomposes every sell into three parts:

- **Gross**: what the constant-product pool releases before any fee.
- **Fee**: protocol fee, plus the creator fee when the curve has a creator set.
- **Net**: what lands in the seller's wallet.

Then it does two things that only an offline example can do cheaply: it prices the same sell against two otherwise identical curves, one with a creator and one without, to isolate the creator fee's exact cost in lamports; and it walks a dust sell down to the point where the net clamps to zero, which is where a naive PnL implementation would go negative.

## Prerequisites

- Node 18 or newer, with `npm install` run in this repository.
- No RPC, no wallet, no funds. Nothing here touches the network.
- Familiarity with the buy side helps but is not required. [Example 11](./11-buy-quote-offline.md) covers the forward direction and the integer-math conventions used throughout.

All amounts are `BN`. Token amounts are 6-decimal base units (1 token = 1,000,000 units), SOL is lamports (1 SOL = 1,000,000,000). A 1,000,000-token sell is written `new BN("1000000000000")`.

## Walkthrough

### 1. Imports and state

```ts
import { getSellSolAmountFromTokenAmount } from "@nirholas/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import type { BondingCurve, Global } from "@nirholas/pump-sdk";

import {
  EXAMPLE_CREATOR,
  launchBondingCurve,
  mainnetGlobal,
} from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
```

One SDK function carries the whole example. `EXAMPLE_CREATOR` is a stand-in creator address from [`examples/_lib/curveState.ts`](../../examples/_lib/curveState.ts); its only job is to be something other than `PublicKey.default`, because that is precisely the test the fee logic performs.

### 2. Reconstructing gross from the curve

```ts
export interface SellQuoteBreakdown {
  tokenAmount: BN;
  /** SOL the curve releases before any fee, in lamports. */
  grossSol: BN;
  /** Protocol fee plus creator fee (when a creator is set), in lamports. */
  feeSol: BN;
  /** What the seller actually receives, in lamports. */
  netSol: BN;
}
```

```ts
export function quoteSellBreakdown(
  global: Global,
  bondingCurve: BondingCurve,
  tokenAmount: BN,
): SellQuoteBreakdown {
  const grossSol = tokenAmount
    .mul(bondingCurve.virtualSolReserves)
    .div(bondingCurve.virtualTokenReserves.add(tokenAmount));

  const netSol = getSellSolAmountFromTokenAmount({
    global,
    feeConfig: null,
    mintSupply: global.tokenTotalSupply,
    bondingCurve,
    amount: tokenAmount,
  });

  return { tokenAmount, grossSol, feeSol: grossSol.sub(netSol), netSol };
}
```

This is the heart of the example, and the structure is worth dwelling on.

**Gross is computed by hand.** The line

```ts
tokenAmount.mul(bondingCurve.virtualSolReserves).div(bondingCurve.virtualTokenReserves.add(tokenAmount))
```

is the sell side of the constant product, `amount * vSol / (vTok + amount)`, written out exactly as [`src/bondingCurve.ts`](../../src/bondingCurve.ts) writes it internally. Selling pushes tokens **into** the pool, so the token reserve grows by the amount sold, which is why the denominator adds rather than subtracts. Reproducing it here is not duplication for its own sake: the SDK deliberately exposes only the net, so recovering gross is the caller's job and this is how you do it correctly.

**Net comes from the SDK.** Never reimplement the fee schedule. `getSellSolAmountFromTokenAmount` applies `computeFeesBps` (which handles tiered fee configs, mayhem mode, and the creator check) and then subtracts. Reimplementing that would be a second source of truth that drifts the first time the protocol changes a rate.

**Fee is derived, not computed.** `feeSol = grossSol - netSol`. Because gross is the pre-fee curve output and net is the post-fee payout, the difference is the fee by definition. Any other derivation risks disagreeing with the number that actually gets charged.

The test in [`examples/__tests__/11-16-curve-math.test.ts`](../../examples/__tests__/11-16-curve-math.test.ts) asserts exactly that identity, in `BN`, with no tolerance at all:

```ts
it("breaks proceeds into net and fees that sum to gross", () => {
  const q = quoteSellBreakdown(makeGlobal(), activeCurve, new BN("50000000000000"));
  expect(q.netSol.gtn(0)).toBe(true);
  expect(q.netSol.add(q.feeSol).eq(q.grossSol)).toBe(true);
});
```

`net + fee === gross`, exactly. That is the kind of assertion integer math makes possible. A floating-point implementation would need an epsilon, and an epsilon is where accounting bugs hide.

### 3. Isolating the creator fee

```ts
export interface FeeImpactComparison {
  tokenAmount: BN;
  /** Net proceeds when the curve has no creator set (protocol fee only). */
  netWithoutCreator: BN;
  /** Net proceeds when a creator collects their fee too. */
  netWithCreator: BN;
  /** Extra lamports the creator fee costs the seller. */
  creatorFeeCost: BN;
}
```

```ts
export function compareCreatorFeeImpact(
  global: Global,
  tokenAmount: BN,
): FeeImpactComparison {
  const withoutCreator = quoteSellBreakdown(
    global,
    launchBondingCurve({ creator: PublicKey.default }),
    tokenAmount,
  );
  const withCreator = quoteSellBreakdown(
    global,
    launchBondingCurve({ creator: EXAMPLE_CREATOR }),
    tokenAmount,
  );
  return {
    tokenAmount,
    netWithoutCreator: withoutCreator.netSol,
    netWithCreator: withCreator.netSol,
    creatorFeeCost: withoutCreator.netSol.sub(withCreator.netSol),
  };
}
```

Two curves, identical in every field except `creator`, quoted for the same token amount. The difference in net is the creator fee, measured rather than assumed.

The mechanism behind it lives in `computeFeesBps` and its caller: the creator fee is added to the total only when `!PublicKey.default.equals(bondingCurve.creator)`. The default pubkey (all zero bytes) is the protocol's way of saying "no creator", so a curve with `creator: PublicKey.default` pays 100 bps while a curve with a real creator pays 150 bps under the mainnet flat-fee config.

This is a pattern worth stealing for any fee question: **build two states that differ in exactly one field, quote both, subtract.** It is more reliable than reading the fee code and reasoning about which branch fires, and it keeps working when the fee code changes.

Being offline is what makes it cheap. You cannot ask mainnet "what would this sell have netted if the token had no creator?"

### 4. Where net clamps to zero

```ts
  heading("Why net can hit zero");
  const dust = quoteSellBreakdown(global, curve, new BN("35766"));
  row("Dust sell", formatTokens(dust.tokenAmount, 6));
  row("Gross", `${dust.grossSol.toString()} lamports`);
  row("Net (clamped)", `${dust.netSol.toString()} lamports`);
```

35,766 base units is 0.035766 of one token. At launch reserves the curve owes roughly one lamport for it, fees round up by ceiling division, and the result would be negative.

The SDK's final line in the sell path is:

```ts
// ceilDiv fee rounding can exceed gross SOL for dust amounts; clamp to 0.
return BN.max(new BN(0), netSol);
```

The clamp is not defensive decoration. Sell instructions encode a `minSolOutput` as an unsigned 64-bit integer. A negative value serialized into a u64 field wraps to something astronomically large, the program compares it against real proceeds, and the transaction aborts with an error that looks nothing like "your sell was too small". Clamping to zero turns a confusing on-chain failure into an obviously-useless quote that your UI can reject before signing.

Practical consequence: **treat a zero net quote as a refusal, not as a free trade.** Anything that dust-sells in a loop without checking will burn transaction fees producing nothing.

### 5. What `main()` prints

```ts
  heading("Sell quotes (gross / fee / net)");
  const sizes = [
    new BN("1000000000000"), // 1M tokens
    new BN("10000000000000"), // 10M tokens
    new BN("50000000000000"), // 50M tokens
    new BN("100000000000000"), // 100M tokens
  ];
  for (const amount of sizes) {
    const q = quoteSellBreakdown(global, curve, amount);
    row(
      formatTokens(q.tokenAmount, 0),
      `gross ${formatSol(q.grossSol, 6)}  fee ${formatSol(q.feeSol, 6)}  net ${formatSol(
        q.netSol,
        6,
      )}`,
    );
  }
```

Four sizes spanning two orders of magnitude, all quoted against the same unchanged launch curve. As with the buy side, this is four independent hypotheticals, not a sequence: each row assumes the seller arrives first.

## Run it

```bash
npm run example 12
```

Real output from this repository:

```
Curve state (fresh launch, creator set)
---------------------------------------
Virtual SOL reserves         30.0000 SOL
Virtual token reserves       1,073,000,000.00 tokens
Protocol fee                 100 bps
Creator fee                  50 bps

Sell quotes (gross / fee / net)
-------------------------------
1,000,000 tokens             gross 0.027932 SOL  fee 0.000418 SOL  net 0.027513 SOL
10,000,000 tokens            gross 0.277008 SOL  fee 0.004155 SOL  net 0.272853 SOL
50,000,000 tokens            gross 1.335707 SOL  fee 0.020035 SOL  net 1.315672 SOL
100,000,000 tokens           gross 2.557544 SOL  fee 0.038363 SOL  net 2.519181 SOL

Creator fee impact on 10M-token sell
------------------------------------
Net, no creator (1% fee)     0.274238 SOL
Net, creator set (1.5% fee)  0.272853 SOL
Creator fee costs seller     0.001385 SOL

Why net can hit zero
--------------------
Dust sell                    0.035766 tokens
Gross                        0 lamports
Net (clamped)                0 lamports

Fees round up (ceiling division), so a dust sell whose gross proceeds
are ~1 lamport nets exactly 0. The SDK clamps instead of going negative,
because a negative amount encoded as u64 would wrap and abort on-chain.
```

Reading it:

- **The fee is a flat 150 bps of gross, at every size.** 0.000418 / 0.027932 and 0.038363 / 2.557544 both land on 1.5%. Fees do not scale with size under a flat config; only price impact does.
- **Price impact does scale.** 1M tokens fetch 0.027932 SOL gross, so 100M tokens at that rate would be 2.7932 SOL. They actually fetch 2.557544, about 8.4% less. Selling into a pool moves the price against you, and the constant product is what does the moving.
- **The creator fee costs 0.001385 SOL on a 0.277 SOL sell.** That is the measured 50 bps, confirming the two-curve subtraction agrees with the configured rate.
- **The dust sell reports gross 0.** Even before fees, 0.035766 of a token rounds to zero lamports on this curve. Integer division truncates, and there is no smaller unit than a lamport.

The offline tests cover the same functions:

```bash
npm run test:examples
```

## Going further

**Related documentation**

- [Bonding Curve Math](../../docs/bonding-curve-math.md): the sell formula, the fee subtraction, and the zero clamp in reference form.
- [Fee Tiers](../../docs/fee-tiers.md): how a real `feeConfig` replaces the flat rates used here with market-cap-dependent ones.
- [Error Reference](../../docs/errors.md): what the SDK throws on the sell path and what the on-chain Anchor errors mean.
- [Tutorial 9: Understanding the Fee System](../09-fee-system.md): protocol, creator, and shared fees end to end.

**Related examples**

- [Example 11: Buy Quotes, Fully Offline](./11-buy-quote-offline.md): the same math in the other direction.
- [Example 14: Sell Enough Tokens to Extract N SOL](./14-target-sol.md): inverts this quote to plan an exit around a SOL target.
- [Example 15: The Sell Overflow Guard](./15-max-safe-sell.md): the ceiling on a single sell instruction, and how to tell it apart from slippage.
- [Example 13: Market Cap Along the Curve](./13-market-cap.md): what the same reserves say about valuation.

**SDK surface used**

| Symbol | Role |
|--------|------|
| `getSellSolAmountFromTokenAmount` | Net sell proceeds in lamports, fees already subtracted |
| `BondingCurve.creator` | The field that decides whether a creator fee applies |
| `Global.creatorFeeBasisPoints` | The flat creator rate used when `feeConfig` is `null` |

**Things to try next**

1. Pass `mainnetFeeConfig()` instead of `feeConfig: null` and re-run `compareCreatorFeeImpact` against curves at different market caps. The creator fee cost will change with the tier.
2. Binary-search for the largest token amount whose net still clamps to zero on a launch curve. That value is the practical dust floor your UI should refuse below.
3. Feed the breakdown into a realized-PnL calculation: entry cost from [example 11](./11-buy-quote-offline.md)'s reverse quote, exit proceeds from `netSol` here, both in `BN`, subtracted at the end.
