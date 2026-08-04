/**
 * Example 49: Token Incentives
 *
 * Category: AMM & Advanced
 *
 * Reads the global volume accumulator that drives Pump's trade-to-earn
 * rewards, works out which day of the program a timestamp falls in, and
 * builds the whole user-side lifecycle: open an accumulator, sync it, claim
 * rewards, close it. The day math is the part everything else hangs on.
 *
 * Run: npm run example 49
 */
import {
  OnlinePumpSdk,
  PUMP_SDK,
  currentDayTokens,
  totalUnclaimedTokens,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA,
  ammUserVolumeAccumulatorPda,
  userVolumeAccumulatorPda,
  type GlobalVolumeAccumulator,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { formatSol, heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";

/** Where a timestamp falls inside the incentive program's schedule. */
export interface IncentiveWindow {
  /** False when the accumulator has never been configured (all zeros). */
  configured: boolean;
  /** True once the start time has passed. */
  started: boolean;
  /** True once the end time has passed. */
  ended: boolean;
  /** Zero-based index of the day containing the timestamp. */
  dayIndex: number;
  /** Index of the final day of the program. */
  finalDayIndex: number;
  /** Unix seconds at which the current day began. */
  dayStart: BN;
  /** Seconds left in the current day. */
  secondsRemainingInDay: BN;
}

/**
 * Locate a timestamp in the incentive schedule.
 *
 * Rewards are allocated per day: the program stores a token supply and a
 * total SOL volume for each day, and a trader's cut of a day is their share
 * of that day's volume. Every read of the accumulators therefore starts by
 * turning a clock time into a day index, exactly as `totalUnclaimedTokens`
 * and `currentDayTokens` do internally.
 */
export function incentiveWindow(
  accumulator: GlobalVolumeAccumulator,
  timestampSeconds: number,
): IncentiveWindow {
  const { startTime, endTime, secondsInADay } = accumulator;
  const configured =
    !startTime.isZero() && !endTime.isZero() && !secondsInADay.isZero();
  if (!configured) {
    return {
      configured: false,
      started: false,
      ended: false,
      dayIndex: 0,
      finalDayIndex: 0,
      dayStart: new BN(0),
      secondsRemainingInDay: new BN(0),
    };
  }

  const now = new BN(Math.floor(timestampSeconds));
  const started = now.gte(startTime);
  const elapsed = started ? now.sub(startTime) : new BN(0);
  const dayIndex = elapsed.div(secondsInADay).toNumber();
  const dayStart = startTime.add(secondsInADay.muln(dayIndex));
  return {
    configured: true,
    started,
    ended: now.gt(endTime),
    dayIndex,
    finalDayIndex: endTime.sub(startTime).div(secondsInADay).toNumber(),
    dayStart,
    secondsRemainingInDay: started
      ? dayStart.add(secondsInADay).sub(now)
      : secondsInADay,
  };
}

/**
 * A trader's cut of one day's token allocation.
 *
 * The same proportional rule the program applies: your SOL volume over the
 * day's total SOL volume, times the tokens allocated to that day. Integer
 * division floors, so the pool is never over-issued.
 */
export function projectedDayShare({
  userSolVolume,
  daySolVolume,
  dayTokenSupply,
}: {
  userSolVolume: BN;
  daySolVolume: BN;
  dayTokenSupply: BN;
}): BN {
  if (daySolVolume.isZero()) return new BN(0);
  return userSolVolume.mul(dayTokenSupply).div(daySolVolume);
}

/** Total tokens the program still has to hand out from `dayIndex` onward. */
export function remainingProgramSupply(
  accumulator: GlobalVolumeAccumulator,
  dayIndex: number,
): BN {
  return accumulator.totalTokenSupply
    .slice(Math.max(0, dayIndex))
    .reduce((total, supply) => total.add(supply), new BN(0));
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const wallet = loadWallet();
  const sdk = new OnlinePumpSdk(connection);

  heading("The accumulators");
  row("Curve global accumulator", GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58());
  row("AMM global accumulator", AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58());
  row("Curve user accumulator", userVolumeAccumulatorPda(wallet.publicKey).toBase58());
  row("AMM user accumulator", ammUserVolumeAccumulatorPda(wallet.publicKey).toBase58());

  heading("Global schedule");
  const accumulator = await sdk.fetchGlobalVolumeAccumulator();
  row("Reward mint", accumulator.mint.toBase58());
  row("Start time", accumulator.startTime.toString());
  row("End time", accumulator.endTime.toString());
  row("Seconds in a day", accumulator.secondsInADay.toString());
  row("Days tracked", accumulator.totalTokenSupply.length);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const window = incentiveWindow(accumulator, nowSeconds);
  row("Configured", window.configured);
  if (window.configured) {
    row("Started", window.started);
    row("Ended", window.ended);
    row("Day index", `${window.dayIndex} of ${window.finalDayIndex}`);
    row("Day began at", window.dayStart.toString());
    row("Seconds left today", window.secondsRemainingInDay.toString());
    row(
      "Supply left from today",
      remainingProgramSupply(accumulator, window.dayIndex).toString(),
    );
  } else {
    console.log(
      "\nThe on-chain accumulator currently carries a zeroed schedule, so no",
    );
    console.log(
      "incentive round is running. Every reward read below correctly returns",
    );
    console.log(
      "zero rather than throwing, which is what a UI needs between rounds.",
    );
  }

  heading("This wallet's position");
  const stats = await sdk.fetchUserVolumeAccumulatorTotalStats(wallet.publicKey);
  row("Unclaimed (both programs)", stats.totalUnclaimedTokens.toString());
  row("Claimed (both programs)", stats.totalClaimedTokens.toString());
  row("Current SOL volume", formatSol(stats.currentSolVolume, 6));
  row(
    "getTotalUnclaimedTokens",
    (await sdk.getTotalUnclaimedTokens(wallet.publicKey)).toString(),
  );
  row(
    "getTotalUnclaimedTokensBothPrograms",
    (await sdk.getTotalUnclaimedTokensBothPrograms(wallet.publicKey)).toString(),
  );
  row(
    "getCurrentDayTokens",
    (await sdk.getCurrentDayTokens(wallet.publicKey)).toString(),
  );

  heading("The same math, offline");
  const userAccumulator = (await sdk.fetchUserVolumeAccumulator(
    wallet.publicKey,
  )) ?? {
    user: wallet.publicKey,
    needsClaim: false,
    totalUnclaimedTokens: new BN(0),
    totalClaimedTokens: new BN(0),
    currentSolVolume: new BN(0),
    lastUpdateTimestamp: new BN(0),
  };
  row("Accumulator on chain", userAccumulator.lastUpdateTimestamp.gtn(0));
  row(
    "totalUnclaimedTokens()",
    totalUnclaimedTokens(accumulator, userAccumulator, nowSeconds).toString(),
  );
  row(
    "currentDayTokens()",
    currentDayTokens(accumulator, userAccumulator, nowSeconds).toString(),
  );
  const dayIndex = window.dayIndex;
  row(
    "projectedDayShare()",
    projectedDayShare({
      userSolVolume: userAccumulator.currentSolVolume,
      daySolVolume: accumulator.solVolumes[dayIndex] ?? new BN(0),
      dayTokenSupply: accumulator.totalTokenSupply[dayIndex] ?? new BN(0),
    }).toString(),
  );
  console.log(
    "\nThe SDK's online helpers are these pure functions with a pair of",
  );
  console.log(
    "account fetches in front, so a client that already holds the accounts",
  );
  console.log("can recompute rewards without another round trip.");

  heading("Lifecycle instructions (not sent)");
  const initIx = await PUMP_SDK.initUserVolumeAccumulator({
    payer: wallet.publicKey,
    user: wallet.publicKey,
  });
  row("init accounts / data", `${initIx.keys.length} / ${initIx.data.length}B`);
  const syncIxs = await sdk.syncUserVolumeAccumulatorBothPrograms(
    wallet.publicKey,
  );
  row("sync instructions", syncIxs.length);
  const claimIx = await PUMP_SDK.claimTokenIncentivesInstruction({
    user: wallet.publicKey,
    payer: wallet.publicKey,
  });
  row("claim accounts / data", `${claimIx.keys.length} / ${claimIx.data.length}B`);
  const closeIx = await PUMP_SDK.closeUserVolumeAccumulator(wallet.publicKey);
  row("close accounts / data", `${closeIx.keys.length} / ${closeIx.data.length}B`);
  console.log(
    "\nThe accumulator is opened once, updated by every trade, synced when a",
  );
  console.log(
    "round rolls over, drained by a claim, and closed to reclaim its rent",
  );
  console.log(
    "when the trader is done. claimTokenIncentivesInstruction defaults to the",
  );
  console.log("PUMP reward mint; pass `mint` to claim a different one.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
