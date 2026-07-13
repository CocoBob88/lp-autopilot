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
  minimumTvlUsd: number;
  catalogSize: number;
  databaseBacked: boolean;
  source: string;
  query?: string;
};

export type LiquidityDistributionPoint = {
  tick: number;
  price: number;
  liquidity: number;
  liquidityGross: string;
  liquidityNet: string;
};

export type LiquidityDistributionResponse = {
  poolAddress: `0x${string}`;
  currentTick: number;
  currentPrice: number;
  tickSpacing: number;
  points: LiquidityDistributionPoint[];
  blockNumber: string;
  updatedAt: string;
};

export type InitializedLiquidityTick = {
  tick: number;
  liquidityGross: bigint;
  liquidityNet: bigint;
};

export type RangeSimulation = {
  tickLower: number;
  tickUpper: number;
  lowerPrice: number;
  upperPrice: number;
  amount0: number;
  amount1: number;
  positionLiquidity: number;
  shareOfActiveLiquidity: number;
  observedRangeActivity: number;
  estimatedAnnualFeesUsd: number | null;
  estimatedApr: number | null;
  capitalEfficiency: number;
};

export type ImpermanentLossSimulation = {
  futurePrice: number;
  amount0: number;
  amount1: number;
  positionValueUsd: number;
  holdValueUsd: number;
  impermanentLossPercent: number;
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
  return simulateTickRange(farm, depositUsd, tickLower, tickUpper);
}

export function simulateFullRange(
  farm: FarmOpportunity,
  depositUsd: number,
): RangeSimulation {
  const tickLower = Math.ceil(-887272 / farm.tickSpacing) * farm.tickSpacing;
  const tickUpper = Math.floor(887272 / farm.tickSpacing) * farm.tickSpacing;
  return simulateTickRange(farm, depositUsd, tickLower, tickUpper);
}

export function simulateTickRange(
  farm: FarmOpportunity,
  depositUsd: number,
  tickLower: number,
  tickUpper: number,
): RangeSimulation {
  const lowerPrice = priceAtTick(
    tickLower,
    farm.token0.decimals,
    farm.token1.decimals,
  );
  const upperPrice = priceAtTick(
    tickUpper,
    farm.token0.decimals,
    farm.token1.decimals,
  );
  const unitAmounts = amountsAtTick(farm, tickLower, tickUpper, farm.tick, 1);
  const unitValueUsd =
    unitAmounts.amount0 * (farm.token0.priceUsd ?? 0) +
    unitAmounts.amount1 * (farm.token1.priceUsd ?? 0);
  const positionLiquidity = unitValueUsd > 0 ? depositUsd / unitValueUsd : 0;
  const { amount0, amount1 } = amountsAtTick(
    farm,
    tickLower,
    tickUpper,
    farm.tick,
    positionLiquidity,
  );
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
      : farm.fees24hProjectedUsd * 365 * shareOfActiveLiquidity;
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
    positionLiquidity,
    shareOfActiveLiquidity,
    observedRangeActivity,
    estimatedAnnualFeesUsd,
    estimatedApr,
    capitalEfficiency,
  };
}

function distributionPoint(
  tick: number,
  liquidity: bigint,
  record: InitializedLiquidityTick | undefined,
  decimals0: number,
  decimals1: number,
): LiquidityDistributionPoint {
  return {
    tick,
    price: priceAtTick(tick, decimals0, decimals1),
    liquidity: Math.max(0, Number(liquidity)),
    liquidityGross: (record?.liquidityGross ?? 0n).toString(),
    liquidityNet: (record?.liquidityNet ?? 0n).toString(),
  };
}

