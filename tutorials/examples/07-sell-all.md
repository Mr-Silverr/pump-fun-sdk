# Example 07: Sell All

> Exit an entire position, close the token account to reclaim its rent, and learn what the single-transaction sell bound actually constrains.

## What you'll build

Two things.

First, an offline exit plan: given a curve and a balance, what the whole position is worth after fees, what the largest amount a single sell instruction can carry is, and whether the balance exceeds it.

Second, `OnlinePumpSdk.sellAllInstructions`, which reads the live balance, sells all of it, and appends a `closeAccount` instruction so the emptied token account's rent (about 0.002 SOL) comes back to the wallet.

The example also spends time on `maxSafeSellAmount`, because the bound is widely misunderstood and the misunderstanding leads people to chunk exits that never needed chunking, and to blame arithmetic for failures that are really slippage.

The example lives in [`../../examples/07-sell-all.ts`](../../examples/07-sell-all.ts).

## Prerequisites

- Node.js 18 or newer, with `npm install` already run.
- Network access with WebSocket support, for the token discovery helper.

Optional configuration:

```bash
export PUMP_RPC_URL=https://your-endpoint    # default: public mainnet RPC
export MINT=<mint address>                   # skip discovery, use this token
export PUMP_WALLET=/path/to/keypair.json     # default: ephemeral keypair
```

You do not need to hold the token. The plan is computed offline, and the online call has a designed empty-result path for a wallet with no token account.

## Walkthrough

### Step 1: The plan shape

```ts
export interface SellAllPlan {
  /** SOL the whole balance is worth at current reserves, after fees. */
  solOut: BN;
  /** Largest amount a single sell instruction can carry without overflow. */
  maxSafe: BN;
  /** True when the balance exceeds maxSafe: use sellChunked, not one tx. */
  needsChunking: boolean;
}
```

Three fields, computed together because they answer one question: can this exit be a single transaction, and what does it produce?

Returning `needsChunking` as data rather than throwing is deliberate. A caller can render it, log it, branch on it, or decide it does not matter, and none of that requires catching an exception.

### Step 2: Compute the plan

```ts
export function computeSellAllPlan({
  global,
  feeConfig,
  bondingCurve,
  balance,
}: {
  global: Global;
  feeConfig: FeeConfig | null;
  bondingCurve: BondingCurve;
  balance: BN;
}): SellAllPlan {
  const maxSafe = maxSafeSellAmount(bondingCurve.virtualSolReserves);
  const solOut = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: balance,
  });
  return {
    solOut,
    maxSafe,
    needsChunking: balance.gt(maxSafe),
  };
}
```

Pure function, no network, all `BN`. `balance` is token base units, `solOut` is lamports, `maxSafe` is token base units. `balance.gt(maxSafe)` is a `BN` comparison, not a numeric one, which matters because both operands can exceed the exact range of a JavaScript number.

### Step 3: What `maxSafeSellAmount` actually bounds

This is the part worth reading slowly. From [`../../src/bondingCurve.ts`](../../src/bondingCurve.ts), the limit is:

```
min( u64::MAX,  floor(0.9 * u128::MAX / virtualSolReserves) )
```

The example's own JSDoc states it correctly:

```ts
/**
 * Plan a full exit offline.
 *
 * `maxSafeSellAmount` bounds what a single sell instruction can carry: the
 * program widens the sell multiply to u128, so the binding limit is the
 * token amount's own u64 field width. A balance wider than that needs
 * chunking, which this plan reports before anything is signed.
 * ...
 */
```

Two separate bounds are in play.

The **u64 bound** is the on-chain width of a token amount field. Nothing wider can be expressed as a sell amount at all, at any reserve level.

The **u128 bound** comes from the intermediate product `amount * virtualSolReserves` in the sell formula. The deployed program widens that multiply to u128, so the product only overflows past `u128::MAX`. The `0.9` factor keeps a ten percent margin so reserve drift between quoting and landing cannot push a previously safe amount over the edge.

At any realistic reserve level the u128 bound is astronomically larger than `u64::MAX`, so **the u64 field width is what binds, and the printed limit is `u64::MAX` in token base units**: about 18.4 quadrillion tokens, roughly 18 million times a Pump token's entire billion-token supply.

