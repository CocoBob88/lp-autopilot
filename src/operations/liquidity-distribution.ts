import { getAddress, type Address } from "viem";
import { mainnetManifest, MAINNET_CHAIN_ID } from "@/src/chains/robinhood";
import { erc20Abi, poolAbi } from "@/src/contracts/abis";
import {
  priceAtTick,
  reconstructLiquidityDistribution,
  type LiquidityDistributionResponse,
} from "@/src/domain/farms";
import { getPublicClient } from "@/src/lib/client";

const maxInitializedTicks = 640;
const cache = new Map<
  string,
  { expiresAt: number; value: LiquidityDistributionResponse }
>();

type TickRecord = {
  tick: number;
  liquidityGross: bigint;
  liquidityNet: bigint;
};

function compressedTick(tick: number, spacing: number) {
  let compressed = Math.trunc(tick / spacing);
  if (tick < 0 && tick % spacing !== 0) compressed -= 1;
  return compressed;
}

export async function getLiquidityDistribution(
  rawPoolAddress: string,
): Promise<LiquidityDistributionResponse> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(rawPoolAddress)) {
    throw new Error("Invalid pool address");
  }
  const poolAddress = getAddress(rawPoolAddress);
  const key = poolAddress.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const client = getPublicClient(MAINNET_CHAIN_ID);
  const [
    factory,
    token0,
    token1,
    spacingRaw,
    currentLiquidity,
    slot0,
    blockNumber,
  ] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "factory",
    }),
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
    client.getBlockNumber(),
  ]);
  if (factory.toLowerCase() !== mainnetManifest.factory.toLowerCase()) {
    throw new Error("Pool is not from the reviewed V3 factory");
  }

  const [decimals0, decimals1] = await Promise.all([
    client.readContract({
      address: getAddress(token0),
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: getAddress(token1),
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  const tickSpacing = Number(spacingRaw);
  const currentTick = Number(slot0[1]);
  const currentWord = Math.floor(
    compressedTick(currentTick, tickSpacing) / 256,
  );
  const wordRadius = Math.min(
    24,
    Math.max(1, Math.ceil(6_000 / (256 * tickSpacing))),
  );
  const words = Array.from(
    { length: wordRadius * 2 + 1 },
    (_, index) => currentWord - wordRadius + index,
  ).filter((word) => word >= -32768 && word <= 32767);
  const bitmapResults = await client.multicall({
    allowFailure: true,
    contracts: words.map((word) => ({
      address: poolAddress,
      abi: poolAbi,
      functionName: "tickBitmap" as const,
      args: [word] as const,
    })),
  });
  const initializedTicks: number[] = [];
  bitmapResults.forEach((result, wordIndex) => {
    if (result.status !== "success") return;
    const bitmap = result.result;
    for (let bit = 0; bit < 256; bit += 1) {
      if ((bitmap & (1n << BigInt(bit))) === 0n) continue;
      initializedTicks.push((words[wordIndex] * 256 + bit) * tickSpacing);
    }
  });
  const nearestTicks = initializedTicks
    .sort((a, b) => Math.abs(a - currentTick) - Math.abs(b - currentTick))
    .slice(0, maxInitializedTicks)
    .sort((a, b) => a - b);
  const tickResults = await client.multicall({
    allowFailure: true,
    contracts: nearestTicks.map((tick) => ({
      address: poolAddress,
      abi: poolAbi,
      functionName: "ticks" as const,
      args: [tick] as const,
    })),
  });
  const records = tickResults
    .map((result, index): TickRecord | null => {
      if (result.status !== "success" || !result.result[7]) return null;
      return {
        tick: nearestTicks[index],
        liquidityGross: result.result[0],
        liquidityNet: result.result[1],
      };
    })
    .filter((record): record is TickRecord => record !== null);

  const value: LiquidityDistributionResponse = {
    poolAddress: poolAddress as Address,
    currentTick,
    currentPrice: priceAtTick(
      currentTick,
      Number(decimals0),
      Number(decimals1),
    ),
    tickSpacing,
    points: reconstructLiquidityDistribution(
      records,
      currentTick,
      currentLiquidity,
      tickSpacing,
      Number(decimals0),
      Number(decimals1),
    ),
    blockNumber: blockNumber.toString(),
    updatedAt: new Date().toISOString(),
  };
  cache.set(key, { expiresAt: Date.now() + 5 * 60_000, value });
  return value;
}
