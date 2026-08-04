/**
 * Example 24: Decoding the Fee Config
 *
 * Category: Accounts & Events
 *
 * Fetches the fee program's config account, decodes it with
 * decodeFeeConfig, and walks its FeeTier list into the ladder a trade is
 * actually priced against. Also shows what the flat fees are for, and what
 * happens to a quote when the tier list has a single entry.
 *
 * Run: npm run example 24
 */
import { PUMP_FEE_CONFIG_PDA, PUMP_SDK } from "@nirholas/pump-sdk";
import BN from "bn.js";

import type { FeeConfig, Fees } from "@nirholas/pump-sdk";

import { getConnection } from "./_lib/connection";
import { formatSol, heading, row } from "./_lib/format";

export interface TierBand {
  index: number;
  /** Lowest market cap, in lamports, that selects this tier. */
  fromMarketCap: BN;
  /** Highest market cap this tier covers, or null when it is the top band. */
  toMarketCap: BN | null;
  protocolFeeBps: BN;
  creatorFeeBps: BN;
  lpFeeBps: BN;
  totalBps: BN;
}

export interface FeeConfigReport {
  admin: string;
  tierCount: number;
  /** Contiguous bands, derived by pairing each threshold with the next. */
  bands: TierBand[];
  /** Rate the lowest band charges, which also covers caps below its floor. */
  entryFees: Fees;
  /** Rate the highest band charges. */
  topFees: Fees;
  /** True when every tier charges the same, so cap does not change the rate. */
  flatInPractice: boolean;
  /** The config's own flatFees field. */
  flatFees: Fees;
  /** True when the tier list is ordered by ascending threshold, as required. */
  thresholdsAscending: boolean;
}

function totalBps(fees: Fees): BN {
  return fees.protocolFeeBps.add(fees.creatorFeeBps).add(fees.lpFeeBps);
}

/**
 * Turn a fee config into the ladder a caller can reason about.
 *
 * Tiers are stored as (threshold, fees) pairs with no upper bound, so the
 * band a tier covers is implicit: it runs to the next tier's threshold. The
 * lowest tier is special, and it is where integrations go wrong: a market
 * cap below its threshold does not escape fees, it falls back to that same
 * lowest tier. Ordering matters too, because the tier search walks the list
 * from the top, so an unsorted list would return the wrong rate.
 */
export function interpretFeeConfig(feeConfig: FeeConfig): FeeConfigReport {
  const tiers = feeConfig.feeTiers;
  const bands: TierBand[] = tiers.map((tier, index) => {
    const next = tiers[index + 1];
    return {
      index,
      fromMarketCap: tier.marketCapLamportsThreshold,
      toMarketCap: next ? next.marketCapLamportsThreshold : null,
      protocolFeeBps: tier.fees.protocolFeeBps,
      creatorFeeBps: tier.fees.creatorFeeBps,
      lpFeeBps: tier.fees.lpFeeBps,
      totalBps: totalBps(tier.fees),
    };
  });

  const first = tiers[0];
  const last = tiers[tiers.length - 1];
  if (!first || !last) {
    throw new Error("Fee config has no tiers; every quote would fail");
  }

  let thresholdsAscending = true;
  for (let i = 1; i < tiers.length; i += 1) {
    if (
      tiers[i]!.marketCapLamportsThreshold.lt(
        tiers[i - 1]!.marketCapLamportsThreshold,
      )
    ) {
      thresholdsAscending = false;
    }
  }

  return {
    admin: feeConfig.admin.toBase58(),
    tierCount: tiers.length,
    bands,
    entryFees: first.fees,
    topFees: last.fees,
    flatInPractice: bands.every((band) =>
      band.totalBps.eq(bands[0]!.totalBps),
    ),
    flatFees: feeConfig.flatFees,
    thresholdsAscending,
  };
}

function bandLabel(band: TierBand): string {
  const from = formatSol(band.fromMarketCap, 0);
  return band.toMarketCap === null
    ? `${from} and above`
    : `${from} to ${formatSol(band.toMarketCap, 0)}`;
}

export async function main(): Promise<void> {
  const connection = getConnection();

  heading("Fetching the fee config");
  row("Address", PUMP_FEE_CONFIG_PDA.toBase58());
  const accountInfo = await connection.getAccountInfo(PUMP_FEE_CONFIG_PDA);
  if (!accountInfo) {
    throw new Error(
      `No account at ${PUMP_FEE_CONFIG_PDA.toBase58()}. Check the RPC endpoint (PUMP_RPC_URL) is mainnet.`,
    );
  }
  row("Owner", accountInfo.owner.toBase58());
  row("Data size", `${accountInfo.data.length} bytes`);
  console.log("\nThe account is allocated for a long tier list. The vector length is");
  console.log("stored with the data, so the decoder returns only the live tiers and");
  console.log("the slack costs nothing to read.");

  const feeConfig = PUMP_SDK.decodeFeeConfig(accountInfo);
  const report = interpretFeeConfig(feeConfig);

  heading("Config");
  row("Admin", report.admin);
  row("Tiers", report.tierCount);
  row("Thresholds ascending", report.thresholdsAscending);

  heading("Tier ladder");
  for (const band of report.bands) {
    row(`[${band.index}] ${bandLabel(band)}`, `${band.totalBps.toString()} bps all-in`);
    row(
      "    protocol / creator / lp",
      `${band.protocolFeeBps.toString()} / ${band.creatorFeeBps.toString()} / ${band.lpFeeBps.toString()} bps`,
    );
  }
  if (report.flatInPractice) {
    console.log("\nEvery live tier charges the same all-in rate, so on-chain pricing");
    console.log("is currently cap-independent. The tier machinery is still active;");
    console.log("adding a tier changes rates with no client update.");
  } else {
    console.log("\nRates step down as cap grows, so the same trade costs less on a");
    console.log("larger token. A quote must therefore be computed against the curve's");
    console.log("current cap, never cached across price moves.");
  }

  heading("Below the lowest threshold");
  const entryTotal = totalBps(report.entryFees);
  row("Lowest threshold", formatSol(report.bands[0]!.fromMarketCap, 0));
  row("Rate applied below it", `${entryTotal.toString()} bps`);
  console.log("\ncalculateFeeTier returns the first tier for any cap under its");
  console.log("threshold. There is no zero-fee region, and no error.");

  heading("Flat fees");
  row("Protocol", `${feeConfig.flatFees.protocolFeeBps.toString()} bps`);
  row("Creator", `${feeConfig.flatFees.creatorFeeBps.toString()} bps`);
  row("LP", `${feeConfig.flatFees.lpFeeBps.toString()} bps`);
  console.log("\nflatFees is a separate field the fee program uses for flows that");
  console.log("are not priced off a bonding curve market cap. Bonding curve quotes");
  console.log("go through the tier list; passing feeConfig: null instead falls back");
  console.log("to the Global account's own rates, not to this field.");

  heading("Using it");
  console.log("Fetch this account once per quote cycle and pass it into");
  console.log("getBuyTokenAmountFromSolAmount and getSellSolAmountFromTokenAmount.");
  console.log("Example 17 walks the tier selection itself; example 22 covers the");
  console.log("Global fallback rates.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