**No ordinary position comes close.** This bound was previously derived from `u64::MAX` applied to the product rather than the amount, and that version rejected the great majority of real sells: sampling live mainnet trade events, 344 of 417 landed sells (83 percent) exceeded the old limit, some by more than two thousand times. Every one of those was a transaction the chain would have accepted. If you carry the old model in your head, you will chunk exits for no reason and pay extra fees for the privilege.

The example's `main()` prints the same rationale, and it matches [`../../docs/errors.md`](../../docs/errors.md) and [`../../docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md).

### Step 4: The failure this bound does not explain

Also from the JSDoc:

```ts
 * A failing sell is worth distinguishing from a too-large one. AnchorError
 * 6024 that strikes intermittently at sizes that usually work is slippage:
 * reserves drift between quote and landing slot, and the abort happens
 * after your tokens already moved in that same transaction (rolled back,
 * but you paid the fee). Chunking does not fix that; slippage headroom and
 * quoting near send time do.
```

The diagnostic is the intermittency itself. A width limit is a pure function of `(amount, reserves)`: at a given size it fails deterministically, every time. If your sells land most of the time and fail occasionally at similar sizes, arithmetic width is ruled out by definition. What happened instead is that other trades moved the curve between your quote and your landing slot, the sell could no longer produce your `minSolOutput`, and the program aborted.

Fixes that work: quote as close to send time as possible, raise slippage headroom, add priority fee so you land in a nearer slot. Chunking a position that already fits does nothing except multiply your exposure to the same race.

### Step 5: Two plans, side by side

```ts
  heading("Exit planning (offline math, live global state)");
  const demoCurve = newBondingCurve(global);
  const smallBalance = new BN(150_000_000); // 150 tokens
  const small = computeSellAllPlan({
    global,
    feeConfig,
    bondingCurve: demoCurve,
    balance: smallBalance,
  });
  row("Balance", formatTokens(smallBalance));
  row("Worth (after fees)", formatSol(small.solOut));
  row("Max safe single sell", formatTokens(small.maxSafe));
  row("Needs chunking", small.needsChunking);
```

The plan is computed against `newBondingCurve(global)`, a launch-state curve derived from the live `Global` account. That keeps the numbers reproducible run to run while still coming from real protocol parameters.

```ts
  const wholeBag = small.maxSafe.muln(3);
  const big = computeSellAllPlan({
    global,
    feeConfig,
    bondingCurve: demoCurve,
    balance: wholeBag,
  });
  row("Balance (large holder)", formatTokens(wholeBag));
  row("Needs chunking", big.needsChunking);
```

`maxSafe.muln(3)` constructs a balance that is three times the limit, purely so `needsChunking: true` can be demonstrated. That balance is not a realistic holding. It is fifty-five quadrillion tokens against a billion-token supply, and it exists in this example only to exercise the flag.

### Step 6: The one-call exit

```ts
  heading("sellAllInstructions (the one-call online flow)");
  try {
    const ixs = await online.sellAllInstructions({
      mint,
      user: wallet.publicKey,
      slippage: 1,
    });
```

`sellAllInstructions` does more work than its three arguments suggest:

1. Detects the token program from the mint account's owner, so Token-2022 mints work without configuration.
2. Derives the seller's associated token address and reads the account.
3. Returns `[]` when there is no token account, so there is nothing to sell and nothing to close.
4. Returns just a `closeAccount` instruction when the account exists but holds zero, reclaiming the rent from a leftover empty account.
5. Otherwise reads the balance straight out of the account data, quotes the SOL out, builds the sell with your slippage, and appends `closeAccount`.

Point 4 is a small piece of found money. Empty associated token accounts accumulate in an active trader's wallet and each one holds roughly 0.002 SOL of rent hostage.

```ts
    if (ixs.length === 0) {
      console.log("Returned 0 instructions: this wallet has no token account for");
      console.log("the mint. Nothing to sell, nothing to close.");
    } else {
      row("Instruction count", ixs.length);
      console.log("The final instruction is always closeAccount: after a full");
      console.log("exit the empty token account is closed and its rent (about");
      console.log("0.002 SOL) returns to the wallet.");
    }
  } catch (err) {
    console.log("sellAllInstructions threw (needs a live bonding curve account):");
    console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    console.log("Set MINT=<mint> of an un-graduated token to see the full path.");
  }
```

Same distinction as [example 06](./06-sell-by-percentage.md): an empty array is a designed no-op, a thrown error is a real problem (most often a missing or graduated bonding curve account).

