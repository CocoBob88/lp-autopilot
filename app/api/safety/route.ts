import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { requireSession } from "@/src/security/session";

export async function GET() {
  try {
    const session = await requireSession();
    const [breakers, wallets] = await Promise.all([
      prisma.circuitBreaker.findMany({
        where: {
          chainId: session.chainId,
          OR: [
            { scope: "GLOBAL" },
            { wallet: { userId: session.userId } },
            { position: { wallet: { userId: session.userId } } },
          ],
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.wallet.findMany({
        where: { userId: session.userId, chainId: session.chainId },
        select: {
          id: true,
          address: true,
          label: true,
          mode: true,
          executionDisabled: true,
          automationEnabled: true,
        },
      }),
    ]);
    return NextResponse.json(jsonSafe({ breakers, wallets }));
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

const schema = z.object({
  action: z.enum(["EMERGENCY_STOP", "RESET_GLOBAL"]),
  confirmation: z.string(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request);
    const input = schema.parse(await request.json());
    if (input.action === "EMERGENCY_STOP") {
      if (input.confirmation !== "EMERGENCY STOP")
        throw new Error("Emergency stop confirmation did not match");
      await prisma.$transaction([
        prisma.wallet.updateMany({
          where: { userId: session.userId, chainId: session.chainId },
          data: { executionDisabled: true, automationEnabled: false },
        }),
        prisma.circuitBreaker.create({
          data: {
            chainId: session.chainId,
            scope: "GLOBAL",
            active: true,
            consecutiveFailures: 0,
            reasonCode: `MANUAL_STOP:${session.userId}`,
            activatedAt: new Date(),
          },
        }),
      ]);
    } else {
      if (input.confirmation !== "RESET AFTER REVIEW")
        throw new Error("Reset confirmation did not match");
      await prisma.circuitBreaker.updateMany({
        where: {
          chainId: session.chainId,
          scope: "GLOBAL",
          active: true,
          reasonCode: { startsWith: `MANUAL_STOP:${session.userId}` },
        },
        data: {
          active: false,
          resetAt: new Date(),
          resetByUserId: session.userId,
        },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
