export type FarmToken = {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  priceUsd: number | null;
};

export type FarmOpportunity = {
  poolAddress: `0x${string}`;
  token0: FarmToken;
  token1: FarmToken;
  fee: number;
  feePercent: number;
  tickSpacing: number;
  tick: number;
  sqrtPriceX96: string;
  liquidity: string;
  reserve0: number;
  reserve1: number;
  priceToken1PerToken0: number;
  tvlUsd: number | null;
  volume24hProjectedUsd: number | null;
  fees24hProjectedUsd: number | null;
  projectedPoolApr: number | null;
  priceChangePercent: number | null;
  swapsInWindow: number;
  sampleMinutes: number;
  sampledTicks: number[];
  activityScore: number;
  risk: "LOW" | "MEDIUM" | "HIGH" | "UNPRICED";
  riskReasons: string[];
  updatedAt: string;
  blockNumber: string;
};

export type FarmScannerResponse = {
  farms: FarmOpportunity[];
  blockNumber: string;
  updatedAt: string;
  refreshAfterSeconds: number;
  sampleMinutes: number;
  source: string;
  query?: string;
};

export type RangeSimulation = {
  tickLower: number;
  tickUpper: number;
  lowerPrice: number;
  upperPrice: number;
  amount0: number;
  amount1: number;
  shareOfActiveLiquidity: number;
  observedRangeActivity: number;
  estimatedAnnualFeesUsd: number | null;
  estimatedApr: number | null;
  capitalEfficiency: number;
};

function alignTick(value: number, spacing: number, direction: "down" | "up") {
  const scaled = value / spacing;
  return (
    (direction === "down" ? Math.floor(scaled) : Math.ceil(scaled)) * spacing
  );
}

export function priceAtTick(
  tick: number,
  decimals0: number,
  decimals1: number,
) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

export function simulateRange(
  farm: FarmOpportunity,
  depositUsd: number,
  lowerPercent: number,
  upperPercent: number,
): RangeSimulation {
  const currentPrice = farm.priceToken1PerToken0;
  const lowerPrice = currentPrice * Math.max(0.000001, 1 - lowerPercent / 100);
  const upperPrice = currentPrice * (1 + upperPercent / 100);
  const decimalScale = Math.pow(
    10,
    farm.token0.decimals - farm.token1.decimals,
  );
  const tickLower = Math.max(
    -887272,
    alignTick(
      Math.log(lowerPrice / decimalScale) / Math.log(1.0001),
      farm.tickSpacing,
      "down",
    ),
  );
  const tickUpper = Math.min(
    887272,
    alignTick(
      Math.log(upperPrice / decimalScale) / Math.log(1.0001),
      farm.tickSpacing,
      "up",
    ),
  );
  const sqrtPrice = Math.sqrt(Math.pow(1.0001, farm.tick));
  const sqrtLower = Math.sqrt(Math.pow(1.0001, tickLower));
  const sqrtUpper = Math.sqrt(Math.pow(1.0001, tickUpper));
  const amount0RawPerLiquidity =
    farm.tick < tickLower
      ? (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper)
      : farm.tick >= tickUpper
        ? 0
        : (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper);
  const amount1RawPerLiquidity =
    farm.tick < tickLower
      ? 0
      : farm.tick >= tickUpper
        ? sqrtUpper - sqrtLower
        : sqrtPrice - sqrtLower;
  const amount0PerLiquidity =
    amount0RawPerLiquidity / Math.pow(10, farm.token0.decimals);
  const amount1PerLiquidity =
    amount1RawPerLiquidity / Math.pow(10, farm.token1.decimals);
  const unitValueUsd =
    amount0PerLiquidity * (farm.token0.priceUsd ?? 0) +
    amount1PerLiquidity * (farm.token1.priceUsd ?? 0);
  const positionLiquidity = unitValueUsd > 0 ? depositUsd / unitValueUsd : 0;
  const amount0 = amount0PerLiquidity * positionLiquidity;
  const amount1 = amount1PerLiquidity * positionLiquidity;
  const poolLiquidity = Number(farm.liquidity);
  const shareOfActiveLiquidity =
    positionLiquidity > 0
      ? positionLiquidity / (poolLiquidity + positionLiquidity)
      : 0;
  const samples = farm.sampledTicks.length ? farm.sampledTicks : [farm.tick];
  const observedRangeActivity =
    samples.filter((tick) => tick >= tickLower && tick < tickUpper).length /
    samples.length;
  const estimatedAnnualFeesUsd =
    farm.fees24hProjectedUsd == null
      ? null
      : farm.fees24hProjectedUsd *
        365 *
        shareOfActiveLiquidity *
        observedRangeActivity;
  const estimatedApr =
    estimatedAnnualFeesUsd == null || depositUsd <= 0
      ? null
      : (estimatedAnnualFeesUsd / depositUsd) * 100;
  const fullRangeWidth = 1_774_544;
  const capitalEfficiency = Math.min(
    999,
    fullRangeWidth / Math.max(farm.tickSpacing, tickUpper - tickLower),
  );
  return {
    tickLower,
    tickUpper,
    lowerPrice,
    upperPrice,
    amount0,
    amount1,
    shareOfActiveLiquidity,
    observedRangeActivity,
    estimatedAnnualFeesUsd,
    estimatedApr,
    capitalEfficiency,
  };
}
