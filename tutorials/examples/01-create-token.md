# Example 01: Create a Token

> Build the createV2 instruction that launches a token on the Pump bonding curve, with no network, no wallet, and no funds.

## What you'll build

A program that produces the single instruction every Pump token starts its life with: `createV2`. You will see what that instruction contains (which program owns it, how many accounts it touches, how many bytes of data it carries) and which on-chain addresses the launch will bring into existence.

Nothing is broadcast. Building an instruction is pure local computation: the SDK serializes your launch parameters into an Anchor instruction and hands it back. You decide later whether it ever reaches a validator.

That is the point of starting here. A token launch is irreversible and costs real SOL, so the first thing worth learning is how to inspect the exact bytes you are about to sign.

The example lives in [`../../examples/01-create-token.ts`](../../examples/01-create-token.ts).

## Prerequisites

- Node.js 18 or newer.
- A clone of this repository with dependencies installed:

  ```bash
  npm install
  ```

- No wallet, no SOL, and no RPC endpoint. This example runs entirely offline.

If you want the example to use a wallet you control instead of a throwaway keypair, export one of these before running it (see [`../../examples/_lib/wallet.ts`](../../examples/_lib/wallet.ts)):

```bash
export PUMP_WALLET=/path/to/keypair.json      # solana-keygen JSON array
export PUMP_WALLET_SECRET=<base58 secret key>
```

Neither is required. Without them the example generates an ephemeral keypair, which is safe because it never signs or sends anything.

## Walkthrough

### Step 1: The imports

```ts
import {
  PUMP_SDK,
  PUMP_PROGRAM_ID,
  bondingCurvePda,
  creatorVaultPda,
} from "@nirholas/pump-sdk";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";
```

`PUMP_SDK` is the offline singleton. It builds instructions and decodes accounts; it never opens a socket. `PUMP_PROGRAM_ID` is the Pump bonding curve program address, used here to assert that the instruction really targets Pump. `bondingCurvePda` and `creatorVaultPda` are pure address derivations: given a mint (or a creator), they compute the program-derived address deterministically, on your machine, before the account exists.

`heading` and `row` are the example suite's formatting helpers from [`../../examples/_lib/format.ts`](../../examples/_lib/format.ts). They print aligned label/value lines and section titles.

### Step 2: Name the launch parameters

```ts
export interface TokenLaunchParams {
  name: string;
  symbol: string;
  /** Off-chain metadata JSON (image, description). */
  uri: string;
  mint: PublicKey;
  creator: PublicKey;
  /** Wallet paying rent and fees; usually the creator. */
  user: PublicKey;
  /** Opt the token into mayhem mode at launch. */
  mayhemMode?: boolean;
  /** Opt the token into cashback rewards at launch. */
  cashback?: boolean;
}
```

Six of these deserve a sentence each.

- `name` and `symbol` are stored on-chain and are what wallets and explorers display.
- `uri` points at a JSON document hosted off-chain (IPFS, Arweave, any public URL) holding the description and image. The chain stores the pointer, not the picture.
- `mint` is the token's address. It must be a brand-new keypair, and that keypair has to co-sign the transaction, which is how the program knows you actually own the address you are claiming.
- `creator` is the address that will earn creator fees on every trade of this token, forever.
- `user` pays rent and transaction fees. It is usually the same wallet as `creator`, but the two are separate parameters precisely so a treasury can pay for a launch that credits someone else.
- `mayhemMode` and `cashback` are launch-time opt-ins, both defaulting to off. See [`../23-mayhem-mode-trading.md`](../23-mayhem-mode-trading.md) and [`../27-cashback-social-fees.md`](../27-cashback-social-fees.md) for what each one changes.

### Step 3: Build the instruction

```ts
export async function buildCreateTokenInstruction(
  params: TokenLaunchParams,
): Promise<TransactionInstruction> {
  return await PUMP_SDK.createV2Instruction({
    mint: params.mint,
    name: params.name,
    symbol: params.symbol,
    uri: params.uri,
    creator: params.creator,
    user: params.user,
    mayhemMode: params.mayhemMode ?? false,
    cashback: params.cashback ?? false,
  });
}
```

This is the whole launch, as far as your process is concerned. Note the two rules the SDK enforces here on your behalf.

**Use `createV2Instruction`, not `createInstruction`.** The v1 builder is deprecated. `createV2` targets Token-2022 and is the only creation path that supports mayhem mode and cashback.

**The function returns a `TransactionInstruction`, not a `Transaction`.** Every builder in this SDK returns instructions and leaves transaction assembly to you. That is what lets you bundle a create with a buy (example 02), or with a priority fee instruction, or with anything else, in a single atomic transaction.

The `?? false` defaults matter more than they look. Passing `undefined` for a boolean flag into an Anchor encoder is a bug waiting to happen; normalizing at the boundary means the encoder always sees a real value.

### Step 4: Set up a launch and inspect what came back

```ts
export async function main(): Promise<void> {
  const wallet = loadWallet();
  const mint = Keypair.generate();

  heading("Launch parameters");
  row("Name", "Example Coin");
  row("Symbol", "XMPL");
  row("Mint (new keypair)", mint.publicKey.toBase58());
  row("Creator / payer", wallet.publicKey.toBase58());
```

`Keypair.generate()` is the mint. Every run produces a different address, which is why the sample output below will not match your run byte for byte.

If you want a mint address that ends in `pump` like the ones on the pump.fun site, swap this line for the SDK's vanity generator. [`../13-vanity-addresses.md`](../13-vanity-addresses.md) covers that; nothing else in this example changes.

