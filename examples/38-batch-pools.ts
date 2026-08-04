/**
 * Example 38: Batched AMM Pool Reads
 *
 * Category: Live Data
 *
 * Asks fetchMultiplePools for a mixed basket of graduated and still-curving
 * mints in one call, then reads each live pool's vaults in a second batched
 * call and prices every pool from its own reserves. Missing entries are the
 * answer to "has this token graduated?", not an error.
 *
 * Run: npm run example 38
 */
import {
  OnlinePumpSdk,
  canonicalPumpPoolPda,
  type Pool,
} from "@nirholas/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { collectStreamMints, findGraduatedMint } from "./_lib/discovery";
import { formatSol, formatTokens, heading, row } from "./_lib/format";

/** 1 whole Pump token = 1e6 raw units (6 decimals). */
const TOKEN_UNITS = new BN(1_000_000);

/** A pool with the vault balances that back it. */
export interface PoolReserves {
  mint: string;
  pool: string;
  /** Base (token) vault balance in raw units. */
  baseReserve: BN;
  /** Quote (SOL) vault balance in lamports. */
  quoteReserve: BN;
  lpSupply: BN;
}

/** One priced pool. */
export interface PoolPrice extends PoolReserves {
  /** Spot price of one whole token, in lamports. */
  priceLamportsPerToken: BN;
}

export interface PoolBasketSummary {
  /** Every pool that had both reserves and could be priced. */
  priced: PoolPrice[];
  /** Pools skipped because a vault was empty and the price is undefined. */
  unpriced: number;
  /** SOL across every pool in the basket, in lamports. */
  totalQuoteLiquidity: BN;
  /** The pool holding the most SOL. */
  deepest: PoolPrice | null;
}

/**
 * Price a basket of pools from their vault balances.
 *
 * A PumpAMM pool account stores its vault addresses, not its balances, so
 * the reserves come from the token accounts themselves. Spot price is
 * `quoteReserve / baseReserve`, scaled by 1e6 first so the result is
 * lamports per whole token and never rounds to zero on a deep pool.
 */
export function aggregatePools(entries: PoolReserves[]): PoolBasketSummary {
  const priced: PoolPrice[] = [];
  let unpriced = 0;
  let totalQuoteLiquidity = new BN(0);
  let deepest: PoolPrice | null = null;

  for (const entry of entries) {
    totalQuoteLiquidity = totalQuoteLiquidity.add(entry.quoteReserve);
    if (entry.baseReserve.isZero() || entry.quoteReserve.isZero()) {
      unpriced += 1;
      continue;
    }
    const withPrice: PoolPrice = {
      ...entry,
      priceLamportsPerToken: entry.quoteReserve
        .mul(TOKEN_UNITS)
        .div(entry.baseReserve),
    };
    priced.push(withPrice);
    if (!deepest || withPrice.quoteReserve.gt(deepest.quoteReserve)) {
      deepest = withPrice;
    }
  }

  return { priced, unpriced, totalQuoteLiquidity, deepest };
}

/** SPL token account layout: mint (32) owner (32) amount (8, little endian). */
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

/** Read both vaults of every pool in one getMultipleAccountsInfo call. */
async function readPoolReserves(
  connection: ReturnType<typeof getConnection>,
  pools: Array<{ mint: string; pool: PublicKey; state: Pool }>,
): Promise<PoolReserves[]> {
  const vaults: PublicKey[] = [];
  for (const entry of pools) {
    vaults.push(entry.state.poolBaseTokenAccount, entry.state.poolQuoteTokenAccount);
  }
  const infos = await rpc("getMultipleAccountsInfo", () =>
    connection.getMultipleAccountsInfo(vaults),
  );

  const reserves: PoolReserves[] = [];
  for (const [index, entry] of pools.entries()) {
    const base = infos[index * 2];
    const quote = infos[index * 2 + 1];
    if (!base || !quote) continue;
    reserves.push({
      mint: entry.mint,
      pool: entry.pool.toBase58(),
      baseReserve: tokenAccountAmount(base.data),
      quoteReserve: tokenAccountAmount(quote.data),
      lpSupply: entry.state.lpSupply,
    });
  }
  return reserves;
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);

  heading("Building a mixed basket");
  const graduated = await findGraduatedMint(connection);
  row("Graduated mint", graduated.mint.toBase58());
  row("Its pool", graduated.pool.toBase58());
  const streamed = await collectStreamMints(connection, ["trade", "create"], 5);
  const mints = [graduated.mint, ...streamed.map((entry) => entry.mint)];
  row("Basket size", mints.length);

  heading("One call: fetchMultiplePools");
  const started = Date.now();
  const pools = await rpc("fetchMultiplePools", () =>
    online.fetchMultiplePools(mints),
  );
  row("Entries returned", pools.size);
  row("Elapsed", `${Date.now() - started} ms`);
  console.log(
    "Each mint maps to its canonical pool PDA and the whole set is read with",
  );
  console.log(
    "a single getMultipleAccounts request. A null entry means the canonical",
  );
  console.log(
    "pool account does not exist, which is the on-chain definition of a token",
  );
  console.log("that has not graduated.");

  const live: Array<{ mint: string; pool: PublicKey; state: Pool }> = [];
  heading("Per mint");
  for (const [mint, pool] of pools) {
    if (!pool) {
      row(mint.slice(0, 8), "no canonical pool (still on its curve)");
      continue;
    }
    row(
      mint.slice(0, 8),
      `pool live, lpSupply ${pool.lpSupply.toString()}`,
    );
    live.push({
      mint,
      pool: canonicalPumpPoolPda(new PublicKey(mint)),
      state: pool,
    });
  }

  if (live.length === 0) {
    heading("No canonical pool in this basket");
    console.log(
      "Every mint in the basket is still on its bonding curve. Re-run to draw",
    );
    console.log(
      "a fresh basket, or pass GRADUATED_MINT=<address> to price a known pool.",
    );
    return;
  }

  heading("Reserves: one more batched call");
  const reserves = await readPoolReserves(connection, live);
  row("Pools read", reserves.length);

  heading("Prices from reserves");
  const summary = aggregatePools(reserves);
  for (const entry of summary.priced) {
    row(entry.mint.slice(0, 8), `${entry.priceLamportsPerToken.toString()} lamports/token`);
    row("  base reserve", formatTokens(entry.baseReserve, 0));
    row("  quote reserve", formatSol(entry.quoteReserve));
  }
  row("Pools priced", summary.priced.length);
  row("Pools without a price", summary.unpriced);
  row("SOL across the basket", formatSol(summary.totalQuoteLiquidity));
  if (summary.deepest) {
    row(
      "Deepest pool",
      `${summary.deepest.mint.slice(0, 8)} with ${formatSol(summary.deepest.quoteReserve)}`,
    );
  }
  console.log(
    "price = quoteReserve * 1e6 / baseReserve. It is the pool's spot price:",
  );
  console.log(
    "a real fill pays fees on top and moves the reserves while it executes.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
