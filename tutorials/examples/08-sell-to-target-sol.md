# Example 08: Sell to a Target SOL Amount

> Binary-search the bonding curve for the minimum tokens that raise a target amount of SOL, and see how sellChunked handles exits one transaction cannot carry.

## What you'll build

"I need 2 SOL back" is a target, not a token amount, and there is no closed-form inversion of the sell formula once tiered fees are involved. `getTokenAmountForTargetSol` solves it the direct way: binary search over the sell quote, bounded so the answer is always valid for a single transaction.

This example runs that search, verifies the result by quoting it back, and then documents `sellChunked`, the method for exits that genuinely exceed what one instruction can carry.

The example lives in [`../../examples/08-sell-to-target-sol.ts`](../../examples/08-sell-to-target-sol.ts).

## Prerequisites

- Node.js 18 or newer, with `npm install` already run.
- Network access with WebSocket support, for the token discovery helper.

Optional configuration:

```bash
export PUMP_RPC_URL=https://your-endpoint    # default: public mainnet RPC
export MINT=<mint address>                   # skip discovery, use this token
export PUMP_WALLET=/path/to/keypair.json     # default: ephemeral keypair
```

You do not need to hold the token. The search is offline; the online call is demonstrated with its real error path when the wallet holds nothing.

## Walkthrough

### Step 1: The search, wrapped

```ts
export function tokensForTargetSol({
  global,
  feeConfig,
  bondingCurve,
  targetSol,
}: {
  global: Global;
  feeConfig: FeeConfig | null;
  bondingCurve: BondingCurve;
  targetSol: BN;
}): BN {
  return getTokenAmountForTargetSol({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    targetSol,
  });
}
```

`targetSol` is lamports as a `BN`; the return is token base units as a `BN`. Both are integers throughout, which matters here more than usual: a binary search that carried floating-point error in its bounds could converge on an amount that quotes one lamport short of the target, which is the one outcome the whole function exists to prevent.

The docstring states the contract precisely:

```ts
/**
 * Minimum token amount whose sell quote reaches `targetSol` lamports after
 * fees. Binary search over the bonding curve, bounded by both the real
 * token reserves and maxSafeSellAmount, so the result is always valid for
 * a single sell instruction. When even the bounded maximum cannot reach
 * the target, that maximum is returned; quote it back to detect the case.
 */
```

Four properties are packed into that.

**Minimum, not approximate.** The search returns the smallest amount that reaches the target, so you part with as few tokens as possible.

**After fees.** The target is what arrives in your wallet, not the gross proceeds. The search evaluates net quotes at every step.

**Doubly bounded.** The upper bound is `min(realTokenReserves, maxSafeSellAmount(virtualSolReserves))`. The reserve bound exists because you cannot extract more SOL than the curve holds; the safe bound keeps the answer inside one instruction.

**Saturating, not throwing.** If selling the entire bounded maximum still falls short, that maximum comes back rather than an exception. This is the one part of the contract that requires caller discipline: the return value alone does not tell you whether the target was met. Quote it back to find out, which is exactly what the example does next.

### Step 2: Search, then verify

```ts
  heading("Target math (offline, live global state)");
  const bondingCurve = newBondingCurve(global);
  const targetSol = new BN(500_000_000); // 0.5 SOL
  const amount = tokensForTargetSol({ global, feeConfig, bondingCurve, targetSol });
  const check = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount,
  });
  row("Target", formatSol(targetSol));
  row("Tokens to sell", formatTokens(amount));
  row("Actual SOL out", formatSol(check));
  row("Single-tx safe bound", formatTokens(maxSafeSellAmount(bondingCurve.virtualSolReserves)));
```

The `check` quote is the pattern to copy into production code. Search for the amount, quote the amount, compare the quote to the target. If `check.lt(targetSol)`, the curve could not deliver and you are looking at the saturated case: either accept less, or plan a chunked exit.

Verifying with the same function the search optimized against is not circular reasoning here. The search's job is inversion, and `getSellSolAmountFromTokenAmount` is the forward direction. Running the forward direction on the answer is precisely how you confirm an inversion.

```ts
  console.log("The search returns the MINIMUM tokens that reach the target, so");
  console.log("actual SOL out lands just above it, never below (unless the safe");
  console.log("bound itself cannot reach the target; then the bound is returned).");
```

"Just above, never below" is the guarantee. The bisection narrows until the interval is one unit wide and keeps the upper side, so the answer is the first amount whose quote clears the target. The overshoot is at most one token base unit of curve movement.

