import { defineChain, getAddress, type Address } from "viem";

export type ReviewedManifest = {
  chainId: number;
  factory: Address;
  quoterV2: Address;
  positionManager: Address;
  swapRouter02: Address;
  permit2: Address;
  universalRouter: Address;
  weth: Address;
  usdg: Address;
  explorer: string;
  supportedFeeTiers: readonly number[];
};

export const MAINNET_CHAIN_ID = 4663 as const;
export const TESTNET_CHAIN_ID = 46630 as const;

const publicMainnetRpc = "https://rpc.mainnet.chain.robinhood.com";
const mainnetRpc =
  process.env.ROBINHOOD_MAINNET_RPC?.trim() || publicMainnetRpc;
const testnetRpc =
  process.env.ROBINHOOD_TESTNET_RPC?.trim() || "http://127.0.0.1:0";

export const robinhoodMainnet = defineChain({
  id: MAINNET_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [mainnetRpc] },
    public: { http: [publicMainnetRpc] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
  contracts: {
    multicall3: {
      address: getAddress("0xcA11bde05977b3631167028862bE2a173976CA11"),
    },
  },
});

export const robinhoodTestnet = defineChain({
  id: TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [testnetRpc] } },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url:
        process.env.ROBINHOOD_TESTNET_EXPLORER?.trim() ||
        "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

export const mainnetManifest: ReviewedManifest = {
  chainId: MAINNET_CHAIN_ID,
  factory: getAddress("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"),
  quoterV2: getAddress("0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7"),
  positionManager: getAddress("0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3"),
  swapRouter02: getAddress("0xCaf681a66D020601342297493863E78C959E5cb2"),
  permit2: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
  universalRouter: getAddress("0x8876789976dEcBfCbBbe364623C63652db8C0904"),
  weth: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
  usdg: getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  explorer: "https://robinhoodchain.blockscout.com",
  supportedFeeTiers: [500, 3000, 10000],
};

export function getChainConfig(chainId: number) {
  if (chainId === MAINNET_CHAIN_ID) {
    return {
      chain: robinhoodMainnet,
      manifest: mainnetManifest,
      rpcUrl: mainnetRpc,
    };
  }
  if (chainId === TESTNET_CHAIN_ID) {
    return { chain: robinhoodTestnet, manifest: null, rpcUrl: testnetRpc };
  }
  throw new Error("Unsupported Robinhood Chain ID");
}

export function liveWritesEnabled(chainId: number) {
  if (process.env.ALL_LIVE_TRANSACTIONS_ENABLED !== "true") return false;
  return chainId === MAINNET_CHAIN_ID
    ? process.env.ROBINHOOD_MAINNET_WRITES_ENABLED === "true"
    : chainId === TESTNET_CHAIN_ID &&
        process.env.ROBINHOOD_TESTNET_WRITES_ENABLED === "true";
}
