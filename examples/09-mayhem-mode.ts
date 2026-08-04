/**
 * Example 09: Mayhem Mode
 *
 * Category: Token Lifecycle
 *
 * Builds the same launch twice with createV2Instruction, once with mayhem
 * mode off and once with it on, then diffs the two instructions byte for
 * byte. Shows the four Mayhem program accounts every create_v2 carries and
 * exactly where the flag lands in the instruction data.
 *
 * Run: npm run example 09
 */
import {
  PUMP_SDK,
  MAYHEM_PROGRAM_ID,
  getGlobalParamsPda,
  getMayhemStatePda,
  getSolVaultPda,
  getTokenVaultPda,
} from "@nirholas/pump-sdk";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";

/** The Mayhem program accounts createV2 threads into every launch. */
export interface MayhemAccounts {
  /** Program-wide Mayhem parameters, shared by every mayhem token. */
  globalParams: PublicKey;
  /** The Mayhem SOL vault, shared by every mayhem token. */
  solVault: PublicKey;
  /** Per-mint Mayhem state. */
  mayhemState: PublicKey;
  /** The SOL vault's Token-2022 ATA for this mint. */
  tokenVault: PublicKey;
}

/** Derive every Mayhem PDA a create_v2 for `mint` references. */
export function mayhemAccounts(mint: PublicKey): MayhemAccounts {
  return {
    globalParams: getGlobalParamsPda(),
    solVault: getSolVaultPda(),
    mayhemState: getMayhemStatePda(mint),
    tokenVault: getTokenVaultPda(mint),
  };
}

/** The result of comparing two instructions account-for-account, byte-for-byte. */
export interface InstructionDiff {
  /** True when both reference the same accounts in the same order with the same flags. */
  accountsIdentical: boolean;
  /** True when both data buffers have the same length. */
  sameDataLength: boolean;
  /** Indexes into the data buffer where the two instructions differ. */
  changedDataOffsets: number[];
}

/** Compare two instructions built for the same launch. */
export function diffInstructions(
  a: TransactionInstruction,
  b: TransactionInstruction,
): InstructionDiff {
  const accountsIdentical =
    a.keys.length === b.keys.length &&
    a.keys.every((key, i) => {
      const other = b.keys[i];
      return (
        other !== undefined &&
        key.pubkey.equals(other.pubkey) &&
        key.isSigner === other.isSigner &&
        key.isWritable === other.isWritable
      );
    });

  const changedDataOffsets: number[] = [];
  const shared = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < shared; i += 1) {
    if (a.data[i] !== b.data[i]) changedDataOffsets.push(i);
  }

  return {
    accountsIdentical,
    sameDataLength: a.data.length === b.data.length,
    changedDataOffsets,
  };
}

export interface MayhemLaunchParams {
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  creator: PublicKey;
  user: PublicKey;
}

/** Build the plain and mayhem variants of one launch, ready to compare. */
export async function buildMayhemPair(
  params: MayhemLaunchParams,
): Promise<{ plain: TransactionInstruction; mayhem: TransactionInstruction }> {
  const [plain, mayhem] = await Promise.all([
    PUMP_SDK.createV2Instruction({ ...params, mayhemMode: false }),
    PUMP_SDK.createV2Instruction({ ...params, mayhemMode: true }),
  ]);
  return { plain, mayhem };
}

/** Index of an account inside an instruction's account list, or -1. */
export function accountIndex(
  ix: TransactionInstruction,
  account: PublicKey,
): number {
  return ix.keys.findIndex((key) => key.pubkey.equals(account));
}

export async function main(): Promise<void> {
  const wallet = loadWallet();
  const mint = Keypair.generate();

  heading("Launch parameters");
  row("Mint (new keypair)", mint.publicKey.toBase58());
  row("Creator / payer", wallet.publicKey.toBase58());

  const { plain, mayhem } = await buildMayhemPair({
    mint: mint.publicKey,
    name: "Mayhem Example",
    symbol: "MHEX",
    uri: "https://example.com/metadata.json",
    creator: wallet.publicKey,
    user: wallet.publicKey,
  });

  heading("Mayhem program accounts (present in BOTH variants)");
  row("Mayhem program", MAYHEM_PROGRAM_ID.toBase58());
  const accounts = mayhemAccounts(mint.publicKey);
  for (const [label, account] of Object.entries(accounts)) {
    row(label, `${account.toBase58()} @ix[${accountIndex(plain, account)}]`);
  }
  console.log(
    "\ncreateV2 always threads these four accounts, mayhem on or off. The",
  );
  console.log(
    "flag decides whether the program initializes mayhem state for the mint.",
  );

  heading("Instruction shape");
  row("Accounts (mayhemMode false)", plain.keys.length);
  row("Accounts (mayhemMode true)", mayhem.keys.length);
  row("Data bytes (false)", plain.data.length);
  row("Data bytes (true)", mayhem.data.length);

  heading("Byte diff");
  const diff = diffInstructions(plain, mayhem);
  row("Accounts identical", diff.accountsIdentical);
  row("Same data length", diff.sameDataLength);
  row("Changed data offsets", `[${diff.changedDataOffsets.join(", ")}]`);
  for (const offset of diff.changedDataOffsets) {
    row(
      `  data[${offset}]`,
      `${String(plain.data[offset])} -> ${String(mayhem.data[offset])}`,
    );
  }
  console.log(
    "\nThe whole difference is one boolean byte in the Anchor-encoded args.",
  );
  console.log(
    "The account lists are identical, so a launcher can flip mayhem mode",
  );
  console.log("without changing how it assembles the transaction.");

  heading("Next step (not performed here)");
  console.log(
    "Sign the chosen instruction with both the wallet and the mint keypair,",
  );
  console.log(
    "then send it. Example 10 covers the other create_v2 flag, cashback.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
