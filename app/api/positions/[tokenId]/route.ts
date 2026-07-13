import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { readPosition } from "@/src/operations/positions";
import { rateLimit } from "@/src/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  try {
    rateLimit(request, "position", 40);
    const { tokenId } = await context.params;
    if (!/^\d+$/.test(tokenId)) throw new Error("Invalid token ID");
    const url = new URL(request.url);
    const owner = z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .parse(url.searchParams.get("owner"));
    const chainId = 4663;
    return NextResponse.json(
      jsonSafe(await readPosition(chainId, owner, BigInt(tokenId))),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 422 });
  }
}
