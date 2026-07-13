import { randomUUID } from "node:crypto";
import { prisma } from "@/src/lib/db";

export async function acquireNonceLease(
  walletId: string,
  chainId: number,
  address: string,
  nonce: bigint,
  ttlMs = 60_000,
) {
  const ownerToken = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    const lease = await prisma.nonceLease.create({
      data: {
        walletId,
        chainId,
        address: address.toLowerCase(),
        nonce: nonce.toString(),
        ownerToken,
        expiresAt,
      },
    });
    return lease;
  } catch {
    const existing = await prisma.nonceLease.findUnique({
      where: {
        chainId_address_nonce: {
          chainId,
          address: address.toLowerCase(),
          nonce: nonce.toString(),
        },
      },
    });
    if (existing && existing.expiresAt < new Date() && !existing.releasedAt) {
      return prisma.nonceLease.update({
        where: { id: existing.id },
        data: { ownerToken, expiresAt, releasedAt: null },
      });
    }
    throw new Error("The signer nonce is already leased by another execution");
  }
}

export async function releaseNonceLease(ownerToken: string) {
  await prisma.nonceLease.update({
    where: { ownerToken },
    data: { releasedAt: new Date() },
  });
}
