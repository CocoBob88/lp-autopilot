import {
  encodeFunctionData,
  getAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { mainnetManifest, MAINNET_CHAIN_ID } from "@/src/chains/robinhood";
import { erc20Abi, poolAbi, positionManagerAbi } from "@/src/contracts/abis";
import { applySlippage } from "@/src/domain/liquidity-math";
import { canonicalRequestHash } from "@/src/domain/workflow";
import { getPublicClient } from "@/src/lib/client";

const schema = z.object({
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  poolAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tickLower: z.number().int().min(-887272).max(887272),
  tickUpper: z.number().int().min(-887272).max(887272),
  amount0: z.string().regex(/^\d+(\.\d+)?$/),
  amount1: z.string().regex(/^\d+(\.\d+)?$/),
  slippageBps: z.number().int().min(1).max(500).default(100),
});

export type MintStep = {
  ordinal: number;
  label: string;
  target: Address;
  method: string;
  calldata: Hex;
  value: bigint;
  simulated: boolean;
  simulationError?: string;
  gasEstimate?: bigint;
};

async function simulate(
  owner: Address,
  target: Address,
  calldata: Hex,
): Promise<Pick<MintStep, "simulated" | "simulationError" | "gasEstimate">> {
  const client = getPublicClient(MAINNET_CHAIN_ID);
  try {
    await client.call({ account: owner, to: target, data: calldata });
    const gasEstimate = await client.estimateGas({
      account: owner,
      to: target,
      data: calldata,
    });
    return { simulated: true, gasEstimate };
  } catch (error) {
    return {
      simulated: false,
      simulationError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildMintPlan(raw: unknown) {
  const input = schema.parse(raw);
  const owner = getAddress(input.owner);
  const poolAddress = getAddress(input.poolAddress);
  const client = getPublicClient(MAINNET_CHAIN_ID);
  const [factory, token0, token1, fee, tickSpacing, slot0, block] =
    await Promise.all([
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "factory",
      }),
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "token0",
      }),
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "token1",
      }),
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "fee",
      }),
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "tickSpacing",
      }),
      client.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "slot0",
      }),
      client.getBlock(),
    ]);
  if (factory.toLowerCase() !== mainnetManifest.factory.toLowerCase())
    throw new Error("The selected pool is not from the reviewed V3 factory");
  if (input.tickLower >= input.tickUpper)
    throw new Error("The lower tick must be below the upper tick");
  if (
    input.tickLower % Number(tickSpacing) ||
    input.tickUpper % Number(tickSpacing)
  )
    throw new Error("Range ticks must align to the pool tick spacing");
  const [decimals0, decimals1, balance0, balance1, allowance0, allowance1] =
    await Promise.all([
      client.readContract({
        address: token0,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: token1,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: token0,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: token1,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: token0,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, mainnetManifest.positionManager],
      }),
      client.readContract({
        address: token1,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, mainnetManifest.positionManager],
      }),
    ]);
  const amount0 = parseUnits(input.amount0, Number(decimals0));
  const amount1 = parseUnits(input.amount1, Number(decimals1));
  if (amount0 <= 0n && amount1 <= 0n)
    throw new Error("Enter a non-zero deposit amount");
  if (balance0 < amount0 || balance1 < amount1)
    throw new Error(
      "Wallet token balances are below the simulated deposit amounts",
    );
  const steps: MintStep[] = [];
  for (const [token, amount, allowance, label] of [
    [token0, amount0, allowance0, "token 0"],
    [token1, amount1, allowance1, "token 1"],
  ] as const) {
    if (amount <= 0n || allowance >= amount) continue;
    const calldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [mainnetManifest.positionManager, amount],
    });
    steps.push({
      ordinal: steps.length,
      label: `Approve exact ${label} amount`,
      target: token,
      method: "approve",
      calldata,
      value: 0n,
      ...(await simulate(owner, token, calldata)),
    });
  }
  const deadline = block.timestamp + 1_200n;
  const mintCalldata = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        fee,
        tickLower: input.tickLower,
        tickUpper: input.tickUpper,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: applySlippage(amount0, input.slippageBps),
        amount1Min: applySlippage(amount1, input.slippageBps),
        recipient: owner,
        deadline,
      },
    ],
  });
  const approvalsRequired = steps.length > 0;
  const mintSimulation = approvalsRequired
    ? {
        simulated: false,
        simulationError:
          "Mint simulation becomes exact after the required approvals confirm.",
      }
    : await simulate(owner, mainnetManifest.positionManager, mintCalldata);
  steps.push({
    ordinal: steps.length,
    label: "Create concentrated liquidity position",
    target: mainnetManifest.positionManager,
    method: "mint",
    calldata: mintCalldata,
    value: 0n,
    ...mintSimulation,
  });
  const gasPrice = await client.getGasPrice();
  const estimatedGas = steps.reduce(
    (sum, step) => sum + (step.gasEstimate ?? 300_000n),
    0n,
  );
  const request = {
    chainId: MAINNET_CHAIN_ID,
    owner,
    poolAddress,
    token0,
    token1,
    fee,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    slippageBps: input.slippageBps,
    deadline: deadline.toString(),
    quoteBlock: block.number.toString(),
  };
  return {
    ...request,
    requestHash: canonicalRequestHash(request),
    currentTick: Number(slot0[1]),
    tickSpacing: Number(tickSpacing),
    balance0: balance0.toString(),
    balance1: balance1.toString(),
    steps,
    gasPrice,
    maximumGasCostWei: estimatedGas * gasPrice,
    executionReady: true,
    explicitAuthorization:
      "Every approval and mint is submitted by the connected wallet after an explicit click.",
  };
}
