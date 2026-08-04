# Example 05: Buy by SOL Amount

> One call takes a SOL budget and returns ready-to-sign buy instructions, and a quote table shows the price impact you pay for size.

## What you'll build

Two things, side by side.

First, a quote table: what 0.01, 0.1, 1, and 10 SOL each buy on the same curve, with tokens-per-SOL alongside. Reading down that column is the clearest possible demonstration of price impact, because the only thing changing between rows is size.

Second, `OnlinePumpSdk.buyBySolAmount`, the one-call flow. Where [example 03](./03-buy-tokens.md) fetched state, quoted, and built instructions in three explicit steps, this does all of it behind a single method. Most application code should use this; example 03 exists so you know what it is doing.

The example lives in [`../../examples/05-buy-by-sol-amount.ts`](../../examples/05-buy-by-sol-amount.ts).

## Prerequisites

- Node.js 18 or newer, with `npm install` already run.
- Network access with WebSocket support, for the token discovery helper.

Optional configuration:

```bash
export PUMP_RPC_URL=https://your-endpoint    # default: public mainnet RPC
export MINT=<mint address>                   # skip discovery, use this token
export PUMP_WALLET=/path/to/keypair.json     # default: ephemeral keypair
```

No funds required. Nothing is signed or sent.

## Walkthrough

### Step 1: The quote, extracted

```ts
export function quoteTokensForSol({
  global,
  feeConfig,
  bondingCurve,
  solAmount,
}: {
  global: Global;
  feeConfig: FeeConfig | null;
  bondingCurve: BondingCurve;
  solAmount: BN;
}): BN {
  return getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solAmount,
  });
}
```

This is the exact computation `buyBySolAmount` performs internally after its fetches, lifted out so it can be called with any state and tested offline.

`solAmount` is lamports as a `BN`; the return is token base units as a `BN`. Fees come off the input before the curve math, so the result is the token amount that actually lands in the buyer's account.

Exposing this matters more than it looks. It means you can build a quote table, a price ladder, a UI preview, or a backtest without an RPC connection and without duplicating the SDK's fee handling. The online method and this function cannot drift, because the online method calls the same underlying `getBuyTokenAmountFromSolAmount`.

### Step 2: Decide which curve to quote against

```ts
  const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint));
  const decoded = curveInfo ? PUMP_SDK.decodeBondingCurveNullable(curveInfo) : null;
  const tradable =
    curveInfo !== null &&
    decoded !== null &&
    !decoded.complete &&
    !decoded.virtualTokenReserves.isZero();

  const bondingCurve: BondingCurve =
    tradable && decoded ? decoded : newBondingCurve(global);
```

The same tradability test as examples 03 and 04, written as a single boolean here because this example needs it twice. When the discovered mint is not tradable on a curve (no curve account, or it graduated), the quote table falls back to a launch-state curve derived from live `Global` reserves.

```ts
  if (!tradable) {
    heading("Bonding curve status");
    console.log("This mint has no active bonding curve (missing or graduated), so");
    console.log("the quote table below uses a brand-new curve from live global");
    console.log("state. Set MINT=<mint> to quote a live curve token.");
  }
```

The example tells you which curve produced the numbers. A quote table that silently switched its underlying state would be worse than useless.

### Step 3: The quote table

```ts
  heading("Quote table (offline math on the curve state)");
  const budgets = [
    new BN(10_000_000), // 0.01 SOL
    new BN(100_000_000), // 0.1 SOL
    new BN(1_000_000_000), // 1 SOL
    new BN(10_000_000_000), // 10 SOL
  ];
  for (const solAmount of budgets) {
    const tokens = quoteTokensForSol({ global, feeConfig, bondingCurve, solAmount });
    const perSol = tokens.mul(new BN(1_000_000_000)).div(solAmount);
    row(
      formatSol(solAmount, 2),
      `${formatTokens(tokens)}  (${divToDecimalString(perSol, new BN(1_000_000), 0)} tokens/SOL)`,
    );
  }
  console.log("Larger budgets get fewer tokens per SOL: each lamport buys at a");
  console.log("worse point on the curve than the one before it (price impact).");
```

Every budget is a `BN` literal in lamports with the human value in a comment. That convention runs through the whole example suite and it is worth adopting: `new BN(10_000_000_000)` for 10 SOL, never `10e9`, and never a float that gets converted.

The `perSol` line is the one piece of arithmetic worth walking through:

```ts
const perSol = tokens.mul(new BN(1_000_000_000)).div(solAmount);
```

Multiply first, divide second. `tokens` is in base units and `solAmount` is in lamports, so multiplying by 1e9 before dividing rescales the ratio to "base units per whole SOL" without ever producing a fraction. Dividing first would truncate to zero for every row. This ordering rule (scale up, then divide) is how you do ratios in integer arithmetic, and getting it backwards is the most common `BN` mistake there is.

`divToDecimalString(perSol, new BN(1_000_000), 0)` then converts base units to whole tokens with zero decimal places, purely for display.

Reading the sample output further down: 0.01 SOL buys about 3.398 million tokens per SOL, and 10 SOL buys about 3.083 million tokens per SOL. Same curve, same instant, roughly a 9 percent worse rate purely for being a thousand times larger. That is the constant-product curve doing what it is designed to do, and it is not a fee. Fees are already deducted from all four rows.

### Step 4: The one-call flow

```ts
  heading("buyBySolAmount (the one-call online flow)");
  const solAmount = new BN(100_000_000); // 0.1 SOL
  try {
    const ixs = await online.buyBySolAmount({
      mint,
      user: wallet.publicKey,
      solAmount,
      slippage: 1,
    });
    row("Instruction count", ixs.length);
    ixs.forEach((ix, i) => {
      const kind = ix.programId.equals(PUMP_PROGRAM_ID) ? "pump" : "token/ata";
      row(`${i + 1}. ${kind}`, `${ix.keys.length} accounts, ${ix.data.length} data bytes`);
    });
```

