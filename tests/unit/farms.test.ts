import { describe, expect, it } from "vitest";
import {
  priceAtTick,
  simulateFullRange,
  simulateImpermanentLoss,
  simulateRange,
  type FarmOpportunity,
} from "@/src/domain/farms";

const farm: FarmOpportunity = {
  poolAddress: "0x1111111111111111111111111111111111111111",
  token0: {
    address: "0x2222222222222222222222222222222222222222",
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
    totalSupply: "0",
    priceUsd: 1800,
  },
  token1: {
    address: "0x3333333333333333333333333333333333333333",
    name: "Dollar",
    symbol: "USDG",
    decimals: 6,
    totalSupply: "0",
    priceUsd: 1,
  },
  fee: 500,
  feePercent: 0.05,
  tickSpacing: 10,
  tick: -201500,
  sqrtPriceX96: "0",
  liquidity: "500000000000000000",
  reserve0: 1000,
  reserve1: 1_800_000,
  priceToken1PerToken0: priceAtTick(-201500, 18, 6),
  tvlUsd: 3_600_000,
  volume24hProjectedUsd: 10_000_000,
  fees24hProjectedUsd: 5_000,
  projectedPoolApr: 50.69,
  priceChangePercent: 1,
  swapsInWindow: 100,
  sampleMinutes: 30,
  sampledTicks: [-202000, -201800, -201500, -201200, -201000],
  activityScore: 100,
  risk: "LOW",
  riskReasons: [],
  updatedAt: new Date(0).toISOString(),
  blockNumber: "1",
};

describe("farm range simulation", () => {
  it("converts V3 ticks into decimal-aware pair prices", () => {
    expect(priceAtTick(-201500, 18, 6)).toBeGreaterThan(1_000);
    expect(priceAtTick(-201500, 18, 6)).toBeLessThan(3_000);
  });

  it("aligns ranges and allocates the full deposit", () => {
    const result = simulateRange(farm, 10_000, 10, 10);
    expect(Math.abs(result.tickLower % farm.tickSpacing)).toBe(0);
    expect(Math.abs(result.tickUpper % farm.tickSpacing)).toBe(0);
    expect(result.tickLower).toBeLessThan(farm.tick);
    expect(result.tickUpper).toBeGreaterThan(farm.tick);
    const value =
      result.amount0 * farm.token0.priceUsd! +
      result.amount1 * farm.token1.priceUsd!;
    expect(value).toBeCloseTo(10_000, 4);
    expect(result.estimatedApr).toBeGreaterThan(0);
  });

  it("makes a tighter range more capital efficient", () => {
    const tight = simulateRange(farm, 5_000, 2, 2);
    const wide = simulateRange(farm, 5_000, 30, 30);
    expect(tight.capitalEfficiency).toBeGreaterThan(wide.capitalEfficiency);
    expect(tight.positionLiquidity).toBeGreaterThan(wide.positionLiquidity);
    expect(tight.estimatedApr).toBeGreaterThan(wide.estimatedApr!);
  });

  it("uses the widest valid tick-aligned bounds for full range", () => {
    const result = simulateFullRange(farm, 5_000);
    expect(result.tickLower).toBe(-887270);
    expect(result.tickUpper).toBe(887270);
    expect(Math.abs(result.tickLower % farm.tickSpacing)).toBe(0);
    expect(Math.abs(result.tickUpper % farm.tickSpacing)).toBe(0);
    expect(result.capitalEfficiency).toBeCloseTo(1, 3);
  });

  it("compares a future concentrated position with holding the initial tokens", () => {
    const range = simulateRange(farm, 10_000, 15, 15);
    const unchanged = simulateImpermanentLoss(farm, range, 0);
    const moved = simulateImpermanentLoss(farm, range, 50);

    expect(unchanged).not.toBeNull();
    expect(unchanged!.positionValueUsd).toBeCloseTo(unchanged!.holdValueUsd, 6);
    expect(unchanged!.impermanentLossPercent).toBeCloseTo(0, 6);
    expect(moved).not.toBeNull();
    expect(moved!.futurePrice).toBeCloseTo(farm.priceToken1PerToken0 * 1.5, 6);
    expect(moved!.impermanentLossPercent).toBeLessThan(0);
  });
});
