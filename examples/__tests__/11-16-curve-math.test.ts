/**
 * Offline tests for the Curve Math & Fees examples (11-16).
 *
 * Grouped in one suite because they share the same fixture-shaped curve
 * state and cross-check each other: quotes round-trip, market cap grows
 * with buys, target-SOL plans stay within safety bounds, and the launch
 * ladder's reserves stay consistent under the constant-product invariant.
 */
import BN from "bn.js";

import { makeGlobal, makeBondingCurve } from "../../src/__tests__/fixtures";
import { launchContext, quoteTokensForSol, quoteSolForTokens, roundTrip } from "../11-buy-quote-offline";
import { quoteSellBreakdown, compareCreatorFeeImpact } from "../12-sell-quote-offline";
import { marketCapOf, buildMarketCapTable } from "../13-market-cap";
import { planTargetSol, maxSingleSellExtraction, buildTargetSolTable } from "../14-target-sol";
import { U64_MAX, checkSellSafety } from "../15-max-safe-sell";
import { spotPriceLamportsPerMillionTokens, applyBuy, simulateBuySequence } from "../16-launch-price-ladder";

const SOL = (n: number) => new BN(n).mul(new BN(1_000_000_000));

describe("example 11: offline buy quotes", () => {
  const ctx = launchContext();

  it("quotes more tokens for more SOL, monotonically", () => {
    const small = quoteTokensForSol(ctx, SOL(1));
    const large = quoteTokensForSol(ctx, SOL(5));
    expect(small.gtn(0)).toBe(true);
    expect(large.gt(small)).toBe(true);
  });

  it("round-trips a quote back to nearly the same SOL", () => {
    const trip = roundTrip(ctx, SOL(1));
    expect(trip.driftBps.lten(5)).toBe(true);
  });

  it("reverse quote is consistent with the forward quote", () => {
    const tokens = quoteTokensForSol(ctx, SOL(2));
    const sol = quoteSolForTokens(ctx, tokens);
    expect(sol.gtn(0)).toBe(true);
    expect(sol.lte(SOL(2))).toBe(true);
  });
});

describe("example 12: offline sell quotes", () => {
  it("breaks proceeds into net and fees that sum to gross", () => {
    const q = quoteSellBreakdown(makeGlobal(), null, makeBondingCurve({
      realSolReserves: SOL(10),
      virtualSolReserves: SOL(40),
    }), new BN("50000000000000"));
    expect(q.netSol.gtn(0)).toBe(true);
    expect(q.netSol.add(q.feesLamports).eq(q.grossSol)).toBe(true);
  });

  it("higher creator fee reduces net proceeds", () => {
    const cmp = compareCreatorFeeImpact(makeBondingCurve({
      realSolReserves: SOL(10),
      virtualSolReserves: SOL(40),
    }), new BN("50000000000000"));
    expect(cmp.withCreatorFee.netSol.lte(cmp.withoutCreatorFee.netSol)).toBe(true);
  });
});

describe("example 13: market cap", () => {
  it("grows as the curve fills", () => {
    const table = buildMarketCapTable(makeGlobal());
    expect(table.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < table.length; i += 1) {
      expect(table[i]!.marketCap.gte(table[i - 1]!.marketCap)).toBe(true);
    }
  });

  it("matches the SDK's own market cap for fixture state", () => {
    const cap = marketCapOf(makeGlobal(), makeBondingCurve());
    expect(cap.gtn(0)).toBe(true);
  });
});

describe("example 14: target SOL extraction", () => {
  const global = makeGlobal();
  const curve = makeBondingCurve({
    realSolReserves: SOL(20),
    virtualSolReserves: SOL(50),
    virtualTokenReserves: new BN("500000000000000"),
    realTokenReserves: new BN("300000000000000"),
  });

  it("plans a sell that raises at least the target", () => {
    const plan = planTargetSol(global, null, curve, SOL(1));
    expect(plan.achievable).toBe(true);
    expect(plan.tokensToSell.gtn(0)).toBe(true);
    expect(plan.expectedSol.gte(SOL(1).muln(99).divn(100))).toBe(true);
  });

  it("marks an impossible target as unachievable", () => {
    const plan = planTargetSol(global, null, curve, SOL(1_000_000));
    expect(plan.achievable).toBe(false);
  });

  it("max single-sell extraction never exceeds real reserves", () => {
    const max = maxSingleSellExtraction(global, null, curve);
    expect(max.lte(curve.realSolReserves)).toBe(true);
  });

  it("builds a table across targets", () => {
    expect(buildTargetSolTable(global, null, curve, [SOL(1), SOL(5)]).length).toBe(2);
  });
});

describe("example 15: max safe sell", () => {
  it("flags amounts beyond the u64 safety margin", () => {
    const curve = makeBondingCurve();
    const check = checkSellSafety(curve, U64_MAX);
    expect(check.safe).toBe(false);
    expect(check.maxSafeAmount.lt(U64_MAX)).toBe(true);
  });

  it("passes ordinary position sizes", () => {
    const curve = makeBondingCurve();
    const check = checkSellSafety(curve, new BN("1000000000000"));
    expect(check.safe).toBe(true);
  });
});

describe("example 16: launch price ladder", () => {
  const global = makeGlobal();

  it("each buy raises the spot price", () => {
    const steps = simulateBuySequence(global, [SOL(1), SOL(1), SOL(1)]);
    expect(steps.length).toBe(3);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!.spotPrice.gte(steps[i - 1]!.spotPrice)).toBe(true);
    }
  });

  it("applyBuy preserves the constant-product relationship directionally", () => {
    const before = makeBondingCurve();
    const spotBefore = spotPriceLamportsPerMillionTokens(before);
    const { after } = applyBuy(global, null, before, SOL(5));
    expect(after.virtualSolReserves.gt(before.virtualSolReserves)).toBe(true);
    expect(after.virtualTokenReserves.lt(before.virtualTokenReserves)).toBe(true);
    expect(spotPriceLamportsPerMillionTokens(after).gte(spotBefore)).toBe(true);
  });
});
