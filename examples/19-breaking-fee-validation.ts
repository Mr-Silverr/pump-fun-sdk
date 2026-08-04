/**
 * Example 19: Validating the Breaking Fee Accounts
 *
 * Category: Curve Math & Fees
 *
 * Builds real bonding curve and AMM instructions, strips the trailing
 * accounts the 2026-04-28 upgrade requires to produce exactly what
 * pre-upgrade code emits, then repairs them with patchBcInstruction and
 * patchAmmInstruction. validateBcInstruction and validateAmmInstruction
 * report what was wrong before and after.
 *
 * Run: npm run example 19
 */
import {
  BONDING_CURVE_NEW_SIZE,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  buildAmmBreakingFeeRecipientAccounts,
  canonicalPumpPoolPda,
  patchAmmInstruction,
  patchBcInstruction,
  pickBreakingFeeRecipient,
  validateAmmInstruction,
  validateBcInstruction,
} from "@nirholas/pump-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AccountInfo,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import type { BreakingFeeValidation } from "@nirholas/pump-sdk";

import { launchBondingCurve, mainnetGlobal } from "./_lib/curveState";
import { heading, row } from "./_lib/format";

/** A curve account already at the current layout, so no extend is prepended. */
export function currentSizeCurveAccount(): AccountInfo<Buffer> {
  return {
    data: Buffer.alloc(BONDING_CURVE_NEW_SIZE),
    executable: false,
    lamports: 0,
    owner: PUMP_PROGRAM_ID,
  };
}

/** An existing, initialised token account, so no ATA creation is prepended. */
export function existingTokenAccount(): AccountInfo<Buffer> {
  return {
    data: Buffer.alloc(165),
    executable: false,
    lamports: 0,
    owner: TOKEN_PROGRAM_ID,
  };
}

/**
 * Build a real bonding curve buy instruction from fixture-shaped state.
 *
 * `buyInstructions` returns a list because it prepends an account extension
 * and an ATA creation when they are needed; feeding it a current-size curve
 * account and an existing token account isolates the buy itself, which is
 * the instruction the upgrade changed.
 */
