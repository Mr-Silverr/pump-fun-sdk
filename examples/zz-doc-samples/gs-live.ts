import { Connection } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_TOKEN_MINT } from "@nirholas/pump-sdk";

async function main() {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const sdk = new OnlinePumpSdk(connection);

  const global = await sdk.fetchGlobal();
  console.log("initialized:", global.initialized);
  console.log("initial virtual SOL reserves:", global.initialVirtualSolReserves.toString());
  console.log("initial virtual token reserves:", global.initialVirtualTokenReserves.toString());

  const bondingCurve = await sdk.fetchBondingCurve(PUMP_TOKEN_MINT);
  console.log("PUMP graduated:", bondingCurve.complete);
}

main().catch((err) => { console.error(err); process.exit(1); });
