import { Connection, Keypair } from "@solana/web3.js";
import { PUMP_SDK, OnlinePumpSdk, Platform } from "@nirholas/pump-sdk";

async function main() {
  const wallet = Keypair.generate();
  const socialClaimAuthority = Keypair.generate().publicKey;
  const sdk = new OnlinePumpSdk(new Connection("https://api.mainnet-beta.solana.com"));

  const ix = await PUMP_SDK.createSocialFeePdaInstruction({
    payer: wallet.publicKey,
    userId: "583231",
    platform: Platform.GitHub,
  });

  const ix2 = await PUMP_SDK.claimSocialFeePdaInstruction({
    recipient: wallet.publicKey,
    socialClaimAuthority,
    userId: "583231",
    platform: Platform.GitHub,
  });

  const state = await sdk.fetchSocialFeePda("583231", Platform.GitHub);
  void [ix, ix2, state];
}
void main;
