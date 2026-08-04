# Market Cap Along the Curve

> Compute a Pump token's SOL-denominated market cap at launch, mid-curve, and at the graduation edge, entirely offline and entirely in integers.

## What you'll build

A market cap calculator, and more usefully, an understanding of why every Pump token graduates at almost exactly the same valuation.

Market cap on a bonding curve is not an observation. Nothing polls a price feed and nothing aggregates trades. The number is fully determined by two fields on the curve account:

```
marketCap = virtualSolReserves * mintSupply / virtualTokenReserves
```

Because the curve's launch parameters are fixed by the `Global` config and the constant product `k = vSol * vTok` holds across every trade, the entire valuation path from launch to graduation is knowable before a single token is bought. This example walks it: about 28 SOL at launch, about 112 SOL when the curve has taken 30 SOL, and about 411 SOL at the moment of graduation.

## Prerequisites

- Node 18 or newer, `npm install` already run.
- No network access, no wallet.
- Useful background: [Example 11](./11-buy-quote-offline.md) for the constant-product basics and the `BN` conventions.

Market cap is returned in **lamports**, as a `BN`. A launch-state cap is roughly 2.8e10 lamports, which fits a `number` fine today, but reserves and supplies do not (1e15 base units), and mixing the two representations is how precision bugs start. Keep it all `BN`.

## Walkthrough

### 1. Imports

```ts
import { bondingCurveMarketCap } from "@nirholas/pump-sdk";
import BN from "bn.js";

import type { BondingCurve, Global } from "@nirholas/pump-sdk";

import {
  curveAtVirtualSol,
  graduationVirtualSol,
  launchBondingCurve,
  mainnetGlobal,
} from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
```

`bondingCurveMarketCap` is the SDK's single source of truth for this formula. The three helpers from [`examples/_lib/curveState.ts`](../../examples/_lib/curveState.ts) construct curve states without needing an RPC, and they are where the interesting derivation happens.

### 2. The formula, wrapped

```ts
/** Market cap of one curve state, using the SDK's exact formula. */
export function marketCapOf(global: Global, bondingCurve: BondingCurve): BN {
  return bondingCurveMarketCap({
    mintSupply: global.tokenTotalSupply,
    virtualSolReserves: bondingCurve.virtualSolReserves,
    virtualTokenReserves: bondingCurve.virtualTokenReserves,
  });
}
```

Three inputs, one output, all `BN`. The implementation in [`src/bondingCurve.ts`](../../src/bondingCurve.ts) is:

```ts
if (virtualTokenReserves.isZero()) {
  throw new Error("Division by zero: virtual token reserves cannot be zero");
}
return virtualSolReserves.mul(mintSupply).div(virtualTokenReserves);
```

Two details matter.

**The multiply comes before the divide.** `vSol * supply` is roughly 3e10 * 1e15 = 3e25, far past what a 64-bit float can represent exactly and far past `Number.MAX_SAFE_INTEGER` (about 9e15). `BN` holds it exactly, and only then does the division bring it back into lamport range. Reorder those operations (divide first to "keep the numbers small") and you truncate the price to zero before you ever multiply by supply.

**A migrated curve throws rather than lying.** After migration `virtualTokenReserves` is set to zero. There is no meaningful bonding curve market cap for a token that has graduated; its price now lives in a PumpSwap pool. The SDK refuses instead of returning infinity or zero. If you compute market caps over a feed of arbitrary mints, check `complete` or catch this.

Note also what the formula uses: `mintSupply`, not `realTokenReserves`, not circulating supply. This is fully-diluted valuation, which is the same convention the on-chain [fee tier system](../../docs/fee-tiers.md) uses when it decides which rate applies. Using a different supply convention here would silently disagree with the fee code.

### 3. Three checkpoints on the curve's life

```ts
export function buildMarketCapTable(global: Global): MarketCapPoint[] {
  const launch = launchBondingCurve();
  const mid = curveAtVirtualSol(global, new BN("60000000000")); // 60 SOL
  const gradSol = graduationVirtualSol(global);
  const nearGraduation = curveAtVirtualSol(global, gradSol);

  return [
    { label: "Launch", bondingCurve: launch },
    { label: "Mid-curve (60 SOL virtual)", bondingCurve: mid },
    { label: "Graduation edge", bondingCurve: nearGraduation },
  ].map(({ label, bondingCurve }) => ({
    label,
    bondingCurve,
    marketCap: marketCapOf(global, bondingCurve),
    solRaised: bondingCurve.realSolReserves,
  }));
}
```

