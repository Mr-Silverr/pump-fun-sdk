/**
 * Runtime discovery of a graduated Pump token for the AMM examples.
 *
 * The AMM examples need a token whose canonical PumpAMM pool exists on
 * mainnet. Graduations happen constantly, so instead of hardcoding a mint
 * (which would rot, and third-party mints must never be hardcoded anyway)
 * we scan the most recent PumpAMM transactions and take the first account
 * that IS a canonical pool: its address equals canonicalPumpPoolPda of the
 * base mint it names. That check is exact, no decoding heuristics involved.
 *
 * Override with MINT=<graduated mint base58> to point every AMM example at
 * a specific token. A non-graduated MINT fails fast with a clear message.
 */
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from "@nirholas/pump-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

/** Pool account layout offsets: 8 discriminator + 1 poolBump + 2 index + 32 creator. */
const BASE_MINT_OFFSET = 43;
const QUOTE_MINT_OFFSET = 75;
const MIN_POOL_DATA_LENGTH = QUOTE_MINT_OFFSET + 32;

/**
 * Resolve a graduated token mint with a live canonical AMM pool.
 *
 * Order: the MINT env var (verified on-chain), then the base mint of the
 * first canonical pool touched by recent PumpAMM transactions.
 */
export async function resolveGraduatedMint(
  connection: Connection,
): Promise<PublicKey> {
  const fromEnv = process.env.MINT;
  if (fromEnv) {
    const mint = new PublicKey(fromEnv);
    const poolInfo = await connection.getAccountInfo(
      canonicalPumpPoolPda(mint),
    );
    if (!poolInfo) {
      throw new Error(
        `MINT ${fromEnv} has no canonical AMM pool: the token has not ` +
          `graduated. Pass a graduated mint or unset MINT to auto-discover one.`,
      );
    }
    return mint;
  }

  const signatures = await connection.getSignaturesForAddress(
    PUMP_AMM_PROGRAM_ID,
    { limit: 12 },
  );

  for (const sig of signatures) {
    if (sig.err) continue;
    const tx = await connection.getTransaction(sig.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;

    const keys = tx.transaction.message.staticAccountKeys.concat(
      tx.meta?.loadedAddresses?.writable ?? [],
      tx.meta?.loadedAddresses?.readonly ?? [],
    );
    const unique = [...new Map(keys.map((k) => [k.toBase58(), k])).values()]
      .slice(0, 100);
    const infos = await connection.getMultipleAccountsInfo(unique);

    for (let i = 0; i < unique.length; i++) {
      const key = unique[i];
      const info = infos[i];
      if (!key || !info) continue;
      if (!info.owner.equals(PUMP_AMM_PROGRAM_ID)) continue;
      if (info.data.length < MIN_POOL_DATA_LENGTH) continue;

      const baseMint = new PublicKey(
        info.data.subarray(BASE_MINT_OFFSET, BASE_MINT_OFFSET + 32),
      );
      const quoteMint = new PublicKey(
        info.data.subarray(QUOTE_MINT_OFFSET, QUOTE_MINT_OFFSET + 32),
      );
      if (!quoteMint.equals(NATIVE_MINT)) continue;
      if (!canonicalPumpPoolPda(baseMint).equals(key)) continue;

      return baseMint;
    }
  }

  throw new Error(
    "No canonical pool found in recent PumpAMM activity. " +
      "Retry, or pass MINT=<graduated mint> explicitly.",
  );
}
