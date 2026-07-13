import { formatUnits, getAddress, zeroAddress, type Address } from "viem";
import type { Prisma } from "@prisma/client";
import { mainnetManifest, MAINNET_CHAIN_ID } from "@/src/chains/robinhood";
import {
  erc20Abi,
  factoryAbi,
  poolAbi,
  poolCreatedEvent,
  swapEvent,
} from "@/src/contracts/abis";
import {
  priceAtTick,
  projectVolumeWithinTokenAge,
  type FarmOpportunity,
  type FarmScannerResponse,
  type FarmToken,
} from "@/src/domain/farms";
import { getPublicClient } from "@/src/lib/client";
import { databaseConfigured, prisma } from "@/src/lib/db";

const refreshSeconds = 120;
const activityWindowBlocks = 2_500n;
const metricWindowBlocks = 20_000n;
const minimumTvlUsd = 1_000;
const maxCandidatePools = 360;
const maxActivePoolReads = 120;
const maxPoolReads = 160;
const maxFarms = 140;
const catalogSampleSize = maxPoolReads - maxActivePoolReads;
const maxCatalogCandidates = 2_000;

type SwapSample = {
  amount0: bigint;
  amount1: bigint;
  tick: number;
};

type PoolCreatedLog = {
  args: { pool?: Address };
  blockNumber: bigint;
};

type PoolBase = {
  poolAddress: Address;
  token0: FarmToken;
  token1: FarmToken;
  fee: number;
  tickSpacing: number;
  tick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  reserve0: number;
  reserve1: number;
  activityScore: number;
  swaps: SwapSample[];
};

let scannerCache: { expiresAt: number; value: FarmScannerResponse } | undefined;
const tokenCache = new Map<string, { expiresAt: number; value: FarmToken }>();
const tokenCandidateCache = new Map<
  string,
  { expiresAt: number; value: Array<[Address, number]> }
>();

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const result = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      result[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return result;
}

