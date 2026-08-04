/**
 * Example 36: Live Quotes Beside Offline Math
 *
 * Category: Live Data
 *
 * Runs quoteBuy and quoteSell against a live curve and puts the buy quote
 * next to the same trade computed offline with getBuyTokenAmountFromSolAmount.
 * Both print, and the drift between them is measured in basis points: the
 * SDK's online path is the offline formula plus a state fetch, nothing more.
 *
 * Run: npm run example 36
 */
import {
  OnlinePumpSdk,
  bondingCurvePda,
  getBuyTokenAmountFromSolAmount,
  type BondingCurve,
  type FeeConfig,
  type Global,
} from "@nirholas/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { findActiveCurveMint } from "./_lib/discovery";
import { formatSol, formatTokens, heading, row } from "./_lib/format";

/** Result of holding the online quote against the offline formula. */
export interface QuoteComparison {
  /** Tokens the online quoteBuy returned. */
  online: BN;
  /** Tokens the offline curve math returned for the same state. */
  offline: BN;
  /** Absolute difference in basis points of the online figure. */
  driftBps: BN;
  /** True when the drift is inside the tolerance. */
  agree: boolean;
}

/**
 * Compare an online quote against the offline computation of the same trade.
 *
 * On identical curve state the two are bit-for-bit equal, because quoteBuy
 * calls the same integer math this compares it to. Any drift on a live run
 * is the curve moving between the two reads, so the tolerance is expressed
 * in basis points rather than demanding exact equality.
 */
export function compareBuyQuotes(
  online: BN,
  offline: BN,
  toleranceBps: BN = new BN(50),
): QuoteComparison {
  if (online.isZero()) {
    throw new Error("Online quote returned zero tokens; nothing to compare");
  }
  const driftBps = online.sub(offline).abs().muln(10_000).div(online);
  return { online, offline, driftBps, agree: driftBps.lte(toleranceBps) };
}

/** The offline half of the comparison: pure curve math, no RPC. */
export function offlineBuyQuote({
  global,
  feeConfig,
  bondingCurve,
  solAmount,
}: {
  global: Global;
  feeConfig: FeeConfig | null;
  bondingCurve: BondingCurve;
  solAmount: BN;
}): BN {
  return getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solAmount,
  });
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

/**
 * A real holder of the token, needed because quoteSell reads the seller's
 * associated token account and refuses to quote a position that does not
 * exist. The curve's own vault is skipped: it holds the unsold supply and
 * is not a trader.
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

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);

  heading("Live token");
  const { mint } = await findActiveCurveMint(connection);
  row("Mint", mint.toBase58());

  const solAmount = new BN(100_000_000); // 0.1 SOL
  const quoteUser = PublicKey.default;

  heading("Online: quoteBuy");
  const buy = await rpc("quoteBuy", () =>
    online.quoteBuy({ mint, user: quoteUser, solAmount }),
  );
  row("Spend", formatSol(solAmount));
  row("Tokens out", formatTokens(buy.tokensOut));
  row("Fees", formatSol(buy.feesLamports, 6));
  row("Price impact", `${buy.priceImpactBps} bps`);

  heading("Offline: getBuyTokenAmountFromSolAmount");
  const [global, feeConfig, bondingCurve] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    online.fetchBondingCurve(mint),
  ]);
  const offline = offlineBuyQuote({ global, feeConfig, bondingCurve, solAmount });
  row("Tokens out", formatTokens(offline));
  row("Virtual SOL reserves", formatSol(bondingCurve.virtualSolReserves));

  heading("Agreement");
  const comparison = compareBuyQuotes(buy.tokensOut, offline);
  row("Online", comparison.online.toString());
  row("Offline", comparison.offline.toString());
  row("Drift", `${comparison.driftBps.toString()} bps`);
  row("Within tolerance", comparison.agree);
  console.log(
    "Zero drift means both reads saw the same curve. Nonzero drift is other",
  );
  console.log(
    "traders moving the reserves between the two fetches, not a difference",
  );
  console.log(
    "in the math: quoteBuy runs this exact formula on the state it fetched.",
  );

  heading("Online: quoteSell");
  const holder = await findHolder(connection, mint);
  if (!holder) {
    console.log(
      "No holder token account is readable for this mint right now, so there",
    );
    console.log(
      "is no position to quote a sell against. quoteSell reads the seller's",
    );
    console.log("associated token account and needs it to exist.");
    return;
  }
  const sellAmount = BN.min(holder.amount, buy.tokensOut);
  const sell = await rpc("quoteSell", () =>
    online.quoteSell({ mint, user: holder.owner, amount: sellAmount }),
  );
  row("Seller", holder.owner.toBase58());
  row("Tokens in", formatTokens(sellAmount));
  row("SOL out", formatSol(sell.solOut));
  row("Fees", formatSol(sell.feesLamports, 6));
  row("Price impact", `${sell.priceImpactBps} bps`);
  row("Max safe single sell", formatTokens(sell.maxSafeAmount, 0));
  row("Would overflow", sell.willOverflow);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
