import { NextResponse } from "next/server";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/security/session";

export async function GET() {
  try {
    const session = await requireSession();
    const workflows = await prisma.workflow.findMany({
      where: { userId: session.userId, chainId: session.chainId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        steps: { orderBy: { ordinal: "asc" } },
        submissions: { orderBy: { submittedAt: "asc" } },
      },
    });
    return NextResponse.json(jsonSafe({ workflows }));
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
