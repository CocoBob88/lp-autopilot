import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { requireSession } from "@/src/security/session";

export async function GET() {
  try {
    const session = await requireSession();
    const alerts = await prisma.alert.findMany({
      where: { userId: session.userId, chainId: session.chainId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json(jsonSafe({ alerts }));
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request);
    const { id } = z
      .object({ id: z.string().cuid() })
      .parse(await request.json());
    const result = await prisma.alert.updateMany({
      where: { id, userId: session.userId, chainId: session.chainId },
      data: { acknowledgedAt: new Date() },
    });
    if (!result.count)
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    return NextResponse.json({ acknowledged: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
