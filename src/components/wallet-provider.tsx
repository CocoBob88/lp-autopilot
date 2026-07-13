"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createPublicClient,
  defineChain,
  formatEther,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";

type Health = {
  healthy: boolean;
  chainId?: number;
  blockNumber?: string;
  latencyMs?: number;
  indexerLag?: number | null;
  writesAllowed?: boolean;
  error?: string;
};
type WalletMode = "none" | "watch" | "assisted" | "autopilot";
type Context = {
  chainId: 4663 | 46630;
  setChainId: (value: 4663 | 46630) => void;
  address: Address | null;
  mode: WalletMode;
  authenticated: boolean;
  csrf: string | null;
  health: Health | null;
  gasBalance: string | null;
  busy: boolean;
  error: string | null;
  inspect: (address: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshHealth: () => Promise<void>;
  provider: EIP1193Provider | null;
};

const WalletContext = createContext<Context | null>(null);
const chainInfo = {
  4663: {
    name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  46630: {
    name: "Robinhood Chain Testnet",
    rpc: process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC || "",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
} as const;

function browserProvider() {
  return (
    (window as typeof window & { ethereum?: EIP1193Provider }).ethereum ?? null
  );
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [chainId, setChainState] = useState<4663 | 46630>(4663);
  const [address, setAddress] = useState<Address | null>(null);
  const [mode, setMode] = useState<WalletMode>("none");
  const [authenticated, setAuthenticated] = useState(false);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [gasBalance, setGasBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch(`/api/health?chainId=${chainId}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as Health;
      setHealth(body);
    } catch {
      setHealth({ healthy: false, error: "RPC health request failed" });
    }
  }, [chainId]);

  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);
  useEffect(() => {
    if (!address || !chainInfo[chainId].rpc) {
      setGasBalance(null);
      return;
    }
    const client = createPublicClient({
      chain: defineChain({
        id: chainId,
        name: chainInfo[chainId].name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [chainInfo[chainId].rpc] } },
      }),
      transport: http(chainInfo[chainId].rpc),
    });
    void client
      .getBalance({ address })
      .then((balance) => setGasBalance(formatEther(balance)))
      .catch(() => setGasBalance(null));
  }, [address, chainId, health?.blockNumber]);

  const setChainId = useCallback((value: 4663 | 46630) => {
    void value;
    setChainState(4663);
  }, []);
  const inspect = useCallback((value: string) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      setError("Enter a valid EVM wallet address");
      return;
    }
    setAddress(value as Address);
    setMode("watch");
    setAuthenticated(false);
    setCsrf(null);
    setError(null);
    localStorage.setItem("lp-autopilot:watch-address", value);
  }, []);
  const disconnect = useCallback(() => {
    setAddress(null);
    setMode("none");
    setAuthenticated(false);
    setCsrf(null);
    setProvider(null);
    setError(null);
    localStorage.removeItem("lp-autopilot:watch-address");
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const injected = browserProvider();
      if (!injected)
        throw new Error("No compatible browser wallet was detected");
      const [account] = (await injected.request({
        method: "eth_requestAccounts",
      })) as Address[];
      if (!account) throw new Error("The wallet did not return an account");
      const hexChain = "0x1237";
      try {
        await injected.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexChain }],
        });
      } catch {
        const info = chainInfo[4663];
        await injected.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexChain,
              chainName: info.name,
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [info.rpc],
              blockExplorerUrls: [info.explorer],
            },
          ],
        });
      }
      setAddress(account);
      setMode("assisted");
      setAuthenticated(false);
      setCsrf(null);
      setProvider(injected);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wallet connection failed",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<Context>(
    () => ({
      chainId,
      setChainId,
      address,
      mode,
      authenticated,
      csrf,
      health,
      gasBalance,
      busy,
      error,
      inspect,
      connect,
      disconnect,
      refreshHealth,
      provider,
    }),
    [
      chainId,
      address,
      mode,
      authenticated,
      csrf,
      health,
      gasBalance,
      busy,
      error,
      inspect,
      connect,
      disconnect,
      refreshHealth,
      provider,
      setChainId,
    ],
  );
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("WalletProvider is missing");
  return context;
}
