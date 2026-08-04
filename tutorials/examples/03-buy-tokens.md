# Example 03: Buy Tokens

> Quote a SOL budget against a live bonding curve, then build slippage-protected buy instructions from explicit on-chain state.

## What you'll build

The canonical bonding curve buy, split into two halves that never mix:

- **Fetch**: read the `Global` account, the fee config, and the token's bonding curve from an RPC endpoint.
- **Compute**: quote the trade and build the instructions, with no network access at all.

Keeping those separate is the design principle behind every trading example in this repository. The compute half is a pure function of its inputs, so it can be tested against fixtures offline and it behaves identically whether the state came from mainnet, a local validator, or a test file.

The example also finds a token to trade with by itself, so you do not have to go hunting for a mint address that is still on its curve.

The example lives in [`../../examples/03-buy-tokens.ts`](../../examples/03-buy-tokens.ts).

## Prerequisites

- Node.js 18 or newer, with `npm install` already run.
- Network access, including WebSocket support on your RPC endpoint. The default public mainnet RPC supports `logsSubscribe`, which the token discovery helper uses.

Optional configuration:

```bash
export PUMP_RPC_URL=https://your-endpoint    # default: public mainnet RPC
export MINT=<mint address>                   # skip discovery, use this token
export PUMP_WALLET=/path/to/keypair.json     # default: ephemeral keypair
```

No funds are required. The example builds a buy and prints it; it never signs or sends.

## Walkthrough

### Step 1: Quote the buy

```ts
export function quoteBuyTokens({
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

Given a curve and a SOL budget, this returns the token amount you receive. Fees are already deducted from the input before the curve math runs, so the number that comes back is what actually lands in your token account, not a pre-fee figure you have to adjust.

`solAmount` is lamports as a `BN`. The return value is token base units as a `BN` (6 decimals). No step of this ever touches a float. Every amount in this SDK is `BN` for the same reason: 1 SOL is 1,000,000,000 lamports, positions run into the trillions of token base units, and a double silently drops the low bits of both.

The wrapper exists so the example has one named, exported, testable entry point for its compute step. It adds nothing over calling `getBuyTokenAmountFromSolAmount` directly except the `mintSupply` binding, which comes from the curve rather than being a separate argument the caller can get wrong.

### Step 2: Build the instructions from explicit state

```ts
export async function buildBuyInstructions({
  global,
  bondingCurveAccountInfo,
  bondingCurve,
  associatedUserAccountInfo,
  mint,
  user,
  amount,
  solAmount,
  slippage,
  tokenProgram = TOKEN_PROGRAM_ID,
}: {
  global: Global;
  bondingCurveAccountInfo: AccountInfo<Buffer>;
  bondingCurve: BondingCurve;
  associatedUserAccountInfo: AccountInfo<Buffer> | null;
  mint: PublicKey;
  user: PublicKey;
  amount: BN;
  solAmount: BN;
  slippage: number;
  tokenProgram?: PublicKey;
}): Promise<TransactionInstruction[]> {
  return await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    amount,
    solAmount,
    slippage,
    tokenProgram,
  });
}
```

Notice that `buyInstructions` wants both the decoded `bondingCurve` and the raw `bondingCurveAccountInfo`. The decoded struct drives the pricing; the raw account is inspected for its byte length, which tells the SDK whether the account predates the current layout and needs an `extendAccount` instruction prepended.

`associatedUserAccountInfo` is `null` when the buyer has no token account for this mint yet. In that case the SDK prepends an idempotent create-associated-token-account instruction. Pass the account info when it exists and the instruction is skipped, saving compute units.

So the returned array is between one and three instructions long depending on state, and the caller does not have to reason about which case applies.

`slippage` is a **percent**, not basis points. `slippage: 1` means one percent. This trips people up constantly, and the SDK cannot detect the mistake for you: `slippage: 100` is a legal value meaning "accept any price."

### Step 3: Find a token that is actually trading

```ts
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);
  const wallet = loadWallet();
  // Discover a token actively trading on its curve (MINT env overrides).
  const { mint } = await findActiveCurveMint(connection);
