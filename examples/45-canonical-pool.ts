/**
 * Example 45: The Canonical Pool
 *
 * Category: AMM & Advanced
 *
 * Derives a graduated token's canonical PumpAMM pool address from its mint
 * alone, reads the pool with fetchPool, prices it from its reserves, and
 * compares that price against what a bonding curve holding the same reserves
 * would quote. The gap is the whole economic effect of graduation.
 *
 * Run: npm run example 45
 */
import {
  OnlinePumpSdk,
  PUMP_TOKEN_MINT,
  canonicalPumpPoolPda,
  pumpPoolAuthorityPda,
} from "@nirholas/pump-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { mainnetGlobal } from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { findGraduatedMint } from "./_lib/discovery";

/** 1 whole Pump token = 1e6 raw units (6 decimals). */
const TOKEN_UNITS = new BN(1_000_000);

/** Spot price of a constant-product pool, in lamports per whole token. */
export function spotPriceLamports(baseReserve: BN, quoteReserve: BN): BN {
  if (baseReserve.isZero()) {
    throw new Error("Base reserve is zero; the pool has no price");
  }
  return quoteReserve.mul(TOKEN_UNITS).div(baseReserve);
}

/** An AMM price set beside the bonding curve price for the same reserves. */
export interface VenuePriceComparison {
  /** AMM spot price in lamports per whole token. */
  ammSpotLamports: BN;
  /** Bonding curve spot price for the same reserves, lamports per whole token. */
  curveSpotLamports: BN;
  /** The price at which the two venues agree, lamports per whole token. */
  crossoverPriceLamports: BN;
  /** How far the AMM price sits above the curve price, in basis points. Negative below the crossover. */
  differenceBps: BN;
}

/**
 * Price the same reserves on both venues.
 *
 * A PumpAMM pool prices purely off what it holds: quote / base. A bonding
 * curve prices off virtual reserves, which are its real reserves plus fixed
 * offsets baked in at launch (30 SOL of virtual SOL, and the ~280M tokens of
 * virtual supply that never sit in the curve).
 *
 * Adding a fixed amount to both sides of a ratio drags it toward that fixed
 * ratio, so the two venues agree exactly when the pool price equals
 * `virtualSolOffset / virtualTokenOffset`. Above that crossover the curve
 * quotes cheaper than the pool, below it the curve quotes dearer, and either
 * way the gap narrows as both reserves grow past the offsets.
 */
export function compareVenuePrices({
  baseReserve,
  quoteReserve,
  virtualSolOffset,
  virtualTokenOffset,
}: {
  baseReserve: BN;
  quoteReserve: BN;
  virtualSolOffset: BN;
  virtualTokenOffset: BN;
}): VenuePriceComparison {
  const ammSpotLamports = spotPriceLamports(baseReserve, quoteReserve);
  const curveSpotLamports = spotPriceLamports(
    baseReserve.add(virtualTokenOffset),
    quoteReserve.add(virtualSolOffset),
  );
  if (curveSpotLamports.isZero()) {
    throw new Error(
      "Curve price rounds to zero at this scale; compare raw reserves instead",
    );
  }
  return {
    ammSpotLamports,
    curveSpotLamports,
    crossoverPriceLamports: spotPriceLamports(
      virtualTokenOffset,
      virtualSolOffset,
    ),
    differenceBps: ammSpotLamports
      .sub(curveSpotLamports)
      .muln(10_000)
      .div(curveSpotLamports),
  };
}


