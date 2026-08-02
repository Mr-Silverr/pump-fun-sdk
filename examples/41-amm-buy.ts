/**
 * Example 41: AMM Buy
 *
 * Category: AMM & Advanced
 *
 * Quotes a buy on a graduated token's PumpAMM pool with ammQuoteBuy, then
 * builds the swap instructions with ammBuyInstructions without sending
 * anything. Shows how to read a quote: effective price, fee load, and how
 * far the fill sits from the pool's spot price.
 *
 * Run: npm run example 41
 */
import { OnlinePumpSdk, type AmmBuyQuote } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { resolveGraduatedMint } from "./_lib/graduated";
import { loadWallet } from "./_lib/wallet";

/** 1 whole Pump token = 1e6 raw units (6 decimals). */
const TOKEN_UNITS = new BN(1_000_000);

/** Human-readable breakdown of an AMM buy quote. All math stays in BN. */
export interface AmmBuyQuoteBreakdown {
  /** Lamports paid per whole token at this fill (input / output). */
  effectivePriceLamports: BN;
  /** Pool spot price in lamports per whole token (quoteReserve / baseReserve). */
  spotPriceLamports: BN;
  /** Total fees as basis points of the SOL spent. */
  feeBpsOfInput: BN;
  /** How far the effective price sits above spot, in basis points. */
  premiumOverSpotBps: BN;
}

/**
 * Interpret an AMM buy quote.
 *
 * The quote alone tells you tokens out and fees; what a trader actually
 * wants to know is the effective price and how much of it is fees versus
 * price impact. Both fall out of the quote with integer math only.
 */
export function interpretAmmBuyQuote(quote: AmmBuyQuote): AmmBuyQuoteBreakdown {
  if (quote.tokensOut.isZero()) {
    throw new Error("Quote returned zero tokens out; input too small to fill");
  }
  const effectivePriceLamports = quote.solSpent
    .mul(TOKEN_UNITS)
    .div(quote.tokensOut);
  const spotPriceLamports = quote.poolQuoteAmount
    .mul(TOKEN_UNITS)
    .div(quote.poolBaseAmount);
  const feeBpsOfInput = quote.feesLamports.muln(10_000).div(quote.solSpent);
  const premiumOverSpotBps = effectivePriceLamports
    .sub(spotPriceLamports)
    .muln(10_000)
    .div(spotPriceLamports);
  return {
    effectivePriceLamports,
    spotPriceLamports,
    feeBpsOfInput,
    premiumOverSpotBps,
  };
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const wallet = loadWallet();
  const sdk = new OnlinePumpSdk(connection);

  heading("Finding a graduated token");
  const mint = await resolveGraduatedMint(connection);
  row("Mint", mint.toBase58());
  row("Buyer", wallet.publicKey.toBase58());

  const solAmount = new BN(100_000_000); // 0.1 SOL

  heading("Quote: ammQuoteBuy");
  const quote = await sdk.ammQuoteBuy({
    mint,
    user: wallet.publicKey,
    quoteAmountIn: solAmount,
  });
  row("SOL in", formatSol(quote.solSpent));
  row("Tokens out", formatTokens(quote.tokensOut));
  row("Fees", formatSol(quote.feesLamports, 6));
  row("Pool base reserve", formatTokens(quote.poolBaseAmount));
  row("Pool quote reserve", formatSol(quote.poolQuoteAmount));

  heading("Quote interpretation");
  const breakdown = interpretAmmBuyQuote(quote);
  row("Spot price", `${breakdown.spotPriceLamports.toString()} lamports/token`);
  row(
    "Effective price",
    `${breakdown.effectivePriceLamports.toString()} lamports/token`,
  );
  row("Fee load", `${breakdown.feeBpsOfInput.toString()} bps of input`);
  row(
    "Premium over spot",
    `${breakdown.premiumOverSpotBps.toString()} bps (fees + price impact)`,
  );

  heading("Instructions: ammBuyInstructions (not sent)");
  const ixs = await sdk.ammBuyInstructions({
    mint,
    user: wallet.publicKey,
    solAmount,
    slippageBps: 100, // 1%
  });
  row("Instruction count", ixs.length);
  for (const [i, ix] of ixs.entries()) {
    row(
      `  ix[${i}]`,
      `${ix.programId.toBase58()} keys=${ix.keys.length} data=${ix.data.length}B`,
    );
  }

  heading("Next step (not performed here)");
  console.log(
    "Compose these instructions into a transaction, sign with the wallet,",
  );
  console.log(
    "and send. The wSOL wrapping and ATA creation are already included.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