async function persistPoolCatalog(pools: PoolBase[]) {
  if (!databaseConfigured() || !pools.length) return false;
  try {
    const uniqueTokens = new Map<string, FarmToken>();
    for (const pool of pools) {
      uniqueTokens.set(pool.token0.address.toLowerCase(), pool.token0);
      uniqueTokens.set(pool.token1.address.toLowerCase(), pool.token1);
    }
    await prisma.token.createMany({
      data: [...uniqueTokens.values()].map((token) => ({
        chainId: MAINNET_CHAIN_ID,
        address: token.address.toLowerCase(),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      })),
      skipDuplicates: true,
    });
    const storedTokens = await prisma.token.findMany({
      where: {
        chainId: MAINNET_CHAIN_ID,
        address: { in: [...uniqueTokens.keys()] },
      },
      select: { id: true, address: true },
    });
    const tokenIds = new Map(
      storedTokens.map((token) => [token.address.toLowerCase(), token.id]),
    );
    await prisma.pool.createMany({
      data: pools.flatMap((pool) => {
        const token0Id = tokenIds.get(pool.token0.address.toLowerCase());
        const token1Id = tokenIds.get(pool.token1.address.toLowerCase());
        if (!token0Id || !token1Id) return [];
        return [
          {
            chainId: MAINNET_CHAIN_ID,
            address: pool.poolAddress.toLowerCase(),
            factory: mainnetManifest.factory.toLowerCase(),
            token0Id,
            token1Id,
            fee: pool.fee,
            tickSpacing: pool.tickSpacing,
          },
        ];
      }),
      skipDuplicates: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function persistFarmSnapshots(farms: FarmOpportunity[]) {
  if (!databaseConfigured() || !farms.length) return false;
  try {
    await mapLimit(farms, 12, (farm) =>
      prisma.pool.updateMany({
        where: {
          chainId: MAINNET_CHAIN_ID,
          address: farm.poolAddress.toLowerCase(),
        },
        data: {
          snapshot: farm as unknown as Prisma.InputJsonValue,
          snapshotAt: new Date(farm.updatedAt),
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

async function trackedPoolAgeMinutes(pools: PoolBase[], now: Date) {
  const ages = new Map<string, number>();
  if (!databaseConfigured() || !pools.length) return ages;
  try {
    const stored = await prisma.pool.findMany({
      where: {
        chainId: MAINNET_CHAIN_ID,
        address: {
          in: pools.map((pool) => pool.poolAddress.toLowerCase()),
        },
      },
      select: {
        address: true,
        createdAt: true,
        token0: { select: { createdAt: true } },
        token1: { select: { createdAt: true } },
      },
    });
    for (const pool of stored) {
      const firstSeenAt = Math.max(
        pool.createdAt.getTime(),
        pool.token0.createdAt.getTime(),
        pool.token1.createdAt.getTime(),
      );
      ages.set(
        pool.address.toLowerCase(),
        Math.max(0, (now.getTime() - firstSeenAt) / 60_000),
      );
    }
  } catch {
    return new Map();
  }
  return ages;
}

function isFarmSnapshot(value: unknown): value is FarmOpportunity {
  if (!value || typeof value !== "object") return false;
  const farm = value as Partial<FarmOpportunity>;
  return Boolean(
    farm.poolAddress &&
      /^0x[0-9a-fA-F]{40}$/.test(farm.poolAddress) &&
      farm.token0?.address &&
      farm.token1?.address &&
      typeof farm.updatedAt === "string" &&
      typeof farm.blockNumber === "string",
  );
}

function sortFarms(farms: FarmOpportunity[]) {
  farms.sort((a, b) => {
    const priced = Number(b.tvlUsd != null) - Number(a.tvlUsd != null);
    if (priced) return priced;
    return (
      (b.volume24hProjectedUsd ?? b.activityScore) -
      (a.volume24hProjectedUsd ?? a.activityScore)
    );
  });
  return farms;
}

export async function getStoredFarmScanner(): Promise<FarmScannerResponse | null> {
  if (!databaseConfigured()) return null;
  try {
    const [stored, catalogSize] = await Promise.all([
      prisma.pool.findMany({
        where: { chainId: MAINNET_CHAIN_ID },
        orderBy: { snapshotAt: "desc" },
        take: maxCatalogCandidates,
        select: { snapshot: true },
      }),
      prisma.pool.count({ where: { chainId: MAINNET_CHAIN_ID } }),
    ]);
    const farms = sortFarms(
      stored
        .map(({ snapshot }) => snapshot)
        .filter(isFarmSnapshot)
        .filter((farm) => farm.tvlUsd != null && farm.tvlUsd >= minimumTvlUsd),
    );
    if (!farms.length) return null;
    const freshest = farms.reduce((latest, farm) =>
      Date.parse(farm.updatedAt) > Date.parse(latest.updatedAt) ? farm : latest,
    );
    return {
      farms: farms.slice(0, maxFarms),
      blockNumber: freshest.blockNumber,
      updatedAt: freshest.updatedAt,
      refreshAfterSeconds: refreshSeconds,
      sampleMinutes: freshest.sampleMinutes,
      minimumTvlUsd,
      catalogSize,
      databaseBacked: true,
      source:
        "Neon pool snapshots · Robinhood Chain · factory-verified V3 pools",
    };
  } catch {
    return null;
  }
}

async function catalogCandidates(): Promise<Array<[Address, number]>> {
  if (!databaseConfigured()) return [];
  try {
    const stored = await prisma.pool.findMany({
      where: { chainId: MAINNET_CHAIN_ID },
      orderBy: { createdAt: "desc" },
      take: maxCatalogCandidates,
      select: { address: true },
    });
    if (!stored.length) return [];
    const bucket = Math.floor(Date.now() / (refreshSeconds * 1_000));
    const offset = (bucket * catalogSampleSize) % stored.length;
    return Array.from(
      { length: Math.min(catalogSampleSize, stored.length) },
      (_, index) => stored[(offset + index) % stored.length],
    ).map(
      ({ address }, index) =>
        [getAddress(address), catalogSampleSize - index] as [Address, number],
    );
  } catch {
    return [];
  }
}

async function catalogStatus(fallbackSize: number) {
  if (!databaseConfigured())
    return { catalogSize: fallbackSize, databaseBacked: false };
  try {
    return {
      catalogSize: await prisma.pool.count({
        where: { chainId: MAINNET_CHAIN_ID },
      }),
      databaseBacked: true,
    };
  } catch {
    return { catalogSize: fallbackSize, databaseBacked: false };
  }
}

function mergeDefaultCandidates(
  active: Array<[Address, number]>,
  catalog: Array<[Address, number]>,
) {
  const merged = new Map<string, [Address, number]>();
  for (const item of active.slice(0, maxActivePoolReads))
    merged.set(item[0].toLowerCase(), item);
  for (const item of catalog) {
    if (merged.size >= maxPoolReads) break;
    if (!merged.has(item[0].toLowerCase()))
      merged.set(item[0].toLowerCase(), item);
  }
  for (const item of active.slice(maxActivePoolReads)) {
    if (merged.size >= maxPoolReads) break;
    if (!merged.has(item[0].toLowerCase()))
      merged.set(item[0].toLowerCase(), item);
  }
  return [...merged.values()];
}

async function readToken(address: Address): Promise<FarmToken> {
  const key = address.toLowerCase();
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const client = getPublicClient(MAINNET_CHAIN_ID);
  const fallback = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client
      .readContract({ address, abi: erc20Abi, functionName: "name" })
      .catch(() => fallback),
    client
      .readContract({ address, abi: erc20Abi, functionName: "symbol" })
      .catch(() => fallback),
    client
      .readContract({ address, abi: erc20Abi, functionName: "decimals" })
      .catch(() => 18),
    client
      .readContract({ address, abi: erc20Abi, functionName: "totalSupply" })
      .catch(() => 0n),
  ]);
  const value: FarmToken = {
    address,
    name: String(name).slice(0, 64),
    symbol: String(symbol).slice(0, 24),
    decimals: Number(decimals),
    totalSupply: totalSupply.toString(),
    priceUsd: key === mainnetManifest.usdg.toLowerCase() ? 1 : null,
  };
  tokenCache.set(key, { expiresAt: Date.now() + 15 * 60_000, value });
  return value;
}

async function validateFactoryPools(
  candidates: Array<[Address, number]>,
): Promise<Array<[Address, number]>> {
  const client = getPublicClient(MAINNET_CHAIN_ID);
  const checked = await mapLimit(candidates, 20, async ([address, score]) => {
    const factory = await client
      .readContract({ address, abi: poolAbi, functionName: "factory" })
      .catch(() => zeroAddress);
    return factory.toLowerCase() === mainnetManifest.factory.toLowerCase()
      ? ([address, score] as const)
      : null;
  });
  return checked.filter((item): item is [Address, number] => item !== null);
}

async function anchorPools() {
  const client = getPublicClient(MAINNET_CHAIN_ID);
  const pools = await Promise.all(
    mainnetManifest.supportedFeeTiers.map((fee) =>
      client.readContract({
        address: mainnetManifest.factory,
        abi: factoryAbi,
        functionName: "getPool",
        args: [mainnetManifest.weth, mainnetManifest.usdg, fee],
      }),
    ),
  );
  return pools.filter((pool): pool is Address => pool !== zeroAddress);
}

async function readPoolBase(
  poolAddress: Address,
  activityScore: number,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolBase | null> {
  const client = getPublicClient(MAINNET_CHAIN_ID);
  try {
    const [token0Address, token1Address, fee, spacing, liquidity, slot0] =
      await Promise.all([
        client.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "token0",
        }),
        client.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "token1",
        }),
        client.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "fee",
        }),
        client.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "tickSpacing",
        }),
        client.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "liquidity",
        }),
        client.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "slot0",
        }),
      ]);
    const [token0, token1] = await Promise.all([
      readToken(getAddress(token0Address)),
      readToken(getAddress(token1Address)),
    ]);
    const [balance0, balance1, logs] = await Promise.all([
      client.readContract({
        address: token0.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [poolAddress],
      }),
      client.readContract({
        address: token1.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [poolAddress],
      }),
      client
        .getLogs({
          address: poolAddress,
          event: swapEvent,
          fromBlock,
          toBlock,
        })
        .catch(() => []),
    ]);
    return {
      poolAddress,
      token0: { ...token0 },
      token1: { ...token1 },
      fee: Number(fee),
      tickSpacing: Number(spacing),
      tick: Number(slot0[1]),
      sqrtPriceX96: slot0[0],
      liquidity,
      reserve0: Number(formatUnits(balance0, token0.decimals)),
      reserve1: Number(formatUnits(balance1, token1.decimals)),
      activityScore,
      swaps: logs.map((log) => ({
        amount0: log.args.amount0!,
        amount1: log.args.amount1!,
        tick: log.args.tick!,
      })),
    };
  } catch {
    return null;
  }
}

