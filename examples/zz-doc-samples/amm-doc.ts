import { Connection, Keypair } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, canonicalPumpPoolPda } from "@nirholas/pump-sdk";
import BN from "bn.js";

async function main() {
  const user = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const protocolFeeRecipient = Keypair.generate().publicKey;
  const baseAmount = new BN(1_000_000);
  const quoteAmount = new BN(100_000_000);
  const lpAmount = new BN(50_000);
  const sdk = new OnlinePumpSdk(new Connection("https://api.mainnet-beta.solana.com"));

  const quote = await sdk.ammQuoteBuy({ mint, user, quoteAmountIn: new BN(100_000_000) });
  const buyIxs = await sdk.ammBuyInstructions({ mint, user, solAmount: new BN(100_000_000), slippageBps: 500 });
  const sellIxs = await sdk.ammSellInstructions({ mint, user, tokenAmount: new BN(1_000_000), slippageBps: 500 });

  const depQuote = await sdk.ammDepositAutocompleteFromBase({ mint, user, base: baseAmount, slippage: 1 });
  const depQuote2 = await sdk.ammDepositAutocompleteFromQuote({ mint, user, quote: quoteAmount, slippage: 1 });
  const depIxs = await sdk.depositByBaseAmount({ mint, user, baseAmount, slippage: 1 });
  const wdIxs = await sdk.withdrawByLpAmount({ mint, user, lpAmount, slippage: 1 });
  const lpBalance = await sdk.getLpTokenBalance(mint, user);
  const pools = await sdk.fetchMultiplePools([mint]);
  const graduated = await sdk.isGraduated(mint);

  const ix = await PUMP_SDK.ammBuyInstruction({
    user, pool: canonicalPumpPoolPda(mint), mint,
    baseAmountOut: new BN(1_000_000), maxQuoteAmountIn: new BN(100_000),
    cashback: false, protocolFeeRecipient,
  });
  const sellIx = await PUMP_SDK.ammSellInstruction({
    user, pool: canonicalPumpPoolPda(mint), mint,
    baseAmountIn: new BN(1_000_000), minQuoteAmountOut: new BN(90_000),
    cashback: false, protocolFeeRecipient,
  });
  void [quote, buyIxs, sellIxs, depQuote, depQuote2, depIxs, wdIxs, lpBalance, pools, graduated, ix, sellIx];
}
void main;
