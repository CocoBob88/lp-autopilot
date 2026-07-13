import { NextResponse } from "next/server";
import { getFarmScanner } from "@/src/operations/farms";
import { sanitizeError } from "@/src/lib/serialize";
import { rateLimit } from "@/src/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    rateLimit(request, "farm-scanner", 30);
    const token = new URL(request.url).searchParams.get("token")?.trim();
    const response = await getFarmScanner(token || undefined);
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": token
          ? "public, max-age=30, stale-while-revalidate=120"
          : "public, max-age=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 422 });
  }
}
