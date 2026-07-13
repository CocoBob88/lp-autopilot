import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { sanitizeError } from "@/src/lib/serialize";
import { requireSession } from "@/src/security/session";

const schema = z.object({
  workflowId: z.string().cuid(),
  stepOrdinal: z.number().int().nonnegative(),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  nonce: z.string().regex(/^\d+$/),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = schema.parse(await request.json());
    const workflow = await prisma.workflow.findFirstOrThrow({
      where: {
        id: input.workflowId,
        userId: session.userId,
        chainId: session.chainId,
      },
      include: { steps: true, wallet: true },
    });
    const step = workflow.steps.find(
      (candidate) => candidate.ordinal === input.stepOrdinal,
    );
    if (!step) throw new Error("Workflow step does not exist");
    if (workflow.wallet.address !== session.address.toLowerCase())
      throw new Error("Signer does not own this workflow");
    const submission = await prisma.transactionSubmission.upsert({
      where: {
        chainId_transactionHash: {
          chainId: session.chainId,
          transactionHash: input.transactionHash.toLowerCase(),
        },
      },
      create: {
        workflowId: workflow.id,
        stepId: step.id,
        chainId: session.chainId,
        signerAddress: getAddress(session.address).toLowerCase(),
        nonce: input.nonce,
        transactionHash: input.transactionHash.toLowerCase(),
        status: "SUBMITTED",
      },
      update: { status: "SUBMITTED" },
    });
    await prisma.$transaction([
      prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: "SUBMITTED" },
      }),
      prisma.workflow.update({
        where: { id: workflow.id },
        data: { status: "SUBMITTED" },
      }),
    ]);
    return NextResponse.json({
      checkpointed: true,
      submissionId: submission.id,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
