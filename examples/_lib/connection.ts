/**
 * Shared RPC connection for the runnable examples.
 *
 * Every example that touches the network goes through here so a single
 * environment variable upgrades all of them to a paid endpoint:
 *
 *   PUMP_RPC_URL=https://your-endpoint npm run example 31
 *
 * The default is the public mainnet RPC, which is rate limited but
 * sufficient for the read-only examples.
 */
import { Connection } from "@solana/web3.js";

export const RPC_URL =
  process.env.PUMP_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}