function resolveUsdPrices(pools: PoolBase[]) {
  const prices = new Map<string, number>([
    [mainnetManifest.usdg.toLowerCase(), 1],
  ]);
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const pool of pools) {
      const key0 = pool.token0.address.toLowerCase();
      const key1 = pool.token1.address.toLowerCase();
      const price0 = prices.get(key0);
      const price1 = prices.get(key1);
      const ratio = priceAtTick(
        pool.tick,
        pool.token0.decimals,
        pool.token1.decimals,
      );
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      if (price0 != null && price1 == null) {
        prices.set(key1, price0 / ratio);
        changed = true;
      } else if (price1 != null && price0 == null) {
        prices.set(key0, ratio * price1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const pool of pools) {
    pool.token0.priceUsd =
      prices.get(pool.token0.address.toLowerCase()) ?? null;
    pool.token1.priceUsd =
      prices.get(pool.token1.address.toLowerCase()) ?? null;
  }
}

function toOpportunity(
  pool: PoolBase,
  blockNumber: bigint,
  sampleMinutes: number,
  tokenAgeMinutes: number | null,
  updatedAt: string,
): FarmOpportunity {
  const priceToken1PerToken0 = priceAtTick(
    pool.tick,
    pool.token0.decimals,
    pool.token1.decimals,
  );
  const tvlUsd =
    pool.token0.priceUsd != null && pool.token1.priceUsd != null
      ? pool.reserve0 * pool.token0.priceUsd +
        pool.reserve1 * pool.token1.priceUsd
      : null;
  const volumeWindowUsd =
    pool.token0.priceUsd != null && pool.token1.priceUsd != null
      ? pool.swaps.reduce((sum, swap) => {
          const value0 =
            Number(
              formatUnits(
                swap.amount0 < 0n ? -swap.amount0 : swap.amount0,
                pool.token0.decimals,
              ),
            ) * pool.token0.priceUsd!;
          const value1 =
            Number(
              formatUnits(
                swap.amount1 < 0n ? -swap.amount1 : swap.amount1,
                pool.token1.decimals,
              ),
            ) * pool.token1.priceUsd!;
          return sum + (value0 + value1) / 2;
        }, 0)
      : null;
  const volumeProjection = projectVolumeWithinTokenAge(
    volumeWindowUsd,
    sampleMinutes,
    tokenAgeMinutes,
  );
  const volume24hProjectedUsd = volumeProjection.volumeUsd;
  const fees24hProjectedUsd =
    volume24hProjectedUsd == null
      ? null
      : volume24hProjectedUsd * (pool.fee / 1_000_000);
  const projectedPoolApr =
    fees24hProjectedUsd == null || tvlUsd == null || tvlUsd <= 0
      ? null
      : (fees24hProjectedUsd * 365 * 100) / tvlUsd;
  const firstTick = pool.swaps[0]?.tick;
  const lastTick = pool.swaps.at(-1)?.tick;
  const priceChangePercent =
    firstTick == null || lastTick == null
      ? null
      : (Math.pow(1.0001, lastTick - firstTick) - 1) * 100;
  const riskReasons: string[] = [];
  if (tvlUsd == null) riskReasons.push("No verified USD pricing path");
  if (tvlUsd != null && tvlUsd < 10_000) riskReasons.push("Low pool TVL");
  if (pool.swaps.length < 20) riskReasons.push("Sparse recent trading");
  if (projectedPoolApr != null && projectedPoolApr > 500)
    riskReasons.push("APR is highly sample-sensitive");
  const risk: FarmOpportunity["risk"] =
    tvlUsd == null
      ? "UNPRICED"
      : riskReasons.length >= 2
        ? "HIGH"
        : riskReasons.length === 1
          ? "MEDIUM"
          : "LOW";
  const stride = Math.max(1, Math.ceil(pool.swaps.length / 96));
  return {
    poolAddress: pool.poolAddress,
    token0: pool.token0,
    token1: pool.token1,
    fee: pool.fee,
    feePercent: pool.fee / 10_000,
    tickSpacing: pool.tickSpacing,
    tick: pool.tick,
    sqrtPriceX96: pool.sqrtPriceX96.toString(),
    liquidity: pool.liquidity.toString(),
    reserve0: pool.reserve0,
    reserve1: pool.reserve1,
    priceToken1PerToken0,
    tvlUsd,
    volume24hProjectedUsd,
    volumeProjectionMinutes: volumeProjection.projectionMinutes,
    fees24hProjectedUsd,
    projectedPoolApr,
    priceChangePercent,
    swapsInWindow: pool.swaps.length,
    sampleMinutes,
    sampledTicks: pool.swaps
      .filter((_, index) => index % stride === 0)
      .map((swap) => swap.tick),
    activityScore: pool.activityScore,
    risk,
    riskReasons,
    updatedAt,
    blockNumber: blockNumber.toString(),
  };
}

async function buildResponse(
  candidates: Array<[Address, number]>,
  query?: string,
): Promise<FarmScannerResponse> {
  const client = getPublicClient(MAINNET_CHAIN_ID);
  const blockNumber = await client.getBlockNumber();
  const fromBlock =
    blockNumber > metricWindowBlocks ? blockNumber - metricWindowBlocks : 0n;
  const [headBlock, firstBlock] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.getBlock({ blockNumber: fromBlock }),
  ]);
  const sampleMinutes = Math.max(
    1,
    Number(headBlock.timestamp - firstBlock.timestamp) / 60,
  );
  const anchors = await anchorPools();
  const score = new Map(
    candidates.map(([address, value]) => [address.toLowerCase(), value]),
  );
  const addresses = [...candidates.map(([address]) => address)];
  for (const anchor of anchors) {
    if (!score.has(anchor.toLowerCase())) {
      addresses.push(anchor);
      score.set(anchor.toLowerCase(), 0);
    }
  }
  const bases = (
    await mapLimit(
      addresses.slice(0, maxPoolReads + anchors.length),
      12,
      (address) =>
        readPoolBase(
          address,
          score.get(address.toLowerCase()) ?? 0,
          fromBlock,
          blockNumber,
        ),
    )
  ).filter((pool): pool is PoolBase => pool !== null);
  resolveUsdPrices(bases);
  await persistPoolCatalog(bases);
  const catalog = await catalogStatus(bases.length);
  const updatedAtDate = new Date();
  const updatedAt = updatedAtDate.toISOString();
  const trackedAges = await trackedPoolAgeMinutes(bases, updatedAtDate);
  let farms = bases.map((pool) =>
    toOpportunity(
      pool,
      blockNumber,
      sampleMinutes,
      trackedAges.get(pool.poolAddress.toLowerCase()) ?? null,
      updatedAt,
    ),
  );
  await persistFarmSnapshots(farms);
  farms = farms.filter(
    (farm) => farm.tvlUsd != null && farm.tvlUsd >= minimumTvlUsd,
  );
  if (query && /^0x[0-9a-fA-F]{40}$/.test(query)) {
    const normalized = query.toLowerCase();
    farms = farms.filter(
      (farm) =>
        farm.token0.address.toLowerCase() === normalized ||
        farm.token1.address.toLowerCase() === normalized,
    );
  }
  sortFarms(farms);
  return {
    farms: farms.slice(0, maxFarms),
    blockNumber: blockNumber.toString(),
    updatedAt,
    refreshAfterSeconds: refreshSeconds,
    sampleMinutes,
    minimumTvlUsd,
    catalogSize: catalog.catalogSize,
    databaseBacked: catalog.databaseBacked,
    source:
      "Robinhood Chain RPC · Factory-verified V3 pools · persistent catalog · rolling activity sample",
    query,
  };
}

