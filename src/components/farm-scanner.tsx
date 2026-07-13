"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronsUpDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  http,
  parseEventLogs,
  zeroAddress,
  type Hex,
} from "viem";
import { positionManagerAbi } from "@/src/contracts/abis";
import {
  priceAtTick,
  simulateFullRange,
  simulateRange,
  type FarmOpportunity,
  type FarmScannerResponse,
  type LiquidityDistributionPoint,
  type LiquidityDistributionResponse,
} from "@/src/domain/farms";
import { compactAddress } from "@/src/domain/format";
import { useWallet } from "./wallet-provider";

type SortKey =
  | "pair"
  | "fee"
  | "price"
  | "tvl"
  | "volume"
  | "fees"
  | "apr"
  | "move"
  | "swaps"
  | "liquidity";
type SortDirection = "asc" | "desc";
type RangePreset = "small" | "wide" | "full" | "custom";
type Filters = {
  fee: string;
  minTvl: string;
  minVolume: string;
  minApr: string;
  minSwaps: string;
  maxMove: string;
};
type MintPlan = {
  requestHash: string;
  token0: Hex;
  token1: Hex;
  amount0: string;
  amount1: string;
  tickLower: number;
  tickUpper: number;
  maximumGasCostWei: string;
  executionReady: boolean;
  steps: Array<{
    ordinal: number;
    label: string;
    target: Hex;
    method: string;
    calldata: Hex;
    value: string;
    simulated: boolean;
    simulationError?: string;
  }>;
};

const EMPTY_FILTERS: Filters = {
  fee: "ALL",
  minTvl: "",
  minVolume: "",
  minApr: "",
  minSwaps: "",
  maxMove: "",
};

function money(value: number | null, compact = true) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: value < 100 ? 2 : 1,
  }).format(value);
}

function percent(value: number | null, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "-";
  return (
    value.toLocaleString(undefined, { maximumFractionDigits: digits }) + "%"
  );
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function price(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value === 0) return "$0";
  if (Math.abs(value) < 0.0001 || Math.abs(value) >= 1_000_000) {
    return "$" + value.toExponential(3);
  }
  return (
    "$" +
    value.toLocaleString(undefined, {
      maximumSignificantDigits: 7,
    })
  );
}

function amount(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value
    .toFixed(Math.min(decimals, 8))
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function TokenPair({ farm }: { farm: FarmOpportunity }) {
  return (
    <div className="dense-pair">
      <div className="dense-token-stack" aria-hidden="true">
        <span>{farm.token0.symbol.slice(0, 1)}</span>
        <span>{farm.token1.symbol.slice(0, 1)}</span>
      </div>
      <div>
        <strong>
          {farm.token0.symbol}/{farm.token1.symbol}
        </strong>
        <small>{compactAddress(farm.poolAddress, 5)}</small>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        {active ? (
          direction === "asc" ? (
            <ArrowUp size={11} />
          ) : (
            <ArrowDown size={11} />
          )
        ) : (
          <ChevronsUpDown size={11} />
        )}
      </button>
    </th>
  );
}

function PriceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: number | string }>;
}) {
  const value = Number(payload?.[0]?.value);
  if (!active || !Number.isFinite(value)) return null;
  return <div className="price-tooltip">{price(value)}</div>;
}

function LiquidityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: LiquidityDistributionPoint }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return (
    <div className="liquidity-tooltip">
      <strong>{price(item.price)}</strong>
      <span>Active liquidity {compactNumber(item.liquidity)}</span>
      <small>Tick {item.tick.toLocaleString()}</small>
    </div>
  );
}

