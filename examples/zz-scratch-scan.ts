import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID } from "../src/index";
import pumpIdl from "../src/idl/pump.json";
import ammIdl from "../src/idl/pump_amm.json";
import { Connection } from "@solana/web3.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function disc(idl: any, name: string): Buffer {
  return Buffer.from(idl.events.find((e: any) => e.name === name).discriminator);
}
const TRADE = disc(pumpIdl, "TradeEvent");
const CREATE = disc(pumpIdl, "CreateEvent");
const ABUY = disc(ammIdl, "BuyEvent");
const ASELL = disc(ammIdl, "SellEvent");

async function main() {
  const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const sigs = await c.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit: 20 });
  console.log("pump sigs:", sigs.length, "ok:", sigs.filter((s) => !s.err).length);
  let scanned = 0;
  for (const s of sigs.filter((x) => !x.err)) {
    if (scanned >= 5) break;
    scanned++;
    await sleep(250);
    const tx = await c.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    const logs = tx?.meta?.logMessages ?? [];
    for (const l of logs) {
      if (!l.startsWith("Program data: ")) continue;
      const buf = Buffer.from(l.slice(14), "base64");
      if (buf.length < 8) continue;
      const d = buf.subarray(0, 8);
      try {
        if (d.equals(TRADE)) {
          const ev = PUMP_SDK.decodeTradeEvent(buf.subarray(8));
          console.log("TRADE", ev.mint.toBase58(), ev.isBuy ? "buy" : "sell", ev.solAmount.toString(), "user", ev.user.toBase58().slice(0,8));
        } else if (d.equals(CREATE)) {
          const ev = PUMP_SDK.decodeCreateEvent(buf.subarray(8));
          console.log("CREATE", ev.mint.toBase58(), ev.name, ev.symbol);
        }
      } catch (e: any) { console.log("decode err", e.message); }
    }
  }
  await sleep(400);
  const asigs = await c.getSignaturesForAddress(PUMP_AMM_PROGRAM_ID, { limit: 15 });
  console.log("amm sigs ok:", asigs.filter((s) => !s.err).length);
  let ascanned = 0;
  for (const s of asigs.filter((x) => !x.err)) {
    if (ascanned >= 3) break;
    ascanned++;
    await sleep(250);
    const tx = await c.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    const logs = tx?.meta?.logMessages ?? [];
    for (const l of logs) {
      if (!l.startsWith("Program data: ")) continue;
      const buf = Buffer.from(l.slice(14), "base64");
      if (buf.length < 8) continue;
      const d = buf.subarray(0, 8);
      try {
        if (d.equals(ABUY)) {
          const ev = PUMP_SDK.decodeAmmBuyEvent(buf.subarray(8));
          console.log("AMM BUY pool", ev.pool.toBase58(), "quoteIn", ev.quoteAmountIn.toString());
        } else if (d.equals(ASELL)) {
          const ev = PUMP_SDK.decodeAmmSellEvent(buf.subarray(8));
          console.log("AMM SELL pool", ev.pool.toBase58());
        }
      } catch (e: any) { console.log("amm decode err", e.message); }
    }
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
