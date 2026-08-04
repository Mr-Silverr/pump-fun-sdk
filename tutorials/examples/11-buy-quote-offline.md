# Buy Quotes, Fully Offline

> Price a Pump bonding curve buy in both directions with zero network access, using the same integer math the on-chain program runs.

## What you'll build

A quoting layer that answers the two questions every trading UI, bot, and PnL screen asks:

1. "I have 0.5 SOL. How many tokens does that buy?"
2. "I want 10,000,000 tokens. What will they cost me?"

Both answers come out of pure functions. No RPC endpoint, no wallet, no transaction, no waiting. You will also prove the two directions agree with each other by round-tripping a quote and measuring the drift in basis points, which is the cheapest possible regression test for curve math.

The example runs against a mainnet-shaped bonding curve state built in [`examples/_lib/curveState.ts`](../../examples/_lib/curveState.ts): the exact parameters a fresh Pump token launches with (30 SOL virtual, 1.073B virtual tokens, 793.1M real tokens for sale, 1% protocol fee, 0.5% creator fee).

## Prerequisites

- Node 18 or newer and a checkout of this repository with `npm install` already run.
- No RPC endpoint, no keypair, no funded wallet. This example never touches the network.
- A working idea of what a constant-product pool is. If you want the theory first, read [Bonding Curve Math](../../docs/bonding-curve-math.md); this tutorial is the runnable half of that page.

One rule matters more than any other before you start: **every amount in this SDK is a `BN` (bn.js), never a JavaScript `number`.** SOL is measured in lamports (1 SOL = 1,000,000,000 lamports) and Pump tokens are 6-decimal base units (1 token = 1,000,000 units). A `number` cannot hold 1e15 base units without losing precision, and a quote that is off by one unit is a quote that disagrees with the chain.

## Walkthrough

### 1. The imports

```ts
import {
  getBuySolAmountFromTokenAmount,
  getBuyTokenAmountFromSolAmount,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

import type { BondingCurve, Global } from "@nirholas/pump-sdk";

import { launchBondingCurve, mainnetGlobal } from "./_lib/curveState";
import { divToDecimalString, formatSol, formatTokens, heading, row } from "./_lib/format";
```

Two SDK functions do all the work. They are exported from the package root, not from an internal path, and they are the same functions `OnlinePumpSdk.quoteBuy` calls after it fetches state for you. Fetching state is the only thing the online path adds; the arithmetic is identical.

### 2. The quote context

```ts
export interface QuoteContext {
  global: Global;
  bondingCurve: BondingCurve;
  mintSupply: BN;
}

/** A fresh mainnet-shaped launch state, the default for every quote here. */
export function launchContext(): QuoteContext {
  const global = mainnetGlobal();
  return {
    global,
    bondingCurve: launchBondingCurve(),
    mintSupply: global.tokenTotalSupply,
  };
}
```

Every quote function in the SDK takes the same four inputs: the `Global` program config, an optional `FeeConfig`, the mint supply, and the bonding curve state. Bundling them into one `QuoteContext` keeps the call sites short and makes the dependency obvious: **a quote is a pure function of protocol config plus curve state.** Change nothing else and you get the same number every time, on any machine, forever.

`mintSupply` comes from `global.tokenTotalSupply` here because a fresh launch has not burned or minted anything. On a live token you would read the current supply, since the fee tier depends on market cap and market cap depends on supply.

### 3. Forward quote: SOL in, tokens out

```ts
/** How many tokens a given SOL spend buys (fees included in the spend). */
export function quoteTokensForSol(ctx: QuoteContext, solIn: BN): BN {
  return getBuyTokenAmountFromSolAmount({
    global: ctx.global,
    feeConfig: null,
    mintSupply: ctx.mintSupply,
    bondingCurve: ctx.bondingCurve,
    amount: solIn,
  });
}
```

`feeConfig: null` means "use the flat fees on `Global`" instead of the tiered fee-program account. That is the right choice for an offline demonstration, and it is also what happens on-chain whenever the fee config account is absent. To model the tiered schedule instead, pass `mainnetFeeConfig()` from the same helper module and read [Fee Tiers](../../docs/fee-tiers.md).

Inside `getBuyTokenAmountFromSolAmount` ([`src/bondingCurve.ts`](../../src/bondingCurve.ts)) three things happen, in this order:

