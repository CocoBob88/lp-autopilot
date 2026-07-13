import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainConfig, liveWritesEnabled } from "@/src/chains/robinhood";
import { poolAbi } from "@/src/contracts/abis";
import { getPublicClient } from "@/src/lib/client";
import { prisma } from "@/src/lib/db";
import {
  asPrismaJson,
  persistValidatedPosition,
} from "@/src/operations/persistence";
import { buildWorkflowPlan } from "@/src/operations/plan";
import { readPosition } from "@/src/operations/positions";
import { decryptAutomationKey } from "@/src/security/automation-key";
import {
  assertExecutionAllowed,
  recordExecutionFailure,
  recordExecutionSuccess,
} from "@/src/security/breaker";
import {
  acquireNonceLease,
  releaseNonceLease,
} from "@/src/security/nonce-lease";
import { deliverNotification } from "@/src/notifications";
import { evaluateExecutionBudget } from "@/src/domain/budget";

const pollMs = Number(process.env.WORKER_POLL_MS || 15_000);

async function createAlert(
  strategy: Awaited<ReturnType<typeof loadStrategy>>,
  type: string,
  title: string,
  message: string,
  evidence: unknown,
  severity: "INFO" | "WARNING" | "CRITICAL" = "WARNING",
) {
  const errors = await deliverNotification({
    title,
    message,
    severity,
    evidence,
  });
  return prisma.alert.create({
    data: {
      userId: strategy.userId,
      chainId: strategy.chainId,
      positionId: strategy.positionId,
      strategyId: strategy.id,
      type,
      severity,
      title,
      message,
      evidence: asPrismaJson(evidence),
      deliveredAt: errors.length ? null : new Date(),
      deliveryErrors: errors.length ? asPrismaJson(errors) : undefined,
    },
  });
}

async function loadStrategy(id: string) {
  return prisma.strategy.findUniqueOrThrow({
    where: { id },
    include: {
      position: {
        include: { wallet: true, pool: true, token0: true, token1: true },
      },
    },
  });
}

async function twapTick(
  chainId: number,
  poolAddress: `0x${string}`,
  seconds = 1800,
) {
  const client = getPublicClient(chainId);
  const [cumulatives] = await client.readContract({
    address: poolAddress,
    abi: poolAbi,
    functionName: "observe",
    args: [[seconds, 0]],
  });
  const delta = cumulatives[1] - cumulatives[0];
  let average = delta / BigInt(seconds);
  if (delta < 0n && delta % BigInt(seconds) !== 0n) average -= 1n;
  return Number(average);
}

