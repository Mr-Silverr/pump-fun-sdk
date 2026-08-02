/**
 * Live reference-token discovery for the runnable examples.
 *
 * The examples need real tokens to read: one still trading on its bonding
 * curve, and one that graduated to a PumpAMM pool. Hardcoding any mint
 * would rot (and the PUMP token itself is unsuitable: it launched straight
 * into an AMM listing, so it has no bonding curve history and no canonical
 * pool). Polling recent transactions does not work either: pump.fun runs
 * around a hundred transactions per second, most of them failed slippage
 * bots, which exhausts public RPC rate limits before anything useful turns
 * up. So we listen instead: a few seconds on a `logsSubscribe` WebSocket
 * yields a stream of real trade and create events, and their mints are the
 * freshest possible reference tokens.
 *
 * Overrides for a specific token:
 *   MINT=<address>            for the bonding-curve examples
 *   GRADUATED_MINT=<address>  for the AMM examples
 */
import {
  OnlinePumpSdk,
  PUMP_SDK,
  PUMP_PROGRAM_ID,
  BondingCurve,
  Pool,
  PumpEvent,
  parsePumpEventsFromLogs,
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

const STREAM_TIMEOUT_MS = 20_000;
const MAX_CANDIDATES = 12;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The mint named by a protocol event, when it names one. */
export function mintFromEvent(event: PumpEvent): PublicKey | null {
  switch (event.type) {
    case "trade":
    case "create":
    case "complete":
    case "completePumpAmmMigration":
      return event.data.mint;
    default:
      return null;
  }
}

/**
 * Listen to the Pump program's log stream and collect mints named by the
 * requested event types, newest first, until enough candidates arrive or
 * the timeout passes.
 */
export interface StreamMint {
  mint: PublicKey;
  eventType: PumpEvent["type"];
}

export async function collectStreamMints(
  connection: Connection,
  eventTypes: ReadonlyArray<PumpEvent["type"]>,
  limit: number = MAX_CANDIDATES,
  timeoutMs: number = STREAM_TIMEOUT_MS,
): Promise<StreamMint[]> {
  const wanted = new Set(eventTypes);
  const seen = new Set<string>();
  const mints: StreamMint[] = [];

  return await new Promise((resolve, reject) => {
    let settled = false;
    let subscription: number | null = null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (subscription !== null) {
        connection.removeOnLogsListener(subscription).catch(() => undefined);
      }
      if (error && mints.length === 0) reject(error);
      else resolve(mints);
    };

    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `No ${[...wanted].join("/")} events observed in ${timeoutMs / 1000}s of live Pump logs. ` +
              "Check the RPC endpoint (PUMP_RPC_URL) supports logsSubscribe, or pass MINT/GRADUATED_MINT.",
          ),
        ),
      timeoutMs,
    );

    try {
      subscription = connection.onLogs(
        PUMP_PROGRAM_ID,
        ({ logs, err }) => {
          if (err) return;
          for (const event of parsePumpEventsFromLogs(logs)) {
            if (!wanted.has(event.type)) continue;
            const mint = mintFromEvent(event);
            if (!mint || seen.has(mint.toBase58())) continue;
            seen.add(mint.toBase58());
            mints.push({ mint, eventType: event.type });
            if (mints.length >= limit) finish();
          }
        },
        "confirmed",
      );
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Find a token that is actively trading on its bonding curve.
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

  const candidates = await collectStreamMints(connection, ["trade", "create"]);
  for (const { mint } of candidates) {
    const bondingCurve = await online
      .fetchBondingCurve(mint)
      .catch(() => null);
    if (bondingCurve && !bondingCurve.complete) {
      return { mint, bondingCurve };
    }
    await pause(250);
  }

  throw new Error(
    "None of the streamed candidate tokens had an active bonding curve. " +
      "Retry, set PUMP_RPC_URL to a less limited endpoint, or pass MINT=<address>.",
  );
}

/**
 * Find a graduated token with a live pool at the canonical pool address.
 * Completion events stream in every minute or two; their pools exist
 * shortly after, so recently completed mints are checked first and a
 * trade-mint sweep covers the gap when no completion streams by.
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

  const candidates = await collectStreamMints(
    connection,
    ["complete", "completePumpAmmMigration", "trade"],
    MAX_CANDIDATES * 2,
  );

  // Completions first: their canonical pools are near-certain to exist.
  const completions = candidates.filter((c) => c.eventType !== "trade");
  const trades = candidates.filter((c) => c.eventType === "trade");

  for (const { mint } of [...completions, ...trades]) {
    const pool = canonicalPumpPoolPda(mint);
    const info = await connection.getAccountInfo(pool).catch(() => null);
    if (info) {
      try {
        return { mint, pool, state: PUMP_SDK.decodePool(info) };
      } catch {
        // Not a pool account; keep scanning.
      }
    }
    await pause(250);
  }

  throw new Error(
    "No graduated token with a canonical pool found among streamed candidates. " +
      "Retry, set PUMP_RPC_URL, or pass GRADUATED_MINT=<address>.",
  );
}
