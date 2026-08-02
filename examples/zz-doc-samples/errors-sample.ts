import { PublicKey, Keypair } from "@solana/web3.js";
import {
  PUMP_SDK,
  NoShareholdersError,
  TooManyShareholdersError,
  ZeroShareError,
  InvalidShareTotalError,
  DuplicateShareholderError,
  maxSafeSellAmount,
  validateSellAmount,
  type Shareholder,
  type BondingCurve,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

async function feeShareSample(wallet: PublicKey, tokenMint: PublicKey, shares: Shareholder[]) {
  try {
    const ix = await PUMP_SDK.updateFeeShares({
      authority: wallet,
      mint: tokenMint,
      currentShareholders: [],
      newShareholders: shares,
    });
    return ix;
  } catch (err) {
    if (err instanceof InvalidShareTotalError) {
      console.error(`Shares total ${err.total}, need 10000`);
    } else if (err instanceof TooManyShareholdersError) {
      console.error(`${err.count} shareholders, max ${err.max}`);
    } else if (err instanceof ZeroShareError) {
      console.error(`Zero share for ${err.address}`);
    } else if (err instanceof NoShareholdersError || err instanceof DuplicateShareholderError) {
      console.error(err.message);
    }
    return null;
  }
}

function overflowSample(amount: BN, bondingCurve: BondingCurve) {
  const max = maxSafeSellAmount(bondingCurve.virtualSolReserves);
  if (amount.gt(max)) {
    // chunk
  }
  validateSellAmount(amount, bondingCurve);
}

void feeShareSample(Keypair.generate().publicKey, Keypair.generate().publicKey, []);
void overflowSample;
