import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAddress, zeroAddress } from "viem";
import { z } from "zod";
import { mainnetManifest } from "@/src/chains/robinhood";
import { databaseConfigured, prisma } from "@/src/lib/db";
import { sanitizeError } from "@/src/lib/serialize";
import { rateLimit } from "@/src/security/rate-limit";

const schema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.union([z.literal(4663), z.literal(46630)]),
});

export async function POST(request: Request) {
  try {
    rateLimit(request, "auth-nonce", 10);
    if (!databaseConfigured())
      return NextResponse.json(
        { error: "Database is required for wallet authentication" },
        { status: 503 },
      );
    const input = schema.parse(await request.json());
    const address = getAddress(input.address);
    const nonce = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await prisma.authNonce.create({
      data: {
        address: address.toLowerCase(),
        chainId: input.chainId,
        nonceHash: createHash("sha256").update(nonce).digest("hex"),
        expiresAt,
      },
    });
    const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
    return NextResponse.json({
      nonce,
      typedData: {
        domain: {
          name: "LP Autopilot",
          version: "1",
          chainId: input.chainId,
          verifyingContract:
            input.chainId === 4663
              ? mainnetManifest.positionManager
              : zeroAddress,
        },
        types: {
          Login: [
            { name: "wallet", type: "address" },
            { name: "nonce", type: "string" },
            { name: "uri", type: "string" },
            { name: "expirationTime", type: "uint256" },
          ],
        },
        primaryType: "Login",
        message: {
          wallet: address,
          nonce,
          uri: origin,
          expirationTime: BigInt(
            Math.floor(expiresAt.getTime() / 1000),
          ).toString(),
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 500 },
    );
  }
}
