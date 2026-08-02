import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import {
  PUMP_SDK,
  OnlinePumpSdk,
  Platform,
  generateVanityMint,
  estimateVanityMintAttempts,
  getTokenAmountForTargetSol,
  maxSafeSellAmount,
  getFeeRecipient,
  pickBreakingFeeRecipient,
  isBreakingFeeRecipient,
  buildAmmBreakingFeeRecipientAccounts,
  validateBcInstruction,
  patchBcInstruction,
  bondingCurveGraduationProgress,
  createFallbackConnection,
  parseEndpoints,
  isCreatorUsingSharingConfig,
  isSharingConfigEditable,
  normalizeSocialShareholders,
  newBondingCurve,
  type Global,
  type BondingCurve,
  type FeeConfig,
  type SharingConfig,
} from "@nirholas/pump-sdk";

const pk = () => Keypair.generate().publicKey;

async function main(global: Global, bondingCurve: BondingCurve, feeConfig: FeeConfig, sharingConfig: SharingConfig) {
  const user = pk(); const mint = pk(); const creator = pk(); const payer = pk();
  const pool = pk(); const authority = pk(); const recipient = pk(); const socialClaimAuthority = pk();

  const sdk = OnlinePumpSdk.withFallback([
    "https://my-primary-rpc.com",
    "https://api.mainnet-beta.solana.com",
  ]);

  const exact = await PUMP_SDK.buyExactSolInInstruction({
    user, mint, creator,
    feeRecipient: getFeeRecipient(global, false),
    solAmount: new BN(1_000_000_000),
    minTokenAmount: new BN(1),
  });

  const quote = await sdk.quoteBuy({ mint, user, solAmount: new BN(1_000_000_000) });
  console.log(quote.tokensOut.toString(), quote.priceImpactBps, quote.feesLamports.toString());
  const ixs = await sdk.buyBySolAmount({ mint, user, solAmount: new BN(1_000_000_000), slippage: 1 });

  const squote = await sdk.quoteSell({ mint, user, amount: new BN(1_000_000) });
  if (squote.willOverflow) console.log(squote.maxSafeAmount.toString());

  const sigs = await sdk.sellChunked({
    mint, user, totalAmount: new BN(1), slippage: 1,
    sendTx: async () => "sig",
  });

  const routed = await sdk.routedBuyInstructions({ mint, user, quoteAmountIn: new BN(1), slippage: 0.01 });
  const routedS = await sdk.routedSellInstructions({ mint, user, baseAmountIn: new BN(1), slippage: 0.01 });
  const pct = await sdk.sellByPercentage({ mint, user, percent: 50, slippage: 1 });
  const tgt = await sdk.sellToTargetSol({ mint, user, targetSol: new BN(1), slippage: 1 });
  const all = await sdk.sellAllInstructions({ mint, user });

  const events = await sdk.parseTransactionEvents("sig");
  for (const ev of events) {
    if (ev.type === "trade") console.log(ev.data.isBuy ? "buy" : "sell", ev.data.solAmount.toString());
  }

  const curves = await sdk.fetchMultipleBondingCurves([mint]);
  const pools = await sdk.fetchMultiplePools([mint]);
  const grad = await sdk.isGraduated(mint);
  const bal = await sdk.getTokenBalance(mint, user);

  const ammQ = await sdk.ammQuoteBuy({ mint, user, quoteAmountIn: new BN(1) });
  const ammQS = await sdk.ammQuoteSell({ mint, user, baseAmountIn: new BN(1) });
  const ammB = await sdk.ammBuyInstructions({ mint, user, solAmount: new BN(1), slippageBps: 500 });
  const ammS = await sdk.ammSellInstructions({ mint, user, tokenAmount: new BN(1), slippageBps: 500 });
  const lp = await sdk.getLpTokenBalance(mint, user);

  const mdf = await sdk.getMinimumDistributableFee(mint);
  console.log(mdf.minimumRequired.toString(), mdf.distributableFees.toString(), mdf.canDistribute, mdf.isGraduated);
  const dist = await sdk.buildDistributeCreatorFeesInstructions(mint);
  console.log(dist.instructions.length, dist.isGraduated);

  const cc = await sdk.claimCashbackInstructions(user);
  const ccb = await sdk.claimCashbackBothPrograms(user);

  const ammBuyIx = await PUMP_SDK.ammBuyInstruction({
    user, pool, mint,
    baseAmountOut: new BN(1), maxQuoteAmountIn: new BN(1),
    cashback: false, protocolFeeRecipient: pk(),
  });

  const fsc = await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null });
  const social = await PUMP_SDK.createSocialFeePdaInstruction({
    payer, userId: "583231", platform: Platform.GitHub,
  });
  const claimSocial = await PUMP_SDK.claimSocialFeePdaInstruction({
    recipient, socialClaimAuthority, userId: "583231", platform: Platform.GitHub,
  });

  const upd = await PUMP_SDK.updateSharingConfigWithSocialRecipients({
    authority, mint, currentShareholders: [],
    newShareholders: [
      { address: pk(), shareBps: 7000 },
      { userId: "583231", platform: Platform.GitHub, shareBps: 3000 },
    ],
  });

  const target = getTokenAmountForTargetSol({
    global, feeConfig, mintSupply: bondingCurve.tokenTotalSupply, bondingCurve, targetSol: new BN(1),
  });

  const val = validateBcInstruction(exact, "buy");
  const patched = patchBcInstruction(exact);
  const accounts = buildAmmBreakingFeeRecipientAccounts(pickBreakingFeeRecipient());
  console.log(isBreakingFeeRecipient(pk()));

  const progress = bondingCurveGraduationProgress({
    realSolReserves: bondingCurve.realSolReserves,
    realTokenReserves: bondingCurve.realTokenReserves,
  });

  const conn = createFallbackConnection(parseEndpoints(process.env.RPC_URLS, "https://api.mainnet-beta.solana.com"));

  console.log(isCreatorUsingSharingConfig({ mint, creator: bondingCurve.creator }));
  console.log(isSharingConfigEditable({ sharingConfig }));
  const norm = normalizeSocialShareholders({
    newShareholders: [{ address: pk(), shareBps: 10000 }],
  });

  const estimate = estimateVanityMintAttempts({ suffix: "pump" });
  void estimate;
  const grind = generateVanityMint({ suffix: "p", maxAttempts: 10 }).catch(() => null);

  const collectIx = await PUMP_SDK.collectCreatorFeeInstruction({ creator });
  const claimIx = await PUMP_SDK.claimTokenIncentivesInstruction({ user, payer });

  const nb = newBondingCurve(global);
  void [ixs, sigs, routed, routedS, pct, tgt, all, curves, pools, grad, bal, ammQ, ammQS, ammB, ammS, lp, cc, ccb, ammBuyIx, fsc, social, claimSocial, upd, target, val, patched, accounts, progress, conn, norm, grind, collectIx, claimIx, nb];
}
void main;
