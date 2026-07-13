import { getAddress, keccak256, type Address, type Hex } from "viem";
import { getChainConfig } from "@/src/chains/robinhood";
import { erc20Abi, factoryAbi } from "@/src/contracts/abis";
import { getPublicClient } from "@/src/lib/client";

type Check = {
  name: string;
  address?: Address;
  ok: boolean;
  detail: string;
  codeHash?: Hex;
};
type Validation = {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  healthy: boolean;
  writesAllowed: boolean;
  checks: Check[];
  validatedAt: string;
};

const cache = new Map<number, { expires: number; value: Validation }>();

export async function validateManifest(
  chainId: number,
  fresh = false,
): Promise<Validation> {
  const cached = cache.get(chainId);
  if (!fresh && cached && cached.expires > Date.now()) return cached.value;
  const { manifest } = getChainConfig(chainId);
  const client = getPublicClient(chainId);
  const actualChainId = await client.getChainId();
  if (actualChainId !== chainId)
    throw new Error(
      `RPC chain mismatch: expected ${chainId}, received ${actualChainId}`,
    );
  const block = await client.getBlock({ blockTag: "latest" });
  const checks: Check[] = [];

  if (!manifest) {
    checks.push({
      name: "testnet-manifest",
      ok: false,
      detail: "No reviewed testnet contract manifest is configured",
    });
  } else {
    const entries = Object.entries(manifest).filter(
      ([name, value]) => typeof value === "string" && name !== "explorer",
    ) as Array<[string, Address]>;
    for (const [name, address] of entries) {
      const code = await client.getCode({ address, blockNumber: block.number });
      checks.push({
        name,
        address,
        ok: Boolean(code && code !== "0x"),
        detail:
          code && code !== "0x"
            ? `${(code.length - 2) / 2} bytes`
            : "No bytecode",
        codeHash: code && code !== "0x" ? keccak256(code) : undefined,
      });
    }
    const [wethSymbol, wethDecimals, usdgSymbol, usdgDecimals] =
      await Promise.all([
        client.readContract({
          address: manifest.weth,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber: block.number,
        }),
        client.readContract({
          address: manifest.weth,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber: block.number,
        }),
        client.readContract({
          address: manifest.usdg,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber: block.number,
        }),
        client.readContract({
          address: manifest.usdg,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber: block.number,
        }),
      ]);
    checks.push({
      name: "WETH identity",
      address: manifest.weth,
      ok: wethSymbol === "WETH" && wethDecimals === 18,
      detail: `${wethSymbol}/${wethDecimals}`,
    });
    checks.push({
      name: "USDG identity",
      address: manifest.usdg,
      ok: usdgSymbol === "USDG" && usdgDecimals === 6,
      detail: `${usdgSymbol}/${usdgDecimals}`,
    });
    for (const fee of manifest.supportedFeeTiers) {
      const spacing = await client.readContract({
        address: manifest.factory,
        abi: factoryAbi,
        functionName: "feeAmountTickSpacing",
        args: [fee],
        blockNumber: block.number,
      });
      checks.push({
        name: `fee-tier-${fee}`,
        address: manifest.factory,
        ok: spacing > 0,
        detail: `tick spacing ${spacing}`,
      });
    }
    checks.push({
      name: "checksum",
      ok: entries.every(([, address]) => getAddress(address) === address),
      detail: "Manifest addresses are checksummed",
    });
  }

  const healthy = Boolean(manifest) && checks.every((check) => check.ok);
  const value: Validation = {
    chainId,
    blockNumber: block.number,
    blockHash: block.hash,
    healthy,
    writesAllowed:
      healthy &&
      process.env.ALL_LIVE_TRANSACTIONS_ENABLED === "true" &&
      (chainId === 4663
        ? process.env.ROBINHOOD_MAINNET_WRITES_ENABLED === "true"
        : process.env.ROBINHOOD_TESTNET_WRITES_ENABLED === "true"),
    checks,
    validatedAt: new Date().toISOString(),
  };
  cache.set(chainId, { expires: Date.now() + 30_000, value });
  return value;
}