export async function buildBcBuyInstruction({
  mint = Keypair.generate().publicKey,
  user = Keypair.generate().publicKey,
  solAmount = new BN(100_000_000),
  amount = new BN("1000000000000"),
}: {
  mint?: PublicKey;
  user?: PublicKey;
  solAmount?: BN;
  amount?: BN;
} = {}): Promise<TransactionInstruction> {
  const instructions = await PUMP_SDK.buyInstructions({
    global: mainnetGlobal(),
    bondingCurve: launchBondingCurve(),
    bondingCurveAccountInfo: currentSizeCurveAccount(),
    associatedUserAccountInfo: existingTokenAccount(),
    mint,
    user,
    amount,
    solAmount,
    slippage: 1,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const buy = instructions[instructions.length - 1];
  if (!buy) {
    throw new Error("buyInstructions returned no instructions");
  }
  return buy;
}

/** Build a real PumpAMM buy instruction against a canonical pool address. */
export async function buildAmmBuyInstruction({
  mint = Keypair.generate().publicKey,
  user = Keypair.generate().publicKey,
  baseAmountOut = new BN("1000000000"),
  maxQuoteAmountIn = new BN(100_000_000),
}: {
  mint?: PublicKey;
  user?: PublicKey;
  baseAmountOut?: BN;
  maxQuoteAmountIn?: BN;
} = {}): Promise<TransactionInstruction> {
  return await PUMP_SDK.ammBuyInstruction({
    user,
    pool: canonicalPumpPoolPda(mint),
    mint,
    baseAmountOut,
    maxQuoteAmountIn,
  });
}

/**
 * Drop the last `count` accounts, reproducing what a pre-upgrade builder
 * emits. The data payload and every other account stay untouched, which is
 * exactly the shape of the real regression.
 */
export function dropTrailingAccounts(
  ix: TransactionInstruction,
  count: number,
): TransactionInstruction {
  return new TransactionInstruction({
    keys: ix.keys.slice(0, ix.keys.length - count),
    programId: ix.programId,
    data: ix.data,
  });
}

export interface RepairReport {
  before: BreakingFeeValidation;
  after: BreakingFeeValidation;
  accountsBefore: number;
  accountsAfter: number;
  patched: TransactionInstruction;
  /** True when patching was a no-op because the accounts were already right. */
  alreadyValid: boolean;
}

/** Validate a bonding curve trade, patch it, and validate again. */
export function repairBcInstruction(
  ix: TransactionInstruction,
  kind: "buy" | "sell" | "sell-cashback",
): RepairReport {
  const before = validateBcInstruction(ix, kind);
  const patched = patchBcInstruction(ix);
  return {
    before,
    after: validateBcInstruction(patched, kind),
    accountsBefore: ix.keys.length,
    accountsAfter: patched.keys.length,
    patched,
    alreadyValid: patched === ix,
  };
}

/** Validate an AMM trade, patch it, and validate again. */
export function repairAmmInstruction(
  ix: TransactionInstruction,
  kind: "buy" | "buy-cashback" | "sell" | "sell-cashback",
): RepairReport {
  const before = validateAmmInstruction(ix, kind);
  const patched = patchAmmInstruction(ix);
  return {
    before,
    after: validateAmmInstruction(patched, kind),
    accountsBefore: ix.keys.length,
    accountsAfter: patched.keys.length,
    patched,
    alreadyValid: patched === ix,
  };
}

function printValidation(label: string, result: BreakingFeeValidation): void {
  row(label, result.valid ? "valid" : `invalid (${result.errors.length})`);
  for (const error of result.errors) row("   ", error);
}

export async function main(): Promise<void> {
  const mint = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;

  heading("Setup");
  row("Mint", `${mint.toBase58()} (generated for this run)`);
  row("User", user.toBase58());
  console.log("\nBoth are ephemeral: this example builds and inspects instruction");
  console.log("account lists offline and never signs or sends anything.");

  heading("Bonding curve buy, as the SDK builds it");
  const bcBuy = await buildBcBuyInstruction({ mint, user });
  row("Program", bcBuy.programId.toBase58());
  row("Accounts", bcBuy.keys.length);
  row("Data bytes", bcBuy.data.length);
  const tail = bcBuy.keys[bcBuy.keys.length - 1]!;
  row("Last account", tail.pubkey.toBase58());
  row("  writable / signer", `${tail.isWritable} / ${tail.isSigner}`);
  printValidation("validateBcInstruction", validateBcInstruction(bcBuy, "buy"));

  heading("The same buy, built the pre-upgrade way");
  const staleBc = dropTrailingAccounts(bcBuy, 1);
  const bcRepair = repairBcInstruction(staleBc, "buy");
  row("Accounts", bcRepair.accountsBefore);
  printValidation("Before patch", bcRepair.before);
  console.log("\nThe program does not read the account list loosely: a missing");
  console.log("trailing recipient fails the transaction, it does not degrade.");

  heading("patchBcInstruction");
  row("Accounts after", bcRepair.accountsAfter);
  printValidation("After patch", bcRepair.after);
  const bcAppended = bcRepair.patched.keys[bcRepair.patched.keys.length - 1]!;
  row("Appended", bcAppended.pubkey.toBase58());
  row("  writable / signer", `${bcAppended.isWritable} / ${bcAppended.isSigner}`);
  row(
    "Idempotent on a valid ix",
    repairBcInstruction(bcRepair.patched, "buy").alreadyValid,
  );
  console.log("\nThe patch returns a new instruction; the original is untouched,");
  console.log("so it is safe to run over a queue of already-built instructions.");

  heading("PumpAMM buy, as the SDK builds it");
  const ammBuy = await buildAmmBuyInstruction({ mint, user });
  row("Program", ammBuy.programId.toBase58());
  row("Accounts", ammBuy.keys.length);
  const ammRecipient = ammBuy.keys[ammBuy.keys.length - 2]!;
  const ammAta = ammBuy.keys[ammBuy.keys.length - 1]!;
  row("Second-to-last", ammRecipient.pubkey.toBase58());
  row("  writable / signer", `${ammRecipient.isWritable} / ${ammRecipient.isSigner}`);
  row("Last (WSOL ATA)", ammAta.pubkey.toBase58());
  row("  writable / signer", `${ammAta.isWritable} / ${ammAta.isSigner}`);
  printValidation("validateAmmInstruction", validateAmmInstruction(ammBuy, "buy"));
  console.log("\nNote the asymmetry with the bonding curve: here the recipient is");
  console.log("readonly and the ATA is the mutable account, because the fee lands");
  console.log("in the token account rather than in the recipient's own lamports.");

  heading("The same AMM buy, built the pre-upgrade way");
  const staleAmm = dropTrailingAccounts(ammBuy, 2);
  const ammRepair = repairAmmInstruction(staleAmm, "buy");
  row("Accounts", ammRepair.accountsBefore);
  printValidation("Before patch", ammRepair.before);

  heading("patchAmmInstruction");
  row("Accounts after", ammRepair.accountsAfter);
  printValidation("After patch", ammRepair.after);
  row(
    "Idempotent on a valid ix",
    repairAmmInstruction(ammRepair.patched, "buy").alreadyValid,
  );

  heading("Building the pair by hand");
  const chosen = pickBreakingFeeRecipient();
  const accounts = buildAmmBreakingFeeRecipientAccounts(chosen);
  for (const [index, account] of accounts.entries()) {
    row(
      `  [${index}]`,
      `${account.pubkey.toBase58()} writable=${account.isWritable} signer=${account.isSigner}`,
    );
  }
  console.log("\nbuildAmmBreakingFeeRecipientAccounts is the single source of truth");
  console.log("for that pair. Pass a recipient to pin it, or let it draw one. The");
  console.log("WSOL ATA is looked up from a pre-computed map, so a hot trading loop");
  console.log("pays no ATA derivation cost per instruction.");

  heading("Where this matters");
  console.log("Use the validators as a pre-flight over instructions your own code");
  console.log("assembles, and over anything deserialised from an external source.");
  console.log("Instructions built through PUMP_SDK or OnlinePumpSdk already carry");
  console.log("the accounts, so the validator is an assertion, not a fix.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