/** Read both sides of a pool's reserves from its token accounts. */
export async function readPoolReserves(
  connection: Connection,
  poolBaseTokenAccount: PublicKey,
  poolQuoteTokenAccount: PublicKey,
): Promise<{ base: BN; quote: BN }> {
  const [base, quote] = await Promise.all([
    connection.getTokenAccountBalance(poolBaseTokenAccount),
    connection.getTokenAccountBalance(poolQuoteTokenAccount),
  ]);
  return {
    base: new BN(base.value.amount),
    quote: new BN(quote.value.amount),
  };
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const sdk = new OnlinePumpSdk(connection);

  heading("Finding a graduated token");
  const { mint, pool: discoveredPool } =
    await findGraduatedMint(connection);
  row("Mint", mint.toBase58());

  heading("Deriving the pool from the mint alone");
  const authority = pumpPoolAuthorityPda(mint);
  const canonical = canonicalPumpPoolPda(mint);
  row("Pool authority PDA", authority.toBase58());
  row("Canonical pool PDA", canonical.toBase58());
  row("Discovered pool", discoveredPool.toBase58());
  row("Match", canonical.equals(discoveredPool));
  console.log(
    "\nThe canonical pool is index 0 under the mint's pool authority with wSOL",
  );
  console.log(
    "as the quote mint. Migration always creates it there, so any graduated",
  );
  console.log("token's pool is derivable offline from the mint.");

  heading("Pool state: fetchPool");
  const pool = await sdk.fetchPool(mint);
  row("Creator", pool.creator.toBase58());
  row("Coin creator", pool.coinCreator.toBase58());
  row("Base mint", pool.baseMint.toBase58());
  row("Quote mint", pool.quoteMint.toBase58());
  row("LP mint", pool.lpMint.toBase58());
  row("LP supply", pool.lpSupply.toString());
  row("Mayhem mode", pool.isMayhemMode);
  row("Cashback coin", pool.isCashbackCoin);

  heading("Spot price from the reserves");
  const reserves = await readPoolReserves(
    connection,
    pool.poolBaseTokenAccount,
    pool.poolQuoteTokenAccount,
  );
  row("Base reserve", formatTokens(reserves.base));
  row("Quote reserve", formatSol(reserves.quote));
  row(
    "AMM spot",
    `${spotPriceLamports(reserves.base, reserves.quote).toString()} lamports/token`,
  );

  heading("What a bonding curve would quote for the same reserves");
  const global = mainnetGlobal();
  const virtualTokenOffset = global.initialVirtualTokenReserves.sub(
    global.initialRealTokenReserves,
  );
  const comparison = compareVenuePrices({
    baseReserve: reserves.base,
    quoteReserve: reserves.quote,
    virtualSolOffset: global.initialVirtualSolReserves,
    virtualTokenOffset,
  });
  row("Virtual SOL offset", formatSol(global.initialVirtualSolReserves, 0));
  row("Virtual token offset", formatTokens(virtualTokenOffset, 0));
  row(
    "Curve spot",
    `${comparison.curveSpotLamports.toString()} lamports/token`,
  );
  row(
    "AMM spot",
    `${comparison.ammSpotLamports.toString()} lamports/token`,
  );
  row(
    "Crossover price",
    `${comparison.crossoverPriceLamports.toString()} lamports/token`,
  );
  row("AMM over curve", `${comparison.differenceBps.toString()} bps`);
  console.log(
    "\nThe curve's virtual offsets act like phantom liquidity nobody owns.",
  );
  console.log(
    "They pull the curve's price toward the offsets' own ratio, the crossover",
  );
  console.log(
    "above, so a pool trading richer than the crossover would be cheaper on a",
  );
  console.log(
    "curve, and a pool trading below it would be dearer. Graduation swaps a",
  );
  console.log("priced-with-phantom-liquidity venue for one priced on reality.");

  heading("The counterexample");
  const pumpCanonical = canonicalPumpPoolPda(PUMP_TOKEN_MINT);
  const pumpCanonicalInfo = await connection.getAccountInfo(pumpCanonical);
  row("PUMP canonical PDA", pumpCanonical.toBase58());
  row("Account exists", pumpCanonicalInfo !== null);
  console.log(
    "\nPUMP_TOKEN_MINT never rode a bonding curve, so nothing was ever",
  );
  console.log(
    "migrated to its canonical address: its listing pool lives elsewhere.",
  );
  console.log(
    "Deriving a pool address only works for tokens that graduated.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
