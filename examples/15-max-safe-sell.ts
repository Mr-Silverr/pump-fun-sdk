/**
 * Example 15: The u64 Sell Overflow Guard
 *
 * Category: Curve Math & Fees
 *
 * Demonstrates maxSafeSellAmount and validateSellAmount, the pre-flight
 * checks that keep a sell's amount * virtualSolReserves multiply inside
 * u64 so the on-chain program never aborts with AnchorError 6024
 * (Overflow). Shows the exact arithmetic behind the limit and how to
 * recover from a rejected sell.
 *
 * Run: npm run example 15
 */
import {
  SellOverflowError,
  maxSafeSellAmount,
  validateSellAmount,
} from "@nirholas/pump-sdk";
import BN from "bn.js";

import type { BondingCurve } from "@nirholas/pump-sdk";

import { curveAtVirtualSol, launchBondingCurve, mainnetGlobal } from "./_lib/curveState";
import { formatSol, formatTokens, heading, row } from "./_lib/format";

/** u64::MAX, the bound the deployed program's sell multiply must respect. */
export const U64_MAX = new BN("18446744073709551615");

export interface SellSafetyCheck {
  amount: BN;
  /** amount * virtualSolReserves, the on-chain intermediate product. */
  product: BN;
  /** Largest amount the SDK will let through for these reserves. */
  maxSafeAmount: BN;
  safe: boolean;
  /** Present when the check failed; the SDK's structured error. */
  error?: SellOverflowError;
}

/**
 * Run the SDK's pre-flight sell validation and report every number
 * involved, instead of letting the transaction abort on-chain.
 */
export function checkSellSafety(
  bondingCurve: BondingCurve,
  amount: BN,
): SellSafetyCheck {
  const result: SellSafetyCheck = {
    amount,
    product: amount.mul(bondingCurve.virtualSolReserves),
    maxSafeAmount: maxSafeSellAmount(bondingCurve.virtualSolReserves),
    safe: true,
  };
  try {
    validateSellAmount(amount, bondingCurve);
  } catch (err) {
    if (err instanceof SellOverflowError) {
      result.safe = false;
      result.error = err;
      return result;
    }
    throw err;
  }
  return result;
}

export async function main(): Promise<void> {
  const global = mainnetGlobal();

  heading("Why the guard exists");
  console.log("The sell formula multiplies amount * virtualSolReserves before");
  console.log("dividing. On-chain that intermediate product is a u64; past");
  console.log(`${U64_MAX.toString()} it overflows and the program aborts with`);
  console.log("AnchorError 6024. The SDK refuses such sells before any tokens move.");

  heading("The limit formula");
  console.log("maxSafeSellAmount = floor(0.9 * u64::MAX / virtualSolReserves)");
  console.log("The 10% margin absorbs reserve drift between quote and execution.");

  heading("Limit at launch reserves (30 SOL)");
  const launch = launchBondingCurve();
  const launchLimit = maxSafeSellAmount(launch.virtualSolReserves);
  row("Virtual SOL reserves", formatSol(launch.virtualSolReserves));
  row("Max safe sell", `${launchLimit.toString()} base units (${formatTokens(launchLimit, 2)})`);
  row("Product at the limit", launchLimit.mul(launch.virtualSolReserves).toString());
  row("u64::MAX", U64_MAX.toString());

  heading("Limit shrinks as reserves grow");
  for (const vSol of [
    new BN("30000000000"), // 30 SOL
    new BN("60000000000"), // 60 SOL
    new BN("115000000000"), // ~graduation
  ]) {
    row(formatSol(vSol, 0), formatTokens(maxSafeSellAmount(vSol), 2));
  }

  heading("A safe sell passes");
  const mid = curveAtVirtualSol(global, new BN("60000000000"));
  const safeAmount = maxSafeSellAmount(mid.virtualSolReserves).divn(2);
  const ok = checkSellSafety(mid, safeAmount);
  row("Amount", formatTokens(ok.amount, 2));
  row("Product", ok.product.toString());
  row("Safe", ok.safe);

  heading("An oversized sell is rejected with full context");
  const oversized = checkSellSafety(mid, new BN("6325344957752")); // the issue #6 amount
  row("Amount", formatTokens(oversized.amount, 0));
  row("Product", oversized.product.toString());
  row("Exceeds u64::MAX", oversized.product.gt(U64_MAX));
  row("Safe", oversized.safe);
  if (oversized.error) {
    row("Error class", oversized.error.constructor.name);
    row("Error max safe amount", formatTokens(oversized.error.maxSafeAmount, 2));
  }
  console.log(
    "\nSellOverflowError carries the amount, the reserves, and the safe",
  );
  console.log(
    "maximum, so callers can split the sell into chunks at or below the",
  );
  console.log("limit instead of burning a transaction fee on a guaranteed abort.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
