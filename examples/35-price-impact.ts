/**
 * Example 35: Price Impact, Classified
 *
 * Category: Live Data
 *
 * Measures what a buy and the mirror-image sell do to a live curve's price
 * with fetchBuyPriceImpact and fetchSellPriceImpact, then turns the raw
 * basis points into a verdict a trading UI can act on: negligible, moderate,
 * or severe.
 *
 * Run: npm run example 35
 */
import { OnlinePumpSdk, type PriceImpactResult } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { findActiveCurveMint } from "./_lib/discovery";
import {
  divToDecimalString,
  formatSol,
  formatTokens,
  heading,
  row,
} from "./_lib/format";

/** How bad a fill is, in the three buckets a trader actually reacts to. */
export type ImpactLevel = "negligible" | "moderate" | "severe";

export interface ImpactVerdict {
  level: ImpactLevel;
  /** Impact in basis points, as classified. */
  bps: BN;
  /** One line a UI can show next to the quote. */
  advice: string;
}

/** Upper bound (exclusive) of each bucket, in basis points. */
export const NEGLIGIBLE_MAX_BPS = new BN(50);
export const MODERATE_MAX_BPS = new BN(300);

/**
 * Classify a price impact.
 *
 * The thresholds are the ones that matter on a bonding curve: under 50 bps
 * (0.5%) the fill is inside normal fee noise, under 300 bps (3%) it is a
 * real cost worth showing, and beyond that the trade is moving the market
 * against itself and should be split or resized.
 *
 * Negative impacts (a sell pushing the price down) are classified on their
 * magnitude, since the size of the move is what matters, not its sign.
 */
export function classifyImpact(bps: BN): ImpactVerdict {
  const magnitude = bps.abs();
  if (magnitude.lt(NEGLIGIBLE_MAX_BPS)) {
    return {
      level: "negligible",
      bps,
      advice: "Fill is inside fee noise; trade the full size.",
    };
  }
  if (magnitude.lt(MODERATE_MAX_BPS)) {
    return {
      level: "moderate",
      bps,
      advice: "Visible cost; widen slippage or accept the worse fill.",
    };
  }
  return {
    level: "severe",
    bps,
    advice: "The trade is moving the market; split it or cut the size.",
  };
}

/** Percentage rendering of a basis-point value, integers only. */
export function bpsToPercent(bps: BN): string {
  return `${divToDecimalString(bps, new BN(100), 2)}%`;
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
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return await run();
  }
}

function reportImpact(title: string, impact: PriceImpactResult): void {
  const verdict = classifyImpact(new BN(impact.impactBps));
  row("Price before", `${impact.priceBefore.toString()} lamports/token`);
  row("Price after", `${impact.priceAfter.toString()} lamports/token`);
  row("Impact", `${impact.impactBps} bps (${bpsToPercent(verdict.bps)})`);
  row(`${title} verdict`, verdict.level.toUpperCase());
  console.log(verdict.advice);
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);

  heading("Live token");
  const { mint } = await findActiveCurveMint(connection);
  row("Mint", mint.toBase58());

  const solAmount = new BN(100_000_000); // 0.1 SOL

  heading(`Buy impact for ${formatSol(solAmount)}`);
  const buy = await rpc("fetchBuyPriceImpact", () =>
    online.fetchBuyPriceImpact(mint, solAmount),
  );
  row("Tokens out", formatTokens(buy.outputAmount));
  reportImpact("Buy", buy);

  heading("Sell impact for the same position");
  const sell = await rpc("fetchSellPriceImpact", () =>
    online.fetchSellPriceImpact(mint, buy.outputAmount),
  );
  row("Tokens in", formatTokens(buy.outputAmount));
  row("SOL out", formatSol(sell.outputAmount));
  reportImpact("Sell", sell);

  heading("The buckets");
  row("negligible", `impact < ${NEGLIGIBLE_MAX_BPS.toString()} bps`);
  row("moderate", `${NEGLIGIBLE_MAX_BPS.toString()} to ${MODERATE_MAX_BPS.subn(1).toString()} bps`);
  row("severe", `>= ${MODERATE_MAX_BPS.toString()} bps`);
  console.log(
    "Impact is not a fee: it is the price the curve moves to while filling",
  );
  console.log(
    "the order. Fees are charged on top of it, which is why buying and then",
  );
  console.log("selling the same size never returns the SOL you started with.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