export function reconstructLiquidityDistribution(
  records: InitializedLiquidityTick[],
  currentTick: number,
  currentLiquidity: bigint,
  tickSpacing: number,
  decimals0: number,
  decimals1: number,
): LiquidityDistributionPoint[] {
  const sorted = [...records].sort((a, b) => a.tick - b.tick);
  const byTick = new Map(sorted.map((record) => [record.tick, record]));
  const points = new Map<number, LiquidityDistributionPoint>();

  let downwardLiquidity = currentLiquidity;
  const lowerRecords = sorted
    .filter((record) => record.tick < currentTick)
    .sort((a, b) => b.tick - a.tick);
  for (const record of lowerRecords) {
    points.set(
      record.tick,
      distributionPoint(
        record.tick,
        downwardLiquidity,
        record,
        decimals0,
        decimals1,
      ),
    );
    downwardLiquidity -= record.liquidityNet;
  }
  const lowest = lowerRecords.at(-1);
  if (lowest) {
    const extensionTick = Math.max(-887272, lowest.tick - tickSpacing);
    if (extensionTick < lowest.tick) {
      points.set(
        extensionTick,
        distributionPoint(
          extensionTick,
          downwardLiquidity,
          undefined,
          decimals0,
          decimals1,
        ),
      );
    }
  }

  points.set(
    currentTick,
    distributionPoint(
      currentTick,
      currentLiquidity,
      byTick.get(currentTick),
      decimals0,
      decimals1,
    ),
  );

  let upwardLiquidity = currentLiquidity;
  const upperRecords = sorted.filter((record) => record.tick > currentTick);
  for (const record of upperRecords) {
    upwardLiquidity += record.liquidityNet;
    points.set(
      record.tick,
      distributionPoint(
        record.tick,
        upwardLiquidity,
        record,
        decimals0,
        decimals1,
      ),
    );
  }
  const highest = upperRecords.at(-1);
  if (highest) {
    const extensionTick = Math.min(887272, highest.tick + tickSpacing);
    if (extensionTick > highest.tick) {
      points.set(
        extensionTick,
        distributionPoint(
          extensionTick,
          upwardLiquidity,
          undefined,
          decimals0,
          decimals1,
        ),
      );
    }
  }

  return [...points.values()]
    .filter(
      (item) =>
        Number.isFinite(item.price) &&
        Number.isFinite(item.liquidity) &&
        item.liquidity >= 0,
    )
    .sort((a, b) => a.tick - b.tick);
}

function amountsAtTick(
  farm: FarmOpportunity,
  tickLower: number,
  tickUpper: number,
  tick: number,
  liquidity: number,
) {
  const sqrtPrice = Math.sqrt(Math.pow(1.0001, tick));
  const sqrtLower = Math.sqrt(Math.pow(1.0001, tickLower));
  const sqrtUpper = Math.sqrt(Math.pow(1.0001, tickUpper));
  const amount0RawPerLiquidity =
    tick < tickLower
      ? (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper)
      : tick >= tickUpper
        ? 0
        : (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper);
  const amount1RawPerLiquidity =
    tick < tickLower
      ? 0
      : tick >= tickUpper
        ? sqrtUpper - sqrtLower
        : sqrtPrice - sqrtLower;
  return {
    amount0:
      (amount0RawPerLiquidity / Math.pow(10, farm.token0.decimals)) * liquidity,
    amount1:
      (amount1RawPerLiquidity / Math.pow(10, farm.token1.decimals)) * liquidity,
  };
}

export function simulateImpermanentLoss(
  farm: FarmOpportunity,
  simulation: RangeSimulation,
  futurePriceChangePercent: number,
): ImpermanentLossSimulation | null {
  if (farm.token1.priceUsd == null || farm.token1.priceUsd <= 0) return null;
  const futurePrice = Math.max(
    Number.MIN_VALUE,
    farm.priceToken1PerToken0 * (1 + futurePriceChangePercent / 100),
  );
  const decimalScale = Math.pow(
    10,
    farm.token0.decimals - farm.token1.decimals,
  );
  const futureTick = Math.max(
    -887272,
    Math.min(887272, Math.log(futurePrice / decimalScale) / Math.log(1.0001)),
  );
  const { amount0, amount1 } = amountsAtTick(
    farm,
    simulation.tickLower,
    simulation.tickUpper,
    futureTick,
    simulation.positionLiquidity,
  );
  const futureToken1Usd = farm.token1.priceUsd;
  const futureToken0Usd = futurePrice * futureToken1Usd;
  const positionValueUsd =
    amount0 * futureToken0Usd + amount1 * futureToken1Usd;
  const holdValueUsd =
    simulation.amount0 * futureToken0Usd + simulation.amount1 * futureToken1Usd;
  return {
    futurePrice,
    amount0,
    amount1,
    positionValueUsd,
    holdValueUsd,
    impermanentLossPercent:
      holdValueUsd > 0 ? (positionValueUsd / holdValueUsd - 1) * 100 : 0,
  };
}
