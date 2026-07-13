import { NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { sanitizeError } from "@/src/lib/serialize";
import { encryptAutomationKey } from "@/src/security/automation-key";
import { requireSession } from "@/src/security/session";

const schema = z.object({
  label: z.string().min(1).max(50),
  maxGasPerExecutionWei: z.string().regex(/^\d+$/),
  maxDailyGasWei: z.string().regex(/^\d+$/),
  confirmation: z.literal("CREATE DEDICATED AUTOPILOT WALLET"),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    if (process.env.AUTOPILOT_ENABLED !== "true")
      throw new Error(
        "Autopilot wallet creation is disabled by the server gate",
      );
    const input = schema.parse(await request.json());
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = await prisma.wallet.create({
      data: {
        userId: session.userId,
        chainId: session.chainId,
        address: account.address.toLowerCase(),
        label: input.label,
        mode: "AUTOPILOT",
        encryptedPrivateKey: encryptAutomationKey(privateKey),
        encryptionVersion: 1,
        automationEnabled: false,
        maxGasPerExecutionWei: input.maxGasPerExecutionWei,
        maxDailyGasWei: input.maxDailyGasWei,
      },
    });
    return NextResponse.json(
      {
        id: wallet.id,
        address: account.address,
        recoveryPrivateKey: privateKey,
        warning:
          "This key is shown once. Back it up securely before funding the dedicated wallet.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 422 },
    );
  }
}
