import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { discoverPositions } from "@/src/operations/positions";
import { rateLimit } from "@/src/security/rate-limit";
import { requireSession } from "@/src/security/session";
import { prisma } from "@/src/lib/db";
import { persistValidatedPosition } from "@/src/operations/persistence";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.coerce
    .number()
    .refine((value) => value === 4663 || value === 46630),
});

export async function GET(request: Request) {
  try {
    rateLimit(request, "positions", 20);
    const url = new URL(request.url);
    const input = querySchema.parse({
      owner: url.searchParams.get("owner"),
      chainId: url.searchParams.get("chainId") ?? "4663",
    });
    return NextResponse.json(
      jsonSafe(await discoverPositions(input.chainId, input.owner)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 422;
    return NextResponse.json({ error: sanitizeError(error) }, { status });
  }
}

export async function POST(request: Request) {
  try {
    rateLimit(request, "position-sync", 10);
    const session = await requireSession(request);
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: {
        userId_chainId_address: {
          userId: session.userId,
          chainId: session.chainId,
          address: session.address.toLowerCase(),
        },
      },
    });
    const discovered = await discoverPositions(
      session.chainId,
      session.address,
    );
    const stored = [];
    for (const position of discovered.positions)
      stored.push(
        await persistValidatedPosition(session.userId, wallet.id, position),
      );
    return NextResponse.json(
      jsonSafe({ positions: stored, validated: discovered.positions.length }),
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: sanitizeError(error) }, { status: 422 });
  }
}
