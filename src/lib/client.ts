import { createPublicClient, http } from "viem";
import { getChainConfig } from "@/src/chains/robinhood";

const clients = new Map<number, ReturnType<typeof createPublicClient>>();

export function getPublicClient(chainId: number) {
  const existing = clients.get(chainId);
  if (existing) return existing;
  const { chain, rpcUrl } = getChainConfig(chainId);
  if (!rpcUrl || rpcUrl.endsWith(":0"))
    throw new Error("RPC is not configured for this network");
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl, {
      timeout: 20_000,
      retryCount: 2,
      retryDelay: 500,
    }),
    batch: { multicall: true },
  });
  clients.set(chainId, client);
  return client;
}
