/**
 * Example 29: Fee Sharing Configs
 *
 * Category: Accounts & Events
 *
 * Scans live bonding curves for one whose creator address IS a fee sharing
 * config PDA, decodes that config, and reports whether its split can still
 * be edited. Also mirrors the SDK's shareholder rules exactly, including the
 * ten-shareholder ceiling and the 10,000 bps total, so bad splits are caught
 * before a transaction is built.
 *
 * Run: npm run example 29
 */
import {
  MAX_SHAREHOLDERS,
  Platform,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  bondingCurvePda,
  feeSharingConfigPda,
  isCreatorUsingSharingConfig,
  isSharingConfigEditable,
  normalizeSocialShareholders,
  type SharingConfig,
  type Shareholder,
  type SocialShareholderInput,
} from "@nirholas/pump-sdk";
import { PublicKey } from "@solana/web3.js";

import { getConnection } from "./_lib/connection";
import { collectStreamMints } from "./_lib/discovery";
import { heading, row } from "./_lib/format";
import { withRpcRetry } from "./25-decode-pool";

/** Shareholder splits must total exactly this many basis points. */
export const TOTAL_SHARE_BPS = 10_000;

/** How many curve candidates to probe before giving up on finding a config. */
const CANDIDATE_LIMIT = 8;

export interface ShareholderValidation {
  valid: boolean;
  /** One message per rule broken, in the order the SDK checks them. */
  errors: string[];
  totalBps: number;
}

/**
 * Check a shareholder list against the rules `PumpSdk.updateFeeShares`
 * enforces before it will build an instruction.
 *
 * The SDK throws on the first violation it meets, which is right for a
 * builder and wrong for a form: this returns every violation at once, in
 * the same order, so a UI can show all of them. The rules themselves are
 * not restated from the docs, they are the five checks in the instruction
 * builder: non-empty, at most MAX_SHAREHOLDERS (10), every share positive,
 * exactly 10,000 bps in total, and no repeated address.
 */
export function validateShareholders(
  shareholders: readonly Shareholder[],
): ShareholderValidation {
  const errors: string[] = [];

  if (shareholders.length === 0) {
    errors.push("NoShareholdersError: at least one shareholder is required");
  }
  if (shareholders.length > MAX_SHAREHOLDERS) {
    errors.push(
      `TooManyShareholdersError: ${shareholders.length} shareholders, the maximum is ${MAX_SHAREHOLDERS}`,
    );
  }

  let totalBps = 0;
  const addresses = new Set<string>();
  for (const shareholder of shareholders) {
    if (shareholder.shareBps <= 0) {
      errors.push(
        `ZeroShareError: ${shareholder.address.toBase58()} has a share of ${shareholder.shareBps} bps`,
      );
    }
    totalBps += shareholder.shareBps;
    addresses.add(shareholder.address.toBase58());
  }

  if (shareholders.length > 0 && totalBps !== TOTAL_SHARE_BPS) {
    errors.push(
      `InvalidShareTotalError: shares total ${totalBps} bps, they must total ${TOTAL_SHARE_BPS}`,
    );
  }
  if (addresses.size !== shareholders.length) {
    errors.push("DuplicateShareholderError: an address appears more than once");
  }

  return { valid: errors.length === 0, errors, totalBps };
}

/**
 * Resolve social handles to their on-chain PDAs, then validate the result.
 *
 * `normalizeSocialShareholders` turns a mixed list of wallets and social
 * handles into plain shareholders and tells you which social PDAs do not
 * exist yet. Those PDAs have to be created in the same transaction, before
 * the update instruction, or the update fails on a missing account.
 */
export function resolveShareholders(
  newShareholders: SocialShareholderInput[],
): {
  shareholders: Shareholder[];
  pdasToCreate: Array<{ address: string; userId: string; platform: number }>;
  validation: ShareholderValidation;
} {
  const { normalizedShareholders, socialRecipientsToCreate } =
    normalizeSocialShareholders({ newShareholders });

  return {
    shareholders: normalizedShareholders,
    pdasToCreate: [...socialRecipientsToCreate.entries()].map(
      ([address, recipient]) => ({
        address,
        userId: recipient.userId,
        platform: recipient.platform,
      }),
    ),
    validation: validateShareholders(normalizedShareholders),
  };
}

export interface SharingConfigView {
  version: number;
  mint: string;
  admin: string;
  adminRevoked: boolean;
  /** The split can still be changed by the admin. */
  editable: boolean;
  shareholderCount: number;
  totalBps: number;
  /** Shares sorted largest first, with a percent rendering. */
  shares: Array<{ address: string; shareBps: number; percent: string }>;
  /** Free shareholder slots left under the ceiling. */
  slotsRemaining: number;
}

