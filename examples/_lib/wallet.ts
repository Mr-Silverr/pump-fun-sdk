/**
 * Wallet loading for the runnable examples.
 *
 * Examples never require a funded wallet: instruction-building examples
 * use an ephemeral keypair by default so they are safe to run anywhere.
 * To run an example against a real wallet, export one of:
 *
 *   PUMP_WALLET=/path/to/keypair.json   (solana-keygen JSON array format)
 *   PUMP_WALLET_SECRET=<base58 secret key>
 *
 * No example in this directory sends a transaction on its own. The ones
 * that build spend transactions print them and stop; broadcasting is
 * always an explicit, separate step the reader performs.
 */
import { readFileSync } from "node:fs";

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export function loadWallet(): Keypair {
  const file = process.env.PUMP_WALLET;
  if (file) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const secret = process.env.PUMP_WALLET_SECRET;
  if (secret) {
    return Keypair.fromSecretKey(bs58.decode(secret));
  }
  return Keypair.generate();
}

export function isEphemeral(): boolean {
  return !process.env.PUMP_WALLET && !process.env.PUMP_WALLET_SECRET;
}