async function executeAutopilot(
  strategy: Awaited<ReturnType<typeof loadStrategy>>,
  action: "collect" | "compound",
  owner: `0x${string}`,
) {
  const wallet = strategy.position.wallet;
  if (
    !wallet?.encryptedPrivateKey ||
    wallet.mode !== "AUTOPILOT" ||
    !wallet.automationEnabled
  )
    throw new Error("Dedicated automation wallet is not enabled");
  if (
    process.env.AUTOPILOT_ENABLED !== "true" ||
    !liveWritesEnabled(strategy.chainId)
  )
    throw new Error("Autopilot live execution gates are disabled");
  await assertExecutionAllowed(
    strategy.chainId,
    wallet.id,
    strategy.positionId,
  );
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const executionsToday = await prisma.strategyExecution.findMany({
    where: { strategyId: strategy.id, startedAt: { gte: today } },
  });
  const gasToday = executionsToday.reduce(
    (sum, item) => sum + BigInt(item.gasCostWei?.toString() || "0"),
    0n,
  );
  const plan = await buildWorkflowPlan({
    chainId: strategy.chainId,
    owner,
    tokenId: strategy.position.tokenId.toString(),
    workflowKey: `strategy:${strategy.id}:${Date.now()}`,
    action,
    slippageBps: strategy.maxSlippageBps,
    deadlineSeconds: Math.min(strategy.maxQuoteAgeSeconds, 600),
    unwrapWeth: false,
    ...(action === "compound" ? { allowBalancingSwap: false } : {}),
  });
  const budget = evaluateExecutionBudget({
    executionsToday: executionsToday.length,
    maxExecutionsPerDay: strategy.maxExecutionsPerDay,
    gasSpentWei: gasToday,
    estimatedGasWei: plan.maximumGasCostWei,
    maxGasPerExecutionWei: BigInt(strategy.maxGasPerExecutionWei.toString()),
    maxDailyGasWei: BigInt(strategy.maxDailyGasWei.toString()),
  });
  if (!budget.allowed)
    throw new Error(`Strategy budget failed: ${budget.reason}`);
  const privateKey = decryptAutomationKey(wallet.encryptedPrivateKey);
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== wallet.address)
    throw new Error("Automation signer does not match the dedicated wallet");
  const { chain, rpcUrl } = getChainConfig(strategy.chainId);
  const publicClient = getPublicClient(strategy.chainId);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const storedPosition = await persistValidatedPosition(
    strategy.userId,
    wallet.id,
    plan.position,
  );
  const workflow = await prisma.workflow.create({
    data: {
      userId: strategy.userId,
      walletId: wallet.id,
      positionId: storedPosition.id,
      chainId: strategy.chainId,
      type: action.toUpperCase(),
      workflowKey: plan.workflowKey,
      requestHash: plan.requestHash,
      status: "SUBMITTING",
      planVersion: plan.version,
      quoteBlock: plan.quoteBlock.toString(),
      quoteTimestamp: new Date(plan.quoteTimestamp),
      plan: asPrismaJson(plan),
      policy: asPrismaJson({ strategyId: strategy.id }),
      expectedDeltas: asPrismaJson(plan.expected),
      steps: {
        create: plan.steps.map((step) => ({
          ordinal: step.ordinal,
          kind: step.kind,
          status: "PLANNED",
          requestHash: plan.requestHash,
          target: step.target,
          method: step.method,
          calldata: step.calldata,
          valueWei: step.value.toString(),
          simulation: asPrismaJson({
            initial: step.simulated,
            error: step.simulationError,
          }),
        })),
      },
    },
    include: { steps: true },
  });
  const execution = await prisma.strategyExecution.create({
    data: {
      strategyId: strategy.id,
      chainId: strategy.chainId,
      workflowId: workflow.id,
      triggerBlock: plan.quoteBlock.toString(),
      triggerEvidence: asPrismaJson({
        twapRequired: true,
        planHash: plan.requestHash,
      }),
      decision: "EXECUTE",
    },
  });
  let gasCost = 0n;
  try {
    for (const step of plan.steps) {
      if (step.calldata === "0x")
        throw new Error("Dependent workflow step requires a fresh plan");
      const data = step.calldata as Hex;
      await publicClient.call({
        account,
        to: step.target,
        data,
        value: step.value,
      });
      const gas = await publicClient.estimateGas({
        account,
        to: step.target,
        data,
        value: step.value,
      });
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      const lease = await acquireNonceLease(
        wallet.id,
        strategy.chainId,
        wallet.address,
        BigInt(nonce),
      );
      try {
        const hash = await walletClient.sendTransaction({
          account,
          chain,
          to: step.target,
          data,
          value: step.value,
          gas,
          nonce,
        });
        const dbStep = workflow.steps.find(
          (candidate) => candidate.ordinal === step.ordinal,
        )!;
        const submission = await prisma.transactionSubmission.create({
          data: {
            workflowId: workflow.id,
            stepId: dbStep.id,
            chainId: strategy.chainId,
            signerAddress: wallet.address,
            nonce: String(nonce),
            transactionHash: hash.toLowerCase(),
            status: "SUBMITTED",
          },
        });
        await prisma.workflow.update({
          where: { id: workflow.id },
          data: { status: "SUBMITTED" },
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: strategy.minConfirmations,
          timeout: 120_000,
        });
        if (receipt.status !== "success")
          throw new Error("Autopilot transaction reverted");
        const stepGas = receipt.gasUsed * receipt.effectiveGasPrice;
        gasCost += stepGas;
        await prisma.$transaction([
          prisma.transactionSubmission.update({
            where: { id: submission.id },
            data: {
              status: "CONFIRMED",
              receipt: asPrismaJson(receipt),
              confirmedBlock: receipt.blockNumber.toString(),
              blockHash: receipt.blockHash,
              gasUsed: receipt.gasUsed.toString(),
              effectiveGasPrice: receipt.effectiveGasPrice.toString(),
            },
          }),
          prisma.workflowStep.update({
            where: { id: dbStep.id },
            data: {
              status: "COMPLETED",
              actualDelta: asPrismaJson({ gasCostWei: stepGas }),
            },
          }),
        ]);
      } finally {
        await releaseNonceLease(lease.ownerToken);
      }
    }
    const final = await readPosition(
      strategy.chainId,
      wallet.address,
      BigInt(strategy.position.tokenId.toString()),
    );
    await persistValidatedPosition(strategy.userId, wallet.id, final);
    await prisma.$transaction([
      prisma.workflow.update({
        where: { id: workflow.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          actualDeltas: asPrismaJson({
            liquidity: final.liquidity,
            fees0: final.feePreview.amount0,
            fees1: final.feePreview.amount1,
          }),
        },
      }),
      prisma.strategyExecution.update({
        where: { id: execution.id },
        data: { completedAt: new Date(), gasCostWei: gasCost.toString() },
      }),
      prisma.strategy.update({
        where: { id: strategy.id },
        data: { lastExecutedAt: new Date() },
      }),
    ]);
    await recordExecutionSuccess(strategy.chainId, wallet.id);
  } catch (error) {
    await prisma.$transaction([
      prisma.workflow.update({
        where: { id: workflow.id },
        data: {
          status: "RECONCILIATION_REQUIRED",
          errorCode: "AUTOPILOT_INTERRUPTED",
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Execution interrupted",
        },
      }),
      prisma.strategyExecution.update({
        where: { id: execution.id },
        data: {
          completedAt: new Date(),
          gasCostWei: gasCost.toString(),
          errorCode: "AUTOPILOT_INTERRUPTED",
        },
      }),
    ]);
    await recordExecutionFailure(
      strategy.chainId,
      "WALLET",
      wallet.id,
      "AUTOPILOT_INTERRUPTED",
    );
    throw error;
  }
}

