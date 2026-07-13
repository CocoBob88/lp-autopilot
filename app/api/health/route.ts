import { NextResponse } from "next/server";
import { getPublicClient } from "@/src/lib/client";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { validateManifest } from "@/src/operations/manifest";
import { rateLimit } from "@/src/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    rateLimit(request, "health", 120);
    const url = new URL(request.url);
    const chainId = 4663;
    const started = Date.now();
    const validation = await validateManifest(
      chainId,
      url.searchParams.get("fresh") === "true",
    );
    const client = getPublicClient(chainId);
    const feeData = await client.estimateFeesPerGas();
    return NextResponse.json(
      jsonSafe({
        ...validation,
        latencyMs: Date.now() - started,
        indexerLag: null,
        feeData,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { healthy: false, error: sanitizeError(error) },
      { status: 503 },
    );
  }
}
