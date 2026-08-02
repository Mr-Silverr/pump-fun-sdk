import { Connection, Keypair } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, Platform, isCreatorUsingSharingConfig, isSharingConfigEditable, canonicalPumpPoolPda } from "@nirholas/pump-sdk";

async function main() {
  const mint = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const wallet = Keypair.generate();
  const authorityKeypair = Keypair.generate();
  const onlineSdk = new OnlinePumpSdk(new Connection("https://api.mainnet-beta.solana.com"));

  const bondingCurve = await onlineSdk.fetchBondingCurve(mint);
  const isSharing = isCreatorUsingSharingConfig({ mint, creator: bondingCurve.creator });
  const pool = await onlineSdk.fetchPool(mint);
  const isSharingAmm = isCreatorUsingSharingConfig({ mint, creator: pool.coinCreator });
  if (isSharing) {
    const config = await onlineSdk.fetchSharingConfig(mint);
    console.log(config.shareholders, isSharingConfigEditable({ sharingConfig: config }));
  }

  const cfgIx = await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null });
  const cfgIx2 = await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: canonicalPumpPoolPda(mint) });

  const ix = await PUMP_SDK.createSocialFeePdaInstruction({
    payer: wallet.publicKey, userId: "583231", platform: Platform.GitHub,
  });
  const ix2 = await PUMP_SDK.claimSocialFeePdaInstruction({
    recipient: wallet.publicKey, socialClaimAuthority: authorityKeypair.publicKey,
    userId: "583231", platform: Platform.GitHub,
  });
  const ixs = await PUMP_SDK.updateSharingConfigWithSocialRecipients({
    authority: creator, mint, currentShareholders: [],
    newShareholders: [
      { address: wallet.publicKey, shareBps: 7000 },
      { userId: "583231", platform: Platform.GitHub, shareBps: 3000 },
    ],
  });
  void [isSharingAmm, cfgIx, cfgIx2, ix, ix2, ixs];
}
void main;
