import type { Prisma } from "@prisma/client";
import type { AwaitedReturn } from "@/src/types";
import { prisma } from "@/src/lib/db";
import { jsonSafe } from "@/src/lib/serialize";
import type { readPosition } from "@/src/operations/positions";

type ChainPosition = AwaitedReturn<typeof readPosition>;

export async function persistValidatedPosition(
  userId: string,
  walletId: string,
  position: ChainPosition,
) {
  return prisma.$transaction(async (tx) => {
    const token0 = await tx.token.upsert({
      where: {
        chainId_address: {
          chainId: position.chainId,
          address: position.token0.address.toLowerCase(),
        },
      },
      create: {
        chainId: position.chainId,
        address: position.token0.address.toLowerCase(),
        name: position.token0.name,
        symbol: position.token0.symbol,
        decimals: position.token0.decimals,
      },
      update: {
        name: position.token0.name,
        symbol: position.token0.symbol,
        decimals: position.token0.decimals,
      },
    });
    const token1 = await tx.token.upsert({
      where: {
        chainId_address: {
          chainId: position.chainId,
          address: position.token1.address.toLowerCase(),
        },
      },
      create: {
        chainId: position.chainId,
        address: position.token1.address.toLowerCase(),
        name: position.token1.name,
        symbol: position.token1.symbol,
        decimals: position.token1.decimals,
      },
      update: {
        name: position.token1.name,
        symbol: position.token1.symbol,
        decimals: position.token1.decimals,
      },
    });
    const pool = await tx.pool.upsert({
      where: {
        chainId_address: {
          chainId: position.chainId,
          address: position.pool.address.toLowerCase(),
        },
      },
      create: {
        chainId: position.chainId,
        address: position.pool.address.toLowerCase(),
        factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
        token0Id: token0.id,
        token1Id: token1.id,
        fee: position.pool.fee,
        tickSpacing: position.pool.tickSpacing,
      },
      update: {
        token0Id: token0.id,
        token1Id: token1.id,
        fee: position.pool.fee,
        tickSpacing: position.pool.tickSpacing,
      },
    });
    const stored = await tx.position.upsert({
      where: {
        chainId_managerAddress_tokenId: {
          chainId: position.chainId,
          managerAddress: position.managerAddress.toLowerCase(),
          tokenId: position.tokenId.toString(),
        },
      },
      create: {
        chainId: position.chainId,
        managerAddress: position.managerAddress.toLowerCase(),
        tokenId: position.tokenId.toString(),
        ownerAddress: position.owner.toLowerCase(),
        operator: position.operator.toLowerCase(),
        walletId,
        poolId: pool.id,
        token0Id: token0.id,
        token1Id: token1.id,
        fee: position.pool.fee,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: position.liquidity.toString(),
        tokensOwed0: position.tokensOwed0.toString(),
        tokensOwed1: position.tokensOwed1.toString(),
        lastValidatedBlock: position.blockNumber.toString(),
      },
      update: {
        ownerAddress: position.owner.toLowerCase(),
        operator: position.operator.toLowerCase(),
        walletId,
        poolId: pool.id,
        liquidity: position.liquidity.toString(),
        tokensOwed0: position.tokensOwed0.toString(),
        tokensOwed1: position.tokensOwed1.toString(),
        lastValidatedBlock: position.blockNumber.toString(),
        closedAt: position.liquidity === 0n ? new Date() : null,
      },
    });
    await tx.positionSnapshot.upsert({
      where: {
        positionId_blockNumber: {
          positionId: stored.id,
          blockNumber: position.blockNumber.toString(),
        },
      },
      create: {
        positionId: stored.id,
        chainId: position.chainId,
        blockNumber: position.blockNumber.toString(),
        blockHash: position.blockHash,
        timestamp: new Date(),
        tick: position.tick,
        sqrtPriceX96: position.sqrtPriceX96.toString(),
        poolLiquidity: position.pool.liquidity.toString(),
        liquidity: position.liquidity.toString(),
        amount0: position.amount0.toString(),
        amount1: position.amount1.toString(),
        fees0: position.feePreview.amount0.toString(),
        fees1: position.feePreview.amount1.toString(),
      },
      update: {
        tick: position.tick,
        sqrtPriceX96: position.sqrtPriceX96.toString(),
        poolLiquidity: position.pool.liquidity.toString(),
        liquidity: position.liquidity.toString(),
        amount0: position.amount0.toString(),
        amount1: position.amount1.toString(),
        fees0: position.feePreview.amount0.toString(),
        fees1: position.feePreview.amount1.toString(),
      },
    });
    void userId;
    return stored;
  });
}

export function asPrismaJson(value: unknown) {
  return jsonSafe(value) as Prisma.InputJsonValue;
}
