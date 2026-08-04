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
  canonicalPumpPoolPda,
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

/**
 * An account that certainly holds the token, so the sell leg can be built.
 *
 * routedSellInstructions reads the seller's associated token account and
 * throws when it does not exist, so the seller has to be a real holder.
 * Both venues have one by construction: the bonding curve holds its unsold
 * supply in its own vault, and a graduated token's supply sits in the
 * canonical pool's base vault. Neither costs an extra lookup to derive, and
 * neither changes the routing decision, which is the point of the example.
 */
export function sellerFor(mint: PublicKey, venue: Venue): PublicKey | null {
  if (venue === "bonding-curve") return bondingCurvePda(mint);
  if (venue === "amm") return canonicalPumpPoolPda(mint);
  return null;
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

async function reportToken(
  online: OnlinePumpSdk,
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

  const seller = sellerFor(mint, route.venue);
  if (!seller) return;

  // 1,000 whole tokens: small enough on either venue that the sell never
  // approaches the single-instruction safety bound.
  const sellAmount = new BN(1_000_000_000);
  await pause(300);
  const sellIxs = await rpc("routedSellInstructions", () =>
    online.routedSellInstructions({
      mint,
      user: seller,
      baseAmountIn: sellAmount,
      slippage: 0.01,
    }),
  );
  row("Seller", `${seller.toBase58()} (${route.venue} vault)`);
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
    "Token still on its bonding curve",
    curve.mint,
    wallet.publicKey,
  );

  const graduated = await findGraduatedMint(connection);
  await reportToken(
    online,
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
