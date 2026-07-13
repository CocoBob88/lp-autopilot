import { NextResponse } from "next/server";
import { z } from "zod";
import { buildMintPlan } from "@/src/operations/mint-plan";
import { jsonSafe, sanitizeError } from "@/src/lib/serialize";
import { rateLimit } from "@/src/security/rate-limit";

export async function POST(request: Request) {
  try {
    rateLimit(request, "farm-mint-plan", 12);
    const plan = await buildMintPlan(await request.json());
    return NextResponse.json(jsonSafe({ plan }));
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      {
        error: sanitizeError(error),
        issues: error instanceof z.ZodError ? error.issues : undefined,
      },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
