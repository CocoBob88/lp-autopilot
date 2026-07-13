import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  Q96,
  alignTick,
  amountsForLiquidity,
  applySlippage,
  priceAtTick,
  rangeState,
  sqrtRatioAtTick,
} from "@/src/domain/liquidity-math";

describe("Uniswap V3 math", () => {
  it("matches the canonical ratio at tick zero", () =>
    expect(sqrtRatioAtTick(0)).toBe(Q96));
  it("allocates only token0 below range and only token1 above range", () => {
    const liquidity = 1_000_000_000_000n;
    expect(
      amountsForLiquidity(sqrtRatioAtTick(-200), -100, 100, liquidity).amount1,
    ).toBe(0n);
    expect(
      amountsForLiquidity(sqrtRatioAtTick(200), -100, 100, liquidity).amount0,
    ).toBe(0n);
  });
  it("allocates both sides inside the range", () => {
    const result = amountsForLiquidity(Q96, -100, 100, 1_000_000_000_000n);
    expect(result.amount0).toBeGreaterThan(0n);
    expect(result.amount1).toBeGreaterThan(0n);
  });
  it("uses token1-per-token0 decimal orientation", () => {
    expect(priceAtTick(0, 18, 6)).toBe(1e12);
    expect(priceAtTick(0, 6, 18)).toBe(1e-12);
  });
  it("uses a half-open active range", () => {
    expect(rangeState(0, 0, 100)).not.toBe("OUT_OF_RANGE");
    expect(rangeState(100, 0, 100)).toBe("OUT_OF_RANGE");
  });
  it("rounds slippage down conservatively", () =>
    expect(applySlippage(101n, 100)).toBe(99n));
  it("aligns negative ticks correctly", () => {
    expect(alignTick(-1, 200, "down")).toBe(-200);
    expect(alignTick(-1, 200, "up")).toBe(0);
  });
  it("is monotonic over fuzzed ticks", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: -887271, max: 887271 }),
        (tick) => sqrtRatioAtTick(tick + 1) > sqrtRatioAtTick(tick),
      ),
      { numRuns: 1_000 },
    ));
  it("never returns negative amounts for fuzzed ranges", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: -800000, max: 799000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.bigInt({ min: 0n, max: (1n << 128n) - 1n }),
        (lower, width, liquidity) => {
          const upper = Math.min(887272, lower + width);
          const current = Math.floor((lower + upper) / 2);
          const result = amountsForLiquidity(
            sqrtRatioAtTick(current),
            lower,
            upper,
            liquidity,
          );
          return result.amount0 >= 0n && result.amount1 >= 0n;
        },
      ),
      { numRuns: 2_000 },
    ));
});
