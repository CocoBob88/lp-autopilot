import { getAddress, maxUint128, zeroAddress, type Address } from "viem";
import { getChainConfig } from "@/src/chains/robinhood";
import {
  erc20Abi,
  factoryAbi,
  poolAbi,
  positionManagerAbi,
} from "@/src/contracts/abis";
import {
  amountsForLiquidity,
  priceAtTick,
  rangeState,
} from "@/src/domain/liquidity-math";
import { getPublicClient } from "@/src/lib/client";
import { validateManifest } from "@/src/operations/manifest";

type BlockscoutItem = {
  id?: string;
  token_id?: string;
  token?: { address?: string; address_hash?: string };
  token_address?: string;
};

type BlockscoutPage = {
  items?: BlockscoutItem[];
  next_page_params?: Record<string, string | number> | null;
};

async function discoverTokenIdsFromBlockscout(
  owner: Address,
  manager: Address,
  explorer: string,
) {
  const ids = new Set<bigint>();
  let next: Record<string, string | number> | null = {};
  for (let page = 0; page < 20 && next; page += 1) {
    const query = new URLSearchParams({ type: "ERC-721" });
    for (const [key, value] of Object.entries(next))
      query.set(key, String(value));
    const response = await fetch(
      `${explorer}/api/v2/addresses/${owner}/nft?${query}`,
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`Blockscout NFT inventory returned ${response.status}`);
    const body = (await response.json()) as BlockscoutPage;
    for (const item of body.items ?? []) {
      const tokenAddress =
        item.token?.address_hash ?? item.token?.address ?? item.token_address;
      const rawId = item.id ?? item.token_id;
      if (
        tokenAddress &&
        rawId &&
        tokenAddress.toLowerCase() === manager.toLowerCase() &&
        /^\d+$/.test(rawId)
      ) {
        ids.add(BigInt(rawId));
      }
    }
    next = body.next_page_params ?? null;
  }
  return [...ids];
}

async function readTokenMetadata(
  address: Address,
  chainId: number,
  blockNumber: bigint,
) {
  const client = getPublicClient(chainId);
  const [symbol, decimals, name] = await Promise.all([
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "symbol",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber,
    }),
    client
      .readContract({
        address,
        abi: erc20Abi,
        functionName: "name",
        blockNumber,
      })
      .catch(() => "Unknown token"),
  ]);
  return { address, symbol, name, decimals };
}

export async function readPosition(
  chainId: number,
  ownerInput: string,
  tokenId: bigint,
) {
  const owner = getAddress(ownerInput);
  const { manifest } = getChainConfig(chainId);
  if (!manifest)
    throw new Error("No reviewed contract manifest exists for this network");
  const validation = await validateManifest(chainId);
  if (!validation.healthy)
    throw new Error("Contract manifest validation failed");
  const client = getPublicClient(chainId);
  const blockNumber = validation.blockNumber;
  const currentOwner = await client.readContract({
    address: manifest.positionManager,
    abi: positionManagerAbi,
    functionName: "ownerOf",
    args: [tokenId],
    blockNumber,
  });
  if (currentOwner.toLowerCase() !== owner.toLowerCase())
    throw new Error("Position is no longer owned by this wallet");
  const raw = await client.readContract({
    address: manifest.positionManager,
    abi: positionManagerAbi,
    functionName: "positions",
    args: [tokenId],
    blockNumber,
  });
  const [
    ,
    operator,
    token0Address,
    token1Address,
    fee,
    tickLower,
    tickUpper,
    liquidity,
    ,
    ,
    tokensOwed0,
    tokensOwed1,
  ] = raw;
  const poolAddress = await client.readContract({
    address: manifest.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token0Address, token1Address, fee],
    blockNumber,
  });
  if (poolAddress === zeroAddress)
    throw new Error("Factory does not resolve this position to a pool");
  const code = await client.getCode({ address: poolAddress, blockNumber });
  if (!code || code === "0x") throw new Error("Resolved pool has no bytecode");
  const [
    poolFactory,
    poolToken0,
    poolToken1,
    poolFee,
    tickSpacing,
    poolLiquidity,
    slot0,
    token0,
    token1,
  ] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "factory",
      blockNumber,
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "token0",
      blockNumber,
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "token1",
      blockNumber,
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "fee",
      blockNumber,
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "tickSpacing",
      blockNumber,
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "liquidity",
      blockNumber,
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "slot0",
      blockNumber,
    }),
    readTokenMetadata(token0Address, chainId, blockNumber),
    readTokenMetadata(token1Address, chainId, blockNumber),
  ]);
  if (
    poolFactory.toLowerCase() !== manifest.factory.toLowerCase() ||
    poolToken0.toLowerCase() !== token0Address.toLowerCase() ||
    poolToken1.toLowerCase() !== token1Address.toLowerCase() ||
    poolFee !== fee
  ) {
    throw new Error("Pool immutable validation failed");
  }
  const [
    sqrtPriceX96,
    tick,
    observationIndex,
    observationCardinality,
    observationCardinalityNext,
    feeProtocol,
    unlocked,
  ] = slot0;
  const amounts = amountsForLiquidity(
    sqrtPriceX96,
    tickLower,
    tickUpper,
    liquidity,
  );
  let feePreview = {
    amount0: tokensOwed0,
    amount1: tokensOwed1,
    available: false,
  };
  try {
    const simulation = await client.simulateContract({
      account: owner,
      address: manifest.positionManager,
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: owner,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ],
      blockNumber,
    });
    feePreview = {
      amount0: simulation.result[0],
      amount1: simulation.result[1],
      available: true,
    };
  } catch {
    // Owed counters remain the conservative fallback; the error is surfaced by available=false.
  }
  return {
    chainId,
    blockNumber,
    blockHash: validation.blockHash,
    managerAddress: manifest.positionManager,
    tokenId,
    owner,
    operator,
    pool: {
      address: poolAddress,
      fee,
      tickSpacing,
      liquidity: poolLiquidity,
      unlocked,
      observationIndex,
      observationCardinality,
      observationCardinalityNext,
      feeProtocol,
    },
    token0,
    token1,
    tickLower,
    tickUpper,
    tick,
    sqrtPriceX96,
    liquidity,
    amount0: amounts.amount0,
    amount1: amounts.amount1,
    tokensOwed0,
    tokensOwed1,
    feePreview,
    state: rangeState(tick, tickLower, tickUpper),
    priceToken1PerToken0: priceAtTick(tick, token0.decimals, token1.decimals),
    lowerPriceToken1PerToken0: priceAtTick(
      tickLower,
      token0.decimals,
      token1.decimals,
    ),
    upperPriceToken1PerToken0: priceAtTick(
      tickUpper,
      token0.decimals,
      token1.decimals,
    ),
  };
}

export async function discoverPositions(chainId: number, ownerInput: string) {
  const owner = getAddress(ownerInput);
  const { manifest } = getChainConfig(chainId);
  if (!manifest)
    throw new Error(
      "Position discovery is disabled until the testnet manifest is independently verified",
    );
  const ids = await discoverTokenIdsFromBlockscout(
    owner,
    manifest.positionManager,
    manifest.explorer,
  );
  const positions: Awaited<ReturnType<typeof readPosition>>[] = [];
  const rejected: Array<{ tokenId: string; reason: string }> = [];
  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map((tokenId) => readPosition(chainId, owner, tokenId)),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") positions.push(result.value);
      else
        rejected.push({
          tokenId: batch[index].toString(),
          reason: "Ownership or pool validation failed",
        });
    });
  }
  return {
    owner,
    positions,
    rejected,
    source: "blockscout-validated-onchain" as const,
  };
}