Note that the curve here is `newBondingCurve(global)`: launch-state reserves derived from the live `Global` account. The target math is demonstrated on a curve whose state is reproducible, rather than on whatever the discovery helper happened to find.

### Step 3: The one-call online flow

```ts
  heading("sellToTargetSol (the one-call online flow)");
  try {
    const ixs = await online.sellToTargetSol({
      mint,
      user: wallet.publicKey,
      targetSol,
      slippage: 1,
    });
    row("Instruction count", ixs.length);
  } catch (err) {
    console.log("sellToTargetSol threw (the seller must hold this token on a live");
    console.log(`curve): ${err instanceof Error ? err.message : String(err)}`);
    console.log("The target math above is the pure core of the same flow.");
  }
```

`sellToTargetSol` fetches the sell state, `Global`, and the fee config in parallel; runs `getTokenAmountForTargetSol` against the live curve; returns `[]` if the answer is zero; calls `validateSellAmount` as a final guard; quotes the SOL out; and builds the sell instructions with your slippage as the floor.

Because it calls `fetchSellState`, it requires the seller to already have an associated token account for the mint. A wallet that holds nothing gets a thrown error naming the mint and the user, which is what the sample output below shows. That is the correct behavior for production: asking to raise 0.5 SOL from a position you do not have is a caller bug.

### Step 4: Exits that need more than one transaction

```ts
  heading("Large exits: sellChunked");
  console.log("When the amount exceeds the single-tx safe bound, sellChunked");
  console.log("splits the exit and re-fetches reserves between chunks, since each");
  console.log("landed chunk moves the curve and changes the next safe bound:");
  console.log("");
  console.log("  await online.sellChunked({");
  console.log("    mint,             // token mint");
  console.log("    user,             // seller wallet");
  console.log("    totalAmount,      // BN, the whole exit");
  console.log("    slippage: 1,      // percent, applied per chunk");
  console.log("    tokenProgram,     // optional, default TOKEN_PROGRAM_ID");
  console.log("    cashback: false,  // optional cashback opt-in per chunk");
  console.log("    sendTx,           // async (ixs) => signature, YOUR sender");
  console.log("  });");
  console.log("");
  console.log("It returns every chunk's signature in order. You keep custody of");
  console.log("signing and sending; the SDK never broadcasts on its own.");
```

Two design decisions in `sellChunked` are worth understanding.

**It re-fetches between chunks.** Each landed chunk moves the reserves, which changes both the price of the next chunk and the safe bound for it. Computing the whole split up front from one snapshot would be quoting the second chunk against a curve that no longer exists.

**It never sends anything itself.** You pass a `sendTx` callback, `async (ixs) => signature`, and the SDK calls it once per chunk. Your keys, your priority fee policy, your retry logic, your RPC. The SDK holds no keypair and opens no sending path, and the return value is the array of your own signatures in order.

The loop is straightforward: while tokens remain, refetch state, take `min(remaining, maxSafeSellAmount(currentReserves))`, quote it, build it, hand it to `sendTx`, subtract, repeat.

**When you actually need this.** The bound is `min(u64::MAX, floor(0.9 * u128::MAX / virtualSolReserves))`. At realistic reserve levels the u128 product bound sits far above `u64::MAX`, so the u64 field width binds, and the limit lands around 18.4 quadrillion tokens: roughly 18 million times a Pump token's entire billion-token supply. Ordinary positions, however large in human terms, do not approach it.

