/**
 * Example 44: AMM Withdraw
 *
 * Category: AMM & Advanced
 *
 * Reads an LP position with getLpTokenBalance, quotes burning it back into
 * base and SOL with quoteAmmWithdraw and ammWithdrawAutocomplete, and builds
 * the withdraw instructions without sending them. Checks the quote against the
 * pro-rata share the reserves say the LP tokens are worth.
 *
 * Run: npm run example 44
 */
import { OnlinePumpSdk } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { findGraduatedMint } from "./_lib/discovery";
import { loadWallet } from "./_lib/wallet";

/** What a burn of `lpToken` is worth against the pool's current reserves. */
export interface WithdrawShare {
  /** Base tokens the position is entitled to. */
  base: BN;
  /** Lamports of SOL the position is entitled to. */
  quote: BN;
  /** The position's share of the pool, in basis points. */
  shareOfPoolBps: BN;
}

/**
 * Value an LP position pro rata.
 *
 * A PumpAMM withdraw pays out reserves in proportion to the LP tokens burned
 * against total LP supply, so the entitlement is exact integer arithmetic and
 * needs no pool simulation. Comparing this against quoteAmmWithdraw is a cheap
 * sanity check on any withdraw path.
 */
export function withdrawShare({
  lpToken,
  lpSupply,
  poolBase,
  poolQuote,
}: {
  lpToken: BN;
  lpSupply: BN;
  poolBase: BN;
  poolQuote: BN;
}): WithdrawShare {
  if (lpSupply.isZero()) {
    throw new Error("Pool has no LP supply; nothing to withdraw against");
  }
  if (lpToken.gt(lpSupply)) {
    throw new Error("Cannot burn more LP tokens than the pool has issued");
  }
  return {
    base: poolBase.mul(lpToken).div(lpSupply),
    quote: poolQuote.mul(lpToken).div(lpSupply),
    shareOfPoolBps: lpToken.muln(10_000).div(lpSupply),
  };
}

/**
 * How far below the quoted amount a slippage-adjusted minimum sits, in basis
 * points. This is the worst fill the transaction will accept before it aborts.
 */
export function slippageFloorBps(amount: BN, minAmount: BN): BN {
  if (amount.isZero()) return new BN(0);
  return BN.max(new BN(0), amount.sub(minAmount)).muln(10_000).div(amount);
}


export async function main(): Promise<void> {
  const connection = getConnection();
  const wallet = loadWallet();
  const sdk = new OnlinePumpSdk(connection);

  heading("Finding a graduated token");
  const { mint } = await findGraduatedMint(connection);
  const pool = await sdk.fetchPool(mint);
  row("Mint", mint.toBase58());
  row("Withdrawer", wallet.publicKey.toBase58());
  row("LP mint", pool.lpMint.toBase58());
  row("LP supply", pool.lpSupply.toString());

  heading("The wallet's LP position");
  const lpBalance = await sdk.getLpTokenBalance(mint, wallet.publicKey);
  row("LP balance", lpBalance.toString());
  // Every quote below needs a position to price. A wallet that holds LP
  // tokens prices its own; anything else prices one percent of the pool,
  // which is the same call with a different number.
  const lpToken = lpBalance.isZero()
    ? BN.max(new BN(1), pool.lpSupply.divn(100))
    : lpBalance;
  row(
    "Sizing the quote from",
    lpBalance.isZero() ? "1% of the pool" : "the wallet balance",
  );
  row("LP tokens to burn", lpToken.toString());

  const slippage = 0.01; // 1%

  heading("Quote: quoteAmmWithdraw");
  const quote = await sdk.quoteAmmWithdraw({
    mint,
    user: wallet.publicKey,
    lpToken,
    slippage,
  });
  row("Base out", formatTokens(quote.base));
  row("SOL out", formatSol(quote.quote));
  row("Min base (slippage)", formatTokens(quote.minBase));
  row("Min SOL (slippage)", formatSol(quote.minQuote));
  row("Base floor", `${slippageFloorBps(quote.base, quote.minBase).toString()} bps`);
  row("SOL floor", `${slippageFloorBps(quote.quote, quote.minQuote).toString()} bps`);

  heading("Form autocomplete: ammWithdrawAutocomplete");
  const auto = await sdk.ammWithdrawAutocomplete({
    mint,
    user: wallet.publicKey,
    lpToken,
    slippage,
  });
  row("lpToken -> base", formatTokens(auto.base));
  row("lpToken -> quote", formatSol(auto.quote));
  console.log(
    "\nThe autocomplete pair is what a withdraw slider displays; the quote",
  );
  console.log("above adds the minimums the transaction will enforce.");

  heading("Cross-check against the reserves");
  const reserves = await sdk.ammQuoteSell({
    mint,
    user: wallet.publicKey,
    baseAmountIn: new BN(1_000_000),
  });
  const share = withdrawShare({
    lpToken,
    lpSupply: pool.lpSupply,
    poolBase: reserves.poolBaseAmount,
    poolQuote: reserves.poolQuoteAmount,
  });
  row("Pool base reserve", formatTokens(reserves.poolBaseAmount));
  row("Pool quote reserve", formatSol(reserves.poolQuoteAmount));
  row("Pro-rata base", formatTokens(share.base));
  row("Pro-rata SOL", formatSol(share.quote));
  row("Share of pool", `${share.shareOfPoolBps.toString()} bps`);

  heading("Instructions: ammWithdrawInstructions (not sent)");
  const ixs = await sdk.ammWithdrawInstructions({
    mint,
    user: wallet.publicKey,
    lpTokenIn: lpToken,
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
    "Signing and sending burns the LP tokens and returns both sides of the",
  );
  console.log(
    "position. Withdrawing never trades, so it carries no price impact: the",
  );
  console.log("only cost is the fees already earned by staying in.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
