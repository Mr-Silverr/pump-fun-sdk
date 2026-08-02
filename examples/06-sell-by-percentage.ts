/**
 * Example 06: Sell by Percentage
 *
 * Category: Token Lifecycle
 *
 * "Sell half" is how humans think about exits. This example exposes the
 * exact basis-point math OnlinePumpSdk.sellByPercentage uses to turn a
 * percentage of your balance into a token amount, then exercises the
 * one-call online flow. All amounts stay BN: no floating point ever
 * touches a balance.
 *
 * Run: npm run example 06
 */
import { OnlinePumpSdk } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { findActiveCurveMint } from "./_lib/discovery";
import { formatTokens, heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";

/**
 * Convert a percentage of a token balance into a token amount, exactly as
 * `OnlinePumpSdk.sellByPercentage` does internally.
 *
 * The percentage is scaled to basis points first (33.33% becomes 3333 bps)
 * so fractional percentages survive without floating-point math on the
 * balance itself: the only float operation is `Math.round(percent * 100)`,
 * after which everything is integer BN arithmetic, rounding down.
 *
 * Throws on percent <= 0 or > 100, mirroring the online method. A dust
 * balance can legitimately round to zero; callers treat that as
 * "nothing to sell".
 */
export function percentageToTokenAmount(balance: BN, percent: number): BN {
  if (percent <= 0 || percent > 100) {
    throw new Error(
      `percent must be between 0 (exclusive) and 100, got ${percent}`,
    );
  }
  const bps = Math.round(percent * 100);
  return balance.muln(bps).divn(10_000);
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);
  const wallet = loadWallet();
  // Discover a token actively trading on its curve (MINT env overrides).
  const { mint } = await findActiveCurveMint(connection);

  heading("Setup");
  row("Mint", mint.toBase58());
  row("Wallet", wallet.publicKey.toBase58());

  heading("The basis-point math (offline)");
  const demoBalance = new BN("1234567890"); // 1,234.567890 tokens
  row("Demo balance", formatTokens(demoBalance));
  for (const percent of [100, 50, 25, 33.33, 0.01]) {
    row(`Sell ${percent}%`, formatTokens(percentageToTokenAmount(demoBalance, percent)));
  }
  console.log("Note 33.33% became 3333 bps exactly; the balance was never");
  console.log("multiplied by a float. Division rounds down, so the pieces of a");
  console.log("split exit can sum to slightly less than the whole. The final");
  console.log("chunk should be sold as 100% of what remains, not a percentage.");

  heading("sellByPercentage (the one-call online flow)");
  const balance = await online.getTokenBalance(mint, wallet.publicKey);
  row("Live balance", formatTokens(balance));
  try {
    const ixs = await online.sellByPercentage({
      mint,
      user: wallet.publicKey,
      percent: 50,
      slippage: 1,
    });
    if (ixs.length === 0) {
      console.log("Returned 0 instructions: this wallet holds no tokens of this");
      console.log("mint (or 50% of its dust balance rounds to zero). That empty");
      console.log("array is the designed no-op path, not an error.");
    } else {
      row("Instruction count", ixs.length);
      ixs.forEach((ix, i) => {
        row(`${i + 1}.`, `${ix.programId.toBase58()} (${ix.keys.length} accounts)`);
      });
    }
  } catch (err) {
    console.log("sellByPercentage threw (needs a live, un-graduated curve):");
    console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    console.log("The math above is unaffected; only the state fetch is online.");
  }

  heading("Next step (not performed here)");
  console.log("Compose, sign, send. This example never broadcasts a transaction.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
