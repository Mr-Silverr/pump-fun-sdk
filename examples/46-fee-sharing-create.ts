/**
 * Example 46: Fee Sharing, Creating the Split
 *
 * Category: AMM & Advanced
 *
 * Creates a fee sharing config for a token and sets a multi-way creator fee
 * split with updateFeeShares, including a shareholder identified by a GitHub
 * handle rather than a wallet. Every split the SDK would reject is built here
 * too, so the invariants are visible rather than implied.
 *
 * Run: npm run example 46
 */
import {
  PUMP_SDK,
  MAX_SHAREHOLDERS,
  Platform,
  canonicalPumpPoolPda,
  feeSharingConfigPda,
  normalizeSocialShareholders,
  platformToString,
  socialFeePda,
  type Shareholder,
} from "@nirholas/pump-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";

import { heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";

/** Total of a proposed split, in basis points. Must be exactly 10,000. */
export function splitTotalBps(shareholders: Shareholder[]): number {
  return shareholders.reduce((total, s) => total + s.shareBps, 0);
}

/**
 * Split 10,000 bps as evenly as possible across addresses.
 *
 * 10,000 does not divide by 3, 6, 7 or 9, so an even split always leaves a
 * remainder. The remainder goes to the first shareholder rather than being
 * dropped, because a split that sums to 9,999 is rejected on chain.
 */
export function evenSplit(addresses: PublicKey[]): Shareholder[] {
  if (addresses.length === 0) {
    throw new Error("An even split needs at least one shareholder");
  }
  if (addresses.length > MAX_SHAREHOLDERS) {
    throw new Error(
      `An even split supports at most ${MAX_SHAREHOLDERS} shareholders`,
    );
  }
  return evenSplitUnchecked(addresses);
}

/**
 * The same even split without the shareholder-count guard, so the
 * over-the-limit case below is a real split the SDK gets to reject on its own
 * terms rather than one this file refuses to build.
 */
export function evenSplitUnchecked(addresses: PublicKey[]): Shareholder[] {
  const each = Math.floor(10_000 / addresses.length);
  const remainder = 10_000 - each * addresses.length;
  return addresses.map((address, i) => ({
    address,
    shareBps: i === 0 ? each + remainder : each,
  }));
}

/** Description of a split the SDK refuses to build an instruction for. */
export interface RejectedSplit {
  label: string;
  shareholders: Shareholder[];
}

/**
 * The four ways a split can be invalid, each as a concrete case.
 *
 * updateFeeShares enforces all of them before it encodes anything, so these
 * never reach the network. `duplicate` reuses the first address on purpose.
 */
export function invalidSplits(addresses: PublicKey[]): RejectedSplit[] {
  const first = addresses[0];
  const second = addresses[1];
  if (!first || !second) {
    throw new Error("Need at least two addresses to build the invalid cases");
  }
  return [
    { label: "empty", shareholders: [] },
    {
      label: "under 10,000 bps",
      shareholders: [
        { address: first, shareBps: 5000 },
        { address: second, shareBps: 4000 },
      ],
    },
    {
      label: "zero share",
      shareholders: [
        { address: first, shareBps: 10_000 },
        { address: second, shareBps: 0 },
      ],
    },
    {
      label: "duplicate address",
      shareholders: [
        { address: first, shareBps: 5000 },
        { address: first, shareBps: 5000 },
      ],
    },
    {
      label: `more than ${MAX_SHAREHOLDERS} shareholders`,
      shareholders: evenSplitUnchecked(
        Array.from({ length: MAX_SHAREHOLDERS + 1 }, () =>
          Keypair.generate().publicKey,
        ),
      ),
    },
  ];
}

export async function main(): Promise<void> {
  const wallet = loadWallet();
  const mint = Keypair.generate().publicKey;
  const partner = Keypair.generate().publicKey;
  const treasury = Keypair.generate().publicKey;

  heading("The config account");
  row("Mint", mint.toBase58());
  row("Creator / authority", wallet.publicKey.toBase58());
  const configPda = feeSharingConfigPda(mint);
  row("Sharing config PDA", configPda.toBase58());
  row("Max shareholders", MAX_SHAREHOLDERS);
  console.log(
    "\nOnce a token has a sharing config, the config PDA becomes the coin",
  );
  console.log(
    "creator: creator fees accrue to it instead of to a wallet, and the",
  );
  console.log("split decides who can pull them out.");

  heading("createFeeSharingConfig (ungraduated token)");
  const createIx = await PUMP_SDK.createFeeSharingConfig({
    creator: wallet.publicKey,
    mint,
    pool: null,
  });
  row("Program", createIx.programId.toBase58());
  row("Accounts", createIx.keys.length);
  row("Data bytes", createIx.data.length);
  console.log(
    "\nPass pool: null before graduation. After graduation, pass the canonical",
  );
  console.log(
    `pool so the AMM vault is wired too: ${canonicalPumpPoolPda(mint).toBase58()}`,
  );

  heading("A three-way even split");
  const split = evenSplit([wallet.publicKey, partner, treasury]);
  for (const shareholder of split) {
    row(
      shareholder.address.toBase58().slice(0, 20),
      `${shareholder.shareBps} bps`,
    );
  }
  row("Total", `${splitTotalBps(split)} bps`);
  const updateIx = await PUMP_SDK.updateFeeShares({
    authority: wallet.publicKey,
    mint,
    currentShareholders: [wallet.publicKey],
    newShareholders: split,
  });
  row("Accounts", updateIx.keys.length);
  row("Data bytes", updateIx.data.length);
  console.log(
    "\ncurrentShareholders becomes the remaining accounts: the program pays",
  );
  console.log(
    "out whatever the old split earned before it writes the new one, so no",
  );
  console.log("shareholder can be edited out of fees they already accrued.");

  heading("A shareholder identified by a GitHub handle");
  const { normalizedShareholders, socialRecipientsToCreate } =
    normalizeSocialShareholders({
      newShareholders: [
        { address: wallet.publicKey, shareBps: 6000 },
        { userId: "octocat", platform: Platform.GitHub, shareBps: 4000 },
      ],
    });
  for (const shareholder of normalizedShareholders) {
    row(shareholder.address.toBase58(), `${shareholder.shareBps} bps`);
  }
  row("Social PDAs to create", socialRecipientsToCreate.size);
  for (const [pda, recipient] of socialRecipientsToCreate) {
    row(`  ${platformToString(recipient.platform)} ${recipient.userId}`, pda);
    row(
      "  derived independently",
      socialFeePda(recipient.userId, recipient.platform).toBase58(),
    );
  }
  console.log(
    "\nA social shareholder is a PDA derived from the handle, so fees can be",
  );
  console.log(
    "assigned to someone who has never connected a wallet. The PDA must exist",
  );
  console.log(
    "before the split references it; createSharingConfigWithSocialRecipients",
  );
  console.log("emits both instructions in the right order.");

  heading("Splits the SDK rejects");
  for (const { label, shareholders } of invalidSplits([partner, treasury])) {
    const rejection = await PUMP_SDK.updateFeeShares({
      authority: wallet.publicKey,
      mint,
      currentShareholders: [wallet.publicKey],
      newShareholders: shareholders,
    }).then(
      () => "ACCEPTED (unexpected)",
      (error: unknown) =>
        error instanceof Error ? error.constructor.name : String(error),
    );
    row(label, rejection);
  }
  console.log(
    "\nAll five fail before any encoding happens, so a bad split costs a",
  );
  console.log("function call rather than a failed transaction.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
