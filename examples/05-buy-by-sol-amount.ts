/**
 * Example 05: Buy by SOL Amount
 *
 * Category: Token Lifecycle
 *
 * Most buyers think in SOL, not token units. OnlinePumpSdk.buyBySolAmount
 * takes a SOL budget and does everything: fetch state, quote the token
 * output, build slippage-protected instructions. This example exercises
 * that one-call flow and exposes the quote math it uses underneath.
 *
 * Run: npm run example 05
 */
import {
  PUMP_SDK,
  PUMP_PROGRAM_ID,
  PUMP_TOKEN_MINT,
  BONDING_CURVE_NEW_SIZE,
  OnlinePumpSdk,
  bondingCurvePda,
  getBuyTokenAmountFromSolAmount,
  newBondingCurve,
  type BondingCurve,
  type FeeConfig,
  type Global,
} from "@nirholas/pump-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { divToDecimalString, formatSol, formatTokens, heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";

/**
 * The exact quote `buyBySolAmount` computes before building instructions:
 * how many tokens a SOL budget purchases at the current curve state,
 * with protocol and creator fees already deducted from the input.
 */
export function quoteTokensForSol({
  global,
  feeConfig,
  bondingCurve,
  solAmount,
}: {
  global: Global;
  feeConfig: FeeConfig | null;
  bondingCurve: BondingCurve;
  solAmount: BN;
}): BN {
  return getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solAmount,
  });
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);
  const wallet = loadWallet();
  const mint = new PublicKey(process.env.MINT ?? PUMP_TOKEN_MINT.toBase58());

  heading("Setup");
  row("Mint", mint.toBase58());
  row("Wallet", wallet.publicKey.toBase58());

  const [global, feeConfig] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
  ]);

  const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint));
  const decoded = curveInfo ? PUMP_SDK.decodeBondingCurveNullable(curveInfo) : null;
  const tradable =
    curveInfo !== null &&
    decoded !== null &&
    !decoded.complete &&
    !decoded.virtualTokenReserves.isZero();

  const bondingCurve: BondingCurve =
    tradable && decoded ? decoded : newBondingCurve(global);

  if (!tradable) {
    heading("Bonding curve status");
    console.log("This mint has no active bonding curve (missing or graduated), so");
    console.log("the quote table below uses a brand-new curve from live global");
    console.log("state. Set MINT=<mint> to quote a live curve token.");
  }

  heading("Quote table (offline math on the curve state)");
  const budgets = [
    new BN(10_000_000), // 0.01 SOL
    new BN(100_000_000), // 0.1 SOL
    new BN(1_000_000_000), // 1 SOL
    new BN(10_000_000_000), // 10 SOL
  ];
  for (const solAmount of budgets) {
    const tokens = quoteTokensForSol({ global, feeConfig, bondingCurve, solAmount });
    const perSol = tokens.mul(new BN(1_000_000_000)).div(solAmount);
    row(
      formatSol(solAmount, 2),
      `${formatTokens(tokens)}  (${divToDecimalString(perSol, new BN(1_000_000), 0)} tokens/SOL)`,
    );
  }
  console.log("Larger budgets get fewer tokens per SOL: each lamport buys at a");
  console.log("worse point on the curve than the one before it (price impact).");

  heading("buyBySolAmount (the one-call online flow)");
  const solAmount = new BN(100_000_000); // 0.1 SOL
  try {
    const ixs = await online.buyBySolAmount({
      mint,
      user: wallet.publicKey,
      solAmount,
      slippage: 1,
    });
    row("Instruction count", ixs.length);
    ixs.forEach((ix, i) => {
      const kind = ix.programId.equals(PUMP_PROGRAM_ID) ? "pump" : "token/ata";
      row(`${i + 1}. ${kind}`, `${ix.keys.length} accounts, ${ix.data.length} data bytes`);
    });
  } catch (err) {
    console.log("buyBySolAmount needs a live, un-graduated bonding curve and threw:");
    console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    console.log("Building the identical instructions offline with the demo state,");
    console.log("which is exactly what buyBySolAmount does after its fetches.");
    const tokensOut = quoteTokensForSol({ global, feeConfig, bondingCurve, solAmount });
    const ixs = await PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo: {
        data: Buffer.alloc(BONDING_CURVE_NEW_SIZE),
        executable: false,
        lamports: 0,
        owner: PUMP_PROGRAM_ID,
      },
      bondingCurve,
      associatedUserAccountInfo: null,
      mint,
      user: wallet.publicKey,
      amount: tokensOut,
      solAmount,
      slippage: 1,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    row("Instruction count", ixs.length);
    row("Tokens expected", formatTokens(tokensOut));
  }

  heading("Next step (not performed here)");
  console.log("Compose, sign, send. This example never broadcasts a transaction.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