async function evaluate(id: string) {
  const strategy = await loadStrategy(id);
  if (
    !strategy.enabled ||
    (strategy.expiresAt && strategy.expiresAt < new Date())
  )
    return;
  const wallet = strategy.position.wallet;
  if (!wallet || wallet.executionDisabled) return;
  const client = getPublicClient(strategy.chainId);
  const [head, cursor, position] = await Promise.all([
    client.getBlockNumber(),
    prisma.eventCursor.findFirst({
      where: {
        chainId: strategy.chainId,
        stream: { startsWith: "pool-swaps:" },
      },
      orderBy: { lastFinalizedBlock: "desc" },
    }),
    readPosition(
      strategy.chainId,
      wallet.address,
      BigInt(strategy.position.tokenId.toString()),
    ),
  ]);
  const lag = cursor
    ? head - BigInt(cursor.lastFinalizedBlock.toString())
    : head;
  if (!cursor || lag > BigInt(strategy.maxBlockLag)) {
    await createAlert(
      strategy,
      "RPC_INDEXER_LAG",
      "Strategy paused: indexer evidence is stale",
      `Observed lag is ${lag} blocks; policy maximum is ${strategy.maxBlockLag}.`,
      { head, cursor: cursor?.lastFinalizedBlock },
    );
    return;
  }
  if (position.pool.liquidity < BigInt(strategy.minPoolLiquidity.toString())) {
    await createAlert(
      strategy,
      "POOL_LIQUIDITY_LOW",
      "Strategy paused: pool liquidity policy failed",
      "Current pool liquidity is below the configured minimum.",
      { liquidity: position.pool.liquidity },
    );
    return;
  }
  let twap: number;
  try {
    twap = await twapTick(strategy.chainId, position.pool.address);
  } catch {
    await createAlert(
      strategy,
      "PRICE_EVIDENCE_UNAVAILABLE",
      "Strategy paused: TWAP unavailable",
      "The pool could not supply a reviewed 30-minute TWAP. No action was taken.",
      { pool: position.pool.address },
      "CRITICAL",
    );
    return;
  }
  const deviation = Math.abs(position.tick - twap);
  if (
    deviation >
    Math.max(50, Math.floor((position.tickUpper - position.tickLower) / 3))
  ) {
    await createAlert(
      strategy,
      "PRICE_DEVIATION",
      "Strategy paused: spot and TWAP diverge",
      "Current spot tick deviates materially from the 30-minute TWAP.",
      { spotTick: position.tick, twapTick: twap },
      "CRITICAL",
    );
    return;
  }
  let triggered = false;
  let action: "collect" | "compound" = "collect";
  if (strategy.kind === "RANGE_GUARD") {
    const distance = Math.min(
      twap - position.tickLower,
      position.tickUpper - twap,
    );
    const width = position.tickUpper - position.tickLower;
    triggered =
      twap < position.tickLower ||
      twap >= position.tickUpper ||
      distance * 10_000 <= width * (strategy.triggerDistanceBps ?? 500);
  } else if (strategy.kind === "PROFIT_HARVEST") {
    triggered =
      position.feePreview.amount0 >=
        BigInt(strategy.minFeeThreshold0?.toString() || "0") ||
      position.feePreview.amount1 >=
        BigInt(strategy.minFeeThreshold1?.toString() || "0");
  } else if (
    strategy.kind === "AUTO_COMPOUND" ||
    strategy.kind === "SCHEDULED_COMPOUND"
  ) {
    action = "compound";
    triggered =
      strategy.kind === "SCHEDULED_COMPOUND"
        ? !strategy.nextExecutionAt || strategy.nextExecutionAt <= new Date()
        : position.feePreview.amount0 >=
            BigInt(strategy.minFeeThreshold0?.toString() || "0") ||
          position.feePreview.amount1 >=
            BigInt(strategy.minFeeThreshold1?.toString() || "0");
  }
  await prisma.strategy.update({
    where: { id: strategy.id },
    data: { lastEvaluatedAt: new Date() },
  });
  if (!triggered) return;
  const evidence = {
    blockNumber: position.blockNumber,
    spotTick: position.tick,
    twapTick: twap,
    fees0: position.feePreview.amount0,
    fees1: position.feePreview.amount1,
  };
  if (
    strategy.mode === "ALERT_ONLY" ||
    strategy.kind === "RANGE_GUARD" ||
    strategy.kind === "RECENTER" ||
    strategy.kind === "ONE_SIDED_EXIT"
  ) {
    await createAlert(
      strategy,
      "STRATEGY_TRIGGERED",
      `${strategy.kind.replaceAll("_", " ")} triggered`,
      strategy.mode === "ALERT_ONLY"
        ? "Review the current position and approve an action manually."
        : "This strategy requires approval because its action is multi-step or changes asset exposure.",
      evidence,
    );
  } else if (strategy.mode === "APPROVAL_REQUIRED") {
    await createAlert(
      strategy,
      "STRATEGY_APPROVAL_REQUIRED",
      "Strategy action awaits approval",
      "A deterministic trigger passed. Open the position to preview, simulate, and authorize the action.",
      evidence,
    );
  } else if (action !== "collect") {
    await createAlert(
      strategy,
      "STRATEGY_APPROVAL_REQUIRED",
      "Multi-phase strategy awaits approval",
      "Unattended execution is restricted to single-phase profit harvest. Review the confirmed-state compound continuation before signing.",
      evidence,
    );
  } else {
    await executeAutopilot(strategy, action, wallet.address as `0x${string}`);
    await createAlert(
      strategy,
      "STRATEGY_EXECUTION_SUCCEEDED",
      "Autopilot execution completed",
      "The strategy transaction sequence was confirmed and reconciled.",
      evidence,
      "INFO",
    );
  }
}

async function main() {
  for (;;) {
    const strategies = await prisma.strategy.findMany({
      where: { enabled: true },
      select: { id: true },
    });
    for (const { id } of strategies)
      await evaluate(id).catch(async (error) => {
        const strategy = await loadStrategy(id).catch(() => null);
        if (strategy)
          await createAlert(
            strategy,
            "STRATEGY_EXECUTION_FAILED",
            "Strategy evaluation failed",
            error instanceof Error
              ? error.message
              : "Strategy evaluation failed",
            { strategyId: id },
            "CRITICAL",
          ).catch(() => undefined);
      });
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch(() => {
  process.exitCode = 1;
});
