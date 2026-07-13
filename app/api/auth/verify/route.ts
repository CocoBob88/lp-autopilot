import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAddress, verifyTypedData, zeroAddress } from "viem";
import { z } from "zod";
import { mainnetManifest } from "@/src/chains/robinhood";
import { prisma } from "@/src/lib/db";
import { sanitizeError } from "@/src/lib/serialize";
import { rateLimit } from "@/src/security/rate-limit";
import { createSession } from "@/src/security/session";

const schema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.union([z.literal(4663), z.literal(46630)]),
  nonce: z.string().min(20),
  expirationTime: z.string().regex(/^\d+$/),
  uri: z.string().url(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(request: Request) {
  try {
    rateLimit(request, "auth-verify", 10);
    const input = schema.parse(await request.json());
    const address = getAddress(input.address);
    const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
    if (new URL(input.uri).origin !== new URL(origin).origin)
      throw new Error("Authentication origin mismatch");
    if (BigInt(input.expirationTime) < BigInt(Math.floor(Date.now() / 1000)))
      throw new Error("Authentication request expired");
    const nonceHash = createHash("sha256").update(input.nonce).digest("hex");
    const nonce = await prisma.authNonce.findUnique({ where: { nonceHash } });
    if (
      !nonce ||
      nonce.consumedAt ||
      nonce.expiresAt < new Date() ||
      nonce.chainId !== input.chainId ||
      nonce.address !== address.toLowerCase()
    )
      throw new Error("Authentication nonce is invalid or expired");
    const valid = await verifyTypedData({
      address,
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
        nonce: input.nonce,
        uri: input.uri,
        expirationTime: BigInt(input.expirationTime),
      },
      signature: input.signature as `0x${string}`,
    });
    if (!valid) throw new Error("Wallet signature did not verify");
    const user = await prisma.$transaction(async (tx) => {
      await tx.authNonce.update({
        where: { id: nonce.id },
        data: { consumedAt: new Date() },
      });
      const existing = await tx.user.findFirst({
        where: { primaryAddress: address.toLowerCase() },
      });
      const account =
        existing ??
        (await tx.user.create({
          data: { primaryAddress: address.toLowerCase() },
        }));
      await tx.wallet.upsert({
        where: {
          userId_chainId_address: {
            userId: account.id,
            chainId: input.chainId,
            address: address.toLowerCase(),
          },
        },
        create: {
          userId: account.id,
          chainId: input.chainId,
          address: address.toLowerCase(),
          mode: "ASSISTED",
          label: "Browser wallet",
        },
        update: { mode: "ASSISTED" },
      });
      return account;
    });
    const csrfToken = await createSession({
      userId: user.id,
      address,
      chainId: input.chainId,
    });
    return NextResponse.json({
      authenticated: true,
      address,
      chainId: input.chainId,
      csrfToken,
    });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeError(error) },
      { status: error instanceof z.ZodError ? 400 : 401 },
    );
  }
}
