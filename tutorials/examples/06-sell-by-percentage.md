# Example 06: Sell by Percentage

> Turn "sell half" into an exact token amount with basis-point integer math, then exercise the one-call online flow.

## What you'll build

The percentage exit. Humans think in fractions of a position ("take a third off the table"), while the chain only understands integer token base units. This example shows the conversion between them, done the way `OnlinePumpSdk.sellByPercentage` does it internally, and then calls the online method against a live token.

The conversion is four lines long. It gets a whole example because the obvious implementation is wrong in a way that costs money, and because the rounding behavior has a consequence for split exits that nobody discovers until their last chunk fails.

The example lives in [`../../examples/06-sell-by-percentage.ts`](../../examples/06-sell-by-percentage.ts).

## Prerequisites

- Node.js 18 or newer, with `npm install` already run.
- Network access with WebSocket support, for the token discovery helper.

Optional configuration:

```bash
export PUMP_RPC_URL=https://your-endpoint    # default: public mainnet RPC
export MINT=<mint address>                   # skip discovery, use this token
export PUMP_WALLET=/path/to/keypair.json     # default: ephemeral keypair
```

You do not need to hold the token. The offline math runs regardless, and the online call has a designed empty-result path for a wallet with no position.

## Walkthrough

### Step 1: The conversion

```ts
export function percentageToTokenAmount(balance: BN, percent: number): BN {
  if (percent <= 0 || percent > 100) {
    throw new Error(
      `percent must be between 0 (exclusive) and 100, got ${percent}`,
    );
  }
  const bps = Math.round(percent * 100);
  return balance.muln(bps).divn(10_000);
}
```

Four lines, and every one of them is load-bearing.

**The guard rejects `0`, negatives, and anything above 100.** Note what it does *not* do: it does not clamp. A caller passing `percent: 150` has a bug, and silently selling 100 percent instead of 150 percent would hide it behind a transaction that cannot be undone. `percent: 0` is likewise a bug and not a no-op, since nobody deliberately asks to sell nothing. This mirrors `OnlinePumpSdk.sellByPercentage` exactly, which throws with the same message.

**`Math.round(percent * 100)` is the only floating-point operation in the entire function**, and it is applied to the percentage, not the balance. Scaling to basis points first means `33.33` becomes the integer `3333`, and fractional percentages survive without a float ever touching the position size.

**`balance.muln(bps).divn(10_000)` multiplies before dividing.** This is the same integer-arithmetic rule as the tokens-per-SOL ratio in [example 05](./05-buy-by-sol-amount.md). Dividing first would truncate the balance to a coarse multiple and throw away real value.

The obvious implementation, `balance.muln(percent / 100)`, fails on all three counts: `bn.js` `muln` requires an integer argument, and even if it accepted a float, the position would have been multiplied by an inexact double.

`divn` truncates, so the result always rounds **down**. That is the safe direction: an exit can never round up into selling more than the holder actually has.

### Step 2: See the rounding on a real balance

```ts
  heading("The basis-point math (offline)");
  const demoBalance = new BN("1234567890"); // 1,234.567890 tokens
  row("Demo balance", formatTokens(demoBalance));
  for (const percent of [100, 50, 25, 33.33, 0.01]) {
    row(`Sell ${percent}%`, formatTokens(percentageToTokenAmount(demoBalance, percent)));
  }
```

`new BN("1234567890")` is constructed from a string, not a number literal. For this value a numeric literal would be fine, but real balances routinely exceed `Number.MAX_SAFE_INTEGER` (about 9.007e15, which is only nine billion tokens at six decimals), and passing an already-lossy double to `BN` produces an already-lossy `BN`. Constructing from a string is the habit that never breaks.

The five percentages cover the interesting cases: the whole position, a clean half, a clean quarter, a fractional percentage, and a value small enough to expose truncation.

### Step 3: The consequence nobody expects

```ts
  console.log("Note 33.33% became 3333 bps exactly; the balance was never");
  console.log("multiplied by a float. Division rounds down, so the pieces of a");
  console.log("split exit can sum to slightly less than the whole. The final");
  console.log("chunk should be sold as 100% of what remains, not a percentage.");
```

This is the practical payoff of the example.

Selling in three tranches of 33.33 percent does not empty the position. Each `divn(10_000)` discards a remainder, and 3 times 3333 basis points is 9999, not 10000, so a sliver survives no matter how carefully you slice. Scripted exits that assume "three thirds equals everything" leave dust behind, and a later "sell the rest" that assumes zero balance will misbehave.

The fix is one line of discipline: **the last tranche of any split exit is 100 percent of what remains**, not a percentage of the original. Or use [`07-sell-all.md`](./07-sell-all.md), which reads the current balance and also closes the token account to reclaim its rent.

### Step 4: The one-call online flow

```ts
  heading("sellByPercentage (the one-call online flow)");
  const balance = await online.getTokenBalance(mint, wallet.publicKey);
  row("Live balance", formatTokens(balance));
  try {
    const ixs = await online.sellByPercentage({
      mint,
      user: wallet.publicKey,
      percent: 50,
      slippage: 1,
    });
```

`getTokenBalance` reads the seller's associated token account and returns the raw balance as a `BN`, or zero when the account does not exist. It is the read you want before showing a user anything about their position.

