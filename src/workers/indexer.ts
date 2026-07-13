import { decodeEventLog, getAddress, type Address, type Log } from "viem";
import { mainnetManifest, MAINNET_CHAIN_ID } from "@/src/chains/robinhood";
import { swapEvent, transferEvent } from "@/src/contracts/abis";
import { getPublicClient } from "@/src/lib/client";
import { prisma } from "@/src/lib/db";
import {
  asPrismaJson,
  persistValidatedPosition,
} from "@/src/operations/persistence";
import { readPosition } from "@/src/operations/positions";
import { nextAdaptiveRange, reorgRollbackBlock } from "@/src/domain/indexer";

const chainId = MAINNET_CHAIN_ID;
const confirmations = BigInt(Number(process.env.ROBINHOOD_CONFIRMATIONS || 12));
const configuredBatch = BigInt(Number(process.env.INDEXER_BATCH_SIZE || 1500));
const pollMs = Number(process.env.WORKER_POLL_MS || 15_000);

async function getCursor(
  stream: string,
  contractAddress: Address,
  head: bigint,
) {
  const start = BigInt(process.env.INDEXER_START_BLOCK || "0");
  return prisma.eventCursor.upsert({
    where: {
      chainId_stream_contractAddress: {
        chainId,
        stream,
        contractAddress: contractAddress.toLowerCase(),
      },
    },
    create: {
      chainId,
      stream,
      contractAddress: contractAddress.toLowerCase(),
      nextBlock: (start || head).toString(),
      lastFinalizedBlock: (start || head).toString(),
      lastFinalizedBlockHash: "0x",
      overlapBlocks: 20,
    },
    update: {},
  });
}

async function verifyCursor(cursor: Awaited<ReturnType<typeof getCursor>>) {
  if (cursor.lastFinalizedBlockHash === "0x") return;
  const client = getPublicClient(chainId);
  const block = await client
    .getBlock({ blockNumber: BigInt(cursor.lastFinalizedBlock.toString()) })
    .catch(() => null);
  if (block?.hash === cursor.lastFinalizedBlockHash) return;
  const rollback = reorgRollbackBlock(
    BigInt(cursor.lastFinalizedBlock.toString()),
    cursor.overlapBlocks,
  );
  await prisma.$transaction([
    prisma.positionEvent.deleteMany({
      where: { chainId, blockNumber: { gte: rollback.toString() } },
    }),
    prisma.swapEvent.deleteMany({
      where: { chainId, blockNumber: { gte: rollback.toString() } },
    }),
    prisma.eventCursor.update({
      where: { id: cursor.id },
      data: {
        nextBlock: rollback.toString(),
        lastFinalizedBlock: rollback.toString(),
        lastFinalizedBlockHash: "0x",
      },
    }),
  ]);
  throw new Error(
    `Reorg detected; ${cursor.stream} rolled back to ${rollback}`,
  );
}

async function boundedLogs(
  address: Address,
  event: typeof transferEvent | typeof swapEvent,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const client = getPublicClient(chainId);
  let end = toBlock;
  while (end >= fromBlock) {
    try {
      const logs = await client.getLogs({
        address,
        event,
        fromBlock,
        toBlock: end,
        strict: true,
      });
      return { logs, end };
    } catch {
      const next = nextAdaptiveRange(fromBlock, end);
      if (next == null)
        throw new Error("Provider rejected the minimum indexer range");
      end = next;
    }
  }
  return { logs: [] as Log[], end: fromBlock };
}

