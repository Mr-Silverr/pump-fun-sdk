/**
 * Example 48: Creator Fees
 *
 * Category: AMM & Advanced
 *
 * Reads a live coin creator's unclaimed fee balance on both programs, splits
 * it into its bonding curve and AMM halves, and builds the collect
 * instructions for each without sending them. A creator who only claims one
 * side leaves the other accruing forever.
 *
 * Run: npm run example 48
 */
import {
  OnlinePumpSdk,
  PUMP_SDK,
  ammCreatorVaultPda,
  creatorVaultPda,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { findActiveCurveMint } from "./_lib/discovery";
import { formatSol, heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";

/** A creator's unclaimed fees, split by the program holding them. */
export interface VaultSplit {
  /** Lamports sitting in the bonding curve program's creator vault. */
  bondingCurve: BN;
  /** Lamports sitting in the AMM program's coin creator vault. */
  amm: BN;
  /** Both vaults together. */
  total: BN;
  /** The bonding curve vault's share of the total, in basis points. */
  bondingCurveShareBps: BN;
}

/**
 * Separate the two vaults from the two balance calls.
 *
 * `getCreatorVaultBalance` reads only the bonding curve vault, while
 * `getCreatorVaultBalanceBothPrograms` adds the AMM vault on top, so the AMM
 * side is the difference. Splitting them matters because they are claimed by
 * different instructions against different programs.
 */
export function splitVaultBalances(
  bondingCurveBalance: BN,
  totalBalance: BN,
): VaultSplit {
  if (totalBalance.lt(bondingCurveBalance)) {
    throw new Error(
      "Combined balance is below the bonding curve balance; the two reads disagree",
    );
  }
  const amm = totalBalance.sub(bondingCurveBalance);
  return {
    bondingCurve: bondingCurveBalance,
    amm,
    total: totalBalance,
    bondingCurveShareBps: totalBalance.isZero()
      ? new BN(0)
      : bondingCurveBalance.muln(10_000).div(totalBalance),
  };
}

/**
 * Whether a balance is worth a claim transaction.
 *
 * Claiming costs a signature and rent-exempt ATA handling; below roughly a
 * transaction fee the claim destroys value. 10,000 lamports is a plain,
 * conservative floor a creator dashboard can gate its button on.
 */
export const CLAIM_WORTH_IT_LAMPORTS = new BN(10_000);

export function worthClaiming(balance: BN): boolean {
  return balance.gte(CLAIM_WORTH_IT_LAMPORTS);
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const wallet = loadWallet();
  const sdk = new OnlinePumpSdk(connection);

  heading("Finding a live coin and its creator");
  const { mint, bondingCurve } = await findActiveCurveMint(connection);
  const creator = bondingCurve.creator;
  row("Mint", mint.toBase58());
  row("Creator", creator.toBase58());

  heading("Where creator fees pile up");
  row("Curve creator vault", creatorVaultPda(creator).toBase58());
  row("AMM creator vault", ammCreatorVaultPda(creator).toBase58());
  console.log(
    "\nBoth vaults are derived from the creator address, not from the mint, so",
  );
  console.log(
    "one vault holds the fees from every coin that creator launched.",
  );

  heading("Unclaimed balances");
  const bondingCurveBalance = await sdk.getCreatorVaultBalance(creator);
  const totalBalance = await sdk.getCreatorVaultBalanceBothPrograms(creator);
  const split = splitVaultBalances(bondingCurveBalance, totalBalance);
  row("Bonding curve vault", formatSol(split.bondingCurve, 6));
  row("AMM vault", formatSol(split.amm, 6));
  row("Total", formatSol(split.total, 6));
  row("Curve share", `${split.bondingCurveShareBps.toString()} bps`);
  row("Worth claiming", worthClaiming(split.total));
  console.log(
    "\nThe vault reads subtract rent exemption, so the number here is what the",
  );
  console.log(
    "creator can actually withdraw rather than the account's raw lamports.",
  );

  heading("Instructions: collectCreatorFeeInstruction (not sent)");
  const curveIx = await PUMP_SDK.collectCreatorFeeInstruction({ creator });
  row("Program", curveIx.programId.toBase58());
  row("Accounts", curveIx.keys.length);
  row("Data bytes", curveIx.data.length);

  heading("Instructions: collectCoinCreatorFeeInstructions (not sent)");
  const bothIxs = await sdk.collectCoinCreatorFeeInstructions(
    creator,
    wallet.publicKey,
  );
  row("Instruction count", bothIxs.length);
  for (const [i, ix] of bothIxs.entries()) {
    row(
      `  ix[${i}]`,
      `${ix.programId.toBase58()} keys=${ix.keys.length} data=${ix.data.length}B`,
    );
  }
  console.log(
    "\nThe combined builder leads with the same bonding curve collect above,",
  );
  console.log(
    "then adds the AMM leg with its wSOL account handling. It takes a fee",
  );
  console.log(
    "payer separately, so a service can pay rent on the creator's behalf.",
  );

  heading("Next step (not performed here)");
  console.log(
    "Only the creator can sign a collect. Sending it moves the vault balance",
  );
  console.log(
    "to the creator wallet; nothing else about the coin changes. If the coin",
  );
  console.log(
    "uses a fee sharing config, the fees belong to the split instead: see",
  );
  console.log("example 47.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
