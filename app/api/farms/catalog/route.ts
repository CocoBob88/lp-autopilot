import { NextResponse } from "next/server";
import { getFarmScanner } from "@/src/operations/farms";
import { sanitizeError } from "@/src/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await getFarmScanner(undefined, true);
    return NextResponse.json({
      catalogSize: result.catalogSize,
      visiblePools: result.farms.length,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 422 });
  }
}