```

`findActiveCurveMint` lives in [`../../examples/_lib/discovery.ts`](../../examples/_lib/discovery.ts) and is worth understanding, because the naive approaches to this problem all fail.

Hardcoding a mint rots: tokens graduate to the AMM and stop being valid bonding curve examples within hours. Polling recent transactions burns through public RPC rate limits, because pump.fun runs on the order of a hundred transactions per second and most of them are failed slippage bots.

So the helper listens instead. It opens a `logsSubscribe` WebSocket on the Pump program, parses protocol events out of the log stream with `parsePumpEventsFromLogs`, collects the mints named by `trade` and `create` events, and then checks each candidate's curve until it finds one that is not `complete`. A few seconds of live logs gives you the freshest possible reference token.

Setting `MINT=<address>` bypasses all of it.

### Step 4: Read the live curve, with a fallback

```ts
  const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint));
  const decoded = curveInfo ? PUMP_SDK.decodeBondingCurveNullable(curveInfo) : null;
```

`decodeBondingCurveNullable` returns `null` instead of throwing when the account is not a bonding curve. That matters when a mint address is supplied by hand: not every Pump-adjacent mint has a curve account, and an exception is the wrong response to a legitimate "this token does not trade on a curve" answer.

```ts
  if (curveInfo && decoded && !decoded.complete && !decoded.virtualTokenReserves.isZero()) {
    heading("Live bonding curve state");
    const state = await online.fetchBuyState(mint, wallet.publicKey);
    bondingCurve = state.bondingCurve;
    bondingCurveAccountInfo = state.bondingCurveAccountInfo;
    associatedUserAccountInfo = state.associatedUserAccountInfo;
    tokenProgram = state.tokenProgram;
    row("Virtual SOL reserves", formatSol(bondingCurve.virtualSolReserves));
    row("Virtual token reserves", formatTokens(bondingCurve.virtualTokenReserves));
    row("Buyer token account exists", associatedUserAccountInfo !== null);
```

Three conditions have to hold for a curve to be tradable: the account exists, it decodes, and `complete` is `false`. `complete: true` means the token graduated to a PumpAMM pool and bonding curve trading is permanently disabled for it. The extra `virtualTokenReserves.isZero()` guard catches a migrated curve whose reserves were drained.

When the curve is tradable, `fetchBuyState` does the rest in one call: it returns the decoded curve, the raw curve account, the buyer's associated token account info (or `null`), and the correct token program for the mint. Token-2022 and the classic SPL Token program are both in use across Pump tokens, and getting that wrong produces an account-owner mismatch at execution time.

```ts
  } else {
    heading("Bonding curve status");
    if (!curveInfo || !decoded) {
      console.log("No bonding curve account exists for this mint (the PUMP token");
      console.log("itself never traded on a curve). Set MINT=<mint> to target a");
      console.log("live curve token.");
    } else {
      console.log("This token's curve is complete: it graduated to a PumpAMM pool,");
      console.log("so bonding curve buys are disabled. Use the AMM examples to trade it.");
    }
    console.log("Demonstrating the same compute step on a brand-new curve derived");
    console.log("from live global state via newBondingCurve(global).");
    bondingCurve = newBondingCurve(global);
    bondingCurveAccountInfo = {
      data: Buffer.alloc(BONDING_CURVE_NEW_SIZE),
      executable: false,
      lamports: 0,
      owner: PUMP_PROGRAM_ID,
    };
  }
```

The fallback is not a mock. `newBondingCurve(global)` derives real launch-state reserves from the live `Global` account, and the synthetic account info is a correctly sized, correctly owned buffer whose only job is to tell the SDK "this account is on the current layout, no extend needed." The math that follows is the identical code path a live curve takes.

This is what lets the example stay useful when discovery hands back a token that graduated between the log event and your RPC read, which does happen.

### Step 5: Quote, then reason about slippage

```ts
  const solAmount = new BN(100_000_000); // 0.1 SOL
  const slippage = 1; // percent

  heading("Quote");
  const tokensOut = quoteBuyTokens({ global, feeConfig, bondingCurve, solAmount });
  row("Spend", formatSol(solAmount));
  row("Tokens received", formatTokens(tokensOut));

  heading("Slippage");
  const maxSpend = solAmount.add(solAmount.muln(slippage * 100).divn(10_000));
  console.log("Between quoting and landing on-chain, other buys move the curve.");
  console.log(`slippage: ${slippage} caps the damage: the buy aborts rather than`);
  console.log(`spend more than ${formatSol(maxSpend)} for the quoted tokens.`);
