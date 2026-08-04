/**
 * Example 33: Graduation Progress
 *
 * Category: Live Data
 *
 * Reads how far a live bonding curve sits from graduating to PumpAMM with
 * fetchGraduationProgress, then double checks the verdict against the
 * on-chain pool with isGraduated. The bar itself is integer BN math, so it
 * renders the same number the program will act on.
 *
 * Run: npm run example 33
 */
import { OnlinePumpSdk } from "@nirholas/pump-sdk";
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

/** A progress bar plus the basis-point value it was rendered from. */
export interface ProgressBar {
  /** Completion in basis points, 0 to 10,000. */
  bps: BN;
  /** Number of filled cells in the bar. */
  filled: number;
  /** Fixed-width bar, e.g. "########............". */
  bar: string;
}

/**
 * Render completion of `real` against `target` as a bar.
 *
 * Both inputs are on-chain base-unit amounts, so the percentage is computed
 * as `real * 10000 / target` in BN and only the cell count crosses into a
 * plain number. Values outside [0, target] are clamped: a curve can report
 * marginally more sold than the launch reserves after a rounding step, and
 * a 101% bar helps nobody.
 */
export function progressBar(real: BN, target: BN, width = 40): ProgressBar {
  if (target.lten(0)) {
    throw new Error("progressBar target must be positive");
  }
  if (width <= 0) {
    throw new Error("progressBar width must be positive");
  }
  const clamped = BN.min(BN.max(real, new BN(0)), target);
  const bps = clamped.muln(10_000).div(target);
  const filled = bps.muln(width).divn(10_000).toNumber();
  return {
    bps,
    filled,
    bar: "#".repeat(filled) + ".".repeat(width - filled),
  };
}

/** Basis points as a human percentage string, still without floats. */
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

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);

  heading("Live token");
  const { mint } = await findActiveCurveMint(connection);
  row("Mint", mint.toBase58());

  const progress = await rpc("fetchGraduationProgress", () =>
    online.fetchGraduationProgress(mint),
  );
  const graduated = await rpc("isGraduated", () => online.isGraduated(mint));

  heading("fetchGraduationProgress");
  row("Progress", bpsToPercent(new BN(progress.progressBps)));
  row("Tokens sold", formatTokens(progress.tokensTotal.sub(progress.tokensRemaining), 0));
  row("Tokens remaining", formatTokens(progress.tokensRemaining, 0));
  row("SOL in real reserves", formatSol(progress.solAccumulated));
  row("SOL to finish the curve", formatSol(progress.solNeededToGraduate));

  heading("Progress bar");
  const sold = progress.tokensTotal.sub(progress.tokensRemaining);
  const bar = progressBar(sold, progress.tokensTotal);
  console.log(`[${bar.bar}] ${bpsToPercent(bar.bps)}`);
  console.log(
    "The bar is the same ratio the program tracks: real tokens sold over the",
  );
  console.log("793.1M the curve launched with. At 100% the curve completes.");

  heading("Two ways to ask 'has it graduated?'");
  row("bondingCurve.complete", progress.isGraduated);
  row("isGraduated (pool exists)", graduated);
  console.log(
    "fetchGraduationProgress reads the curve flag; isGraduated checks whether",
  );
  console.log(
    "the canonical PumpAMM pool account exists. They disagree for the few",
  );
  console.log(
    "seconds between a curve completing and its pool receiving liquidity.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