export function FarmScanner() {
  const wallet = useWallet();
  const [data, setData] = useState<FarmScannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chainQuery, setChainQuery] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("apr");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [distribution, setDistribution] =
    useState<LiquidityDistributionResponse | null>(null);
  const [distributionLoading, setDistributionLoading] = useState(false);
  const [distributionError, setDistributionError] = useState<string | null>(
    null,
  );
  const [depositUsd, setDepositUsd] = useState(1_000);
  const [lowerPercent, setLowerPercent] = useState(25);
  const [upperPercent, setUpperPercent] = useState(25);
  const [rangePreset, setRangePreset] = useState<RangePreset>("wide");
  const [lowerPriceInput, setLowerPriceInput] = useState("");
  const [upperPriceInput, setUpperPriceInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [mintPlan, setMintPlan] = useState<MintPlan | null>(null);
  const [mintBusy, setMintBusy] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [submitted, setSubmitted] = useState<Record<number, string>>({});
  const [createdTokenId, setCreatedTokenId] = useState<string | null>(null);

  const load = useCallback(async (token?: string, background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        token ? "/api/farms?token=" + encodeURIComponent(token) : "/api/farms",
        { cache: "no-store" },
      );
      const body = (await response.json()) as FarmScannerResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Farm scanner unavailable");
      }
      setData(body);
      setChainQuery(token ?? null);
      setSelectedAddress((current) =>
        body.farms.some((farm) => farm.poolAddress === current)
          ? current
          : null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Farm scanner unavailable",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(undefined, true);
    }, 75_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selectedAddress) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedAddress(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedAddress]);

  const farms = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const numeric = (value: string) =>
      value.trim() === "" ? null : Number(value);
    const visible = (data?.farms ?? []).filter((farm) => {
      const matchesSearch =
        !needle ||
        farm.token0.symbol.toLowerCase().includes(needle) ||
        farm.token1.symbol.toLowerCase().includes(needle) ||
        farm.token0.name.toLowerCase().includes(needle) ||
        farm.token1.name.toLowerCase().includes(needle) ||
        farm.token0.address.toLowerCase() === needle ||
        farm.token1.address.toLowerCase() === needle ||
        farm.poolAddress.toLowerCase() === needle;
      const minTvl = numeric(filters.minTvl);
      const minVolume = numeric(filters.minVolume);
      const minApr = numeric(filters.minApr);
      const minSwaps = numeric(filters.minSwaps);
      const maxMove = numeric(filters.maxMove);
      return (
        matchesSearch &&
        (filters.fee === "ALL" || farm.fee.toString() === filters.fee) &&
        (minTvl == null || (farm.tvlUsd ?? -Infinity) >= minTvl) &&
        (minVolume == null ||
          (farm.volume24hProjectedUsd ?? -Infinity) >= minVolume) &&
        (minApr == null || (farm.projectedPoolApr ?? -Infinity) >= minApr) &&
        (minSwaps == null || farm.swapsInWindow >= minSwaps) &&
        (maxMove == null ||
          Math.abs(farm.priceChangePercent ?? Infinity) <= maxMove)
      );
    });
    const value = (farm: FarmOpportunity): number | string | null => {
      if (sortKey === "pair") {
        return farm.token0.symbol + "/" + farm.token1.symbol;
      }
      if (sortKey === "fee") return farm.feePercent;
      if (sortKey === "price") return farm.priceToken1PerToken0;
      if (sortKey === "tvl") return farm.tvlUsd;
      if (sortKey === "volume") return farm.volume24hProjectedUsd;
      if (sortKey === "fees") return farm.fees24hProjectedUsd;
      if (sortKey === "apr") return farm.projectedPoolApr;
      if (sortKey === "move") return farm.priceChangePercent;
      if (sortKey === "swaps") return farm.swapsInWindow;
      return Number(farm.liquidity);
    };
    return visible.sort((a, b) => {
      const aValue = value(a);
      const bValue = value(b);
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      const compared =
        typeof aValue === "string" && typeof bValue === "string"
          ? aValue.localeCompare(bValue)
          : Number(aValue) - Number(bValue);
      return sortDirection === "asc" ? compared : -compared;
    });
  }, [data, filters, search, sortDirection, sortKey]);

  const selected =
    data?.farms.find((farm) => farm.poolAddress === selectedAddress) ?? null;
  const simulation = useMemo(() => {
    if (!selected) return null;
    return rangePreset === "full"
      ? simulateFullRange(selected, depositUsd)
      : simulateRange(selected, depositUsd, lowerPercent, upperPercent);
  }, [depositUsd, lowerPercent, rangePreset, selected, upperPercent]);

  const chartData = useMemo(() => {
    if (!selected) return [];
    const ticks = selected.sampledTicks.length
      ? selected.sampledTicks
      : [selected.tick, selected.tick];
    return ticks.map((tick, index) => ({
      index,
      price: priceAtTick(
        tick,
        selected.token0.decimals,
        selected.token1.decimals,
      ),
    }));
  }, [selected]);

  const chartBand = useMemo(() => {
    if (!simulation || !chartData.length) return null;
    if (rangePreset !== "full") {
      return { low: simulation.lowerPrice, high: simulation.upperPrice };
    }
    const values = chartData.map((point) => point.price);
    return {
      low: Math.min(...values) * 0.999,
      high: Math.max(...values) * 1.001,
    };
  }, [chartData, rangePreset, simulation]);

  useEffect(() => {
    if (!selectedAddress) {
      setDistribution(null);
      setDistributionError(null);
      return;
    }
    const controller = new AbortController();
    setDistributionLoading(true);
    setDistributionError(null);
    void fetch(
      "/api/farms/liquidity?pool=" + encodeURIComponent(selectedAddress),
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const body =
          (await response.json()) as LiquidityDistributionResponse & {
            error?: string;
          };
        if (!response.ok) {
          throw new Error(body.error || "Liquidity distribution unavailable");
        }
        setDistribution(body);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setDistributionError(
          cause instanceof Error
            ? cause.message
            : "Liquidity distribution unavailable",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDistributionLoading(false);
      });
    return () => controller.abort();
  }, [selectedAddress]);

  useEffect(() => {
    if (!simulation || rangePreset === "full") {
      setLowerPriceInput("");
      setUpperPriceInput("");
      return;
    }
    setLowerPriceInput(String(Number(simulation.lowerPrice.toPrecision(7))));
    setUpperPriceInput(String(Number(simulation.upperPrice.toPrecision(7))));
  }, [rangePreset, simulation]);

  useEffect(() => {
    setMintPlan(null);
    setMintError(null);
    setSubmitted({});
    setCreatedTokenId(null);
    setReviewed(false);
  }, [
    depositUsd,
    lowerPercent,
    rangePreset,
    selectedAddress,
    slippageBps,
    upperPercent,
  ]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "pair" ? "asc" : "desc");
  }

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function openFarm(farm: FarmOpportunity) {
    setSelectedAddress(farm.poolAddress);
    setLowerPercent(25);
    setUpperPercent(25);
    setRangePreset("wide");
  }

  function selectPreset(preset: RangePreset) {
    setRangePreset(preset);
    if (preset === "small") {
      setLowerPercent(5);
      setUpperPercent(5);
    } else if (preset === "wide") {
      setLowerPercent(25);
      setUpperPercent(25);
    }
  }

  function commitLowerPrice(next: number) {
    if (!selected || !Number.isFinite(next) || next <= 0) return;
    const change = (1 - next / selected.priceToken1PerToken0) * 100;
    setLowerPercent(Math.min(99.9, Math.max(0.1, change)));
    setRangePreset("custom");
  }

  function commitUpperPrice(next: number) {
    if (!selected || !Number.isFinite(next) || next <= 0) return;
    const change = (next / selected.priceToken1PerToken0 - 1) * 100;
    setUpperPercent(Math.min(500, Math.max(0.1, change)));
    setRangePreset("custom");
  }

  async function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(query)) await load(query);
  }

  async function buildPositionPlan() {
    if (!selected || !simulation || !wallet.address) return;
    setMintBusy(true);
    setMintError(null);
    try {
      const response = await fetch("/api/farms/mint-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: wallet.address,
          poolAddress: selected.poolAddress,
          tickLower: simulation.tickLower,
          tickUpper: simulation.tickUpper,
          amount0: amount(simulation.amount0, selected.token0.decimals),
          amount1: amount(simulation.amount1, selected.token1.decimals),
          slippageBps,
        }),
      });
      const body = (await response.json()) as {
        plan?: MintPlan;
        error?: string;
      };
      if (!response.ok || !body.plan) {
        throw new Error(body.error || "Mint plan failed");
      }
      setMintPlan(body.plan);
    } catch (cause) {
      setMintError(cause instanceof Error ? cause.message : "Mint plan failed");
    } finally {
      setMintBusy(false);
    }
  }

  async function submitNextStep() {
    if (!mintPlan || !wallet.provider || !wallet.address) return;
    const step = mintPlan.steps.find(
      (candidate) => !submitted[candidate.ordinal],
    );
    if (!step) return;
    setMintBusy(true);
    setMintError(null);
    try {
      const chain = defineChain({
        id: 4663,
        name: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
        },
      });
      const publicClient = createPublicClient({
        chain,
        transport: http("https://rpc.mainnet.chain.robinhood.com"),
      });
      await publicClient.call({
        account: wallet.address,
        to: step.target,
        data: step.calldata,
        value: BigInt(step.value),
      });
      const walletClient = createWalletClient({
        account: wallet.address,
        chain,
        transport: custom(wallet.provider),
      });
      const hash = await walletClient.sendTransaction({
        account: wallet.address,
        chain,
        to: step.target,
        data: step.calldata,
        value: BigInt(step.value),
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setSubmitted((current) => ({ ...current, [step.ordinal]: hash }));
      if (step.method === "mint") {
        const transfers = parseEventLogs({
          abi: positionManagerAbi,
          eventName: "Transfer",
          logs: receipt.logs,
        });
        const minted = transfers.find(
          (log) =>
            log.args.from === zeroAddress &&
            log.args.to.toLowerCase() === wallet.address!.toLowerCase(),
        );
        if (minted) setCreatedTokenId(minted.args.tokenId.toString());
      }
    } catch (cause) {
      setMintError(
        cause instanceof Error ? cause.message : "Transaction failed",
      );
    } finally {
      setMintBusy(false);
    }
  }

  const nextStep = mintPlan?.steps.find((step) => !submitted[step.ordinal]);
  const activeFilterCount = Object.entries(filters).filter(([key, value]) =>
    key === "fee" ? value !== "ALL" : value !== "",
  ).length;

  return (
    <div className="dense-scanner">
      <section className="dense-toolbar" aria-label="Pool scanner controls">
        <div className="dense-title">
          <strong>Liquidity pools</strong>
          <span>
            {farms.length}/{data?.farms.length ?? 0}
          </span>
        </div>
        <form className="dense-search" onSubmit={submitSearch}>
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search token, symbol, pool or contract"
            aria-label="Search tokens and pools"
          />
          {/^0x[0-9a-fA-F]{40}$/.test(search.trim()) && (
            <button type="submit" disabled={loading}>
              Search chain
            </button>
          )}
        </form>
        <div className="dense-toolbar-actions">
          <div className="filter-wrap">
            <button
              type="button"
              className={
                activeFilterCount ? "dense-action active" : "dense-action"
              }
              onClick={() => setFiltersOpen((current) => !current)}
              aria-expanded={filtersOpen}
            >
              <Filter size={13} />
              Filters
              {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </button>
            {filtersOpen && (
              <div className="filter-popover">
                <div className="filter-popover-head">
                  <strong>Pool filters</strong>
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                  >
                    Reset
                  </button>
                </div>
                <div className="filter-grid">
                  <label>
                    Fee tier
                    <select
                      value={filters.fee}
                      onChange={(event) =>
                        updateFilter("fee", event.target.value)
                      }
                    >
                      <option value="ALL">Any</option>
                      <option value="100">0.01%</option>
                      <option value="500">0.05%</option>
                      <option value="3000">0.30%</option>
                      <option value="10000">1.00%</option>
                    </select>
                  </label>
                  <label>
                    Minimum TVL ($)
                    <input
                      type="number"
                      min="0"
                      value={filters.minTvl}
                      onChange={(event) =>
                        updateFilter("minTvl", event.target.value)
                      }
                      placeholder={
                        data?.minimumTvlUsd
                          ? data.minimumTvlUsd.toLocaleString()
                          : "1,000"
                      }
                    />
                  </label>
                  <label>
                    Minimum volume ($)
                    <input
                      type="number"
                      min="0"
                      value={filters.minVolume}
                      onChange={(event) =>
                        updateFilter("minVolume", event.target.value)
                      }
                      placeholder="0"
                    />
                  </label>
                  <label>
                    Minimum APR (%)
                    <input
                      type="number"
                      value={filters.minApr}
                      onChange={(event) =>
                        updateFilter("minApr", event.target.value)
                      }
                      placeholder="0"
                    />
                  </label>
                  <label>
                    Minimum swaps
                    <input
                      type="number"
                      min="0"
                      value={filters.minSwaps}
                      onChange={(event) =>
                        updateFilter("minSwaps", event.target.value)
                      }
                      placeholder="0"
                    />
                  </label>
                  <label>
                    Maximum move (%)
                    <input
                      type="number"
                      min="0"
                      value={filters.maxMove}
                      onChange={(event) =>
                        updateFilter("maxMove", event.target.value)
                      }
                      placeholder="Any"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="filter-apply"
                  onClick={() => setFiltersOpen(false)}
                >
                  Show {farms.length} pools
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="dense-icon-button"
            onClick={() => void load(chainQuery ?? undefined, true)}
            aria-label="Refresh scanner"
          >
            <RefreshCw size={13} className={refreshing ? "spin" : ""} />
          </button>
        </div>
      </section>

      <div className="dense-meta">
        <span>
          <i /> Live mainnet
        </span>
        <span>
          <Clock3 size={11} />
          {data ? new Date(data.updatedAt).toLocaleTimeString() : "-"}
        </span>
        <span>
          APR projection: {Math.round(data?.sampleMinutes ?? 0)}m sample
        </span>
        <span>Refresh: {data?.refreshAfterSeconds ?? 75}s</span>
        <span>TVL floor: {money(data?.minimumTvlUsd ?? 1_000, false)}</span>
        {chainQuery && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              void load();
            }}
          >
            Clear contract search
          </button>
        )}
      </div>

      <section className="dense-table-panel">
        {loading ? (
          <div className="dense-state">
            <LoaderCircle className="spin" size={20} />
            <strong>Loading live pools</strong>
            <span>Reading mainnet liquidity and activity...</span>
          </div>
        ) : error ? (
          <div className="dense-state error-state">
            <CircleAlert size={20} />
            <strong>Scanner unavailable</strong>
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void load(chainQuery ?? undefined)}
            >
              Try again
            </button>
          </div>
        ) : farms.length ? (
          <div className="dense-table-scroll">
            <table className="dense-table">
              <thead>
                <tr>
                  <SortHeader
                    label="Pool"
                    sortKey="pair"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Fee"
                    sortKey="fee"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Price"
                    sortKey="price"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="TVL"
                    sortKey="tvl"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="24h volume"
                    sortKey="volume"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Fees/day"
                    sortKey="fees"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="APR"
                    sortKey="apr"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Move"
                    sortKey="move"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Swaps"
                    sortKey="swaps"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Liquidity"
                    sortKey="liquidity"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {farms.map((farm) => (
                  <tr
                    key={farm.poolAddress}
                    tabIndex={0}
                    onClick={() => openFarm(farm)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openFarm(farm);
                      }
                    }}
                  >
                    <td>
                      <TokenPair farm={farm} />
                    </td>
                    <td>
                      <span className="dense-fee">{farm.feePercent}%</span>
                    </td>
                    <td className="mono">
                      {farm.priceToken1PerToken0.toLocaleString(undefined, {
                        maximumSignificantDigits: 6,
                      })}
                    </td>
                    <td>{money(farm.tvlUsd)}</td>
                    <td>{money(farm.volume24hProjectedUsd)}</td>
                    <td>{money(farm.fees24hProjectedUsd)}</td>
                    <td className="dense-apr">
                      {percent(farm.projectedPoolApr)}
                    </td>
                    <td
                      className={
                        (farm.priceChangePercent ?? 0) >= 0
                          ? "positive"
                          : "negative"
                      }
                    >
                      {percent(farm.priceChangePercent)}
                    </td>
                    <td>{farm.swapsInWindow.toLocaleString()}</td>
                    <td className="mono">
                      {compactNumber(Number(farm.liquidity))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dense-state">
            <SlidersHorizontal size={20} />
            <strong>No matching pools</strong>
            <span>Change the search or reset the filters.</span>
          </div>
        )}
      </section>

      {selected && simulation && chartBand && (
        <div
          className="pool-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedAddress(null);
          }}
        >
          <section
            className="pool-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              selected.token0.symbol +
              "/" +
              selected.token1.symbol +
              " range simulator"
            }
          >
            <header className="pool-modal-head">
              <TokenPair farm={selected} />
              <div className="pool-head-metrics">
                <span>
                  Price <b>{price(selected.token0.priceUsd)}</b>
                </span>
                <span>
                  TVL <b>{money(selected.tvlUsd)}</b>
                </span>
                <span>
                  Pool APR <b>{percent(selected.projectedPoolApr)}</b>
                </span>
              </div>
              <a
                href={
                  "https://robinhoodchain.blockscout.com/address/" +
                  selected.poolAddress
                }
                target="_blank"
                rel="noreferrer"
                className="pool-head-link"
              >
                Explorer <ExternalLink size={11} />
              </a>
              <button
                type="button"
                className="pool-close"
                onClick={() => setSelectedAddress(null)}
                aria-label="Close range simulator"
              >
                <X size={16} />
              </button>
            </header>

            <div className="pool-modal-body">
              <div className="pool-chart-column">
                <div className="chart-head">
                  <div>
                    <span>Observed pool price</span>
                    <strong>
                      {selected.priceToken1PerToken0.toLocaleString(undefined, {
                        maximumSignificantDigits: 7,
                      })}{" "}
                      {selected.token1.symbol}
                    </strong>
                  </div>
                  <div className="chart-range-label">
                    <span>Active range</span>
                    <strong>
                      {price(simulation.lowerPrice)} -{" "}
                      {price(simulation.upperPrice)}
                    </strong>
                  </div>
                </div>
                <div className="price-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="poolPriceFill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#00d632"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor="#00d632"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1d2420" vertical={false} />
                      <XAxis dataKey="index" hide />
                      <YAxis
                        width={68}
                        tick={{ fill: "#69756e", fontSize: 9 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => price(Number(value))}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        content={<PriceTooltip />}
                        cursor={{ stroke: "#58645d", strokeDasharray: "3 3" }}
                      />
                      <ReferenceArea
                        y1={chartBand.low}
                        y2={chartBand.high}
                        fill="#00d632"
                        fillOpacity={0.08}
                        stroke="#00d632"
                        strokeOpacity={0.35}
                        ifOverflow="hidden"
                      />
                      <ReferenceLine
                        y={selected.priceToken1PerToken0}
                        stroke="#f2f5f3"
                        strokeDasharray="3 3"
                        ifOverflow="extendDomain"
                      />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#00d632"
                        strokeWidth={1.5}
                        fill="url(#poolPriceFill)"
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="price-line" /> Recent price
                  </span>
                  <span>
                    <i className="range-area" /> Simulated active range
                  </span>
                  <span>
                    {selected.sampledTicks.length} samples /{" "}
                    {Math.round(selected.sampleMinutes)}m
                  </span>
                </div>

                <div className="liquidity-chart-card">
                  <div className="liquidity-chart-head">
                    <div>
                      <span>Liquidity distribution</span>
                      <strong>Initialized V3 ticks around current price</strong>
                    </div>
                    {distribution && (
                      <span>
                        {distribution.points.length} ticks · block{" "}
                        {Number(distribution.blockNumber).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {distributionLoading ? (
                    <div className="liquidity-chart-state">
                      <LoaderCircle className="spin" size={16} />
                      Reading initialized liquidity...
                    </div>
                  ) : distributionError ? (
                    <div className="liquidity-chart-state error-state">
                      {distributionError}
                    </div>
                  ) : distribution?.points.length ? (
                    <div className="liquidity-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={distribution.points}
                          margin={{ top: 8, right: 8, bottom: 2, left: 8 }}
                        >
                          <defs>
                            <linearGradient
                              id="liquidityFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="#13b8c4"
                                stopOpacity={0.82}
                              />
                              <stop
                                offset="100%"
                                stopColor="#13b8c4"
                                stopOpacity={0.12}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#1d2420" vertical={false} />
                          <XAxis
                            type="number"
                            dataKey="price"
                            domain={["dataMin", "dataMax"]}
                            tick={{ fill: "#69756e", fontSize: 8 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => price(Number(value))}
                            minTickGap={45}
                          />
                          <YAxis hide domain={[0, "dataMax"]} />
                          <Tooltip content={<LiquidityTooltip />} />
                          <ReferenceArea
                            x1={simulation.lowerPrice}
                            x2={simulation.upperPrice}
                            fill="#00d632"
                            fillOpacity={0.08}
                            stroke="#00d632"
                            strokeOpacity={0.45}
                            ifOverflow="hidden"
                          />
                          <ReferenceLine
                            x={simulation.lowerPrice}
                            stroke="#00f08a"
                            strokeWidth={1.5}
                            ifOverflow="hidden"
                          />
                          <ReferenceLine
                            x={selected.priceToken1PerToken0}
                            stroke="#f3cf45"
                            strokeWidth={1.2}
                            ifOverflow="hidden"
                          />
                          <ReferenceLine
                            x={simulation.upperPrice}
                            stroke="#00f08a"
                            strokeWidth={1.5}
                            ifOverflow="hidden"
                          />
                          <Area
                            type="stepAfter"
                            dataKey="liquidity"
                            stroke="#13b8c4"
                            strokeWidth={1}
                            fill="url(#liquidityFill)"
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="liquidity-chart-state">
                      No initialized ticks were found around this price.
                    </div>
                  )}
                  <div className="liquidity-range-legend">
                    <span>
                      <i className="range-bound-line" /> MIN{" "}
                      {price(simulation.lowerPrice)}
                    </span>
                    <span>
                      <i className="current-price-line" /> CURRENT{" "}
                      {price(selected.priceToken1PerToken0)}
                    </span>
                    <span>
                      <i className="range-bound-line" /> MAX{" "}
                      {price(simulation.upperPrice)}
                    </span>
                  </div>
                </div>

                <div className="simulation-results">
                  <div>
                    <span>Range APR</span>
                    <strong>{percent(simulation.estimatedApr)}</strong>
                  </div>
                  <div>
                    <span>Annual fees</span>
                    <strong>
                      {money(simulation.estimatedAnnualFeesUsd, false)}
                    </strong>
                  </div>
                  <div>
                    <span>In-range activity</span>
                    <strong>
                      {percent(simulation.observedRangeActivity * 100)}
                    </strong>
                  </div>
                  <div>
                    <span>Capital efficiency</span>
                    <strong>{simulation.capitalEfficiency.toFixed(1)}x</strong>
                  </div>
                </div>
                <div className="split-bar">
                  <span>Estimated deposit</span>
                  <div>
                    <b>
                      {amount(simulation.amount0, selected.token0.decimals)}{" "}
                      {selected.token0.symbol}
                    </b>
                    <b>
                      {amount(simulation.amount1, selected.token1.decimals)}{" "}
                      {selected.token1.symbol}
                    </b>
                  </div>
                </div>
              </div>

              <aside className="range-panel">
                <div className="range-panel-title">
                  <div>
                    <span>Range simulator</span>
                    <strong>Configure position</strong>
                  </div>
                  <span className="fee-chip">{selected.feePercent}% fee</span>
                </div>

                <div className="preset-tabs" aria-label="Range presets">
                  {(["small", "wide", "full", "custom"] as RangePreset[]).map(
                    (preset) => (
                      <button
                        type="button"
                        key={preset}
                        className={rangePreset === preset ? "active" : ""}
                        onClick={() => selectPreset(preset)}
                      >
                        {preset}
                      </button>
                    ),
                  )}
                </div>

                <label className="deposit-input">
                  <span>Deposit value</span>
                  <div>
                    <b>$</b>
                    <input
                      type="number"
                      min="10"
                      step="100"
                      value={depositUsd}
                      onChange={(event) =>
                        setDepositUsd(Math.max(0, Number(event.target.value)))
                      }
                    />
                    <em>USD</em>
                  </div>
                </label>

                <div className="price-bound-inputs">
                  <label>
                    <span>Lower price</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      disabled={rangePreset === "full"}
                      value={lowerPriceInput}
                      placeholder="Full range"
                      onChange={(event) =>
                        setLowerPriceInput(event.target.value)
                      }
                      onBlur={() => commitLowerPrice(Number(lowerPriceInput))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                  <label>
                    <span>Upper price</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      disabled={rangePreset === "full"}
                      value={upperPriceInput}
                      placeholder="Full range"
                      onChange={(event) =>
                        setUpperPriceInput(event.target.value)
                      }
                      onBlur={() => commitUpperPrice(Number(upperPriceInput))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                </div>

                <div className="range-slider-control">
                  <div>
                    <span>Lower boundary</span>
                    <b>-{lowerPercent.toFixed(1)}%</b>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="95"
                    step="0.1"
                    value={lowerPercent}
                    disabled={rangePreset === "full"}
                    onChange={(event) => {
                      setLowerPercent(Number(event.target.value));
                      setRangePreset("custom");
                    }}
                  />
                </div>
                <div className="range-slider-control">
                  <div>
                    <span>Upper boundary</span>
                    <b>+{upperPercent.toFixed(1)}%</b>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="200"
                    step="0.1"
                    value={upperPercent}
                    disabled={rangePreset === "full"}
                    onChange={(event) => {
                      setUpperPercent(Number(event.target.value));
                      setRangePreset("custom");
                    }}
                  />
                </div>

                <div className="tick-summary">
                  <span>
                    Lower tick <b>{simulation.tickLower.toLocaleString()}</b>
                  </span>
                  <span>
                    Upper tick <b>{simulation.tickUpper.toLocaleString()}</b>
                  </span>
                </div>

                <label className="compact-slippage">
                  <span>
                    Slippage <b>{slippageBps / 100}%</b>
                  </span>
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={slippageBps}
                    onChange={(event) =>
                      setSlippageBps(Number(event.target.value))
                    }
                  />
                </label>

                {!wallet.address ? (
                  <button
                    type="button"
                    className="range-primary"
                    onClick={() => void wallet.connect()}
                    disabled={wallet.busy}
                  >
                    <WalletCards size={14} />
                    {wallet.busy ? "Connecting..." : "Connect wallet"}
                  </button>
                ) : createdTokenId ? (
                  <div className="compact-success">
                    <Check size={15} />
                    <span>Position #{createdTokenId} created</span>
                  </div>
                ) : !mintPlan ? (
                  <button
                    type="button"
                    className="range-primary"
                    onClick={() => void buildPositionPlan()}
                    disabled={
                      mintBusy ||
                      selected.token0.priceUsd == null ||
                      selected.token1.priceUsd == null
                    }
                  >
                    {mintBusy ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <ArrowUpRight size={14} />
                    )}
                    Review transactions
                  </button>
                ) : (
                  <div className="compact-mint-plan">
                    <div>
                      <strong>{mintPlan.steps.length} wallet steps</strong>
                      <span>
                        Max gas{" "}
                        {Number(
                          formatEther(BigInt(mintPlan.maximumGasCostWei)),
                        ).toFixed(6)}{" "}
                        ETH
                      </span>
                    </div>
                    <ol>
                      {mintPlan.steps.map((step) => (
                        <li
                          key={step.ordinal}
                          className={submitted[step.ordinal] ? "done" : ""}
                        >
                          <span>
                            {submitted[step.ordinal] ? (
                              <Check size={10} />
                            ) : (
                              step.ordinal + 1
                            )}
                          </span>
                          {step.label}
                        </li>
                      ))}
                    </ol>
                    <label>
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(event) => setReviewed(event.target.checked)}
                      />
                      I reviewed the range, amounts and targets
                    </label>
                    <button
                      type="button"
                      className="range-primary"
                      disabled={!reviewed || mintBusy || !nextStep}
                      onClick={() => void submitNextStep()}
                    >
                      {mintBusy ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <WalletCards size={14} />
                      )}
                      {nextStep
                        ? "Confirm step " + (nextStep.ordinal + 1)
                        : "Transactions submitted"}
                    </button>
                  </div>
                )}
                <p className="compact-model-note">
                  Projection uses recent activity and current liquidity; returns
                  are not guaranteed.
                </p>
                {mintError && <div className="compact-error">{mintError}</div>}
              </aside>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