So do not reach for `sellChunked` because a sell failed. If a sell fails intermittently at sizes that usually work, that is slippage and reserve drift between your quote and your landing slot, not arithmetic width, and chunking makes it worse by multiplying your exposure to the same race. A width limit would fail deterministically at that size, every time. See [`../../docs/errors.md`](../../docs/errors.md) and [`../../docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md).

## Run it

```bash
npm run example 08
```

Real output from a run of this example:

```
Setup
-----
Mint                         66VJkHxqo5t2AotwaXmrzze3xsUahRyC6xcFNzXGpump
Wallet                       HhXPHPLsCZVePGM7iFe3R5sxKeqSsV1pKj3SRF4pWm9d

Target math (offline, live global state)
----------------------------------------
Target                       0.5000 SOL
Tokens to sell               18,363,854.19 tokens
Actual SOL out               0.5000 SOL
Single-tx safe bound         18,446,744,073,709.55 tokens
The search returns the MINIMUM tokens that reach the target, so
actual SOL out lands just above it, never below (unless the safe
bound itself cannot reach the target; then the bound is returned).

sellToTargetSol (the one-call online flow)
------------------------------------------
sellToTargetSol threw (the seller must hold this token on a live
curve): Associated token account not found for mint: 66VJkHxqo5t2AotwaXmrzze3xsUahRyC6xcFNzXGpump and user: HhXPHPLsCZVePGM7iFe3R5sxKeqSsV1pKj3SRF4pWm9d
The target math above is the pure core of the same flow.

Large exits: sellChunked
------------------------
When the amount exceeds the single-tx safe bound, sellChunked
splits the exit and re-fetches reserves between chunks, since each
landed chunk moves the curve and changes the next safe bound:

  await online.sellChunked({
    mint,             // token mint
    user,             // seller wallet
    totalAmount,      // BN, the whole exit
    slippage: 1,      // percent, applied per chunk
    tokenProgram,     // optional, default TOKEN_PROGRAM_ID
    cashback: false,  // optional cashback opt-in per chunk
    sendTx,           // async (ixs) => signature, YOUR sender
  });

It returns every chunk's signature in order. You keep custody of
signing and sending; the SDK never broadcasts on its own.

Next step (not performed here)
------------------------------
Compose, sign, send. This example never broadcasts a transaction.
```

Reading it:

**18.36 million tokens for 0.5 SOL** on a launch-state curve. Compare with [example 02](./02-create-and-buy.md), where 0.5 SOL *bought* about 17.38 million tokens on the same curve. Selling to get 0.5 SOL back costs more tokens than 0.5 SOL bought, and the gap is fees on both legs plus the curve moving against you in each direction. Round-tripping a bonding curve position is not free, and that comparison is the cheapest way to internalize it.

**`Actual SOL out: 0.5000 SOL`** is the verification quote landing on the target. Displayed to four decimals, the overshoot the search leaves is invisible, which is the intended result.

**The thrown error** is the expected path for an ephemeral wallet, and the message names both the mint and the user so it is actionable. Set `PUMP_WALLET` to a wallet that holds the discovered token and you get an instruction count instead.

**`Single-tx safe bound: 18,446,744,073,709.55 tokens`** is `u64::MAX` in base units divided by 1e6, the reading you should expect on any real curve.

Your run picks a different mint. The target math is stable, because it runs against launch-state reserves from `Global`.

## Going further

**Related examples**

- [`07-sell-all.md`](./07-sell-all.md) is the full exit, with the same safe-bound discussion and the rent-reclaiming account close.
- [`06-sell-by-percentage.md`](./06-sell-by-percentage.md) sizes an exit by fraction of position instead of by SOL needed.
- [`04-sell-tokens.md`](./04-sell-tokens.md) shows the explicit sell flow underneath.

**Related long-form tutorials**

- [`../03-sell-tokens.md`](../03-sell-tokens.md) covers signing and sending.
- [`../11-trading-bot.md`](../11-trading-bot.md) builds automated take-profit logic on this primitive.
- [`../05-bonding-curve-math.md`](../05-bonding-curve-math.md) derives the sell formula the search inverts.

**Reference documentation**

- [`../../docs/bonding-curve-math.md`](../../docs/bonding-curve-math.md) for the curve formulas.
- [`../../docs/errors.md`](../../docs/errors.md) for `SellOverflowError` and AnchorError 6024.
- [`../../docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md) for the intermittent-6024 diagnosis.
- [`../../docs/api-reference.md`](../../docs/api-reference.md) for `sellToTargetSol` and `sellChunked` signatures.

**SDK methods used here**

| Symbol | What it does |
|---|---|
| `getTokenAmountForTargetSol` | Binary-searches the minimum tokens reaching a SOL target |
| `OnlinePumpSdk.sellToTargetSol` | Fetch, search, and build the sell in one call |
| `OnlinePumpSdk.sellChunked` | Splits an oversized exit, refetching state per chunk |
| `getSellSolAmountFromTokenAmount` | The forward quote, used to verify the search |
| `maxSafeSellAmount(virtualSolReserves)` | The single-instruction amount bound |
| `validateSellAmount(amount, curve)` | Final guard inside `sellToTargetSol` |

**Offline tests**

`tokensForTargetSol` is covered by [`../../examples/__tests__/02-08-lifecycle.test.ts`](../../examples/__tests__/02-08-lifecycle.test.ts): the returned amount always quotes back at or above the target, a larger target asks for more tokens, and a zero target returns zero.
