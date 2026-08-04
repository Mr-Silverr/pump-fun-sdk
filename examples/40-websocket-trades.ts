/**
 * Example 40: Live Trade Feed
 *
 * Category: Live Data
 *
 * Subscribes to the Pump program's log stream and decodes every trade as it
 * lands with parsePumpEventsFromLogs, printing side, size, and the reserves
 * the trade left behind. Runs for at most 15 seconds or 10 trades, then
 * unsubscribes and exits.
 *
 * Run: npm run example 40
 */
import {
  PUMP_PROGRAM_ID,
  parsePumpEventsFromLogs,
  type TradeEvent,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { formatSol, formatTokens, heading, row } from "./_lib/format";

/** One decoded trade, reduced to the fields a feed actually renders. */
export interface LiveTrade {
  mint: string;
  user: string;
  isBuy: boolean;
  /** SOL side of the trade, in lamports. */
  solAmount: BN;
  /** Token side of the trade, in raw units. */
  tokenAmount: BN;
  /** Protocol fee charged on this trade, in lamports. */
  fee: BN;
  /** Creator fee charged on this trade, in lamports. */
  creatorFee: BN;
  /** Virtual SOL reserves the trade left behind. */
  virtualSolReserves: BN;
}

/**
 * Turn raw program log lines into trades.
 *
 * This is the whole decoding step: the WebSocket hands over the log lines of
 * one transaction, `parsePumpEventsFromLogs` recovers the anchor-encoded
 * events from the `Program data:` entries, and everything that is not a
 * bonding curve trade is dropped. It is pure, so a feed's rendering can be
 * tested against recorded logs without a socket.
 */
export function extractTrades(logs: readonly string[]): LiveTrade[] {
  const trades: LiveTrade[] = [];
  for (const event of parsePumpEventsFromLogs(logs)) {
    if (event.type !== "trade") continue;
    const trade: TradeEvent = event.data;
    trades.push({
      mint: trade.mint.toBase58(),
      user: trade.user.toBase58(),
      isBuy: trade.isBuy,
      solAmount: trade.solAmount,
      tokenAmount: trade.tokenAmount,
      fee: trade.fee,
      creatorFee: trade.creatorFee,
      virtualSolReserves: trade.virtualSolReserves,
    });
  }
  return trades;
}

export interface FeedSummary {
  trades: number;
  buys: number;
  sells: number;
  /** Total SOL that changed hands, in lamports. */
  volume: BN;
  /** Protocol plus creator fees across the window, in lamports. */
  fees: BN;
  /** Distinct mints seen. */
  mints: number;
}

/** Roll a window of trades into the numbers a ticker header shows. */
export function summariseFeed(trades: readonly LiveTrade[]): FeedSummary {
  const mints = new Set<string>();
  let buys = 0;
  let volume = new BN(0);
  let fees = new BN(0);
  for (const trade of trades) {
    mints.add(trade.mint);
    if (trade.isBuy) buys += 1;
    volume = volume.add(trade.solAmount);
    fees = fees.add(trade.fee).add(trade.creatorFee);
  }
  return {
    trades: trades.length,
    buys,
    sells: trades.length - buys,
    volume,
    fees,
    mints: mints.size,
  };
}

const MAX_TRADES = 10;
const WINDOW_MS = 15_000;

export async function main(): Promise<void> {
  const connection = getConnection();

  heading("Subscribing to the Pump program log stream");
  row("Program", PUMP_PROGRAM_ID.toBase58());
  row("Stops after", `${MAX_TRADES} trades or ${WINDOW_MS / 1000}s`);
  console.log(
    "connection.onLogs opens a logsSubscribe WebSocket. Every transaction",
  );
  console.log(
    "that touches the program pushes its logs here within a slot or two.",
  );

  const collected: LiveTrade[] = [];

  await new Promise<void>((resolve) => {
    let finished = false;
    let subscription: number | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (subscription !== null) {
        connection.removeOnLogsListener(subscription).catch(() => undefined);
      }
      resolve();
    };

    const timer = setTimeout(finish, WINDOW_MS);

    subscription = connection.onLogs(
      PUMP_PROGRAM_ID,
      ({ logs, err, signature }) => {
        if (err || finished) return;
        for (const trade of extractTrades(logs)) {
          if (collected.length >= MAX_TRADES) break;
          collected.push(trade);
          const side = trade.isBuy ? "BUY " : "SELL";
          console.log(
            `${side} ${formatSol(trade.solAmount)} for ${formatTokens(trade.tokenAmount)}  ${trade.mint.slice(0, 8)}  ${signature.slice(0, 8)}`,
          );
        }
        if (collected.length >= MAX_TRADES) finish();
      },
      "confirmed",
    );
  });

  heading("Window summary");
  const summary = summariseFeed(collected);
  row("Trades", summary.trades);
  row("Buys / sells", `${summary.buys} / ${summary.sells}`);
  row("Distinct mints", summary.mints);
  row("SOL volume", formatSol(summary.volume));
  row("Fees paid", formatSol(summary.fees, 6));

  if (summary.trades === 0) {
    console.log(
      "No trades landed in the window. The subscription itself worked; either",
    );
    console.log(
      "the endpoint does not forward logsSubscribe or the stream was quiet.",
    );
    console.log("Set PUMP_RPC_URL to an endpoint with WebSocket support.");
  }

  heading("Unsubscribed");
  console.log(
    "The listener is removed, which closes the socket once the last",
  );
  console.log("subscription goes away, and the process exits.");
}

if (require.main === module) {
  // Exit explicitly: a WebSocket that has not finished closing would
  // otherwise hold the event loop open after the feed is done.
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
