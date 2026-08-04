/**
 * Example 31: Fetch Global State
 *
 * Category: Live Data
 *
 * Reads the two accounts that price every Pump launch: the program's Global
 * account and the tiered FeeConfig. Then it diffs the live launch parameters
 * against the documented mainnet defaults, so a changed reserve or fee rate
 * shows up as drift instead of quietly moving every quote in your app.
 *
 * Run: npm run example 31
 */
import { OnlinePumpSdk, calculateFeeTier, type FeeConfig, type Global } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { getConnection } from "./_lib/connection";
import { mainnetGlobal } from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { withRpcRetry } from "./25-decode-pool";

/** One documented parameter, checked against the live account. */
export interface ParameterDrift {
  field: string;
  documented: string;
  live: string;
  matches: boolean;
}

/**
 * The launch parameters this SDK's offline math assumes, as a Global.
 *
 * `mainnetGlobal()` in `_lib/curveState` is the single place these numbers
 * live: the same values the offline curve examples and the SDK unit fixtures
 * use. Diffing against it is therefore a real check that the offline math
 * still describes mainnet, not a restatement of the docs.
 */
export function documentedGlobal(): Global {
  return mainnetGlobal();
}

function bnField(
  field: string,
  documented: BN,
  live: BN,
  render: (value: BN) => string,
): ParameterDrift {
  return {
    field,
    documented: render(documented),
    live: render(live),
    matches: documented.eq(live),
  };
}

/**
 * Compare a live Global against the documented launch parameters. Pure.
 *
 * Every curve quote in the SDK is a function of these numbers, so a drift
 * here is not cosmetic: it changes graduation SOL, market cap at launch, and
 * the fee every trade pays.
 */
export function compareToDefaults(global: Global): ParameterDrift[] {
  const reference = documentedGlobal();
  const tokens = (value: BN) => formatTokens(value, 0);
  const sol = (value: BN) => formatSol(value, 4);
  const bps = (value: BN) => `${value.toString()} bps`;

  return [
    bnField(
      "initialVirtualTokenReserves",
      reference.initialVirtualTokenReserves,
      global.initialVirtualTokenReserves,
      tokens,
    ),
    bnField(
      "initialVirtualSolReserves",
      reference.initialVirtualSolReserves,
      global.initialVirtualSolReserves,
      sol,
    ),
    bnField(
      "initialRealTokenReserves",
      reference.initialRealTokenReserves,
      global.initialRealTokenReserves,
      tokens,
    ),
    bnField(
      "tokenTotalSupply",
      reference.tokenTotalSupply,
      global.tokenTotalSupply,
      tokens,
    ),
    bnField("feeBasisPoints", reference.feeBasisPoints, global.feeBasisPoints, bps),
    bnField(
      "creatorFeeBasisPoints",
      reference.creatorFeeBasisPoints,
      global.creatorFeeBasisPoints,
      bps,
    ),
    bnField(
      "poolMigrationFee",
      reference.poolMigrationFee,
      global.poolMigrationFee,
      sol,
    ),
    {
      field: "createV2Enabled",
      documented: String(reference.createV2Enabled),
      live: String(global.createV2Enabled),
      matches: reference.createV2Enabled === global.createV2Enabled,
    },
    {
      field: "enableMigrate",
      documented: String(reference.enableMigrate),
      live: String(global.enableMigrate),
      matches: reference.enableMigrate === global.enableMigrate,
    },
    {
      field: "mayhemModeEnabled",
      documented: String(reference.mayhemModeEnabled),
      live: String(global.mayhemModeEnabled),
      matches: reference.mayhemModeEnabled === global.mayhemModeEnabled,
    },
  ];
}

/** Fee tier rows, cheapest threshold first, rendered for printing. Pure. */
export function describeFeeTiers(
  feeConfig: FeeConfig,
): Array<{ threshold: string; protocolFeeBps: string; creatorFeeBps: string; lpFeeBps: string }> {
  return [...feeConfig.feeTiers]
    .sort((a, b) =>
      a.marketCapLamportsThreshold.cmp(b.marketCapLamportsThreshold),
    )
    .map((tier) => ({
      threshold: formatSol(tier.marketCapLamportsThreshold, 2),
      protocolFeeBps: tier.fees.protocolFeeBps.toString(),
      creatorFeeBps: tier.fees.creatorFeeBps.toString(),
      lpFeeBps: tier.fees.lpFeeBps.toString(),
    }));
}

export async function main(): Promise<void> {
  const connection = getConnection();
  const online = new OnlinePumpSdk(connection);

  heading("Fetching");
  const global = await withRpcRetry("fetchGlobal", () => online.fetchGlobal());
  const feeConfig = await withRpcRetry("fetchFeeConfig", () =>
    online.fetchFeeConfig(),
  );
  row("Global initialized", global.initialized);
  row("Fee config admin", feeConfig.admin.toBase58());

  heading("Global account");
  row("Authority", global.authority.toBase58());
  row("Fee recipient", global.feeRecipient.toBase58());
  row("Fee recipients", global.feeRecipients.length);
  row("Reserved fee recipients", global.reservedFeeRecipients.length);
  row("Withdraw authority", global.withdrawAuthority.toBase58());
  row("Set creator authority", global.setCreatorAuthority.toBase58());
  row("Initial virtual SOL", formatSol(global.initialVirtualSolReserves, 2));
  row("Initial virtual tokens", formatTokens(global.initialVirtualTokenReserves, 0));
  row("Initial real tokens", formatTokens(global.initialRealTokenReserves, 0));
  row("Token total supply", formatTokens(global.tokenTotalSupply, 0));

  heading("Drift from the documented launch parameters");
  const drift = compareToDefaults(global);
  for (const item of drift) {
    row(
      item.field,
      item.matches
        ? `${item.live} (as documented)`
        : `${item.live} (documented ${item.documented})`,
    );
  }
  const changed = drift.filter((item) => !item.matches);
  console.log(
    changed.length === 0
      ? "\nEvery launch parameter matches the documented defaults, so the offline curve examples model mainnet exactly."
      : `\n${changed.length} parameter(s) drifted. The offline curve math in examples 11 to 20 assumes the documented values, so update _lib/curveState before trusting an offline quote.`,
  );

  heading("Fee tiers (FeeConfig)");
  row("Flat protocol fee", `${feeConfig.flatFees.protocolFeeBps.toString()} bps`);
  row("Flat creator fee", `${feeConfig.flatFees.creatorFeeBps.toString()} bps`);
  row("Tiers", feeConfig.feeTiers.length);
  for (const tier of describeFeeTiers(feeConfig)) {
    row(
      `  above ${tier.threshold}`,
      `protocol ${tier.protocolFeeBps} bps, creator ${tier.creatorFeeBps} bps, lp ${tier.lpFeeBps} bps`,
    );
  }

  heading("Which tier a launch starts in");
  const launchMarketCap = global.initialVirtualSolReserves
    .mul(global.tokenTotalSupply)
    .div(global.initialVirtualTokenReserves);
  const tier = calculateFeeTier({
    feeTiers: feeConfig.feeTiers,
    marketCap: launchMarketCap,
  });
  row("Market cap at launch", formatSol(launchMarketCap, 2));
  row("Protocol fee", `${tier.protocolFeeBps.toString()} bps`);
  row("Creator fee", `${tier.creatorFeeBps.toString()} bps`);
  console.log(
    "\nFees step DOWN as market cap grows, so the first buyers of a coin pay",
  );
  console.log(
    "the highest rate. calculateFeeTier picks the row, computeFeesBps applies",
  );
  console.log("it, and every bonding curve quote in the SDK goes through both.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
