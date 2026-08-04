/**
 * Example 32: Bonding Curve Summary
 *
 * Category: Live Data
 *
 * Pulls one live coin's full bonding curve summary (market cap, graduation
 * progress, prices, fee tier) with a single SDK call, then derives what a
 * trader actually asks: how far to graduation in SOL, what a round trip
 * costs, and how much of that cost is fees.
 *
 * Run: npm run example 32
 */
import { OnlinePumpSdk, type BondingCurveSummary } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { findActiveCurveMint } from "./_lib/discovery";
import { divToDecimalString, formatSol, formatTokens, heading, row } from "./_lib/format";
import { withRpcRetry } from "./25-decode-pool";

/** A summary read the way a trader reads it. Every amount stays a BN. */
export interface CurveReading {
  status: "trading" | "graduated";
  /** Graduation progress as a percentage string, from the bps field. */
  progressPercent: string;
  marketCap: BN;
  /** SOL already raised into the curve. */
  solRaised: BN;
  /** SOL still needed to buy out the curve and trigger migration. */
  solToGraduate: BN;
  /** Tokens left for sale on the curve. */
  tokensRemaining: BN;
  /** Buy price minus sell price for one whole token, in lamports. */
  roundTripCost: BN;
  /** That cost as basis points of the buy price. */
  roundTripBps: BN;
  /** Protocol plus creator fee for the curve's current tier. */
  totalFeeBps: BN;
  /** Round-trip cost beyond the fees, i.e. the curve's own spread. */
  curveSpreadBps: BN;
}

/**
 * Derive a trader's reading from a bonding curve summary. Pure: no RPC, no
 * floats in the arithmetic.
 *
 * The round trip is the honest cost of a position: buy one token and sell it
 * back in the same slot and you lose the buy/sell spread. Fees explain most
 * of it, and the remainder is the curve moving under the trade itself. A
 * graduated curve has zeroed reserves and prices, so it reports zeros rather
 * than dividing by them.
 */
export function summarizeCurve(summary: BondingCurveSummary): CurveReading {
  const roundTripCost = summary.buyPricePerToken.sub(summary.sellPricePerToken);
  const roundTripBps = summary.buyPricePerToken.isZero()
    ? new BN(0)
    : roundTripCost.muln(10_000).div(summary.buyPricePerToken);
  const totalFeeBps = summary.protocolFeeBps.add(summary.creatorFeeBps);
  // A round trip pays the fee twice, once on each leg.
  const feeLegsBps = totalFeeBps.muln(2);

  return {
    status: summary.isGraduated ? "graduated" : "trading",
    progressPercent: divToDecimalString(
      new BN(summary.progressBps),
      new BN(100),
      2,
    ),
    marketCap: summary.marketCap,
    solRaised: summary.realSolReserves,
    solToGraduate: summary.solNeededToGraduate,
    tokensRemaining: summary.realTokenReserves,
    roundTripCost,
    roundTripBps,
    totalFeeBps,
    curveSpreadBps: BN.max(new BN(0), roundTripBps.sub(feeLegsBps)),
  };
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);

  heading("Finding a coin trading on its curve");
  const { mint } = await findActiveCurveMint(connection);
  row("Mint", mint.toBase58());

  const summary = await withRpcRetry("fetchBondingCurveSummary", () =>
    online.fetchBondingCurveSummary(mint),
  );

  heading("fetchBondingCurveSummary");
  row("Market cap", formatSol(summary.marketCap, 2));
  row("Progress", `${summary.progressBps} bps`);
  row("Graduated", summary.isGraduated);
  row("Buy price / token", `${summary.buyPricePerToken.toString()} lamports`);
  row("Sell price / token", `${summary.sellPricePerToken.toString()} lamports`);
  row("Real SOL reserves", formatSol(summary.realSolReserves, 4));
  row("Real token reserves", formatTokens(summary.realTokenReserves, 0));
  row("Virtual SOL reserves", formatSol(summary.virtualSolReserves, 4));
  row("Virtual token reserves", formatTokens(summary.virtualTokenReserves, 0));
  row("Protocol fee", `${summary.protocolFeeBps.toString()} bps`);
  row("Creator fee", `${summary.creatorFeeBps.toString()} bps`);
  row("Mayhem mode", summary.isMayhemMode);

  heading("Reading");
  const reading = summarizeCurve(summary);
  row("Status", reading.status);
  row("Progress", `${reading.progressPercent}%`);
  row("SOL raised", formatSol(reading.solRaised, 4));
  row("SOL to graduation", formatSol(reading.solToGraduate, 4));
  row("Tokens left on curve", formatTokens(reading.tokensRemaining, 0));
  row("Round trip cost", `${reading.roundTripCost.toString()} lamports/token`);
  row("Round trip", `${reading.roundTripBps.toString()} bps`);
  row("Fees (one leg)", `${reading.totalFeeBps.toString()} bps`);
  row("Curve spread", `${reading.curveSpreadBps.toString()} bps`);

  heading("What the numbers mean");
  console.log(
    "Progress counts tokens sold off the curve, not SOL raised: the last",
  );
  console.log(
    "tokens cost far more than the first, so a coin at 50% progress is well",
  );
  console.log(
    "past half of its graduation SOL. `SOL to graduation` is the honest",
  );
  console.log(
    "number, quoted through the same fee tier the curve is trading in now.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