The states are not hand-written fixtures with plausible-looking numbers. They are **derived by sliding along the invariant**, which is what makes the output trustworthy.

### 4. How `curveAtVirtualSol` derives a state

From [`examples/_lib/curveState.ts`](../../examples/_lib/curveState.ts):

```ts
export function curveAtVirtualSol(
  global: Global,
  virtualSolReserves: BN,
): BondingCurve {
  const k = global.initialVirtualSolReserves.mul(
    global.initialVirtualTokenReserves,
  );
  const virtualTokenReserves = k.div(virtualSolReserves);
  const tokensSold = global.initialVirtualTokenReserves.sub(
    virtualTokenReserves,
  );
  return launchBondingCurve({
    virtualSolReserves,
    virtualTokenReserves,
    realSolReserves: virtualSolReserves.sub(global.initialVirtualSolReserves),
    realTokenReserves: BN.max(
      new BN(0),
      global.initialRealTokenReserves.sub(tokensSold),
    ),
    creator: EXAMPLE_CREATOR,
  });
}
```

The chain of reasoning:

1. `k = vSol0 * vTok0` is the invariant. For the mainnet parameters that is 3e10 * 1.073e15.
2. Pick any `vSol`. Then `vTok = k / vSol` follows. **One coordinate determines the whole curve.**
3. Tokens sold so far is `vTok0 - vTok`, since tokens only leave the virtual pool by being bought.
4. Real SOL raised is `vSol - vSol0`, because the virtual 30 SOL was never deposited by anyone. This is exactly why "virtual" reserves exist: they set a sane opening price without requiring seed capital.
5. Real tokens left is `realTok0 - tokensSold`, floored at zero.

Every step is `BN`. Steps 2 and 3 truncate, so the derived state is accurate to within a base unit or two of what a real sequence of buys would produce, which is immaterial at these magnitudes and is exactly the kind of drift the constant product tolerates on-chain too.

### 5. Where graduation actually sits

```ts
export function graduationVirtualSol(global: Global): BN {
  const k = global.initialVirtualSolReserves.mul(
    global.initialVirtualTokenReserves,
  );
  const finalVirtualTokenReserves = global.initialVirtualTokenReserves.sub(
    global.initialRealTokenReserves,
  );
  return k.div(finalVirtualTokenReserves);
}
```

A curve graduates when `realTokenReserves` hits zero: every token that was for sale has been sold. All 793.1M real tokens sold means the virtual token reserve has dropped by 793.1M tokens, from 1.073B to 279.9M. Feed that back through the invariant and `vSol = k / 279.9M tokens`, which lands at 115 SOL.

So graduation is not a market cap threshold that someone chose and hardcoded. It is a **token-supply condition**, and the 411 SOL cap is what that condition implies given the launch parameters. Change `initialRealTokenReserves` in `Global` and the graduation cap moves; leave it alone and every token that graduates does so at the same valuation.

The test in [`examples/__tests__/11-16-curve-math.test.ts`](../../examples/__tests__/11-16-curve-math.test.ts) pins the direction of travel:

```ts
it("grows as the curve fills", () => {
  const table = buildMarketCapTable(makeGlobal());
  expect(table.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < table.length; i += 1) {
    expect(table[i]!.marketCap.gte(table[i - 1]!.marketCap)).toBe(true);
  }
});
```

Market cap is monotonically non-decreasing as the curve fills. On a constant-product curve with no sells, it cannot do anything else.

### 6. Reporting

```ts
  heading("Graduation");
  const gradSol = graduationVirtualSol(global);
  row("Virtual SOL at graduation", formatSol(gradSol, 2));
  row("SOL raised at graduation", formatSol(gradSol.sub(global.initialVirtualSolReserves), 2));
```

`gradSol - initialVirtualSolReserves` is the real SOL a curve must absorb to graduate: 115 minus the virtual 30, so 85 SOL. That is the number a "progress to graduation" bar should be measured against, and it is also what `getGraduationProgress` computes for you from a live curve.

## Run it

```bash
npm run example 13
```

Real output from this repository:

```
The formula
-----------
marketCap = virtualSolReserves * mintSupply / virtualTokenReserves
Every value is a BN in base units; no floats touch the math.

Market cap checkpoints (SOL-denominated)
----------------------------------------
Launch                       27.95 SOL
  virtual SOL                30.00 SOL
  virtual tokens             1,073,000,000 tokens
  real tokens left           793,100,000 tokens
  SOL raised so far          0.00 SOL
Mid-curve (60 SOL virtual)   111.83 SOL
  virtual SOL                60.00 SOL
  virtual tokens             536,500,000 tokens
  real tokens left           256,600,000 tokens
  SOL raised so far          30.00 SOL
Graduation edge              410.88 SOL
  virtual SOL                115.00 SOL
  virtual tokens             279,900,000 tokens
  real tokens left           0 tokens
  SOL raised so far          85.00 SOL

Graduation
----------
Virtual SOL at graduation    115.00 SOL
SOL raised at graduation     85.00 SOL

When the 793.1M real tokens are sold out, the curve completes and the
token migrates to the PumpSwap AMM. The market cap at that moment is
fixed by the launch parameters: every Pump token graduates at the same
SOL-denominated cap, near 411 SOL.
```

What the numbers show:

- **A 2x in virtual SOL is a 4x in market cap.** From 30 to 60 SOL virtual, the cap goes 27.95 to 111.83. Doubling `vSol` halves `vTok` under the invariant, and market cap is their ratio times supply, so it moves quadratically. This is why bonding curve charts look steep even when the SOL raised is modest.
- **Halfway in valuation is nowhere near halfway in tokens.** At the mid-curve checkpoint 27% of the total cap has been reached but 256.6M of 793.1M real tokens are still unsold. Early buyers get a structurally better price, and no amount of UI framing changes that arithmetic.
- **The last stretch is the expensive one.** Going from 60 to 115 SOL virtual (55 more SOL raised) moves the cap from 111.83 to 410.88, nearly 300 SOL of valuation, while distributing only the remaining 256.6M tokens.
- **Real SOL raised at graduation is 85 SOL, and the cap is 411 SOL.** The gap is the virtual liquidity doing its job: the 30 virtual SOL was never contributed by anyone.

Deterministic and offline, so those digits reproduce anywhere. The offline suite covers the same functions:

```bash
npm run test:examples
```

## Going further

**Related documentation**

- [Bonding Curve Math](../../docs/bonding-curve-math.md): the market cap formula, graduation, and the worked example with the same mainnet parameters.
- [Fee Tiers](../../docs/fee-tiers.md): market cap is the input that selects a fee tier, which is why this formula has to agree with the fee code exactly.
- [Tutorial 5: Bonding Curve Math Deep Dive](../05-bonding-curve-math.md): the online path, including `getGraduationProgress`.
- [Tutorial 6: Token Migration to PumpAMM](../06-migration.md): what happens after the graduation edge.

**Related examples**

- [Example 16: Launch Price Ladder](./16-launch-price-ladder.md): reaches these same states by actually simulating buys instead of deriving them.
- [Example 11: Buy Quotes, Fully Offline](./11-buy-quote-offline.md): quoting against any of these curve states.
- [Example 14: Sell Enough Tokens to Extract N SOL](./14-target-sol.md): uses the same mid-curve state to plan an exit.
- [Example 41: AMM Buy](./41-amm-buy.md): pricing a token after it has graduated past the last checkpoint here.

**SDK surface used**

| Symbol | Role |
|--------|------|
| `bondingCurveMarketCap` | `vSol * supply / vTok`, in lamports, throwing on a migrated curve |
| `Global.tokenTotalSupply` | The supply convention (fully diluted) that fee tiers also use |
| `BondingCurve.virtualSolReserves` / `virtualTokenReserves` | The only two fields the valuation depends on |

**Things to try next**

1. Build a 20-point valuation curve by calling `curveAtVirtualSol` across the 30-to-115 SOL range and plot cap against SOL raised. The convexity is the whole story of a bonding curve launch.
2. Compute the cap at each fee-tier threshold in `mainnetFeeConfig()` and work out how much real SOL a curve must absorb before its fee rate steps down.
3. Point `marketCapOf` at a live curve fetched with `OnlinePumpSdk.fetchBondingCurve(mint)` and compare it against what a public explorer displays for the same mint.
