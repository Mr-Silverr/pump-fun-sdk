/**
 * Example 18: Fee Recipients, Old and New
 *
 * Category: Curve Math & Fees
 *
 * Two different sets of fee accounts ride on every Pump trade: the
 * long-standing protocol recipients that live in Global, and the 8 shared
 * recipients the 2026-04-28 upgrade appended to every buy and sell. This
 * example draws from both, shows how to recognise them, and explains what
 * breaks if the new trailing account is missing.
 *
 * Run: npm run example 18
 */
import {
  BREAKING_FEE_RECIPIENTS,
  BREAKING_FEE_RECIPIENT_WSOL_ATAS,
  getFeeRecipient,
  getStaticRandomFeeRecipient,
  isBreakingFeeRecipient,
  pickBreakingFeeRecipient,
} from "@nirholas/pump-sdk";
import { PublicKey } from "@solana/web3.js";

import type { Global } from "@nirholas/pump-sdk";

import { mainnetGlobal } from "./_lib/curveState";
import { heading, row } from "./_lib/format";

/** The two pools of protocol fee recipients carried by a Global account. */
export interface ProtocolRecipientPools {
  /** Global.feeRecipient plus Global.feeRecipients: normal trades. */
  standard: PublicKey[];
  /** Global.reservedFeeRecipient plus reservedFeeRecipients: mayhem trades. */
  mayhem: PublicKey[];
}

/**
 * Rebuild the exact candidate lists `getFeeRecipient` samples from.
 *
 * The SDK picks one at random per instruction, so a caller that wants to
 * pre-create accounts, or to assert a returned recipient is legitimate,
 * needs the whole set rather than one draw.
 */
export function protocolRecipientPools(global: Global): ProtocolRecipientPools {
  return {
    standard: [global.feeRecipient, ...global.feeRecipients],
    mayhem: [global.reservedFeeRecipient, ...global.reservedFeeRecipients],
  };
}

/**
 * Draw repeatedly from a random picker and report the distinct results.
 *
 * Every recipient picker in the SDK is uniform random per call, which means
 * the only way to see the full set from the outside is to sample it. This
 * is also how a test proves a picker never leaves its intended set.
 */
export function distinctDraws(
  pick: () => PublicKey,
  draws: number,
): PublicKey[] {
  const seen = new Map<string, PublicKey>();
  for (let i = 0; i < draws; i += 1) {
    const key = pick();
    seen.set(key.toBase58(), key);
  }
  return [...seen.values()].sort((a, b) =>
    a.toBase58().localeCompare(b.toBase58()),
  );
}

/** Where an address sits in the breaking recipient list, or -1. */
export function breakingRecipientIndex(pubkey: PublicKey): number {
  return BREAKING_FEE_RECIPIENTS.findIndex((r) => r.equals(pubkey));
}

/**
 * The WSOL associated token account an AMM trade must pass alongside a
 * breaking recipient. Pre-derived by the SDK for all 8, because deriving an
 * ATA per instruction is wasted work in a hot trading loop.
 */
export function breakingRecipientWsolAta(recipient: PublicKey): PublicKey {
  const ata = BREAKING_FEE_RECIPIENT_WSOL_ATAS.get(recipient.toBase58());
  if (!ata) {
    throw new Error(
      `${recipient.toBase58()} is not one of the 8 breaking fee recipients`,
    );
  }
  return ata;
}

export async function main(): Promise<void> {
  const global = mainnetGlobal();

  heading("Pool 1: the protocol recipients in Global");
  const pools = protocolRecipientPools(global);
  row("Standard pool size", pools.standard.length);
  row("Mayhem pool size", pools.mayhem.length);
  console.log(
    "\ngetFeeRecipient(global, mayhemMode) draws one uniformly from the",
  );
  console.log("matching pool. The account is written to, so the transaction must");
  console.log("carry whichever one you drew.");
  row("Draw (standard)", getFeeRecipient(global, false).toBase58());
  row("Draw (mayhem)", getFeeRecipient(global, true).toBase58());

  heading("The hardcoded fallback list");
  const staticDraws = distinctDraws(getStaticRandomFeeRecipient, 400);
  console.log("getStaticRandomFeeRecipient does not read Global at all: it draws");
  console.log("from a list compiled into the SDK, which is what the instruction");
  console.log("builders use when no Global is on hand.");
  row("Distinct addresses seen", staticDraws.length);
  for (const key of staticDraws) row("  ", key.toBase58());

  heading("Pool 2: the 2026-04-28 breaking fee recipients");
  console.log("On 2026-04-28 at 16:00 UTC both the bonding curve program and the");
  console.log("PumpSwap AMM took a breaking upgrade. Every buy and every sell now");
  console.log("carries an extra trailing account: one of 8 new shared recipients.");
  console.log("Nothing before that account moved, so the change is purely an");
  console.log("append, but an instruction built the old way is now rejected.");
  console.log("");
  console.log("On the bonding curve it is one account, mutable, at the very end.");
  console.log("On the AMM it is two: the recipient (readonly), then that");
  console.log("recipient's quote-mint ATA (mutable), both after pool-v2.");

  heading("The 8 recipients and their WSOL ATAs");
  for (const [index, recipient] of BREAKING_FEE_RECIPIENTS.entries()) {
    row(`[${index}] recipient`, recipient.toBase58());
    row("    WSOL ATA", breakingRecipientWsolAta(recipient).toBase58());
  }

  heading("Recognising one");
  const drawn = pickBreakingFeeRecipient();
  row("pickBreakingFeeRecipient", drawn.toBase58());
  row("  index in the list", breakingRecipientIndex(drawn));
  row("  isBreakingFeeRecipient", isBreakingFeeRecipient(drawn));
  const protocolRecipient = pools.standard[0]!;
  row("Protocol recipient", protocolRecipient.toBase58());
  row("  isBreakingFeeRecipient", isBreakingFeeRecipient(protocolRecipient));
  console.log("\nThe two pools are disjoint and serve different roles. A protocol");
  console.log("recipient never satisfies the new trailing account, and a breaking");
  console.log("recipient never replaces Global.feeRecipient.");

  heading("Sampling the picker");
  const breakingDraws = distinctDraws(pickBreakingFeeRecipient, 400);
  row("Distinct addresses seen", breakingDraws.length);
  console.log("All 8 are interchangeable; pick per transaction and spread load.");

  heading("Using them");
  console.log("PUMP_SDK and OnlinePumpSdk append these accounts for you. Reach for");
  console.log("the helpers directly only when you hand-build instructions, and see");
  console.log("example 19 for validating and repairing an instruction that misses");
  console.log("them.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