```ts
  const ix = await buildCreateTokenInstruction({
    name: "Example Coin",
    symbol: "XMPL",
    uri: "https://example.com/metadata.json",
    mint: mint.publicKey,
    creator: wallet.publicKey,
    user: wallet.publicKey,
  });

  heading("createV2 instruction");
  row("Program", ix.programId.toBase58());
  row("Is Pump program", ix.programId.equals(PUMP_PROGRAM_ID));
  row("Accounts", ix.keys.length);
  row("Data bytes", ix.data.length);
```

A Solana instruction is three things: a program id, an ordered list of accounts with their signer and writable flags, and an opaque data blob. Printing all three is a habit worth keeping, because it is the cheapest possible sanity check. If `Is Pump program` were ever `false`, you would be about to sign something you did not intend.

Sixteen accounts sounds like a lot for "make a token." It is: the mint, the bonding curve, the curve's associated token account, the creator vault, the global config, the metadata account, the mint authority, plus the system, token, associated-token, and rent programs, and the event authority. `createV2` initializes several accounts at once, and each one has to be named.

### Step 5: Derive the addresses the launch will create

```ts
  heading("Derived accounts this launch will create");
  row("Bonding curve PDA", bondingCurvePda(mint.publicKey).toBase58());
  row("Creator vault PDA", creatorVaultPda(wallet.publicKey).toBase58());
```

This is the part people find surprising the first time. Both addresses are computable right now, before the transaction exists, because a program-derived address is a hash of fixed seeds and a program id, not something a validator assigns.

- The **bonding curve PDA** is derived from the mint. It will hold the curve's reserves and its state (virtual and real reserves, total supply, the `complete` flag). Every buy and sell for the life of the curve reads and writes this account.
- The **creator vault PDA** is derived from the creator's address, not the mint. One vault per creator, accumulating creator fees across every token that creator launches.

Because these are deterministic, you can index them, prefetch them, or subscribe to them before your launch transaction has even been signed. [`../10-working-with-pdas.md`](../10-working-with-pdas.md) covers the full PDA surface.

### Step 6: Stop before sending

```ts
  heading("Next step (not performed here)");
  console.log(
    "Add this instruction to a Transaction, sign with BOTH the wallet and",
  );
  console.log(
    "the mint keypair, then send it. Example 02 shows create-and-buy in one.",
  );
}
```

Every example in this directory stops here on purpose. Nothing in [`../../examples/`](../../examples/) broadcasts a transaction; instructions that would spend funds get printed and the program exits. Sending is always your own explicit, separate step.

When you do send it, the transaction needs two signatures: the payer wallet, and the mint keypair. Missing the mint signature is the single most common failure on a first launch, and the error the runtime returns for it is not especially descriptive.

### Step 7: The entry point

```ts
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

The guard means the file is importable as a module and runnable as a script. That is what lets [`../../examples/__tests__/01-create-token.test.ts`](../../examples/__tests__/01-create-token.test.ts) import `buildCreateTokenInstruction` and assert against a real encoded instruction, with no network and no mocking.

## Run it

```bash
npm run example 01
```

Real output from a run of this example:

```
Launch parameters
-----------------
Name                         Example Coin
Symbol                       XMPL
Mint (new keypair)           8km6EzLjYYNmp6dYcZsYP3d9veRnkUNAuC6eCwir2Ux8
Creator / payer              5C9epMjN87SQu4Prfjm1dWEJhhQkrC6TTjVwLGfErybx

createV2 instruction
--------------------
Program                      6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
Is Pump program              true
Accounts                     16
Data bytes                   103

Derived accounts this launch will create
----------------------------------------
Bonding curve PDA            7eqHkbqzHNAawcCiiHRsMA31UdPZ4UVZgZ2srHJ4dzW7
Creator vault PDA            6A4QWGNQeW3cVXh1hX2ZXDSuRJYws67RB5N5AUicfPtr

Next step (not performed here)
------------------------------
Add this instruction to a Transaction, sign with BOTH the wallet and
the mint keypair, then send it. Example 02 shows create-and-buy in one.
```

The mint and wallet addresses change on every run because both are freshly generated keypairs. `Program`, `Accounts`, and `Data bytes` are stable. The `103` data bytes are the Anchor discriminator plus the borsh-encoded name, symbol, uri, creator, and the two boolean flags, so that number moves if you change the strings.

You can also run it by name:

```bash
npm run example 01-create-token
```

## Going further

**Next examples**

- [`02-create-and-buy.md`](./02-create-and-buy.md) bundles this instruction with the creator's first buy into one atomic transaction, so nobody can front-run your own launch.
- [`03-buy-tokens.md`](./03-buy-tokens.md) is the canonical buy flow against a live curve.

**Related long-form tutorials**

- [`../01-create-token.md`](../01-create-token.md) walks through signing and sending the transaction end to end, including the metadata JSON format.
- [`../13-vanity-addresses.md`](../13-vanity-addresses.md) generates a mint address with a chosen suffix.
- [`../10-working-with-pdas.md`](../10-working-with-pdas.md) covers every PDA the protocol derives.

**Reference documentation**

- [`../../docs/api-reference.md`](../../docs/api-reference.md) for the full `PumpSdk` surface.
- [`../../docs/getting-started.md`](../../docs/getting-started.md) for installation and first steps outside this repository.
- [`../../docs/errors.md`](../../docs/errors.md) for the typed errors the builders throw.

**SDK methods used here**

| Symbol | What it does |
|---|---|
| `PUMP_SDK.createV2Instruction` | Builds the token creation instruction |
| `bondingCurvePda(mint)` | Derives the curve account address for a mint |
| `creatorVaultPda(creator)` | Derives a creator's fee vault address |
| `PUMP_PROGRAM_ID` | The Pump bonding curve program address |
