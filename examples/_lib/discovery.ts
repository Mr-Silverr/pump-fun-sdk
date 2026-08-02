/**
 * Live reference-token discovery for the runnable examples.
 *
 * The examples need real tokens to read: one still trading on its bonding
 * curve, and one that graduated to a PumpAMM pool. Hardcoding any mint
 * would rot (and the PUMP token itself is unsuitable: it launched straight
 * into an AMM listing, so it has no bonding curve history and no canonical
 * pool). Instead we discover fresh reference tokens from the chain itself:
 * the most recent protocol transactions always name active tokens.
 *
 * Overrides for a specific token:
 *   MINT=<address>            for the bonding-curve examples
 *   GRADUATED_MINT=<address>  for the AMM examples
 */
import {
  OnlinePumpSdk,
  PUMP_SDK,
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  BondingCurve,
  Pool,
  canonicalPumpPoolPda,
} from "@nirholas/pump-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

export interface CurveReference {
  mint: PublicKey;
  bondingCurve: BondingCurve;
}

export interface PoolReference {
  mint: PublicKey;
  pool: PublicKey;
  state: Pool;
}

const SIGNATURE_SCAN_LIMIT = 25;
const TX_SCAN_LIMIT = 8;

/**
 * Find a token that is actively trading on its bonding curve, by reading
 * trade/create events out of the most recent Pump program transactions.
 */
export async function findActiveCurveMint(
  connection: Connection,
): Promise<CurveReference> {
  const online = new OnlinePumpSdk(connection);

  const override = process.env.MINT;
  if (override) {
    const mint = new PublicKey(override);
    return { mint, bondingCurve: await online.fetchBondingCurve(mint) };
  }

  const signatures = await connection.getSignaturesForAddress(
    PUMP_PROGRAM_ID,
    { limit: SIGNATURE_SCAN_LIMIT },
    "confirmed",
  );

  let inspected = 0;
  for (const sig of signatures) {
    if (sig.err || inspected >= TX_SCAN_LIMIT) continue;
    inspected += 1;
    const events = await online.parseTransactionEvents(sig.signature);
    for (const event of events) {
      const mint =
        event.type === "trade" || event.type === "create"
          ? event.data.mint
          : null;
      if (!mint) continue;
      const bondingCurve = await online
        .fetchBondingCurve(mint)
        .catch(() => null);
      if (bondingCurve && !bondingCurve.complete) {
        return { mint, bondingCurve };
      }
    }
  }

  throw new Error(
    `No active bonding-curve token found in the last ${TX_SCAN_LIMIT} Pump transactions. ` +
      "Public RPC may be rate limited; retry, set PUMP_RPC_URL, or pass MINT=<address>.",
  );
}

/**
 * Find a graduated token with a live PumpAMM pool, by inspecting the
 * accounts of the most recent PumpAMM transactions and decoding the first
 * Pool account among them.
 */
export async function findGraduatedMint(
  connection: Connection,
): Promise<PoolReference> {
  const online = new OnlinePumpSdk(connection);

  const override = process.env.GRADUATED_MINT;
  if (override) {
    const mint = new PublicKey(override);
    const pool = canonicalPumpPoolPda(mint);
    return { mint, pool, state: await online.fetchPool(mint) };
  }

  const signatures = await connection.getSignaturesForAddress(
    PUMP_AMM_PROGRAM_ID,
    { limit: SIGNATURE_SCAN_LIMIT },
    "confirmed",
  );

  let inspected = 0;
  for (const sig of signatures) {
    if (sig.err || inspected >= TX_SCAN_LIMIT) continue;
    inspected += 1;
    const tx = await connection.getTransaction(sig.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;

    const keys = tx.transaction.message.staticAccountKeys.slice(0, 24);
    const infos = await connection.getMultipleAccountsInfo(keys);
    for (let i = 0; i < infos.length; i += 1) {
      const info = infos[i];
      const key = keys[i];
      if (!info || !key || !info.owner.equals(PUMP_AMM_PROGRAM_ID)) continue;
      try {
        const state = PUMP_SDK.decodePool(info);
        return { mint: state.baseMint, pool: key, state };
      } catch {
        continue;
      }
    }
  }

  throw new Error(
    `No PumpAMM pool found in the last ${TX_SCAN_LIMIT} AMM transactions. ` +
      "Public RPC may be rate limited; retry, set PUMP_RPC_URL, or pass GRADUATED_MINT=<address>.",
  );
}
