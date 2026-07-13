import { prisma } from "@/src/lib/db";

export async function assertExecutionAllowed(
  chainId: number,
  walletId?: string,
  positionId?: string,
) {
  const active = await prisma.circuitBreaker.findFirst({
    where: {
      chainId,
      active: true,
      OR: [
        { scope: "GLOBAL" },
        ...(walletId ? [{ scope: "WALLET" as const, walletId }] : []),
        ...(positionId ? [{ scope: "POSITION" as const, positionId }] : []),
      ],
    },
  });
  if (active)
    throw new Error(
      `Execution blocked by ${active.scope.toLowerCase()} circuit breaker`,
    );
}

export async function recordExecutionFailure(
  chainId: number,
  scope: "GLOBAL" | "WALLET" | "POSITION",
  scopeId: string | null,
  reasonCode: string,
) {
  const where =
    scope === "GLOBAL"
      ? { walletId: null, positionId: null }
      : scope === "WALLET"
        ? { walletId: scopeId }
        : { positionId: scopeId };
  const breaker = await prisma.circuitBreaker.findFirst({
    where: { chainId, scope, ...where },
  });
  if (!breaker)
    return prisma.circuitBreaker.create({
      data: { chainId, scope, ...where, consecutiveFailures: 1, reasonCode },
    });
  const failures = breaker.consecutiveFailures + 1;
  return prisma.circuitBreaker.update({
    where: { id: breaker.id },
    data: {
      consecutiveFailures: failures,
      reasonCode,
      active: failures >= breaker.threshold,
      activatedAt:
        failures >= breaker.threshold ? new Date() : breaker.activatedAt,
    },
  });
}

export async function recordExecutionSuccess(
  chainId: number,
  walletId: string,
) {
  await prisma.circuitBreaker.updateMany({
    where: { chainId, walletId, active: false },
    data: { consecutiveFailures: 0, reasonCode: null },
  });
}
