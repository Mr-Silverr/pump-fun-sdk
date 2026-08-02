import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } from "@nirholas/pump-sdk";
import BN from "bn.js";

async function main(sdk: OnlinePumpSdk, mint: PublicKey, user: PublicKey) {
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig();
  const buyState = await sdk.fetchBuyState(mint, user);

  const solAmount = new BN(100_000_000); // 0.1 SOL
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: buyState.bondingCurve.tokenTotalSupply,
    bondingCurve: buyState.bondingCurve,
    amount: solAmount,
  });

  const ixs = await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
    bondingCurve: buyState.bondingCurve,
    associatedUserAccountInfo: buyState.associatedUserAccountInfo,
    mint,
    user,
    amount,
    solAmount,
    slippage: 1, // percent
    tokenProgram: buyState.tokenProgram,
  });
  return ixs;
}

void main(new OnlinePumpSdk(new Connection("https://api.mainnet-beta.solana.com")), Keypair.generate().publicKey, Keypair.generate().publicKey);
