import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { buildWorkflowPlan } from "@/src/operations/plan";
import {
  asPrismaJson,
  persistValidatedPosition,
} from "@/src/operations/persistence";
import { rateLimit } from "@/src/security/rate-limit";
import { requireSession } from "@/src/security/session";

export async function POST(request: Request) {
  try {
    rateLimit(request, "workflow-plan", 15);
    const session = await requireSession(request);
    const raw = await request.json();
    if (
      raw.owner?.toLowerCase() !== session.address.toLowerCase() ||
      raw.chainId !== session.chainId
    )
      throw new Error(
        "Authenticated wallet or chain does not match the requested plan",
      );
    const plan = await buildWorkflowPlan(raw);
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: {
        userId_chainId_address: {
          userId: session.userId,
          chainId: session.chainId,
          address: session.address.toLowerCase(),
        },
      },
    });
    if (wallet.executionDisabled)
      throw new Error("Wallet execution is disabled by its kill switch");
    const position = await persistValidatedPosition(
      session.userId,
      wallet.id,
      plan.position,
    );
    const existing = await prisma.workflow.findUnique({
      where: {
        userId_chainId_workflowKey: {
          userId: session.userId,
          chainId: session.chainId,
          workflowKey: plan.workflowKey,
        },
      },
      include: { steps: true, submissions: true },
    });
    if (existing) {
      if (existing.requestHash !== plan.requestHash)
        return NextResponse.json(
          { error: "Workflow key is already bound to a different request" },
          { status: 409 },
        );
      return NextResponse.json(
        jsonSafe({ workflow: existing, plan: existing.plan }),
      );
    }
    const workflow = await prisma.workflow.create({
      data: {
        userId: session.userId,
        walletId: wallet.id,
        positionId: position.id,
        chainId: session.chainId,
        type: plan.action.toUpperCase(),
        workflowKey: plan.workflowKey,
        requestHash: plan.requestHash,
        status: "SIMULATED",
        planVersion: plan.version,
        quoteBlock: plan.quoteBlock.toString(),
        quoteTimestamp: new Date(plan.quoteTimestamp),
        plan: asPrismaJson(plan),
        policy: asPrismaJson({
          slippageBps: plan.slippageBps,
          deadline: plan.deadline,
          liveExecutionEnabled: plan.liveExecutionEnabled,
        }),
        expectedDeltas: asPrismaJson(plan.expected),
        steps: {
          create: plan.steps.map((step) => ({
            ordinal: step.ordinal,
            kind: step.kind,
            status: step.simulated ? "SIMULATED" : "PLANNED",
            requestHash: plan.requestHash,
            target: step.target,
            method: step.method,
            calldata: step.calldata,
            valueWei: step.value.toString(),
            simulation: asPrismaJson({
              ok: step.simulated,
              gasEstimate: step.gasEstimate?.toString(),
              error: step.simulationError,
            }),
            expectedDelta: asPrismaJson(plan.expected),
          })),
        },
      },
      include: { steps: true },
    });
    return NextResponse.json(jsonSafe({ workflow, plan }), { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      {
        error: sanitizeError(error),
        issues: error instanceof z.ZodError ? error.issues : undefined,
      },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