Because `closeAccount` is always last, the sell and the close land in the same transaction. If the sell fails, the close never happens, and you do not end up with a closed account and an unsold position.

## Run it

```bash
npm run example 07
```

Real output from a run of this example:

```
Setup
-----
Mint                         GZckavogPiL64Ha9JLWkVywpxXBCpKvCdabnEgxZpump
Wallet                       HEa4pTWFsbdLyWvZ6r3bQuJmtV7ZtSrwiQS9U45URbav

Exit planning (offline math, live global state)
-----------------------------------------------
Balance                      150.00 tokens
Worth (after fees)           0.0000 SOL
Max safe single sell         18,446,744,073,709.55 tokens
Needs chunking               false
Balance (large holder)       55,340,232,221,128.65 tokens
Needs chunking               true
Why the limit exists: a token amount is a u64 on-chain, so a
balance wider than that cannot be carried by one instruction and
sellChunked splits it across transactions. The sell multiply
itself is widened to u128, so ordinary positions never hit it.

sellAllInstructions (the one-call online flow)
----------------------------------------------
Returned 0 instructions: this wallet has no token account for
the mint. Nothing to sell, nothing to close.

Next step (not performed here)
------------------------------
Compose, sign, send. This example never broadcasts a transaction.
```

Reading it:

**`Worth (after fees): 0.0000 SOL`** for 150 tokens is the dust case. A hundred and fifty tokens out of a billion-token launch curve is worth a few hundred lamports gross; the ceiling-rounded fee consumes it and the net clamps to zero.

**`Max safe single sell: 18,446,744,073,709.55 tokens`** is `u64::MAX` divided by the 1e6 base-unit scale. Against 30 SOL of launch-state virtual reserves, the u128 product bound works out around 1e22 tokens, so the u64 width is the smaller of the two and wins. That is the expected reading on any real curve.

**The large-holder row** is `maxSafe * 3`, constructed to make the flag flip. Treat it as a unit test in printed form, not as a position anyone holds.

**The paragraph starting "Why the limit exists"** restates step 3: the on-chain multiply is widened to u128, so the binding limit at realistic reserves is the token amount's own u64 field width.

**The empty-array outcome** is what an ephemeral wallet always produces. Set `PUMP_WALLET` to a wallet holding the discovered mint and you get a sell followed by a `closeAccount`.

Your run picks a different mint. The offline plan numbers are stable, because they come from `Global` rather than from the discovered token.

## Going further

**Related examples**

- [`06-sell-by-percentage.md`](./06-sell-by-percentage.md) is the partial-exit sibling, and explains why the last tranche of a split should be a sell-all rather than a percentage.
- [`08-sell-to-target-sol.md`](./08-sell-to-target-sol.md) sizes an exit by SOL needed, and demonstrates `sellChunked`.
- [`04-sell-tokens.md`](./04-sell-tokens.md) shows the explicit sell flow these one-call methods wrap.

**Related long-form tutorials**

- [`../03-sell-tokens.md`](../03-sell-tokens.md) covers signing and sending.
- [`../33-error-handling-patterns.md`](../33-error-handling-patterns.md) covers `SellOverflowError` and the typed error surface.
- [`../11-trading-bot.md`](../11-trading-bot.md) builds automated exits on these primitives.

**Reference documentation**

- [`../../docs/errors.md`](../../docs/errors.md) for `SellOverflowError` and the AnchorError 6024 table.
- [`../../docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md) for the intermittent-6024 diagnosis.
- [`../../docs/bonding-curve-math.md`](../../docs/bonding-curve-math.md) for the sell formula.

**SDK methods used here**

| Symbol | What it does |
|---|---|
| `OnlinePumpSdk.sellAllInstructions` | Sells the full balance and closes the token account |
| `maxSafeSellAmount(virtualSolReserves)` | The single-instruction amount bound |
| `getSellSolAmountFromTokenAmount` | Quotes net SOL out for a token amount |
| `newBondingCurve(global)` | Derives launch-state reserves for the offline plan |
| `OnlinePumpSdk.sellChunked` | Splits an oversized exit across transactions |

**Offline tests**

`computeSellAllPlan` is covered by [`../../examples/__tests__/02-08-lifecycle.test.ts`](../../examples/__tests__/02-08-lifecycle.test.ts), including a regression test asserting that an ordinary five-million-token position reports `needsChunking: false`. That test exists because the old bound wrongly flagged that size class.
