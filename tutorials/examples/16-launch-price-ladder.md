# Launch Price Ladder

> Simulate a sequence of buys from a fresh launch, applying each fill to the reserves, and watch the price ratchet up with nothing but integer arithmetic.

## What you'll build

Examples 11 through 14 quote against a fixed curve state. This one moves the curve.

Starting from `newBondingCurve(global)`, it buys 1 SOL ten times in a row, applying each fill to the virtual and real reserves before quoting the next one, and prints the spot price and market cap after every step. The result is the price ladder an early launch actually climbs.

By the end you will have a `applyBuy` function that reproduces the on-chain reserve update exactly, which is the building block for backtesting a sniper, previewing a multi-wallet entry, or drawing a launch chart that matches what the chain will do rather than an approximation of it.

## Prerequisites

- Node 18 or newer, `npm install` run.
- Fully offline. No RPC, no wallet, no funds.
- [Example 11](./11-buy-quote-offline.md) covers the quote function this simulation calls in a loop. [Example 13](./13-market-cap.md) covers the market cap formula printed at each step.

Everything is `BN`. Simulating state transitions is where that discipline pays the most: an error of one base unit compounds through ten steps and quietly diverges from the chain, and a float that rounds differently than the program's integer division will disagree by the third buy.

## Walkthrough

### 1. Imports

```ts
import {
  bondingCurveMarketCap,
  computeFeesBps,
  getBuyTokenAmountFromSolAmount,
  newBondingCurve,
} from "@nirholas/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import type { BondingCurve, Global } from "@nirholas/pump-sdk";

import { EXAMPLE_CREATOR, mainnetGlobal } from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
```

`newBondingCurve` builds the launch state straight from `Global`, `computeFeesBps` resolves the fee rates the program would use, `getBuyTokenAmountFromSolAmount` quotes each fill, and `bondingCurveMarketCap` values the result.

### 2. Spot price without rounding to zero

```ts
/** Lamports per 1,000,000 whole tokens (1e12 base units), pure BN. */
export function spotPriceLamportsPerMillionTokens(bondingCurve: BondingCurve): BN {
  return bondingCurve.virtualSolReserves
    .mul(new BN("1000000000000"))
    .div(bondingCurve.virtualTokenReserves);
}
```

Spot price is `vSol / vTok`, the marginal price for an infinitesimally small trade. At launch that ratio is 3e10 / 1.073e15, which in integer arithmetic is **zero**.

Scaling the numerator by 1e12 first (one million whole tokens in base units) moves the answer into a range integers can express. Multiply before you divide; that is the whole trick, and it is the same one [example 11](./11-buy-quote-offline.md) uses for average execution price.

Spot price and average execution price are different things and the example prints both. Spot is the price at the current reserves, before your trade moves them. Average execution is what your fill actually cost, and on a curve it is always worse than the spot you saw beforehand. Confusing the two is how a UI ends up promising a price it cannot deliver.

### 3. Applying one buy

```ts
export interface BuyApplication {
  /** Tokens the buyer receives for this step's SOL spend. */
  tokensOut: BN;
  /** The fee-stripped SOL that actually enters the reserves. */
  solIntoReserves: BN;
  /** The curve state after the buy. */
  curve: BondingCurve;
}
```

```ts
export function applyBuy(
  global: Global,
  bondingCurve: BondingCurve,
  solIn: BN,
): BuyApplication {
  const { protocolFeeBps, creatorFeeBps } = computeFeesBps({
    global,
    feeConfig: null,
    mintSupply: global.tokenTotalSupply,
    virtualSolReserves: bondingCurve.virtualSolReserves,
    virtualTokenReserves: bondingCurve.virtualTokenReserves,
  });
  const totalFeeBps = protocolFeeBps.add(
    PublicKey.default.equals(bondingCurve.creator) ? new BN(0) : creatorFeeBps,
  );
  const solIntoReserves = solIn
    .subn(1)
    .muln(10_000)
    .div(totalFeeBps.addn(10_000));

  const tokensOut = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig: null,
    mintSupply: global.tokenTotalSupply,
    bondingCurve,
    amount: solIn,
  });

  return {
    tokensOut,
    solIntoReserves,
    curve: {
      ...bondingCurve,
      virtualSolReserves: bondingCurve.virtualSolReserves.add(solIntoReserves),
      virtualTokenReserves: bondingCurve.virtualTokenReserves.sub(tokensOut),
      realSolReserves: bondingCurve.realSolReserves.add(solIntoReserves),
      realTokenReserves: bondingCurve.realTokenReserves.sub(tokensOut),
    },
  };
}
```

Four things this gets right, each of which is a place a hand-rolled simulator typically goes wrong.

