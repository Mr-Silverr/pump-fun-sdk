/**
 * Example 28: Volume Accumulators
 *
 * Category: Accounts & Events
 *
 * Reads the live GlobalVolumeAccumulator and a user's UserVolumeAccumulator,
 * then reconstructs the day-window arithmetic behind token incentives: which
 * day index the clock is in, how much supply that day carries, and why a
 * user's current-day reward is zero the moment their accumulator falls a day
 * behind.
 *
 * Run: npm run example 28
 */
import {
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  PUMP_SDK,
  currentDayTokens,
  totalUnclaimedTokens,
  userVolumeAccumulatorPda,
  type GlobalVolumeAccumulator,
  type UserVolumeAccumulator,
  type UserVolumeAccumulatorTotalStats,
} from "@nirholas/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";
import { withRpcRetry } from "./25-decode-pool";

/** One day of the incentive program, as the on-chain arithmetic sees it. */
export interface DayWindow {
  /** Index into `totalTokenSupply` / `solVolumes`, or -1 before the start. */
  dayIndex: number;
  /** Unix second the day opened. */
  dayStart: BN;
  /** Unix second the next day opens. */
  dayEnd: BN;
  /** Seconds elapsed inside the day. */
  secondsIntoDay: BN;
  /** The timestamp falls inside the program's start/end range. */
  withinProgram: boolean;
  /** The day index the program's end time falls in. */
  endDayIndex: number;
}

/**
 * Locate a timestamp inside the incentive program's day grid.
 *
 * The program stores one token supply and one SOL volume per day, and every
 * lookup is `(timestamp - startTime) / secondsInADay` with integer division.
 * That single expression is why rewards are day-scoped: two trades in the
 * same window share a denominator, and the moment the quotient increments
 * the previous day's numbers stop moving.
 */
export function dayWindowAt(
  accumulator: GlobalVolumeAccumulator,
  timestampSeconds: BN,
): DayWindow {
  const { startTime, endTime, secondsInADay } = accumulator;
  if (secondsInADay.isZero() || startTime.isZero() || endTime.isZero()) {
    throw new Error(
      "The global volume accumulator is not configured (zero start, end, or day length)",
    );
  }
  const endDayIndex = endTime.lt(startTime)
    ? -1
    : endTime.sub(startTime).div(secondsInADay).toNumber();

  if (timestampSeconds.lt(startTime)) {
    return {
      dayIndex: -1,
      dayStart: startTime,
      dayEnd: startTime.add(secondsInADay),
      secondsIntoDay: new BN(0),
      withinProgram: false,
      endDayIndex,
    };
  }

  const elapsed = timestampSeconds.sub(startTime);
  const dayIndex = elapsed.div(secondsInADay).toNumber();
  const dayStart = startTime.add(secondsInADay.muln(dayIndex));
  return {
    dayIndex,
    dayStart,
    dayEnd: dayStart.add(secondsInADay),
    secondsIntoDay: timestampSeconds.sub(dayStart),
    withinProgram: timestampSeconds.lte(endTime),
    endDayIndex,
  };
}

/** A user's day-scoped reward, with the inputs that produced it. */
export interface CurrentDayShare {
  window: DayWindow;
  /** The user's accumulator was last touched in the same day window. */
  sameDay: boolean;
  /** Token supply allocated to that day, if the day is in range. */
  dayTokenSupply: BN;
  /** All traders' SOL volume in that day, the reward denominator. */
  daySolVolume: BN;
  /** This user's SOL volume counted toward that day. */
  userSolVolume: BN;
  /** userSolVolume * dayTokenSupply / daySolVolume, floored. */
  tokens: BN;
}

/**
 * Reconstruct the current-day reward the same way the SDK's
 * `currentDayTokens` does, exposing the intermediate values.
 *
 * Pure: pass the timestamp in, no clock and no network. The reward is a
 * pro-rata slice of the day's token supply, and it collapses to zero in two
 * cases worth knowing about: the timestamp sits outside the program window,
 * or the user's accumulator was last updated in an earlier day (their volume
 * belongs to that earlier denominator, not this one).
 */
export function currentDayShare(
  accumulator: GlobalVolumeAccumulator,
  user: UserVolumeAccumulator,
  timestampSeconds: BN,
): CurrentDayShare {
  const window = dayWindowAt(accumulator, timestampSeconds);
  const userWindow = dayWindowAt(accumulator, user.lastUpdateTimestamp);
  const sameDay =
    window.dayIndex >= 0 && window.dayIndex === userWindow.dayIndex;

  const dayTokenSupply =
    (window.dayIndex >= 0
      ? accumulator.totalTokenSupply[window.dayIndex]
      : undefined) ?? new BN(0);
  const daySolVolume =
    (window.dayIndex >= 0
      ? accumulator.solVolumes[window.dayIndex]
      : undefined) ?? new BN(0);

  const eligible = sameDay && window.withinProgram && !daySolVolume.isZero();
  return {
    window,
    sameDay,
    dayTokenSupply,
    daySolVolume,
    userSolVolume: user.currentSolVolume,
    tokens: eligible
      ? user.currentSolVolume.mul(dayTokenSupply).div(daySolVolume)
      : new BN(0),
  };
}

