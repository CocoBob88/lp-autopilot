import {
  encodeFunctionData,
  getAddress,
  maxUint128,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { getChainConfig, liveWritesEnabled } from "@/src/chains/robinhood";
import { erc20Abi, positionManagerAbi } from "@/src/contracts/abis";
import {
  applySlippage,
  amountsForLiquidity,
  alignTick,
} from "@/src/domain/liquidity-math";
import { canonicalRequestHash } from "@/src/domain/workflow";
import { getPublicClient } from "@/src/lib/client";
import { readPosition } from "@/src/operations/positions";

const base = z.object({
  chainId: z.union([z.literal(4663), z.literal(46630)]),
  owner: z.string(),
  tokenId: z.string().regex(/^\d+$/),
  workflowKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9:_-]+$/),
  slippageBps: z.number().int().min(0).max(5_000).default(100),
  deadlineSeconds: z.number().int().min(60).max(3_600).default(600),
  unwrapWeth: z.boolean().default(false),
});

export const planSchema = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("collect") }),
  base.extend({
    action: z.literal("increase"),
    amount0: z.string(),
    amount1: z.string(),
  }),
  base.extend({
    action: z.literal("remove"),
    percentageBps: z.number().int().min(1).max(10_000),
  }),
  base.extend({
    action: z.literal("compound"),
    allowBalancingSwap: z.boolean().default(false),
  }),
  base.extend({
    action: z.literal("compound_finalize"),
    amount0Raw: z.string().regex(/^\d+$/),
    amount1Raw: z.string().regex(/^\d+$/),
  }),
  base.extend({
    action: z.literal("rebalance"),
    newTickLower: z.number().int(),
    newTickUpper: z.number().int(),
    allowBalancingSwap: z.boolean().default(false),
  }),
  base.extend({
    action: z.literal("rebalance_finalize"),
    amount0Raw: z.string().regex(/^\d+$/),
    amount1Raw: z.string().regex(/^\d+$/),
    newTickLower: z.number().int(),
    newTickUpper: z.number().int(),
    allowBalancingSwap: z.boolean().default(false),
  }),
  base.extend({ action: z.literal("burn") }),
]);

export type PlanInput = z.infer<typeof planSchema>;
type Step = {
  ordinal: number;
  kind: string;
  label: string;
  target: Address;
  method: string;
  calldata: Hex;
  value: bigint;
  simulated: boolean;
  simulationError?: string;
  gasEstimate?: bigint;
  requiresFreshPlanAfter?: boolean;
};

async function simulateStep(
  chainId: number,
  owner: Address,
  step: Step,
): Promise<Step> {
  const client = getPublicClient(chainId);
  try {
    const gasEstimate = await client.estimateGas({
      account: owner,
      to: step.target,
      data: step.calldata,
      value: step.value,
    });
    await client.call({
      account: owner,
      to: step.target,
      data: step.calldata,
      value: step.value,
    });
    return { ...step, simulated: true, gasEstimate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...step,
      simulated: false,
      simulationError: message.slice(0, 240),
    };
  }
}

function collectCalls(
  tokenId: bigint,
  owner: Address,
  token0: Address,
  token1: Address,
  weth: Address,
  manager: Address,
  unwrapWeth: boolean,
) {
  if (!unwrapWeth) {
    return [
      encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "collect",
        args: [
          {
            tokenId,
            recipient: owner,
            amount0Max: maxUint128,
            amount1Max: maxUint128,
          },
        ],
      }),
    ];
  }
  if (
    token0.toLowerCase() !== weth.toLowerCase() &&
    token1.toLowerCase() !== weth.toLowerCase()
  ) {
    throw new Error(
      "WETH unwrapping is unavailable because this position has no WETH side",
    );
  }
  const nonWeth = token0.toLowerCase() === weth.toLowerCase() ? token1 : token0;
  return [
    encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: manager,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ],
    }),
    encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "unwrapWETH9",
      args: [0n, owner],
    }),
    encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "sweepToken",
      args: [nonWeth, 0n, owner],
    }),
  ];
}

function managerStep(
  ordinal: number,
  label: string,
  manager: Address,
  method: string,
  calldata: Hex,
  refresh = false,
): Step {
  return {
    ordinal,
    kind: method,
    label,
    target: manager,
    method,
    calldata,
    value: 0n,
    simulated: false,
    requiresFreshPlanAfter: refresh,
  };
}

