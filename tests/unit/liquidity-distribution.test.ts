import { describe, expect, it } from "vitest";
import { reconstructLiquidityDistribution } from "@/src/domain/farms";

describe("liquidity distribution reconstruction", () => {
  it("applies liquidityNet on the correct side of each initialized tick", () => {
    const points = reconstructLiquidityDistribution(
      [
        { tick: 0, liquidityGross: 40n, liquidityNet: 40n },
        { tick: 10, liquidityGross: 40n, liquidityNet: -40n },
      ],
      5,
      100n,
      5,
      18,
      18,
    );

    expect(points.map(({ tick, liquidity }) => [tick, liquidity])).toEqual([
      [-5, 60],
      [0, 100],
      [5, 100],
      [10, 60],
      [15, 60],
    ]);
    expect(points.find((point) => point.tick === 0)?.liquidityNet).toBe("40");
    expect(points.find((point) => point.tick === 10)?.liquidityNet).toBe("-40");
  });

  it("keeps the current active liquidity visible without initialized ticks", () => {
    const points = reconstructLiquidityDistribution([], 20, 75n, 10, 18, 6);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ tick: 20, liquidity: 75 });
  });
});