/** Read a decoded sharing config into a shape worth printing. Pure. */
export function describeSharingConfig(
  config: SharingConfig,
): SharingConfigView {
  const shares = [...config.shareholders]
    .sort((a, b) => b.shareBps - a.shareBps)
    .map((shareholder) => ({
      address: shareholder.address.toBase58(),
      shareBps: shareholder.shareBps,
      percent: `${(shareholder.shareBps / 100).toFixed(2)}%`,
    }));

  return {
    version: config.version,
    mint: config.mint.toBase58(),
    admin: config.admin.toBase58(),
    adminRevoked: config.adminRevoked,
    editable: isSharingConfigEditable({ sharingConfig: config }),
    shareholderCount: config.shareholders.length,
    totalBps: config.shareholders.reduce((sum, s) => sum + s.shareBps, 0),
    shares,
    slotsRemaining: MAX_SHAREHOLDERS - config.shareholders.length,
  };
}

export async function main(): Promise<void> {
  const connection = getConnection();

  heading("The rules");
  row("Maximum shareholders", MAX_SHAREHOLDERS);
  row("Required total", `${TOTAL_SHARE_BPS} bps`);
  console.log(
    "A creator that has migrated to fee sharing no longer holds its own",
  );
  console.log(
    "creator address: the bonding curve's `creator` field becomes the fee",
  );
  console.log(
    "sharing config PDA, which is exactly what isCreatorUsingSharingConfig",
  );
  console.log("checks.");

  heading("Scanning live curves for a fee sharing config");
  const override = process.env.MINT;
  const candidates = override
    ? [new PublicKey(override)]
    : (await collectStreamMints(connection, ["trade", "create"], CANDIDATE_LIMIT))
        .map((entry) => entry.mint);
  row("Candidate mints", candidates.length);

  // One RPC call for every candidate curve.
  const curveInfos = await withRpcRetry("bonding curves", () =>
    connection.getMultipleAccountsInfo(candidates.map(bondingCurvePda)),
  );

  let sharingMint: PublicKey | null = null;
  let checked = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    const info = curveInfos[i];
    const mint = candidates[i];
    if (!info || !mint || !info.owner.equals(PUMP_PROGRAM_ID)) continue;
    const curve = PUMP_SDK.decodeBondingCurveNullable(info);
    if (!curve) continue;
    checked += 1;
    if (isCreatorUsingSharingConfig({ mint, creator: curve.creator })) {
      sharingMint = mint;
      break;
    }
  }
  row("Curves decoded", checked);

  if (!sharingMint) {
    console.log(
      "\nNone of the sampled live curves routes creator fees through a sharing",
    );
    console.log(
      "config: most coins keep a plain creator wallet. Re-run to sample a",
    );
    console.log(
      "fresh batch, or pass MINT=<mint> for a coin you know has one.",
    );
  } else {
    const configPda = feeSharingConfigPda(sharingMint);
    heading("decodeSharingConfig");
    row("Mint", sharingMint.toBase58());
    row("Config PDA", configPda.toBase58());

    const info = await withRpcRetry("sharing config", () =>
      connection.getAccountInfo(configPda),
    );
    if (!info) {
      throw new Error(
        `Curve creator is ${configPda.toBase58()} but that account does not exist`,
      );
    }

    const view = describeSharingConfig(PUMP_SDK.decodeSharingConfig(info));
    row("Version", view.version);
    row("Admin", view.admin);
    row("Admin revoked", view.adminRevoked);
    row("Editable", view.editable);
    row("Shareholders", `${view.shareholderCount} (${view.slotsRemaining} slots left)`);
    row("Total", `${view.totalBps} bps`);
    for (const share of view.shares) {
      row(`  ${share.percent}`, share.address);
    }
    console.log(
      view.editable
        ? "\nThe admin can still call updateFeeShares on this config."
        : "\nThis split is frozen: version 1 configs are immutable, and a version 2 config is frozen once its admin is revoked.",
    );
  }

  heading("Validating a split before building an instruction");
  // Two distinct, obviously synthetic addresses to demonstrate the rules.
  const alice = PublicKey.default;
  const bob = PUMP_PROGRAM_ID;
  const good = validateShareholders([
    { address: alice, shareBps: 7_000 },
    { address: bob, shareBps: 3_000 },
  ]);
  row("70/30 split valid", `${good.valid} (${good.totalBps} bps)`);

  const bad = validateShareholders([
    { address: alice, shareBps: 7_000 },
    { address: alice, shareBps: 2_000 },
  ]);
  row("Duplicate + short split", bad.valid);
  for (const error of bad.errors) row("  error", error);

  heading("Social shareholders");
  const inputs: SocialShareholderInput[] = [
    { address: alice, shareBps: 6_000 },
    { userId: "1", platform: Platform.GitHub, shareBps: 4_000 },
  ];
  const resolved = resolveShareholders(inputs);
  row("Resolved shareholders", resolved.shareholders.length);
  row("Valid", resolved.validation.valid);
  for (const pda of resolved.pdasToCreate) {
    row("  PDA to create first", `${pda.address} (user ${pda.userId})`);
  }
  console.log(
    "\nA social recipient is a PDA derived from the platform user id. Create",
  );
  console.log(
    "it in the same transaction, ahead of the update, or the instruction",
  );
  console.log("lands on an account that does not exist yet.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