`sellByPercentage` then does the whole flow: read the balance, apply the basis-point conversion, fetch `Global`, the fee config, and the sell state, quote the SOL out with `getSellSolAmountFromTokenAmount`, and call `PUMP_SDK.sellInstructions` with `slippage` as the floor on proceeds.

### Step 5: The two non-error outcomes

```ts
    if (ixs.length === 0) {
      console.log("Returned 0 instructions: this wallet holds no tokens of this");
      console.log("mint (or 50% of its dust balance rounds to zero). That empty");
      console.log("array is the designed no-op path, not an error.");
    } else {
      row("Instruction count", ixs.length);
      ixs.forEach((ix, i) => {
        row(`${i + 1}.`, `${ix.programId.toBase58()} (${ix.keys.length} accounts)`);
      });
    }
  } catch (err) {
    console.log("sellByPercentage threw (needs a live, un-graduated curve):");
    console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    console.log("The math above is unaffected; only the state fetch is online.");
  }
```

An **empty array** is a success, not a failure. `sellByPercentage` returns `[]` in two situations: the wallet's balance is zero, or the requested percentage of a dust balance truncates to zero tokens. Neither is an error condition, and neither should throw, because "there is nothing to sell" is a legitimate answer to "sell half." Application code must check `ixs.length` before building a transaction; sending a transaction with zero instructions wastes a fee to accomplish nothing.

A **thrown error** means something upstream is wrong: no bonding curve account, a graduated curve, an out-of-range percentage. Those are worth surfacing.

Note where the `try` boundary sits. It wraps only the online call. The basis-point math above it has already printed and cannot fail from a network problem, which is exactly the separation the whole example suite is built on.

## Run it

```bash
npm run example 06
```

Real output from a run of this example:

```
Setup
-----
Mint                         66VJkHxqo5t2AotwaXmrzze3xsUahRyC6xcFNzXGpump
Wallet                       3UmLHFihj96NkD9V16bD8TzvX54n8HK2HknP1H5uFGfM

The basis-point math (offline)
------------------------------
Demo balance                 1,234.56 tokens
Sell 100%                    1,234.56 tokens
Sell 50%                     617.28 tokens
Sell 25%                     308.64 tokens
Sell 33.33%                  411.48 tokens
Sell 0.01%                   0.12 tokens
Note 33.33% became 3333 bps exactly; the balance was never
multiplied by a float. Division rounds down, so the pieces of a
split exit can sum to slightly less than the whole. The final
chunk should be sold as 100% of what remains, not a percentage.

sellByPercentage (the one-call online flow)
-------------------------------------------
Live balance                 0.00 tokens
Returned 0 instructions: this wallet holds no tokens of this
mint (or 50% of its dust balance rounds to zero). That empty
array is the designed no-op path, not an error.

Next step (not performed here)
------------------------------
Compose, sign, send. This example never broadcasts a transaction.
```

Check the arithmetic against the raw balance of `1234567890` base units, which `formatTokens` truncates to two decimals for display:

- 100 percent gives back `1234567890` exactly, the whole balance.
- 50 percent gives `617283945`, displayed as 617.28.
- 33.33 percent gives `411481477`, displayed as 411.48. Three of those sum to `1234444431`, which is `123459` base units short of the whole. An eighth of a token stranded, from a single three-way split.
- 0.01 percent gives `123456` base units, or 0.12 tokens, the truncation case.

The empty-array path is what an ephemeral wallet always hits. Set `PUMP_WALLET` to a wallet holding the discovered mint and you get sell instructions instead.

Your run picks a different mint. The offline table is identical on every run, because it depends on nothing but the constant demo balance.

## Going further

**Related examples**

- [`07-sell-all.md`](./07-sell-all.md) exits the entire position and closes the token account, which is the right tool for a final tranche.
- [`08-sell-to-target-sol.md`](./08-sell-to-target-sol.md) sizes an exit by the SOL you need rather than by fraction of position.
- [`04-sell-tokens.md`](./04-sell-tokens.md) shows the explicit sell flow underneath all of these.

**Related long-form tutorials**

- [`../03-sell-tokens.md`](../03-sell-tokens.md) covers signing and sending a sell.
- [`../11-trading-bot.md`](../11-trading-bot.md) builds staged exit logic on top of these primitives.
- [`../33-error-handling-patterns.md`](../33-error-handling-patterns.md) covers distinguishing empty results from thrown errors.

**Reference documentation**

- [`../../docs/api-reference.md`](../../docs/api-reference.md) for `sellByPercentage` and `getTokenBalance` signatures.
- [`../../docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md) for unit and slippage mistakes.

**SDK methods used here**

| Symbol | What it does |
|---|---|
| `OnlinePumpSdk.sellByPercentage` | Sells a percentage of the live balance in one call |
| `OnlinePumpSdk.getTokenBalance` | Reads a wallet's token balance as a `BN` |
| `PUMP_SDK.sellInstructions` | The instruction builder underneath |
| `getSellSolAmountFromTokenAmount` | Quotes net SOL out, used internally for the slippage floor |

**Offline tests**

`percentageToTokenAmount` is covered by [`../../examples/__tests__/02-08-lifecycle.test.ts`](../../examples/__tests__/02-08-lifecycle.test.ts): 100 percent returns the balance exactly, out-of-range percentages throw, and the result never exceeds the balance nor goes negative.