async function activeCandidates(): Promise<Array<[Address, number]>> {
  const client = getPublicClient(MAINNET_CHAIN_ID);
  const head = await client.getBlockNumber();
  let span = activityWindowBlocks;
  let logs: Awaited<ReturnType<typeof client.getLogs>> = [];
  for (;;) {
    const fromBlock = head > span ? head - span : 0n;
    try {
      logs = await client.getLogs({
        event: swapEvent,
        fromBlock,
        toBlock: head,
      });
      break;
    } catch (error) {
      if (span <= 250n) throw error;
      span /= 2n;
    }
  }
  const counts = new Map<string, { address: Address; count: number }>();
  for (const log of logs) {
    const key = log.address.toLowerCase();
    const current = counts.get(key);
    counts.set(key, {
      address: getAddress(log.address),
      count: (current?.count ?? 0) + 1,
    });
  }
  const ranked = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxCandidatePools)
    .map(({ address, count }) => [address, count] as [Address, number]);
  return validateFactoryPools(ranked);
}

async function tokenCandidates(
  token: Address,
): Promise<Array<[Address, number]>> {
  const cached = tokenCandidateCache.get(token.toLowerCase());
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const client = getPublicClient(MAINNET_CHAIN_ID);
  await readToken(token);
  const head = await client.getBlockNumber();
  const found = new Map<string, { address: Address; block: bigint }>();
  const sleep = (milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
  async function queryRange(
    fromBlock: bigint,
    toBlock: bigint,
    field: "token0" | "token1",
  ): Promise<PoolCreatedLog[]> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return (await client.getLogs({
          address: mainnetManifest.factory,
          event: poolCreatedEvent,
          args: { [field]: token },
          fromBlock,
          toBlock,
        })) as PoolCreatedLog[];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Too Many Requests")) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (
          (message.includes("timed out") ||
            message.includes("exceeds limit")) &&
          toBlock - fromBlock > 50_000n
        ) {
          const midpoint = (fromBlock + toBlock) / 2n;
          const [left, right] = await Promise.all([
            queryRange(fromBlock, midpoint, field),
            queryRange(midpoint + 1n, toBlock, field),
          ]);
          return [...left, ...right];
        }
        throw error;
      }
    }
    throw new Error(
      "Robinhood RPC rate limit prevented the full-chain token search",
    );
  }
  for (let start = 0n; start <= head; start += 500_000n) {
    const end = start + 499_999n > head ? head : start + 499_999n;
    const [asToken0, asToken1] = await Promise.all([
      queryRange(start, end, "token0"),
      queryRange(start, end, "token1"),
    ]);
    for (const log of [...asToken0, ...asToken1]) {
      if (!log.args.pool) continue;
      found.set(log.args.pool.toLowerCase(), {
        address: getAddress(log.args.pool),
        block: log.blockNumber,
      });
    }
    await sleep(150);
  }
  const value = [...found.values()]
    .sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))
    .slice(0, maxFarms)
    .map(
      ({ address }, index) => [address, maxFarms - index] as [Address, number],
    );
  tokenCandidateCache.set(token.toLowerCase(), {
    expiresAt: Date.now() + 10 * 60_000,
    value,
  });
  return value;
}

