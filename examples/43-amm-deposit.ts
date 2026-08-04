/**
 * Example 43: AMM Deposit
 *
 * Category: AMM & Advanced
 *
 * Quotes a two-sided liquidity deposit into a graduated token's PumpAMM pool
 * from either side (quoteAmmDepositBaseIn / quoteAmmDepositQuoteIn), shows the
 * autocomplete helpers a deposit form uses to fill the other field, and builds
 * the deposit instructions without sending them.
 *
 * Run: npm run example 43
 */
import { OnlinePumpSdk } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { findGraduatedMint } from "./_lib/discovery";
import { loadWallet } from "./_lib/wallet";

/** 1 whole Pump token = 1e6 raw units (6 decimals). */
const TOKEN_UNITS = new BN(1_000_000);

/** The economics of one deposit, in integer units only. */
export interface DepositRatio {
  /** Lamports of SOL required per whole token of base deposited. */
  quotePerTokenLamports: BN;
  /** LP tokens minted per whole token of base deposited. */
  lpPerTokenBase: BN;
  /** The depositor's share of the pool once minted, in basis points. */
  shareOfPoolBps: BN;
}

/**
 * Work out what a deposit buys.
 *
 * A PumpAMM deposit is strictly proportional: you add base and quote in the
 * pool's current ratio and receive LP tokens for the fraction of the pool you
 * added. That fraction, not the absolute amounts, is what a depositor cares
 * about, and it follows from the LP supply before and after.
 */
export function depositRatio({
  base,
  quote,
  lpToken,
  lpSupply,
}: {
  base: BN;
  quote: BN;
  lpToken: BN;
  lpSupply: BN;
}): DepositRatio {
  if (base.isZero()) {
    throw new Error("Deposit has no base side; ratio is undefined");
  }
  const newSupply = lpSupply.add(lpToken);
  return {
    quotePerTokenLamports: quote.mul(TOKEN_UNITS).div(base),
    lpPerTokenBase: lpToken.mul(TOKEN_UNITS).div(base),
    shareOfPoolBps: newSupply.isZero()
      ? new BN(0)
      : lpToken.muln(10_000).div(newSupply),
  };
}

/**
 * How much room a slippage-adjusted maximum leaves above the quoted amount,
 * in basis points. This is the extra the wallet must hold, and the amount the
 * pool may take if the ratio moves before the transaction lands.
 */
export function slippageHeadroomBps(amount: BN, maxAmount: BN): BN {
  if (amount.isZero()) return new BN(0);
  return BN.max(new BN(0), maxAmount.sub(amount)).muln(10_000).div(amount);
}


export async function main(): Promise<void> {
  const connection = getConnection();
  const wallet = loadWallet();
  const sdk = new OnlinePumpSdk(connection);

  heading("Finding a graduated token");
  const { mint } = await findGraduatedMint(connection);
  const pool = await sdk.fetchPool(mint);
  row("Mint", mint.toBase58());
  row("Depositor", wallet.publicKey.toBase58());
  row("LP mint", pool.lpMint.toBase58());
  row("LP supply", pool.lpSupply.toString());

  const solAmount = new BN(100_000_000); // 0.1 SOL
  const slippage = 0.01; // 1%

  heading("Quote from the SOL side: quoteAmmDepositQuoteIn");
  const fromQuote = await sdk.quoteAmmDepositQuoteIn({
    mint,
    user: wallet.publicKey,
    quote: solAmount,
    slippage,
  });
  row("SOL in", formatSol(solAmount));
  row("Base required", formatTokens(fromQuote.base));
  row("LP tokens out", fromQuote.lpToken.toString());
  row("Max base (slippage)", formatTokens(fromQuote.maxBase));
  row("Max quote (slippage)", formatSol(fromQuote.maxQuote));
  row(
    "Base headroom",
    `${slippageHeadroomBps(fromQuote.base, fromQuote.maxBase).toString()} bps`,
  );

  heading("Quote from the token side: quoteAmmDepositBaseIn");
  const fromBase = await sdk.quoteAmmDepositBaseIn({
    mint,
    user: wallet.publicKey,
    base: fromQuote.base,
    slippage,
  });
  row("Base in", formatTokens(fromQuote.base));
  row("SOL required", formatSol(fromBase.quote));
  row("LP tokens out", fromBase.lpToken.toString());
  console.log(
    "\nBoth directions describe the same deposit, so feeding the base side of",
  );
  console.log(
    "one into the other returns to where it started, give or take integer",
  );
  console.log("rounding on the last unit.");

  heading("Form autocomplete (no slippage maxes)");
  const autoFromBase = await sdk.ammDepositAutocompleteFromBase({
    mint,
    user: wallet.publicKey,
    base: fromQuote.base,
    slippage,
  });
  row("base -> quote", formatSol(autoFromBase.quote));
  row("base -> lpToken", autoFromBase.lpToken.toString());
  const autoFromQuote = await sdk.ammDepositAutocompleteFromQuote({
    mint,
    user: wallet.publicKey,
    quote: solAmount,
    slippage,
  });
  row("quote -> base", formatTokens(autoFromQuote.base));
  row("quote -> lpToken", autoFromQuote.lpToken.toString());
  console.log(
    "\nThese are the calls a deposit form makes on every keystroke: fill the",
  );
  console.log(
    "other field and the LP preview, and leave the slippage maxes to the",
  );
  console.log("quote helpers above when the user submits.");

  heading("Deposit economics");
  const ratio = depositRatio({
    base: fromQuote.base,
    quote: solAmount,
    lpToken: fromQuote.lpToken,
    lpSupply: pool.lpSupply,
  });
  row(
    "Price paid",
    `${ratio.quotePerTokenLamports.toString()} lamports/token`,
  );
  row("LP per token", ratio.lpPerTokenBase.toString());
  row("Share of pool", `${ratio.shareOfPoolBps.toString()} bps`);

  heading("Instructions: ammDepositInstructions (not sent)");
  const ixs = await sdk.ammDepositInstructions({
    mint,
    user: wallet.publicKey,
    lpTokenOut: fromQuote.lpToken,
    slippage,
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
    "The list already creates the LP token account and wraps SOL as needed.",
  );
  console.log(
    "Sign and send it to hold LP tokens, then read example 44 to unwind.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