```

The `maxSpend` line is the same arithmetic the SDK performs internally, written out so you can see it. The percent is scaled to basis points (`slippage * 100`) and applied with integer `BN` operations, which is why it reads as `.muln(100).divn(10_000)` rather than a multiplication by `1.01`.

On a buy, slippage protects the SOL side: you named a token quantity, and the transaction refuses to pay more than `maxSpend` to get it. Your quote was computed against reserves at some slot; by the time a validator executes your transaction, other trades may have moved those reserves. The bound is what turns "I might get a worse price" into "I get my price or I get nothing."

### Step 6: Build and inspect

```ts
  const ixs = await buildBuyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user: wallet.publicKey,
    amount: tokensOut,
    solAmount,
    slippage,
    tokenProgram,
  });

  heading("Buy instructions");
  row("Instruction count", ixs.length);
  ixs.forEach((ix, i) => {
    const kind = ix.programId.equals(PUMP_PROGRAM_ID) ? "pump" : "token/ata";
    row(`${i + 1}. ${kind}`, `${ix.keys.length} accounts, ${ix.data.length} data bytes`);
  });
```

Two instructions in the sample run below: the associated token account creation (the ephemeral wallet has none) and the buy itself. Run it with a wallet that already holds the token and you get one.

The buy carries 18 accounts. As in example 02, that includes the trailing mutable fee recipient required since the 2026-04-28 fee recipient upgrade, which the SDK selects for you.

## Run it

```bash
npm run example 03
```

Real output from a run of this example:

```
Setup
-----
Mint                         7CsPtjBwbAdZUtrsxNPeiR7Zx59L14VYZ6GryrPRpump
Wallet                       H4yhMLo2u9rJJ2FQqgL5uT6Jzxu78ks9URHibB5bDYPU
Wallet source                ephemeral (generated for this run)

Live bonding curve state
------------------------
Virtual SOL reserves         74.6711 SOL
Virtual token reserves       431,090,348.87 tokens
Buyer token account exists   false

Quote
-----
Spend                        0.1000 SOL
Tokens received              569,438.11 tokens

Slippage
--------
Between quoting and landing on-chain, other buys move the curve.
slippage: 1 caps the damage: the buy aborts rather than
spend more than 0.1010 SOL for the quoted tokens.

Buy instructions
----------------
Instruction count            2
1. token/ata                 6 accounts, 1 data bytes
2. pump                      18 accounts, 25 data bytes

Next step (not performed here)
------------------------------
Compose these instructions into a transaction, sign with the wallet,
and send it. This example never broadcasts anything.
```

Your run will pick a different mint, because discovery takes whatever is trading at that moment. The curve in this run had 74.67 SOL of virtual reserves against 30 at launch, so it was well along its way toward graduation, and 0.1 SOL bought about 569 thousand tokens.

The first run may take up to twenty seconds while the discovery helper waits for events. Setting `MINT` makes it instant.

## Going further

**Related examples**

- [`05-buy-by-sol-amount.md`](./05-buy-by-sol-amount.md) is the same trade through the one-call `OnlinePumpSdk.buyBySolAmount`, which does the fetching for you.
- [`04-sell-tokens.md`](./04-sell-tokens.md) is the mirror image on the sell side.
- [`02-create-and-buy.md`](./02-create-and-buy.md) buys on a curve that does not exist yet.

**Related long-form tutorials**

- [`../02-buy-tokens.md`](../02-buy-tokens.md) covers signing and sending the buy.
- [`../12-offline-vs-online.md`](../12-offline-vs-online.md) explains the `PumpSdk` and `OnlinePumpSdk` split this example is built around.
- [`../11-trading-bot.md`](../11-trading-bot.md) turns this flow into a running bot.
- [`../28-analytics-price-quotes.md`](../28-analytics-price-quotes.md) covers price impact and quote analytics.

**Reference documentation**

- [`../../docs/bonding-curve-math.md`](../../docs/bonding-curve-math.md) for the pricing formulas.
- [`../../docs/rpc-best-practices.md`](../../docs/rpc-best-practices.md) for endpoint selection and rate limits.
- [`../../docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md) for slippage and unit mistakes.

**SDK methods used here**

| Symbol | What it does |
|---|---|
| `PUMP_SDK.buyInstructions` | Builds buy instructions from explicit state |
| `PUMP_SDK.decodeBondingCurveNullable` | Decodes a curve account, `null` if it is not one |
| `OnlinePumpSdk.fetchBuyState` | Fetches curve, curve account, buyer ATA, and token program |
| `getBuyTokenAmountFromSolAmount` | Quotes tokens out for a SOL budget |
| `newBondingCurve(global)` | Derives launch-state reserves for the offline fallback |
| `bondingCurvePda(mint)` | Derives the curve account address |
