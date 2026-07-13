import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const prisma = enabled
  ? new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } },
    })
  : null;

describe.skipIf(!enabled)("PostgreSQL workflow invariants", () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  it("enforces chain-scoped address identity", async () => {
    const tag = Date.now().toString();
    const user = await prisma!.user.create({
      data: { primaryAddress: `test-${tag}` },
    });
    await prisma!.wallet.create({
      data: {
        userId: user.id,
        chainId: 4663,
        address: `0x${tag.padStart(40, "0")}`,
        mode: "WATCH_ONLY",
      },
    });
    await expect(
      prisma!.wallet.create({
        data: {
          userId: user.id,
          chainId: 4663,
          address: `0x${tag.padStart(40, "0")}`,
          mode: "WATCH_ONLY",
        },
      }),
    ).rejects.toThrow();
    await prisma!.user.delete({ where: { id: user.id } });
  });
});