export async function buildWorkflowPlan(rawInput: unknown) {
  const input = planSchema.parse(rawInput);
  const owner = getAddress(input.owner);
  const tokenId = BigInt(input.tokenId);
  const position = await readPosition(input.chainId, owner, tokenId);
  const { manifest } = getChainConfig(input.chainId);
  if (!manifest)
    throw new Error("No reviewed manifest exists for this network");
  const client = getPublicClient(input.chainId);
  const feeData = await client.estimateFeesPerGas();
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + input.deadlineSeconds,
  );
  const steps: Step[] = [];
  const expected = { amount0: 0n, amount1: 0n, liquidityDelta: 0n };
  let nextPhase: Record<string, unknown> | null = null;

  if (input.action === "collect") {
    const calls = collectCalls(
      tokenId,
      owner,
      position.token0.address,
      position.token1.address,
      manifest.weth,
      manifest.positionManager,
      input.unwrapWeth,
    );
    const calldata =
      calls.length === 1
        ? calls[0]
        : encodeFunctionData({
            abi: positionManagerAbi,
            functionName: "multicall",
            args: [calls],
          });
    steps.push(
      managerStep(
        0,
        "Collect accrued fees",
        manifest.positionManager,
        calls.length === 1 ? "collect" : "multicall",
        calldata,
      ),
    );
    expected.amount0 = position.feePreview.amount0;
    expected.amount1 = position.feePreview.amount1;
  }

  if (input.action === "increase") {
    const amount0 = parseUnits(input.amount0, position.token0.decimals);
    const amount1 = parseUnits(input.amount1, position.token1.decimals);
    if (amount0 <= 0n && amount1 <= 0n)
      throw new Error("Enter a positive token amount");
    const [allowance0, allowance1] = await Promise.all([
      client.readContract({
        address: position.token0.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, manifest.positionManager],
      }),
      client.readContract({
        address: position.token1.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, manifest.positionManager],
      }),
    ]);
    if (amount0 > 0n && allowance0 < amount0)
      steps.push(
        managerStep(
          steps.length,
          `Approve ${position.token0.symbol}`,
          position.token0.address,
          "approve",
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [manifest.positionManager, amount0],
          }),
          true,
        ),
      );
    if (amount1 > 0n && allowance1 < amount1)
      steps.push(
        managerStep(
          steps.length,
          `Approve ${position.token1.symbol}`,
          position.token1.address,
          "approve",
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [manifest.positionManager, amount1],
          }),
          true,
        ),
      );
    const calldata = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "increaseLiquidity",
      args: [
        {
          tokenId,
          amount0Desired: amount0,
          amount1Desired: amount1,
          amount0Min: applySlippage(amount0, input.slippageBps),
          amount1Min: applySlippage(amount1, input.slippageBps),
          deadline,
        },
      ],
    });
    steps.push(
      managerStep(
        steps.length,
        "Increase position liquidity",
        manifest.positionManager,
        "increaseLiquidity",
        calldata,
      ),
    );
    expected.amount0 = -amount0;
    expected.amount1 = -amount1;
  }

  if (input.action === "remove") {
    const liquidityToRemove =
      (position.liquidity * BigInt(input.percentageBps)) / 10_000n;
    if (liquidityToRemove <= 0n)
      throw new Error("Removal rounds down to zero liquidity");
    const principal = amountsForLiquidity(
      position.sqrtPriceX96,
      position.tickLower,
      position.tickUpper,
      liquidityToRemove,
    );
    const decrease = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId,
          liquidity: liquidityToRemove,
          amount0Min: applySlippage(principal.amount0, input.slippageBps),
          amount1Min: applySlippage(principal.amount1, input.slippageBps),
          deadline,
        },
      ],
    });
    const calls = [
      decrease,
      ...collectCalls(
        tokenId,
        owner,
        position.token0.address,
        position.token1.address,
        manifest.weth,
        manifest.positionManager,
        input.unwrapWeth,
      ),
    ];
    steps.push(
      managerStep(
        0,
        `${input.percentageBps === 10_000 ? "Remove all" : "Remove partial"} liquidity and collect`,
        manifest.positionManager,
        "multicall",
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "multicall",
          args: [calls],
        }),
      ),
    );
    expected.amount0 = principal.amount0 + position.feePreview.amount0;
    expected.amount1 = principal.amount1 + position.feePreview.amount1;
    expected.liquidityDelta = -liquidityToRemove;
  }

  if (input.action === "compound") {
    if (position.state === "OUT_OF_RANGE")
      throw new Error(
        "Compounding is blocked while the position is out of range",
      );
    if (input.allowBalancingSwap)
      throw new Error(
        "A balancing swap requires a fresh explicit quote and is planned separately after fee collection",
      );
    const collect = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: owner,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ],
    });
    steps.push(
      managerStep(
        0,
        "Collect fees to the wallet",
        manifest.positionManager,
        "collect",
        collect,
        true,
      ),
    );
    nextPhase = {
      action: "compound_finalize",
      reason:
        "Reconcile the Collect event, then build approvals and increaseLiquidity from the confirmed amounts.",
    };
    expected.amount0 = 0n;
    expected.amount1 = 0n;
  }

  if (input.action === "compound_finalize") {
    if (position.state === "OUT_OF_RANGE")
      throw new Error(
        "Compounding is blocked while the position is out of range",
      );
    const amount0 = BigInt(input.amount0Raw);
    const amount1 = BigInt(input.amount1Raw);
    const [balance0, balance1, allowance0, allowance1] = await Promise.all([
      client.readContract({
        address: position.token0.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: position.token1.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: position.token0.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, manifest.positionManager],
      }),
      client.readContract({
        address: position.token1.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, manifest.positionManager],
      }),
    ]);
    if (balance0 < amount0 || balance1 < amount1)
      throw new Error(
        "Reconciled wallet balances are below the collected fee amounts",
      );
    if (amount0 > 0n && allowance0 < amount0)
      steps.push(
        managerStep(
          steps.length,
          `Approve ${position.token0.symbol} fees`,
          position.token0.address,
          "approve",
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [manifest.positionManager, amount0],
          }),
          true,
        ),
      );
    if (amount1 > 0n && allowance1 < amount1)
      steps.push(
        managerStep(
          steps.length,
          `Approve ${position.token1.symbol} fees`,
          position.token1.address,
          "approve",
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [manifest.positionManager, amount1],
          }),
          true,
        ),
      );
    steps.push(
      managerStep(
        steps.length,
        "Add reconciled fees to the current range",
        manifest.positionManager,
        "increaseLiquidity",
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "increaseLiquidity",
          args: [
            {
              tokenId,
              amount0Desired: amount0,
              amount1Desired: amount1,
              amount0Min: applySlippage(amount0, input.slippageBps),
              amount1Min: applySlippage(amount1, input.slippageBps),
              deadline,
            },
          ],
        }),
      ),
    );
    expected.amount0 = -amount0;
    expected.amount1 = -amount1;
  }

  if (input.action === "rebalance") {
    const lower = alignTick(
      input.newTickLower,
      position.pool.tickSpacing,
      "down",
    );
    const upper = alignTick(
      input.newTickUpper,
      position.pool.tickSpacing,
      "up",
    );
    if (lower >= upper)
      throw new Error("The proposed range is invalid after tick alignment");
    if (lower < -887272 || upper > 887272)
      throw new Error("The proposed range exceeds the V3 tick domain");
    const principal = amountsForLiquidity(
      position.sqrtPriceX96,
      position.tickLower,
      position.tickUpper,
      position.liquidity,
    );
    const decrease = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId,
          liquidity: position.liquidity,
          amount0Min: applySlippage(principal.amount0, input.slippageBps),
          amount1Min: applySlippage(principal.amount1, input.slippageBps),
          deadline,
        },
      ],
    });
    const collect = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: owner,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ],
    });
    steps.push(
      managerStep(
        0,
        "Withdraw and collect the old range",
        manifest.positionManager,
        "multicall",
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "multicall",
          args: [[decrease, collect]],
        }),
        true,
      ),
    );
    nextPhase = {
      action: "rebalance_finalize",
      newTickLower: lower,
      newTickUpper: upper,
      balancingSwapRequested: input.allowBalancingSwap,
      reason:
        "Reconcile the withdrawal first. Any balancing swap is quoted as its own explicit workflow before minting the replacement NFT.",
    };
    expected.amount0 = principal.amount0 + position.feePreview.amount0;
    expected.amount1 = principal.amount1 + position.feePreview.amount1;
    expected.liquidityDelta = -position.liquidity;
  }

  if (input.action === "rebalance_finalize") {
    if (input.allowBalancingSwap)
      throw new Error(
        "Balancing swap must be quoted and confirmed as a separate workflow before final mint",
      );
    const lower = alignTick(
      input.newTickLower,
      position.pool.tickSpacing,
      "down",
    );
    const upper = alignTick(
      input.newTickUpper,
      position.pool.tickSpacing,
      "up",
    );
    if (lower >= upper || lower < -887272 || upper > 887272)
      throw new Error("Replacement range is invalid");
    const amount0 = BigInt(input.amount0Raw);
    const amount1 = BigInt(input.amount1Raw);
    const [balance0, balance1, allowance0, allowance1] = await Promise.all([
      client.readContract({
        address: position.token0.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: position.token1.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: position.token0.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, manifest.positionManager],
      }),
      client.readContract({
        address: position.token1.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, manifest.positionManager],
      }),
    ]);
    if (balance0 < amount0 || balance1 < amount1)
      throw new Error(
        "Reconciled wallet balances are below the withdrawal proceeds",
      );
    if (amount0 > 0n && allowance0 < amount0)
      steps.push(
        managerStep(
          steps.length,
          `Approve ${position.token0.symbol}`,
          position.token0.address,
          "approve",
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [manifest.positionManager, amount0],
          }),
          true,
        ),
      );
    if (amount1 > 0n && allowance1 < amount1)
      steps.push(
        managerStep(
          steps.length,
          `Approve ${position.token1.symbol}`,
          position.token1.address,
          "approve",
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [manifest.positionManager, amount1],
          }),
          true,
        ),
      );
    steps.push(
      managerStep(
        steps.length,
        `Mint replacement range ${lower} → ${upper}`,
        manifest.positionManager,
        "mint",
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "mint",
          args: [
            {
              token0: position.token0.address,
              token1: position.token1.address,
              fee: position.pool.fee,
              tickLower: lower,
              tickUpper: upper,
              amount0Desired: amount0,
              amount1Desired: amount1,
              amount0Min: applySlippage(amount0, input.slippageBps),
              amount1Min: applySlippage(amount1, input.slippageBps),
              recipient: owner,
              deadline,
            },
          ],
        }),
      ),
    );
    expected.amount0 = -amount0;
    expected.amount1 = -amount1;
  }

  if (input.action === "burn") {
    if (
      position.liquidity !== 0n ||
      position.tokensOwed0 !== 0n ||
      position.tokensOwed1 !== 0n
    )
      throw new Error(
        "The position NFT can only be burned when liquidity and owed tokens are zero",
      );
    steps.push(
      managerStep(
        0,
        "Burn empty position NFT",
        manifest.positionManager,
        "burn",
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "burn",
          args: [tokenId],
        }),
      ),
    );
  }

  const simulations: Step[] = [];
  for (const step of steps) {
    if (step.calldata === "0x") simulations.push(step);
    else simulations.push(await simulateStep(input.chainId, owner, step));
  }
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  const gasEstimate = simulations.reduce(
    (total, step) => total + (step.gasEstimate ?? 0n),
    0n,
  );
  const plan = {
    version: 1,
    workflowKey: input.workflowKey,
    requestHash: canonicalRequestHash(input),
    action: input.action,
    chainId: input.chainId,
    owner,
    tokenId,
    quoteBlock: position.blockNumber,
    quoteBlockHash: position.blockHash,
    quoteTimestamp: new Date().toISOString(),
    expiresAt: new Date(Number(deadline) * 1000).toISOString(),
    slippageBps: input.slippageBps,
    deadline: deadline.toString(),
    position,
    steps: simulations,
    nextPhase,
    expected,
    gasEstimate,
    maxFeePerGas,
    maximumGasCostWei: gasEstimate * maxFeePerGas,
    liveExecutionEnabled: liveWritesEnabled(input.chainId),
    recovery: simulations.some((step) => step.requiresFreshPlanAfter)
      ? "This is a recoverable multi-step workflow. Each dependent step must be rebuilt and simulated from confirmed state."
      : "Submitted hashes are checkpointed before confirmation and reconciled by receipt and final state.",
  };
  return plan;
}