async function indexTransfers(head: bigint) {
  const client = getPublicClient(chainId);
  const finalizedHead = head > confirmations ? head - confirmations : 0n;
  const cursor = await getCursor(
    "position-manager-transfers",
    mainnetManifest.positionManager,
    finalizedHead,
  );
  await verifyCursor(cursor);
  const from = BigInt(cursor.nextBlock.toString());
  if (from > finalizedHead) return;
  const requestedEnd =
    from + configuredBatch - 1n < finalizedHead
      ? from + configuredBatch - 1n
      : finalizedHead;
  const { logs, end } = await boundedLogs(
    mainnetManifest.positionManager,
    transferEvent,
    from,
    requestedEnd,
  );
  const wallets = await prisma.wallet.findMany({
    where: { chainId },
    select: { id: true, userId: true, address: true },
  });
  const byAddress = new Map(
    wallets.map((wallet) => [wallet.address.toLowerCase(), wallet]),
  );
  for (const log of logs) {
    const decoded = decodeEventLog({
      abi: [transferEvent],
      data: log.data,
      topics: log.topics,
    });
    const to = decoded.args.to.toLowerCase();
    const wallet = byAddress.get(to);
    if (!wallet) continue;
    const position = await readPosition(
      chainId,
      wallet.address,
      decoded.args.tokenId,
    ).catch(() => null);
    if (!position) continue;
    const stored = await persistValidatedPosition(
      wallet.userId,
      wallet.id,
      position,
    );
    await prisma.positionEvent.upsert({
      where: {
        chainId_transactionHash_logIndex: {
          chainId,
          transactionHash: log.transactionHash!,
          logIndex: log.logIndex!,
        },
      },
      create: {
        positionId: stored.id,
        chainId,
        transactionHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockNumber: log.blockNumber!.toString(),
        blockHash: log.blockHash!,
        eventType: "TRANSFER",
        rawLog: asPrismaJson(log),
        decoderVersion: 1,
      },
      update: { blockHash: log.blockHash!, rawLog: asPrismaJson(log) },
    });
  }
  const block = await client.getBlock({ blockNumber: end });
  await prisma.eventCursor.update({
    where: { id: cursor.id },
    data: {
      nextBlock: (end + 1n).toString(),
      lastFinalizedBlock: end.toString(),
      lastFinalizedBlockHash: block.hash,
    },
  });
}

async function indexPool(pool: { id: string; address: string }, head: bigint) {
  const client = getPublicClient(chainId);
  const finalizedHead = head > confirmations ? head - confirmations : 0n;
  const address = getAddress(pool.address);
  const cursor = await getCursor(
    `pool-swaps:${pool.id}`,
    address,
    finalizedHead,
  );
  await verifyCursor(cursor);
  const from = BigInt(cursor.nextBlock.toString());
  if (from > finalizedHead) return;
  const requestedEnd =
    from + configuredBatch - 1n < finalizedHead
      ? from + configuredBatch - 1n
      : finalizedHead;
  const { logs, end } = await boundedLogs(
    address,
    swapEvent,
    from,
    requestedEnd,
  );
  for (const log of logs) {
    const decoded = decodeEventLog({
      abi: [swapEvent],
      data: log.data,
      topics: log.topics,
    });
    await prisma.swapEvent.upsert({
      where: {
        chainId_transactionHash_logIndex: {
          chainId,
          transactionHash: log.transactionHash!,
          logIndex: log.logIndex!,
        },
      },
      create: {
        poolId: pool.id,
        chainId,
        transactionHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockNumber: log.blockNumber!.toString(),
        blockHash: log.blockHash!,
        sender: decoded.args.sender.toLowerCase(),
        recipient: decoded.args.recipient.toLowerCase(),
        amount0: decoded.args.amount0.toString(),
        amount1: decoded.args.amount1.toString(),
        sqrtPriceX96: decoded.args.sqrtPriceX96.toString(),
        liquidity: decoded.args.liquidity.toString(),
        tick: decoded.args.tick,
        rawLog: asPrismaJson(log),
        decoderVersion: 1,
      },
      update: { blockHash: log.blockHash!, rawLog: asPrismaJson(log) },
    });
  }
  const block = await client.getBlock({ blockNumber: end });
  await prisma.eventCursor.update({
    where: { id: cursor.id },
    data: {
      nextBlock: (end + 1n).toString(),
      lastFinalizedBlock: end.toString(),
      lastFinalizedBlockHash: block.hash,
    },
  });
}

async function cycle() {
  const client = getPublicClient(chainId);
  if ((await client.getChainId()) !== chainId)
    throw new Error("Indexer RPC chain mismatch");
  const head = await client.getBlockNumber();
  await indexTransfers(head);
  const pools = await prisma.pool.findMany({
    where: { chainId },
    select: { id: true, address: true },
  });
  for (const pool of pools) await indexPool(pool, head);
}

async function main() {
  for (;;) {
    await cycle().catch((error) =>
      console.error(
        "indexer_cycle_failed",
        error instanceof Error ? error.message : "unknown",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch(() => {
  process.exitCode = 1;
});