1. **Fees come off the input first.** `inputAmount = (amount - 1) * 10000 / (totalFeeBps + 10000)`. The `- 1` is not a typo and not a rounding fudge; it mirrors the program byte for byte. Fees are charged on the spend, so a 1 SOL buy does not put 1 SOL into the reserves.
2. **The constant product prices the remainder.** `tokensOut = inputAmount * virtualTokenReserves / (virtualSolReserves + inputAmount)`.
3. **The result is capped at `realTokenReserves`.** You cannot buy tokens the curve does not hold. Near graduation this cap binds hard, and a UI that ignores it will quote fills that cannot happen.

Every one of those steps is integer division. Integer division truncates, so the quote is deliberately never rounded up in the buyer's favor.

### 4. Reverse quote: tokens wanted, SOL cost

```ts
/** How much SOL it costs to buy a given token amount (fees included). */
export function quoteSolForTokens(ctx: QuoteContext, tokenAmount: BN): BN {
  return getBuySolAmountFromTokenAmount({
    global: ctx.global,
    feeConfig: null,
    mintSupply: ctx.mintSupply,
    bondingCurve: ctx.bondingCurve,
    amount: tokenAmount,
  });
}
```

This is the inverse, and it is not simply the forward formula rearranged. It computes the raw curve cost `min(amount, realTokenReserves) * vSol / (vTok - min(amount, realTokenReserves)) + 1` and then **adds** the fee on top, whereas the forward direction **subtracts** the fee first. The `+ 1` compensates for truncation so the cost is never quoted a lamport short.

That asymmetry is exactly why the round trip in the next step is worth measuring rather than assuming.

### 5. Round-tripping a quote

```ts
export interface RoundTrip {
  solIn: BN;
  tokensOut: BN;
  solToBuySameTokens: BN;
  /** |solToBuySameTokens - solIn| in basis points of solIn. */
  driftBps: BN;
}
```

```ts
export function roundTrip(ctx: QuoteContext, solIn: BN): RoundTrip {
  const tokensOut = quoteTokensForSol(ctx, solIn);
  const solToBuySameTokens = quoteSolForTokens(ctx, tokensOut);
  const diff = solToBuySameTokens.sub(solIn).abs();
  return {
    solIn,
    tokensOut,
    solToBuySameTokens,
    driftBps: diff.muln(10_000).div(solIn),
  };
}
```

Quote SOL to tokens, then quote those exact tokens back to SOL. If both directions share one fee model and one pool, the reconstructed cost must land within rounding distance of the original spend.

Note how the drift is measured: `diff * 10000 / solIn`, all in `BN`. There is no `toNumber()` anywhere, no division into a float, no percentage computed with `/ 100`. This is the integer-math discipline in miniature. Multiply first to gain precision, divide last, and let truncation be the only loss.

The matching test in [`examples/__tests__/11-16-curve-math.test.ts`](../../examples/__tests__/11-16-curve-math.test.ts) turns that into a guarantee:

```ts
it("round-trips a quote back to nearly the same SOL", () => {
  const trip = roundTrip(ctx, SOL(1));
  expect(trip.driftBps.lten(5)).toBe(true);
});
```

Five basis points is the contract. In practice the drift is zero, as the run below shows, but the assertion leaves headroom for the truncation that different curve states produce.

### 6. The quote table and an all-BN average price

```ts
export interface QuoteRow {
  solIn: BN;
  tokensOut: BN;
  /** Lamports paid per 1,000,000 whole tokens received. */
  lamportsPerMillionTokens: BN;
}

/** Quote a list of buy sizes against the same curve state. */
export function buildBuyQuoteTable(ctx: QuoteContext, solAmounts: BN[]): QuoteRow[] {
  return solAmounts.map((solIn) => {
    const tokensOut = quoteTokensForSol(ctx, solIn);
    return {
      solIn,
      tokensOut,
      // 1M whole tokens = 1e12 base units; all-BN average execution price.
      lamportsPerMillionTokens: solIn.mul(new BN("1000000000000")).div(tokensOut),
    };
  });
}
```

An average execution price is a division, and a division of two integers where the numerator is smaller than the denominator gives zero. Lamports paid per single base unit of a fresh Pump token rounds to 0 every time, which is useless. Scaling the numerator by 1e12 first (one million whole tokens) moves the answer into a range integers can represent, and the unit becomes "lamports per 1M tokens".

That trick, **scale up before you divide**, is the standard fix whenever an integer price threatens to round to zero. Example 41 uses the same idea in a different shape, with a cross-multiplication comparison instead of two per-token prices.

Every row here quotes against **the same unchanged curve state**, so the table shows what four different traders would each get if they arrived first. It is not a simulation of four sequential buys. For that, see [example 16](./16-launch-price-ladder.md), which applies each fill to the reserves before quoting the next one.

### 7. The walkthrough in `main()`