Four arguments and you get signable instructions. Internally `buyBySolAmount` fetches `Global`, the fee config, and the buy state; quotes the token amount with `getBuyTokenAmountFromSolAmount`; and calls `PUMP_SDK.buyInstructions` with the results. It also detects the correct token program from the mint's owner, so Token-2022 tokens work without you thinking about it.

`slippage: 1` is one percent, as everywhere else in this SDK.

Compare this to the fifty-odd lines example 03 spends reaching the same place. Both are correct. Use example 03's shape when you need the intermediate state for your own logic (a UI preview, a risk check, a log line); use this when you just want to trade.

### Step 5: The fallback branch

```ts
  } catch (err) {
    console.log("buyBySolAmount needs a live, un-graduated bonding curve and threw:");
    console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    console.log("Building the identical instructions offline with the demo state,");
    console.log("which is exactly what buyBySolAmount does after its fetches.");
    const tokensOut = quoteTokensForSol({ global, feeConfig, bondingCurve, solAmount });
    const ixs = await PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo: {
        data: Buffer.alloc(BONDING_CURVE_NEW_SIZE),
        executable: false,
        lamports: 0,
        owner: PUMP_PROGRAM_ID,
      },
      bondingCurve,
      associatedUserAccountInfo: null,
      mint,
      user: wallet.publicKey,
      amount: tokensOut,
      solAmount,
      slippage: 1,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    row("Instruction count", ixs.length);
    row("Tokens expected", formatTokens(tokensOut));
  }
```

If the discovered token graduated between the log event and the RPC read, `buyBySolAmount` throws. Rather than exiting, the example prints the real error message and then does by hand what the online method does internally: quote, then call `buyInstructions` with explicit state.

That is worth seeing written out, because it makes the relationship concrete. `buyBySolAmount` is not a different code path. It is these two calls with the fetches attached.

In the sample run below this branch did not execute, because the discovered curve was live.

## Run it

```bash
npm run example 05
```

Real output from a run of this example:

```
Setup
-----
Mint                         6u11eEUjNCpqPGLjnJQv1sWhg84c2LsbUKCbwruqpump
Wallet                       6J88wgyfnsbvT18dvK1jhW65J2HD7qcPyaCaLmmY67m6

Quote table (offline math on the curve state)
---------------------------------------------
0.01 SOL                     33,977.57 tokens  (3,397,757 tokens/SOL)
0.10 SOL                     339,463.86 tokens  (3,394,638 tokens/SOL)
1.00 SOL                     3,363,758.13 tokens  (3,363,758 tokens/SOL)
10.00 SOL                    30,832,771.40 tokens  (3,083,277 tokens/SOL)
Larger budgets get fewer tokens per SOL: each lamport buys at a
worse point on the curve than the one before it (price impact).

buyBySolAmount (the one-call online flow)
-----------------------------------------
Instruction count            2
1. token/ata                 6 accounts, 1 data bytes
2. pump                      18 accounts, 25 data bytes

Next step (not performed here)
------------------------------
Compose, sign, send. This example never broadcasts a transaction.
```

The tokens-per-SOL column is the whole lesson. From 0.01 SOL to 0.1 SOL the rate barely moves, a tenth of a percent, because a tenth of a SOL is a rounding error against this curve's reserves. From 1 SOL to 10 SOL it drops about 8 percent, because 10 SOL is a meaningful fraction of the curve. Price impact is not linear in size; it accelerates.

Two instructions came back because the ephemeral wallet has no token account for this mint. Run it with `PUMP_WALLET` set to a wallet that already holds the token and you get one instruction.

Your run picks a different mint, so your absolute numbers differ. The shape of the column will not.

## Going further

**Related examples**

- [`03-buy-tokens.md`](./03-buy-tokens.md) is the same buy with every step explicit.
- [`06-sell-by-percentage.md`](./06-sell-by-percentage.md) is the sell-side one-call equivalent.
- [`02-create-and-buy.md`](./02-create-and-buy.md) quotes a buy on a curve that does not exist yet.

**Related long-form tutorials**

- [`../28-analytics-price-quotes.md`](../28-analytics-price-quotes.md) covers `quoteBuy`, `quoteSell`, and the price impact helpers.
- [`../05-bonding-curve-math.md`](../05-bonding-curve-math.md) derives why the tokens-per-SOL column falls.
- [`../12-offline-vs-online.md`](../12-offline-vs-online.md) explains when to reach for the online method versus the offline builder.

**Reference documentation**

- [`../../docs/analytics.md`](../../docs/analytics.md) for price impact and market cap helpers.
- [`../../docs/bonding-curve-math.md`](../../docs/bonding-curve-math.md) for the constant-product formulas.
- [`../../docs/api-reference.md`](../../docs/api-reference.md) for the `OnlinePumpSdk` surface.

**SDK methods used here**

| Symbol | What it does |
|---|---|
| `OnlinePumpSdk.buyBySolAmount` | Fetch, quote, and build a buy in one call |
| `getBuyTokenAmountFromSolAmount` | Quotes tokens out for a SOL budget |
| `PUMP_SDK.buyInstructions` | Builds buy instructions from explicit state |
| `newBondingCurve(global)` | Derives launch-state reserves for the offline fallback |
| `PUMP_SDK.decodeBondingCurveNullable` | Decodes a curve account, `null` if it is not one |

**Offline tests**

`quoteTokensForSol` is covered by [`../../examples/__tests__/02-08-lifecycle.test.ts`](../../examples/__tests__/02-08-lifecycle.test.ts), which asserts that a larger budget always yields more tokens.