/**
 * The claim-relevant totals of a user accumulator, with the zeroed shape the
 * SDK uses when the account does not exist yet.
 */
export function totalStatsOf(
  user: UserVolumeAccumulator | null,
): UserVolumeAccumulatorTotalStats {
  if (!user) {
    return {
      totalUnclaimedTokens: new BN(0),
      totalClaimedTokens: new BN(0),
      currentSolVolume: new BN(0),
    };
  }
  return {
    totalUnclaimedTokens: user.totalUnclaimedTokens,
    totalClaimedTokens: user.totalClaimedTokens,
    currentSolVolume: user.currentSolVolume,
  };
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const user = process.env.USER_ADDRESS
    ? new PublicKey(process.env.USER_ADDRESS)
    : loadWallet().publicKey;

  heading("Accounts");
  row("Global accumulator", GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58());
  row("User", user.toBase58());
  row("User accumulator", userVolumeAccumulatorPda(user).toBase58());

  // Both accounts in one RPC round trip.
  const [globalInfo, userInfo] = await withRpcRetry("volume accumulators", () =>
    connection.getMultipleAccountsInfo([
      GLOBAL_VOLUME_ACCUMULATOR_PDA,
      userVolumeAccumulatorPda(user),
    ]),
  );
  if (!globalInfo) {
    throw new Error(
      `Global volume accumulator ${GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58()} not found`,
    );
  }

  const accumulator = PUMP_SDK.decodeGlobalVolumeAccumulator(globalInfo);
  const userAccumulator = userInfo
    ? PUMP_SDK.decodeUserVolumeAccumulatorNullable(userInfo)
    : null;

  heading("decodeGlobalVolumeAccumulator");
  row("Incentive mint", accumulator.mint.toBase58());
  row("Start time", `${accumulator.startTime.toString()} (unix seconds)`);
  row("End time", `${accumulator.endTime.toString()} (unix seconds)`);
  row("Seconds in a day", accumulator.secondsInADay.toString());
  row("Days tracked", accumulator.totalTokenSupply.length);

  const now = new BN(Math.floor(Date.now() / 1000));
  const window = dayWindowAt(accumulator, now);

  heading("Day window right now");
  row("Day index", window.dayIndex);
  row("Final day index", window.endDayIndex);
  row("Window opened", `${window.dayStart.toString()} (unix seconds)`);
  row("Window closes", `${window.dayEnd.toString()} (unix seconds)`);
  row("Seconds into the day", window.secondsIntoDay.toString());
  row("Inside the program window", window.withinProgram);
  if (window.dayIndex >= 0) {
    const supply = accumulator.totalTokenSupply[window.dayIndex];
    const volume = accumulator.solVolumes[window.dayIndex];
    row("Day token supply", supply ? formatTokens(supply, 0) : "not allocated");
    row("Day SOL volume", volume ? formatSol(volume, 2) : "not allocated");
  }

  heading("decodeUserVolumeAccumulator");
  if (!userAccumulator) {
    console.log(
      "This wallet has no user volume accumulator: the PDA is created the",
    );
    console.log("first time the wallet trades with volume tracking on. Pass");
    console.log("USER_ADDRESS=<wallet> to read an account that already exists.");
  } else {
    row("Needs claim", userAccumulator.needsClaim);
    row("Last update", userAccumulator.lastUpdateTimestamp.toString());
    row("Current SOL volume", formatSol(userAccumulator.currentSolVolume));
  }

  const stats = totalStatsOf(userAccumulator);
  heading("UserVolumeAccumulatorTotalStats");
  row("Unclaimed tokens", formatTokens(stats.totalUnclaimedTokens));
  row("Claimed tokens", formatTokens(stats.totalClaimedTokens));
  row("Current SOL volume", formatSol(stats.currentSolVolume));

  if (userAccumulator) {
    const share = currentDayShare(accumulator, userAccumulator, now);
    heading("Current-day reward");
    row("Same day as last update", share.sameDay);
    row("User SOL volume", formatSol(share.userSolVolume));
    row("Day SOL volume", formatSol(share.daySolVolume, 2));
    row("Day token supply", formatTokens(share.dayTokenSupply, 0));
    row("Reward (reconstructed)", formatTokens(share.tokens));
    row(
      "Reward (SDK currentDayTokens)",
      formatTokens(
        currentDayTokens(accumulator, userAccumulator, now.toNumber()),
      ),
    );
    row(
      "Total unclaimed (SDK)",
      formatTokens(
        totalUnclaimedTokens(accumulator, userAccumulator, now.toNumber()),
      ),
    );
  }

  heading("The rule");
  console.log(
    "reward = userSolVolume * dayTokenSupply / daySolVolume, in integers,",
  );
  console.log(
    "for the single day index both the clock and the user's accumulator",
  );
  console.log(
    "agree on. When the day rolls over, the accrued slice is folded into",
  );
  console.log(
    "totalUnclaimedTokens and the current-day figure restarts at zero.",
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