```ts
  heading("Buy quotes (SOL in, tokens out)");
  const sizes = [
    new BN("100000000"), // 0.1 SOL
    new BN("500000000"), // 0.5 SOL
    new BN("1000000000"), // 1 SOL
    new BN("5000000000"), // 5 SOL
  ];
```

Sizes are written as `new BN("100000000")` with a comment, never as `0.1 * 1e9`. A float multiplication that happens to be exact today is a defect waiting for a value where it is not.

## Run it

```bash
npm run example 11
```

Real output from this repository:

```
Curve state (fresh mainnet launch)
----------------------------------
Virtual SOL reserves         30.0000 SOL
Virtual token reserves       1,073,000,000.00 tokens
Real token reserves          793,100,000.00 tokens
Protocol fee                 100 bps

Buy quotes (SOL in, tokens out)
-------------------------------
0.1000 SOL                   3,529,605.22 tokens  (avg 0.028331 SOL per 1M tokens)
0.5000 SOL                   17,418,831.10 tokens  (avg 0.028704 SOL per 1M tokens)
1.0000 SOL                   34,281,150.09 tokens  (avg 0.029170 SOL per 1M tokens)
5.0000 SOL                   151,983,002.79 tokens  (avg 0.032898 SOL per 1M tokens)

Reverse quote (tokens wanted, SOL cost)
---------------------------------------
Tokens wanted                10,000,000.00 tokens
SOL cost (fees included)     0.285042 SOL

Round-trip consistency
----------------------
0.1000 SOL                   rebuilds to 0.099999 SOL  drift 0 bps
0.5000 SOL                   rebuilds to 0.499999 SOL  drift 0 bps
1.0000 SOL                   rebuilds to 0.999999 SOL  drift 0 bps
5.0000 SOL                   rebuilds to 4.999999 SOL  drift 0 bps

Both directions price through the same constant-product pool and the
same fee schedule, so a quote and its reverse agree to rounding dust.
```

Three things to read out of that output:

- **The average price climbs with size.** 0.1 SOL executes at 0.028331 SOL per 1M tokens; 5 SOL executes at 0.032898, about 16% worse. That gap is price impact, and it is a property of the curve, not a fee. Nothing was configured to produce it.
- **The round trip loses a fraction of a lamport, not a fraction of a percent.** `1.0000 SOL` rebuilds to `0.999999 SOL`: one lamport of truncation on a billion, which is 0 bps after integer division.
- **Fees are already inside every number.** The 0.285042 SOL reverse quote is what leaves your wallet, not a pre-fee subtotal.

Because the example is fully offline and deterministic, those numbers are reproducible: run it on any machine and you get the same digits. The offline test suite covers the same functions:

```bash
npm run test:examples
```

## Going further

**Related documentation**

- [Bonding Curve Math](../../docs/bonding-curve-math.md): the formulas behind both directions, including the exact fee-deduction expression and the graduation rule.
- [Fee Tiers](../../docs/fee-tiers.md): what changes when you pass a real `feeConfig` instead of `null`.
- [Tutorial 5: Bonding Curve Math Deep Dive](../05-bonding-curve-math.md): the same math in narrative form, with the online (`OnlinePumpSdk`) fetch path.
- [API Reference](../../docs/api-reference.md): full signatures for every function used here.

**Related examples**

- [Example 12: Sell Quotes and Fee Impact](./12-sell-quote-offline.md): the other direction, split into gross, fee, and net.
- [Example 13: Market Cap Along the Curve](./13-market-cap.md): what these reserves imply about valuation.
- [Example 16: Launch Price Ladder](./16-launch-price-ladder.md): applies quotes to the reserves and walks the price up buy by buy.
- [Example 41: AMM Buy](./41-amm-buy.md): the same quoting instinct after a token graduates to a PumpSwap pool.

**SDK surface used**

| Symbol | Role |
|--------|------|
| `getBuyTokenAmountFromSolAmount` | Forward quote: lamports in, base units out |
| `getBuySolAmountFromTokenAmount` | Reverse quote: base units wanted, lamports cost |
| `Global`, `BondingCurve` | State shapes every quote reads |

**Things to try next**

1. Swap `feeConfig: null` for `mainnetFeeConfig()` from [`examples/_lib/curveState.ts`](../../examples/_lib/curveState.ts) and watch the quotes change as the market cap crosses a tier threshold.
2. Quote against `curveAtVirtualSol(global, new BN("110000000000"))` instead of a launch curve and see the `realTokenReserves` cap start clipping large buys near graduation.
3. Wire `quoteTokensForSol` behind a debounced input field. Because it is synchronous and offline, a UI can re-quote on every keystroke without a single network call.
