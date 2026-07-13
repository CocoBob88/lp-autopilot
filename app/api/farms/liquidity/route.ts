import { NextResponse } from "next/server";
import { getLiquidityDistribution } from "@/src/operations/liquidity-distribution";
import { sanitizeError } from "@/src/lib/serialize";
import { rateLimit } from "@/src/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    rateLimit(request, "farm-liquidity", 30);
    const pool = new URL(request.url).searchParams.get("pool") ?? "";
    const distribution = await getLiquidityDistribution(pool);
    return NextResponse.json(distribution, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 422 });
  }
}
