/**
 * Example 39: Routed Trading
 *
 * Category: Live Data
 *
 * routedBuyInstructions and routedSellInstructions pick the venue for you:
 * bonding curve while the token is still curving, PumpAMM once it has
 * graduated. This runs both against a live curve token and a live graduated
 * token and shows the routing decision behind each instruction set.
 *
 * Run: npm run example 39
 */
import {
  OnlinePumpSdk,
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  bondingCurvePda,
  type BondingCurve,
} from "@nirholas/pump-sdk";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { findActiveCurveMint, findGraduatedMint } from "./_lib/discovery";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { isEphemeral, loadWallet } from "./_lib/wallet";

export type Venue = "bonding-curve" | "amm" | "none";

export interface RouteDecision {
  venue: Venue;
  /** Program the trade instructions will target. */
  programId: PublicKey | null;
  /** Why the router lands here, in one line. */
  reason: string;
}

/**
 * The routing rule, isolated from the network.
 *
 * The router reads exactly one field: `bondingCurve.complete`. The program
 * sets it when the last real token leaves the curve, which is also the
 * moment it stops accepting buys and sells, so it is the only correct
 * switch. A mint with no bonding curve account at all was never a Pump
 * token and neither venue applies.
 */
export function routeFor(bondingCurve: BondingCurve | null): RouteDecision {
  if (!bondingCurve) {
    return {
      venue: "none",
      programId: null,
      reason:
        "No bonding curve account exists for this mint, so it never launched on Pump.",
    };
  }
  if (bondingCurve.complete) {
    return {
      venue: "amm",
      programId: PUMP_AMM_PROGRAM_ID,
      reason:
        "bondingCurve.complete is true: the curve sold out and migrated, so the trade goes to the canonical PumpAMM pool.",
    };
  }
  return {
    venue: "bonding-curve",
    programId: PUMP_PROGRAM_ID,
    reason:
      "bondingCurve.complete is false: real tokens are still on the curve, so the trade goes to the Pump program.",
  };
}

/** SPL token account layout: mint (32) owner (32) amount (8, little endian). */
export function tokenAccountOwner(data: Buffer): PublicKey {
  if (data.length < 72) {
    throw new Error(`Not an SPL token account: ${data.length} bytes`);
  }
  return new PublicKey(data.subarray(32, 64));
}

/** Balance of an SPL token account, from the same fixed layout. */
export function tokenAccountAmount(data: Buffer): BN {
  if (data.length < 72) {
    throw new Error(`Not an SPL token account: ${data.length} bytes`);
  }
  return new BN(data.subarray(64, 72), "le");
}

/** Summarise an instruction list by the program each instruction targets. */
export function summariseInstructions(
  instructions: TransactionInstruction[],
): string[] {
  return instructions.map((ix, index) => {
    const program = ix.programId.equals(PUMP_PROGRAM_ID)
      ? "pump"
      : ix.programId.equals(PUMP_AMM_PROGRAM_ID)
        ? "pump-amm"
        : ix.programId.toBase58().slice(0, 8);
    return `ix[${index}] ${program} keys=${ix.keys.length} data=${ix.data.length}B`;
  });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One paced retry when the public RPC rate limits the run. */
async function rpc<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/429|rate limit|Too Many Requests/i.test(message)) throw error;
    console.log(
      `${label}: public RPC rate limited. Retrying once in 2s (set PUMP_RPC_URL for a dedicated endpoint).`,
    );
    await pause(2_000);
    return await run();
  }
}

/**
 * A real holder, because routedSellInstructions reads the seller's token
 * account and cannot quote a position that does not exist. The curve's own
 * vault holds unsold supply rather than a trader's position, so it is
 * skipped.
 */
async function findHolder(
  connection: ReturnType<typeof getConnection>,
  mint: PublicKey,
): Promise<{ owner: PublicKey; amount: BN } | null> {
  const largest = await rpc("getTokenLargestAccounts", () =>
    connection.getTokenLargestAccounts(mint),
  );
  const curveVault = bondingCurvePda(mint);
  for (const account of largest.value.slice(0, 5)) {
    const info = await connection.getAccountInfo(account.address);
    if (!info) continue;
    const owner = tokenAccountOwner(info.data);
    const amount = tokenAccountAmount(info.data);
    if (owner.equals(curveVault) || amount.isZero()) continue;
    return { owner, amount };
  }
  return null;
}

async function reportToken(
  online: OnlinePumpSdk,
  connection: ReturnType<typeof getConnection>,
  label: string,
  mint: PublicKey,
  buyer: PublicKey,
): Promise<void> {
  heading(label);
  row("Mint", mint.toBase58());

  const bondingCurve = await online.fetchBondingCurve(mint).catch(() => null);
  const route = routeFor(bondingCurve);
  row("Venue", route.venue);
  row("Program", route.programId ? route.programId.toBase58() : "n/a");
  console.log(route.reason);
  if (!bondingCurve) return;

  const solAmount = new BN(50_000_000); // 0.05 SOL
  await pause(300);
  const buyIxs = await rpc("routedBuyInstructions", () =>
    online.routedBuyInstructions({
      mint,
      user: buyer,
      quoteAmountIn: solAmount,
      slippage: 0.01, // 1%
    }),
  );
  row(`Buy ${formatSol(solAmount)}`, `${buyIxs.length} instructions`);
  for (const line of summariseInstructions(buyIxs)) row("  ", line);

  await pause(300);
  const holder = await findHolder(connection, mint);
  if (!holder) {
    console.log(
      "No readable holder account for this mint right now, so the sell leg is",
    );
    console.log(
      "skipped: routedSellInstructions needs a seller with an existing token",
    );
    console.log("account to size and route the trade.");
    return;
  }

  // Sell a hundredth of the holder's position: large enough to price, small
  // enough that it never approaches the single-instruction safety bound.
  const sellAmount = BN.max(new BN(1), holder.amount.divn(100));
  await pause(300);
  const sellIxs = await rpc("routedSellInstructions", () =>
    online.routedSellInstructions({
      mint,
      user: holder.owner,
      baseAmountIn: sellAmount,
      slippage: 0.01,
    }),
  );
  row("Seller", holder.owner.toBase58());
  row(`Sell ${formatTokens(sellAmount)}`, `${sellIxs.length} instructions`);
  for (const line of summariseInstructions(sellIxs)) row("  ", line);
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);
  const wallet = loadWallet();

  heading("Setup");
  row("Buyer", wallet.publicKey.toBase58());
  row(
    "Wallet source",
    isEphemeral() ? "ephemeral (generated for this run)" : "PUMP_WALLET env",
  );
  console.log(
    "Nothing is signed or sent. Both calls return instruction lists and the",
  );
  console.log("route they chose is visible in the program each one targets.");

  const curve = await findActiveCurveMint(connection);
  await reportToken(
    online,
    connection,
    "Token still on its bonding curve",
    curve.mint,
    wallet.publicKey,
  );

  const graduated = await findGraduatedMint(connection);
  await reportToken(
    online,
    connection,
    "Token that graduated to PumpAMM",
    graduated.mint,
    wallet.publicKey,
  );

  heading("Why route at all");
  console.log(
    "A trading bot that hardcodes the bonding curve breaks the moment a token",
  );
  console.log(
    "graduates, in the middle of the run it cares about most. The routed",
  );
  console.log(
    "helpers read the completion flag on every call, so the same code keeps",
  );
  console.log("working across the migration with no branch of your own.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
