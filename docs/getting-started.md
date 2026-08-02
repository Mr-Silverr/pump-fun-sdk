# Getting started with pump-fun-sdk

> Install the SDK, build your first Pump instruction offline, then read live protocol state from mainnet, all in under five minutes.

The SDK is TypeScript-first and split into two classes: `PumpSdk` (offline, builds instructions with no network) and `OnlinePumpSdk` (wraps a Solana `Connection` and fetches on-chain state). You will use both below.

## 1. Install

```bash
npm install @nirholas/pump-sdk @solana/web3.js @coral-xyz/anchor @solana/spl-token bn.js
```

`@solana/web3.js`, `@coral-xyz/anchor`, `@solana/spl-token`, and `bn.js` are peer dependencies; install them alongside the SDK. Any package manager works (`yarn add`, `pnpm add`, `bun add`).

Requirements: Node.js 18 or later.

## 2. First SDK call: build an instruction offline

No RPC endpoint, no wallet funding, no network at all. The offline `PUMP_SDK` singleton builds real, byte-exact program instructions from pure inputs. Save this as `first.ts`:

```typescript
import { Keypair } from "@solana/web3.js";
import { PUMP_SDK, PUMP_PROGRAM_ID } from "@nirholas/pump-sdk";

async function main() {
  const mint = Keypair.generate();
  const user = Keypair.generate();

  const ix = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: "My First Token",
    symbol: "FIRST",
    uri: "https://example.com/metadata.json",
    creator: user.publicKey,
    user: user.publicKey,
    mayhemMode: false,
  });

  console.log("program:", ix.programId.toBase58());
  console.log("matches PUMP_PROGRAM_ID:", ix.programId.equals(PUMP_PROGRAM_ID));
  console.log("accounts:", ix.keys.length);
  console.log("data bytes:", ix.data.length);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Run it:

```bash
npx tsx first.ts
```

Expected output:

```
program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
matches PUMP_PROGRAM_ID: true
accounts: 16
data bytes: 106
```

That is a complete, valid `create_v2` instruction for the Pump program. Nothing was sent anywhere: the SDK returns `TransactionInstruction` objects and leaves signing and submission to you. To actually launch the token you would add this instruction to a transaction, sign with both the wallet and the mint keypair, and send it.

Note the SDK conventions you just used:

- Every amount in the SDK is a `BN` (bn.js), never a JavaScript `number`. `new BN(1_000_000_000)` is 1 SOL in lamports.
- Instruction builders return `TransactionInstruction` or `TransactionInstruction[]`, never a `Transaction`.
- Token creation goes through `createV2Instruction`. The older `createInstruction` is deprecated.

## 3. First live read: fetch protocol state from mainnet

Now add a network connection. `OnlinePumpSdk` fetches and decodes on-chain accounts for you. Save as `live.ts`:

```typescript
import { Connection } from "@solana/web3.js";
import { OnlinePumpSdk } from "@nirholas/pump-sdk";

async function main() {
  const connection = new Connection(
    process.env.PUMP_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const sdk = new OnlinePumpSdk(connection);

  const global = await sdk.fetchGlobal();
  console.log("initialized:", global.initialized);
  console.log("initial virtual SOL reserves:", global.initialVirtualSolReserves.toString());
  console.log("initial virtual token reserves:", global.initialVirtualTokenReserves.toString());
  console.log("initial real token reserves:", global.initialRealTokenReserves.toString());

  const feeConfig = await sdk.fetchFeeConfig();
  console.log("fee tiers:", feeConfig.feeTiers.length);
  const first = feeConfig.feeTiers[0];
  if (first) {
    console.log("tier 1 protocol fee bps:", first.fees.protocolFeeBps.toString());
    console.log("tier 1 creator fee bps:", first.fees.creatorFeeBps.toString());
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Run it:

```bash
npx tsx live.ts
```

Expected output (the fee values are live protocol config and can change):

```
initialized: true
initial virtual SOL reserves: 30000000000
initial virtual token reserves: 1073000000000000
initial real token reserves: 793100000000000
fee tiers: 1
tier 1 protocol fee bps: 95
tier 1 creator fee bps: 30
```

You just read the Pump program's `Global` config (the reserves every new bonding curve starts with) and the live fee tier table from the PumpFees program. The public mainnet RPC is rate limited; set `PUMP_RPC_URL` to a dedicated endpoint for anything beyond experimentation (see [RPC Best Practices](./rpc-best-practices.md)).

## 4. Where to go next

The typical flow for a real trade: fetch state with `OnlinePumpSdk`, quote with the pure math functions, build instructions, then sign and send with your own wallet code.

```typescript
import { PUMP_SDK, getBuyTokenAmountFromSolAmount } from "@nirholas/pump-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

// sdk is an OnlinePumpSdk, mint and user are PublicKeys
const global = await sdk.fetchGlobal();
const feeConfig = await sdk.fetchFeeConfig();
const buyState = await sdk.fetchBuyState(mint, user);

const solAmount = new BN(100_000_000); // 0.1 SOL
const amount = getBuyTokenAmountFromSolAmount({
  global,
  feeConfig,
  mintSupply: buyState.bondingCurve.tokenTotalSupply,
  bondingCurve: buyState.bondingCurve,
  amount: solAmount,
});

const ixs = await PUMP_SDK.buyInstructions({
  global,
  bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
  bondingCurve: buyState.bondingCurve,
  associatedUserAccountInfo: buyState.associatedUserAccountInfo,
  mint,
  user,
  amount,
  solAmount,
  slippage: 1, // percent
  tokenProgram: buyState.tokenProgram,
});
```

Runnable examples: the repository ships 50 numbered, runnable examples under `examples/`. Start with Token Lifecycle (01-10): `npm run example 01`.

## Working from a clone

To hack on the SDK itself:

```bash
git clone https://github.com/nirholas/pump-fun-sdk.git
cd pump-fun-sdk
npm install
```

| Command | Runs |
|---|---|
| `npm run build` | `tsup --clean --dts` |
| `npm run dev` | `tsup --watch` |
| `npm run test` | `jest` |
| `npm run lint` | `eslint --cache --quiet` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run example NN` | Run numbered example NN |

## Related

- [End-to-End Workflow](./end-to-end-workflow.md): the full token lifecycle in one walkthrough
- [API Reference](./api-reference.md): every exported class, function, and type
- [Bonding Curve Math](./bonding-curve-math.md): how quotes are computed
- [FAQ](./faq.md) and [Troubleshooting](./TROUBLESHOOTING.md)
- Found a problem? [Open an issue](https://github.com/nirholas/pump-fun-sdk/issues)