export async function getFarmScanner(token?: string, forceRefresh = false) {
  if (token) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(token))
      throw new Error("Use a token contract address for full-chain search");
    const address = getAddress(token);
    const activeMatches = (scannerCache?.value.farms ?? [])
      .filter(
        (farm) =>
          farm.token0.address.toLowerCase() === address.toLowerCase() ||
          farm.token1.address.toLowerCase() === address.toLowerCase(),
      )
      .map(
        (farm, index) =>
          [farm.poolAddress, 1_000_000 - index] as [Address, number],
      );
    const discovered = await tokenCandidates(address);
    const merged = new Map<string, [Address, number]>();
    for (const item of [...activeMatches, ...discovered])
      merged.set(item[0].toLowerCase(), item);
    return buildResponse([...merged.values()], address);
  }
  if (!forceRefresh) {
    const stored = await getStoredFarmScanner();
    if (stored) return stored;
  }
  if (!forceRefresh && scannerCache && scannerCache.expiresAt > Date.now())
    return scannerCache.value;
  const [active, catalog] = await Promise.all([
    activeCandidates(),
    catalogCandidates(),
  ]);
  const value = await buildResponse(mergeDefaultCandidates(active, catalog));
  scannerCache = { expiresAt: Date.now() + refreshSeconds * 1_000, value };
  return value;
}
