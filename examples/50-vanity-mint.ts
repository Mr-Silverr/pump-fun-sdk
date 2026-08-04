/**
 * Example 50: Vanity Mints
 *
 * Category: AMM & Advanced
 *
 * Grinds keypairs until one lands a chosen suffix, on a bounded attempt
 * budget so the run finishes in seconds, then feeds the winner straight into
 * createV2Instruction. Shows how the cost of a pattern scales, and how the
 * SDK refuses patterns that can never match.
 *
 * Run: npm run example 50
 */
import {
  PUMP_SDK,
  BASE58_ALPHABET,
  MAX_VANITY_PATTERN_LENGTH,
  VanityMintMaxAttemptsError,
  VanityMintPatternError,
  estimateVanityMintAttempts,
  generateVanityMint,
  bondingCurvePda,
} from "@nirholas/pump-sdk";

import { heading, row } from "./_lib/format";
import { loadWallet } from "./_lib/wallet";

/** The pattern a grind is searching for. */
export interface VanityPattern {
  prefix?: string;
  suffix?: string;
  caseInsensitive?: boolean;
}

/**
 * The predicate the grind is testing, extracted.
 *
 * `generateVanityMint` applies exactly this test to every generated address:
 * case folding first when requested, then a prefix and suffix check. Having
 * it as a function means a found keypair can be verified independently of the
 * loop that produced it.
 */
export function matchesVanityPattern(
  address: string,
  pattern: VanityPattern,
): boolean {
  const fold = (value: string) =>
    pattern.caseInsensitive === true ? value.toLowerCase() : value;
  const candidate = fold(address);
  const prefixOk =
    pattern.prefix === undefined ||
    pattern.prefix === "" ||
    candidate.startsWith(fold(pattern.prefix));
  const suffixOk =
    pattern.suffix === undefined ||
    pattern.suffix === "" ||
    candidate.endsWith(fold(pattern.suffix));
  return prefixOk && suffixOk;
}

/** Characters that can never appear in a Solana address. */
export function unmatchableCharacters(pattern: string): string[] {
  const alphabet = new Set(BASE58_ALPHABET);
  return [...pattern].filter((char) => !alphabet.has(char));
}

/**
 * Expected wall-clock seconds for a pattern at a measured grind rate.
 *
 * The estimate is a mean, not a bound: keypair generation is memoryless, so
 * an individual grind can take several times this or finish immediately.
 */
export function estimateSeconds(
  pattern: VanityPattern,
  attemptsPerSecond: number,
): number {
  if (attemptsPerSecond <= 0) return Infinity;
  return estimateVanityMintAttempts(pattern) / attemptsPerSecond;
}

export async function main(): Promise<void> {
  const wallet = loadWallet();

  heading("What a pattern costs");
  row("Base58 alphabet size", BASE58_ALPHABET.length);
  row("Max pattern length", MAX_VANITY_PATTERN_LENGTH);
  for (const suffix of ["w", "ws", "pump", "wswsw"]) {
    row(
      `suffix "${suffix}"`,
      `${estimateVanityMintAttempts({ suffix }).toLocaleString()} attempts (mean)`,
    );
  }
  console.log(
    "\nEach extra character multiplies the work by 58. Node handles two or",
  );
  console.log(
    "three characters comfortably; past that, use the Rust generator in",
  );
  console.log("rust/, which grinds several orders of magnitude faster.");

  heading("Grinding a two-character suffix");
  const pattern: VanityPattern = { suffix: "ws" };
  const budget = 400_000;
  row("Pattern", `suffix "${String(pattern.suffix)}"`);
  row("Attempt budget", budget.toLocaleString());
  let lastRate = 0;
  const result = await generateVanityMint({
    ...pattern,
    maxAttempts: budget,
    onProgress: ({ attempts, attemptsPerSecond }) => {
      lastRate = attemptsPerSecond;
      row(
        `  ${attempts.toLocaleString()} attempts`,
        `${Math.round(attemptsPerSecond).toLocaleString()} keys/sec`,
      );
    },
  });
  const address = result.keypair.publicKey.toBase58();
  const rate = result.durationMs > 0
    ? Math.round((result.attempts / result.durationMs) * 1000)
    : lastRate;
  row("Found", address);
  row("Attempts", result.attempts.toLocaleString());
  row("Duration", `${result.durationMs} ms`);
  row("Rate", `${rate.toLocaleString()} keys/sec`);
  row("Matches pattern", matchesVanityPattern(address, pattern));
  row(
    "Estimated seconds for \"pump\"",
    estimateSeconds({ suffix: "pump" }, rate).toFixed(1),
  );

  heading("Launching with the grinded mint");
  const ix = await PUMP_SDK.createV2Instruction({
    mint: result.keypair.publicKey,
    name: "Vanity Example",
    symbol: "VNTY",
    uri: "https://example.com/metadata.json",
    creator: wallet.publicKey,
    user: wallet.publicKey,
    mayhemMode: false,
  });
  row("Program", ix.programId.toBase58());
  row("Accounts", ix.keys.length);
  row("Data bytes", ix.data.length);
  row("Bonding curve PDA", bondingCurvePda(result.keypair.publicKey).toBase58());
  console.log(
    "\nThe suffix is cosmetic: a grinded mint is an ordinary keypair and the",
  );
  console.log(
    "create instruction is byte-identical to one built from Keypair.generate.",
  );
  console.log("It signs the launch transaction alongside the wallet.");

  heading("Patterns that can never match");
  for (const bad of ["p0mp", "pOmp", "pImp", "pllp"]) {
    const invalid = unmatchableCharacters(bad);
    const rejection = await generateVanityMint({
      suffix: bad,
      maxAttempts: 1,
    }).then(
      () => "ACCEPTED (unexpected)",
      (error: unknown) =>
        error instanceof VanityMintPatternError
          ? error.type
          : error instanceof Error
            ? error.constructor.name
            : String(error),
    );
    row(`suffix "${bad}"`, `${rejection} (bad chars: ${invalid.join("")})`);
  }
  console.log(
    "\nBase58 omits 0, O, I and l so addresses cannot be misread. A pattern",
  );
  console.log(
    "containing one has zero probability, and the SDK rejects it up front",
  );
  console.log("rather than grinding forever.");

  heading("Exhausting a budget");
  const exhausted = await generateVanityMint({
    suffix: "pump",
    maxAttempts: 5_000,
  }).then(
    () => "found (lucky)",
    (error: unknown) =>
      error instanceof VanityMintMaxAttemptsError
        ? `${error.name} after ${error.attempts.toLocaleString()} attempts`
        : String(error),
  );
  row("suffix \"pump\", 5,000 budget", exhausted);
  console.log(
    "\nA four-character suffix averages over eleven million attempts, so a",
  );
  console.log(
    "small budget almost always ends here. Always set maxAttempts in a",
  );
  console.log("request path, or pass an AbortSignal so the caller can cancel.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
