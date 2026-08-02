import { Keypair } from "@solana/web3.js";
import { PUMP_SDK, PUMP_PROGRAM_ID } from "../../src/index";

async function main() {
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const ix = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: "My First Token",
    symbol: "FIRST",
    uri: "https://example.com/metadata.json",
    creator: user.publicKey,
    user: user.publicKey,
    mayhemMode: false,
  });
  console.log("program:", ix.programId.toBase58());
  console.log("matches PUMP_PROGRAM_ID:", ix.programId.equals(PUMP_PROGRAM_ID));
  console.log("accounts:", ix.keys.length);
  console.log("data bytes:", ix.data.length);
}
main().catch((err) => { console.error(err); process.exit(1); });
