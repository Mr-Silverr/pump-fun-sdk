import { Connection } from "@solana/web3.js";
import { OnlinePumpSdk } from "../../src/index";

async function main() {
  const connection = new Connection(process.env.PUMP_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  const sdk = new OnlinePumpSdk(connection);

  const global = await sdk.fetchGlobal();
  console.log("initialized:", global.initialized);
  console.log("initial virtual SOL reserves:", global.initialVirtualSolReserves.toString());
  console.log("initial virtual token reserves:", global.initialVirtualTokenReserves.toString());
  console.log("initial real token reserves:", global.initialRealTokenReserves.toString());

  const feeConfig = await sdk.fetchFeeConfig();
  console.log("fee tiers:", feeConfig.feeTiers.length);
  const first = feeConfig.feeTiers[0];
  if (first) {
    console.log("tier 1 protocol fee bps:", first.fees.protocolFeeBps.toString());
    console.log("tier 1 creator fee bps:", first.fees.creatorFeeBps.toString());
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