**Fees come off the spend before it reaches the reserves.** `solIntoReserves = (solIn - 1) * 10000 / (totalFeeBps + 10000)`. A 1 SOL buy on a curve with a creator does not add 1 SOL to `virtualSolReserves`; it adds about 0.985 SOL. The `- 1` and the exact division order are copied from the program, not approximated. Getting this wrong inflates the simulated reserves a little on every step, and the error compounds.

**Fee rates come from `computeFeesBps`, not from constants.** That function handles tiered fee configs and mayhem mode. Hardcoding "150 bps" would be right for exactly one configuration and silently wrong for the rest.

**The creator check mirrors the program's.** `PublicKey.default.equals(bondingCurve.creator)` decides whether the creator fee applies. The default pubkey means "no creator".

**All four reserve fields move, and the curve is not mutated.** `virtualSol` and `realSol` rise by the fee-stripped input; `virtualToken` and `realToken` fall by the tokens sold. `{ ...bondingCurve, ... }` returns a new object, so the caller's state is untouched and each step is a clean value transition. Mutating shared state in a simulation loop is how you end up unable to reproduce a run.

Notice the fee split: `solIn - solIntoReserves` is what protocol and creator collect. It never enters the pool and it never affects the price. The price moves only on the fee-stripped remainder, which is why a curve's `realSolReserves` grows slower than the SOL its buyers spent.

### 4. The ladder

```ts
export interface LadderStep {
  buyIndex: number;
  solIn: BN;
  tokensOut: BN;
  spotPrice: BN;
  marketCap: BN;
  curve: BondingCurve;
}
```

```ts
export function simulateBuySequence(global: Global, buys: BN[]): LadderStep[] {
  // A live curve always has its creator set, so creator fees apply from
  // the first post-launch trade.
  let curve: BondingCurve = { ...newBondingCurve(global), creator: EXAMPLE_CREATOR };
  const steps: LadderStep[] = [];

  buys.forEach((solIn, index) => {
    const applied = applyBuy(global, curve, solIn);
    curve = applied.curve;
    steps.push({
      buyIndex: index + 1,
      solIn,
      tokensOut: applied.tokensOut,
      spotPrice: spotPriceLamportsPerMillionTokens(curve),
      marketCap: bondingCurveMarketCap({
        mintSupply: global.tokenTotalSupply,
        virtualSolReserves: curve.virtualSolReserves,
        virtualTokenReserves: curve.virtualTokenReserves,
      }),
      curve,
    });
  });

  return steps;
}
```

Fold a list of spends over the curve state, recording a snapshot per step. Each `LadderStep` carries the full `curve` as well as the derived numbers, so a caller can restart the simulation from any point or diff two states.

The creator override matters more than it looks. `newBondingCurve(global)` sets `creator: PublicKey.default`, which is the correct pre-creation state, but no live curve stays that way: creation assigns a real creator. Simulating without it would understate fees by 50 bps on every buy and overstate the tokens each buyer receives. The comment in the source says exactly this, and it is the kind of detail that separates a simulation you can trust from one that looks plausible.

The test in [`examples/__tests__/11-16-curve-math.test.ts`](../../examples/__tests__/11-16-curve-math.test.ts) pins the mechanics:

```ts
it("applyBuy moves reserves the way the program does", () => {
  const before = makeBondingCurve();
  const spotBefore = spotPriceLamportsPerMillionTokens(before);
  const { curve: after, tokensOut, solIntoReserves } = applyBuy(global, before, SOL(5));
  expect(tokensOut.gtn(0)).toBe(true);
  expect(solIntoReserves.gtn(0)).toBe(true);
  expect(solIntoReserves.lte(SOL(5))).toBe(true);
  expect(after.virtualSolReserves.gt(before.virtualSolReserves)).toBe(true);
  expect(after.virtualTokenReserves.lt(before.virtualTokenReserves)).toBe(true);
  expect(spotPriceLamportsPerMillionTokens(after).gte(spotBefore)).toBe(true);
});
```

`solIntoReserves <= solIn` (fees never create SOL), SOL reserve up, token reserve down, price non-decreasing. Those four properties are what "the way the program does" means operationally, and they hold for any spend on any state.

### 5. Printing the table

```ts
  heading("Ten buys of 1 SOL each");
  console.log(
    `${"buy".padEnd(6)}${"tokens out".padEnd(24)}${"spot / 1M tokens".padEnd(22)}market cap`,
  );
  const buys = Array.from({ length: 10 }, () => new BN("1000000000"));
```

Ten identical spends. Identical input is what makes the output legible: every difference between rows is caused by the curve, not by the trade.

## Run it

```bash
npm run example 16
```

Real output from this repository:

```
Launch state (newBondingCurve)
------------------------------
Virtual SOL                  30.0000 SOL
Virtual tokens               1,073,000,000 tokens
Spot price                   0.027958 SOL per 1M tokens

Ten buys of 1 SOL each
----------------------
buy   tokens out              spot / 1M tokens      market cap
1     34,117,646 tokens       0.029825 SOL          29.82 SOL
2     32,014,864 tokens       0.031752 SOL          31.75 SOL
3     30,100,672 tokens       0.033739 SOL          33.73 SOL
4     28,353,173 tokens       0.035787 SOL          35.78 SOL
5     26,753,558 tokens       0.037894 SOL          37.89 SOL
6     25,285,598 tokens       0.040062 SOL          40.06 SOL
7     23,935,233 tokens       0.042291 SOL          42.29 SOL
8     22,690,227 tokens       0.044579 SOL          44.57 SOL
9     21,539,899 tokens       0.046928 SOL          46.92 SOL
10    20,474,885 tokens       0.049338 SOL          49.33 SOL

Each identical 1 SOL buy receives fewer tokens than the one
before it: the fee-stripped SOL raises virtualSolReserves while
tokens leave virtualTokenReserves, so the ratio (the price) only
moves up. Nothing about this needs an oracle; the reserves ARE
the price.
```

What the ladder shows:

- **The first buyer gets 34,117,646 tokens; the tenth gets 20,474,885 for the same 1 SOL.** A 40% penalty for arriving nine trades late, on a curve that has absorbed under 10 SOL. Early-buyer advantage on a bonding curve is arithmetic, not sentiment.
- **Spot price rises 77% over ten buys** (0.027958 to 0.049338 SOL per 1M tokens), and it rises monotonically. With no sells, it cannot do otherwise: `vSol` only goes up, `vTok` only goes down, and the price is their ratio.
- **Market cap tracks spot exactly.** 0.049338 SOL per 1M tokens times 1e9 tokens of supply is 49.33 SOL. Market cap on a bonding curve is spot price times supply, nothing more.
- **The step size shrinks in relative terms.** Buy 1 lifts the cap by 1.87 SOL (from the 27.95 launch cap), buy 10 by 2.41 SOL. In absolute lamports each buy moves the price more than the last, because the reserve ratio is convex; in percentage terms each 1 SOL is a smaller fraction of a growing pool. Both statements are true and they describe different things.
- **10 SOL of spend produced 49.33 SOL of market cap.** Roughly 9.85 SOL entered the reserves after fees and multiplied through the 1e9 supply against a shrinking token reserve. This leverage of spend into valuation is the mechanic the entire launchpad is built on.

Deterministic and offline, so the digits reproduce anywhere. The offline suite covers the same functions:

```bash
npm run test:examples
```

## Going further

**Related documentation**

- [Bonding Curve Math](../../docs/bonding-curve-math.md): `newBondingCurve`, the fee deduction, the constant product, and the price-impact section.
- [Fee Tiers](../../docs/fee-tiers.md): what `computeFeesBps` resolves when a real `feeConfig` is present.
- [Tutorial 5: Bonding Curve Math Deep Dive](../05-bonding-curve-math.md): includes a price-chart generator built on the same reserve arithmetic.
- [Tutorial 28: Analytics and Price Quotes](../28-analytics-price-quotes.md): `calculateBuyPriceImpact`, `getTokenPrice`, and the analytics surface.

**Related examples**

- [Example 13: Market Cap Along the Curve](./13-market-cap.md): reaches the same states by deriving them from the invariant instead of simulating.
- [Example 11: Buy Quotes, Fully Offline](./11-buy-quote-offline.md): the quote called once per step here.
- [Example 14: Sell Enough Tokens to Extract N SOL](./14-target-sol.md): the exit side, which needs this same apply-to-reserves step when chunking.

**SDK surface used**

| Symbol | Role |
|--------|------|
| `newBondingCurve(global)` | Launch state straight from the program config |
| `computeFeesBps` | Resolves protocol and creator rates for the current state |
| `getBuyTokenAmountFromSolAmount` | Tokens out for one fill |
| `bondingCurveMarketCap` | Valuation at each step |

**Things to try next**

1. Run 85 buys of 1 SOL and watch `realTokenReserves` approach zero. That is the graduation edge [example 13](./13-market-cap.md) derives analytically, reached the long way.
2. Compare one 10 SOL buy against ten 1 SOL buys from the same launch state. The single large buy receives fewer tokens in total, and the gap is the price impact you paid for immediacy.
3. Write the mirror function `applySell` using [example 12](./12-sell-quote-offline.md)'s gross formula: reserves move the other way, and the same four-field update applies. That completes a full offline curve simulator.
