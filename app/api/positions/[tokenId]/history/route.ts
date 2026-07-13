import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  try {
    const { tokenId } = await context.params;
    const url = new URL(request.url);
    const chainId = z.coerce
      .number()
      .refine((value) => value === 4663 || value === 46630)
      .parse(url.searchParams.get("chainId") ?? "4663");
    const managerAddress = z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .parse(url.searchParams.get("manager"));
    const position = await prisma.position.findUnique({
      where: {
        chainId_managerAddress_tokenId: {
          chainId,
          managerAddress: managerAddress.toLowerCase(),
          tokenId,
        },
      },
      include: { pool: true },
    });
    if (!position)
      return NextResponse.json({
        swaps: [],
        events: [],
        evidence:
          "No indexed history is available for this validated position.",
      });
    const [swaps, events] = await Promise.all([
      prisma.swapEvent.findMany({
        where: { poolId: position.poolId },
        orderBy: { blockNumber: "asc" },
        take: 2_000,
      }),
      prisma.positionEvent.findMany({
        where: { positionId: position.id },
        orderBy: { blockNumber: "asc" },
        take: 500,
      }),
    ]);
    return NextResponse.json(
      jsonSafe({
        swaps,
        events,
        evidence: `${swaps.length} canonical indexed swaps`,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { swaps: [], events: [], error: sanitizeError(error) },
      { status: 503 },
    );
  }
}
