/**
 * Example 42: AMM Sell
 *
 * Category: AMM & Advanced
 *
 * Quotes a sell on a graduated token's PumpAMM pool with ammQuoteSell, then
 * builds the swap instructions with ammSellInstructions without sending
 * anything. Sizes the position from a buy quote first, so the round-trip
 * cost of entering and leaving the pool is visible in one run.
 *
 * Run: npm run example 42
 */
import { OnlinePumpSdk, type AmmBuyQuote, type AmmSellQuote } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { findGraduatedMint } from "./_lib/discovery";
import { loadWallet } from "./_lib/wallet";

/** 1 whole Pump token = 1e6 raw units (6 decimals). */
const TOKEN_UNITS = new BN(1_000_000);

/** Human-readable breakdown of an AMM sell quote. All math stays in BN. */
export interface AmmSellQuoteBreakdown {
  /** Lamports received per whole token at this fill (output / input). */
  effectivePriceLamports: BN;
  /** Pool spot price in lamports per whole token (quoteReserve / baseReserve). */
  spotPriceLamports: BN;
  /** Total fees as basis points of the gross SOL the pool paid out. */
  feeBpsOfGross: BN;
  /** How far the effective price sits below spot, in basis points. */
  discountToSpotBps: BN;
}

/**
 * Interpret an AMM sell quote.
 *
 * The mirror of the buy case: the quote gives SOL out and fees, and what a
 * seller wants is the price they actually realized and how much of the gap
 * to spot is fees versus price impact. Integer math only.
 */
export function interpretAmmSellQuote(quote: AmmSellQuote): AmmSellQuoteBreakdown {
  if (quote.tokensSold.isZero()) {
    throw new Error("Quote sold zero tokens; nothing to price");
  }
  if (quote.poolBaseAmount.isZero() || quote.poolQuoteAmount.isZero()) {
    throw new Error(
      "Pool reserves are empty; this pool has no liquidity to price against",
    );
  }
  const effectivePriceLamports = quote.solOut
    .mul(TOKEN_UNITS)
    .div(quote.tokensSold);
  const spotPriceLamports = quote.poolQuoteAmount
    .mul(TOKEN_UNITS)
    .div(quote.poolBaseAmount);
  const gross = quote.solOut.add(quote.feesLamports);
  const feeBpsOfGross = gross.isZero()
    ? new BN(0)
    : quote.feesLamports.muln(10_000).div(gross);
  // spot/effective compared by cross-multiplication, so micro-cap pools whose
  // per-token prices round to zero still produce an honest ratio.
  const crossSpot = quote.poolQuoteAmount.mul(quote.tokensSold);
  const crossEffective = quote.solOut.mul(quote.poolBaseAmount);
  const discountToSpotBps = crossSpot
    .sub(crossEffective)
    .muln(10_000)
    .div(crossSpot);
  return {
    effectivePriceLamports,
    spotPriceLamports,
    feeBpsOfGross,
    discountToSpotBps,
  };
}

/**
 * Cost of buying into a pool and immediately selling back out, in basis
 * points of the SOL put in. Two fee legs plus two doses of price impact,
 * which is why this number is always well above a single swap's fee.
 */
export function roundTripLossBps(buy: AmmBuyQuote, sell: AmmSellQuote): BN {
  if (buy.solSpent.isZero()) {
    throw new Error("Buy quote spent zero SOL; no round trip to measure");
  }
  return buy.solSpent.sub(sell.solOut).muln(10_000).div(buy.solSpent);
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const wallet = loadWallet();
  const sdk = new OnlinePumpSdk(connection);

  heading("Finding a graduated token");
  const { mint } = await findGraduatedMint(connection);
  row("Mint", mint.toBase58());
  row("Seller", wallet.publicKey.toBase58());

  const solAmount = new BN(100_000_000); // 0.1 SOL

  heading("Sizing the position from a buy quote");
  const buyQuote = await sdk.ammQuoteBuy({
    mint,
    user: wallet.publicKey,
    quoteAmountIn: solAmount,
  });
  row("SOL in", formatSol(buyQuote.solSpent));
  row("Tokens acquired", formatTokens(buyQuote.tokensOut));

  heading("Quote: ammQuoteSell");
  const quote = await sdk.ammQuoteSell({
    mint,
    user: wallet.publicKey,
    baseAmountIn: buyQuote.tokensOut,
  });
  row("Tokens in", formatTokens(quote.tokensSold));
  row("SOL out", formatSol(quote.solOut));
  row("Fees", formatSol(quote.feesLamports, 6));
  row("Pool base reserve", formatTokens(quote.poolBaseAmount));
  row("Pool quote reserve", formatSol(quote.poolQuoteAmount));

  heading("Quote interpretation");
  const breakdown = interpretAmmSellQuote(quote);
  row("Spot price", `${breakdown.spotPriceLamports.toString()} lamports/token`);
  row(
    "Effective price",
    `${breakdown.effectivePriceLamports.toString()} lamports/token`,
  );
  row("Fee load", `${breakdown.feeBpsOfGross.toString()} bps of gross out`);
  row(
    "Discount to spot",
    `${breakdown.discountToSpotBps.toString()} bps (fees + price impact)`,
  );
  row(
    "Round trip cost",
    `${roundTripLossBps(buyQuote, quote).toString()} bps of SOL in`,
  );

  heading("Instructions: ammSellInstructions (not sent)");
  const ixs = await sdk.ammSellInstructions({
    mint,
    user: wallet.publicKey,
    tokenAmount: buyQuote.tokensOut,
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
    "and send. The wSOL unwrapping and ATA creation are already included.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
