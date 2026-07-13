import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { requireSession } from "@/src/security/session";
import { asPrismaJson } from "@/src/operations/persistence";

const schema = z.object({
  positionId: z.string().cuid(),
  kind: z.enum([
    "RANGE_GUARD",
    "AUTO_COMPOUND",
    "SCHEDULED_COMPOUND",
    "RECENTER",
    "ONE_SIDED_EXIT",
    "PROFIT_HARVEST",
  ]),
  mode: z.enum(["ALERT_ONLY", "APPROVAL_REQUIRED", "AUTOPILOT"]),
  minFeeThreshold0: z.string().regex(/^\d+$/).default("0"),
  minFeeThreshold1: z.string().regex(/^\d+$/).default("0"),
  rangeWidthBps: z.number().int().min(10).max(50_000).optional(),
  triggerDistanceBps: z.number().int().min(1).max(5_000).optional(),
  cooldownSeconds: z.number().int().min(300).max(2_592_000),
  maxExecutionsPerDay: z.number().int().min(1).max(24),
  maxGasPerExecutionWei: z.string().regex(/^\d+$/),
  maxDailyGasWei: z.string().regex(/^\d+$/),
  maxSlippageBps: z.number().int().min(1).max(2_000),
  maxPriceImpactBps: z.number().int().min(1).max(2_000),
  minPoolLiquidity: z.string().regex(/^\d+$/),
  maxQuoteAgeSeconds: z.number().int().min(15).max(3_600),
  maxBlockLag: z.number().int().min(1).max(1_000),
  minConfirmations: z.number().int().min(1).max(200),
  allowedOutputAssets: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(10),
  expiresAt: z.string().datetime().nullable().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function GET() {
  try {
    const session = await requireSession();
    const strategies = await prisma.strategy.findMany({
      where: { userId: session.userId, chainId: session.chainId },
      orderBy: { updatedAt: "desc" },
      include: {
        position: { include: { token0: true, token1: true } },
        executions: { orderBy: { startedAt: "desc" }, take: 5 },
      },
    });
    return NextResponse.json(jsonSafe({ strategies }));
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = schema.parse(await request.json());
    const position = await prisma.position.findFirstOrThrow({
      where: {
        id: input.positionId,
        chainId: session.chainId,
        wallet: { userId: session.userId },
      },
      include: { wallet: true },
    });
    if (
      input.mode === "AUTOPILOT" &&
      (position.wallet?.mode !== "AUTOPILOT" ||
        !position.wallet.automationEnabled)
    )
      throw new Error(
        "Autopilot mode requires an explicitly enabled dedicated automation wallet",
      );
    if (input.mode === "AUTOPILOT" && input.kind !== "PROFIT_HARVEST")
      throw new Error(
        "Unattended execution is limited to single-phase profit harvest; use approval-required mode for compound, recenter, guard, and exit strategies",
      );
    const strategy = await prisma.strategy.create({
      data: {
        userId: session.userId,
        positionId: position.id,
        chainId: session.chainId,
        kind: input.kind,
        mode: input.mode,
        enabled: false,
        minFeeThreshold0: input.minFeeThreshold0,
        minFeeThreshold1: input.minFeeThreshold1,
        rangeWidthBps: input.rangeWidthBps,
        triggerDistanceBps: input.triggerDistanceBps,
        cooldownSeconds: input.cooldownSeconds,
        maxExecutionsPerDay: input.maxExecutionsPerDay,
        maxGasPerExecutionWei: input.maxGasPerExecutionWei,
        maxDailyGasWei: input.maxDailyGasWei,
        maxSlippageBps: input.maxSlippageBps,
        maxPriceImpactBps: input.maxPriceImpactBps,
        minPoolLiquidity: input.minPoolLiquidity,
        maxQuoteAgeSeconds: input.maxQuoteAgeSeconds,
        maxBlockLag: input.maxBlockLag,
        minConfirmations: input.minConfirmations,
        allowedOutputAssets: input.allowedOutputAssets.map((address) =>
          address.toLowerCase(),
        ),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        config: asPrismaJson(input.config),
      },
    });
    return NextResponse.json(jsonSafe({ strategy }), { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request);
    const input = z
      .object({ id: z.string().cuid(), enabled: z.boolean() })
      .parse(await request.json());
    const strategy = await prisma.strategy.findFirstOrThrow({
      where: { id: input.id, userId: session.userId, chainId: session.chainId },
      include: { position: { include: { wallet: true } } },
    });
    if (
      input.enabled &&
      strategy.mode === "AUTOPILOT" &&
      (strategy.position.wallet?.mode !== "AUTOPILOT" ||
        !strategy.position.wallet.automationEnabled)
    )
      throw new Error("Dedicated automation wallet is not enabled");
    if (
      input.enabled &&
      strategy.mode === "AUTOPILOT" &&
      strategy.kind !== "PROFIT_HARVEST"
    )
      throw new Error(
        "Unattended execution is limited to single-phase profit harvest",
      );
    const updated = await prisma.strategy.update({
      where: { id: strategy.id },
      data: { enabled: input.enabled },
    });
    return NextResponse.json(jsonSafe({ strategy: updated }));
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
