import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { discoverPositions } from "@/src/operations/positions";
import { rateLimit } from "@/src/security/rate-limit";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.literal(4663),
});

export async function GET(request: Request) {
  try {
    rateLimit(request, "positions", 20);
    const url = new URL(request.url);
    const input = querySchema.parse({
      owner: url.searchParams.get("owner"),
      chainId: Number(url.searchParams.get("chainId") ?? "4663"),
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
