import { NextResponse } from "next/server";
import { decodeEventLog } from "viem";
import { z } from "zod";
import { getPublicClient } from "@/src/lib/client";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { prisma } from "@/src/lib/db";
import {
  asPrismaJson,
  persistValidatedPosition,
} from "@/src/operations/persistence";
import { readPosition } from "@/src/operations/positions";
import { requireSession } from "@/src/security/session";
import { positionManagerAbi } from "@/src/contracts/abis";

const schema = z.object({ workflowId: z.string().cuid() });

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const { workflowId } = schema.parse(await request.json());
    const workflow = await prisma.workflow.findFirstOrThrow({
      where: {
        id: workflowId,
        userId: session.userId,
        chainId: session.chainId,
      },
      include: { submissions: true, steps: true, position: true, wallet: true },
    });
    const client = getPublicClient(session.chainId);
    const head = await client.getBlockNumber();
    let pending = false;
    let reverted = false;
    let actualCollected0 = 0n;
    let actualCollected1 = 0n;
    for (const submission of workflow.submissions) {
      const receipt = await client
        .getTransactionReceipt({
          hash: submission.transactionHash as `0x${string}`,
        })
        .catch(() => null);
      if (!receipt) {
        pending = true;
        continue;
      }
      const canonicalBlock = await client.getBlock({
        blockNumber: receipt.blockNumber,
      });
      if (canonicalBlock.hash !== receipt.blockHash) {
        pending = true;
        continue;
      }
      const confirmations = head - receipt.blockNumber + 1n;
      const required = BigInt(
        Number(process.env.ROBINHOOD_CONFIRMATIONS || 12),
      );
      const status =
        receipt.status === "reverted"
          ? "REVERTED"
          : confirmations >= required
            ? "CONFIRMED"
            : "CONFIRMING";
      reverted ||= receipt.status === "reverted";
      pending ||= status === "CONFIRMING";
      for (const log of receipt.logs) {
        if (
          log.address.toLowerCase() !==
          workflow.position?.managerAddress.toLowerCase()
        )
          continue;
        try {
          const decoded = decodeEventLog({
            abi: positionManagerAbi,
            data: log.data,
            topics: log.topics,
          });
          if (
            decoded.eventName === "Collect" &&
            decoded.args.tokenId.toString() ===
              workflow.position?.tokenId.toString()
          ) {
            actualCollected0 += decoded.args.amount0;
            actualCollected1 += decoded.args.amount1;
          }
        } catch {
          /* unrelated manager log */
        }
      }
      await prisma.transactionSubmission.update({
        where: { id: submission.id },
        data: {
          status,
          receipt: asPrismaJson(receipt),
          confirmedBlock: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        },
      });
      if (submission.stepId)
        await prisma.workflowStep.update({
          where: { id: submission.stepId },
          data: {
            status:
              status === "CONFIRMED"
                ? "COMPLETED"
                : status === "REVERTED"
                  ? "REVERTED"
                  : "CONFIRMING",
            actualDelta: asPrismaJson({
              gasUsed: receipt.gasUsed,
              effectiveGasPrice: receipt.effectiveGasPrice,
            }),
          },
        });
    }
    let finalPosition = null;
    if (!pending && !reverted && workflow.position) {
      finalPosition = await readPosition(
        session.chainId,
        workflow.wallet.address,
        BigInt(workflow.position.tokenId.toString()),
      ).catch(() => null);
      if (finalPosition)
        await persistValidatedPosition(
          session.userId,
          workflow.wallet.id,
          finalPosition,
        );
    }
    const status = reverted
      ? "REVERTED"
      : pending
        ? "CONFIRMING"
        : finalPosition
          ? "COMPLETED"
          : "RECONCILIATION_REQUIRED";
    const updated = await prisma.workflow.update({
      where: { id: workflow.id },
      data: {
        status,
        actualDeltas: asPrismaJson({
          collected0: actualCollected0,
          collected1: actualCollected1,
          liquidity: finalPosition?.liquidity,
          amount0: finalPosition?.amount0,
          amount1: finalPosition?.amount1,
          fees0: finalPosition?.feePreview.amount0,
          fees1: finalPosition?.feePreview.amount1,
        }),
        completedAt: status === "COMPLETED" ? new Date() : undefined,
      },
      include: { submissions: true, steps: true },
    });
    return NextResponse.json(
      jsonSafe({
        workflow: updated,
        position: finalPosition,
        actualCollected: {
          amount0: actualCollected0,
          amount1: actualCollected1,
        },
      }),
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
