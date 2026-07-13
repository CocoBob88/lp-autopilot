"use client";

import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Filter,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  simulateRange,
  type FarmOpportunity,
  type FarmScannerResponse,
} from "@/src/domain/farms";
import { compactAddress } from "@/src/domain/format";
import { useWallet } from "./wallet-provider";

type SortKey = "opportunity" | "apr" | "tvl" | "volume" | "activity";
type MintPlan = {
  requestHash: string;
  token0: `0x${string}`;
  token1: `0x${string}`;
  amount0: string;
  amount1: string;
  tickLower: number;
  tickUpper: number;
  maximumGasCostWei: string;
  executionReady: boolean;
  steps: Array<{
    ordinal: number;
    label: string;
    target: `0x${string}`;
    method: string;
    calldata: `0x${string}`;
    value: string;
    simulated: boolean;
    simulationError?: string;
  }>;
};

function money(value: number | null, compact = true) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: value < 100 ? 2 : 1,
  }).format(value);
}

function percent(value: number | null, maximumFractionDigits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(undefined, { maximumFractionDigits })}%`;
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
    <div className="farm-pair">
      <div className="token-stack" aria-hidden="true">
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

export function FarmScanner() {
  const wallet = useWallet();
  const [data, setData] = useState<FarmScannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chainQuery, setChainQuery] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("opportunity");
  const [risk, setRisk] = useState("ALL");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [depositUsd, setDepositUsd] = useState(1_000);
  const [lowerPercent, setLowerPercent] = useState(10);
  const [upperPercent, setUpperPercent] = useState(10);
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
        token ? `/api/farms?token=${encodeURIComponent(token)}` : "/api/farms",
        { cache: "no-store" },
      );
      const body = (await response.json()) as FarmScannerResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Farm scanner unavailable");
      setData(body);
      setChainQuery(token ?? null);
      setSelectedAddress((current) =>
        body.farms.some((farm) => farm.poolAddress === current)
          ? current
          : (body.farms[0]?.poolAddress ?? null),
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
    const timer = window.setInterval(() => void load(undefined, true), 75_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const farms = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const visible = (data?.farms ?? []).filter((farm) => {
      const matches =
        !needle ||
        farm.token0.symbol.toLowerCase().includes(needle) ||
        farm.token1.symbol.toLowerCase().includes(needle) ||
        farm.token0.name.toLowerCase().includes(needle) ||
        farm.token1.name.toLowerCase().includes(needle) ||
        farm.token0.address.toLowerCase() === needle ||
        farm.token1.address.toLowerCase() === needle ||
        farm.poolAddress.toLowerCase() === needle;
      return matches && (risk === "ALL" || farm.risk === risk);
    });
    return visible.sort((a, b) => {
      if (sort === "apr")
        return (b.projectedPoolApr ?? -1) - (a.projectedPoolApr ?? -1);
      if (sort === "tvl") return (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1);
      if (sort === "volume")
        return (
          (b.volume24hProjectedUsd ?? -1) - (a.volume24hProjectedUsd ?? -1)
        );
      if (sort === "activity") return b.swapsInWindow - a.swapsInWindow;
      const score = (farm: FarmOpportunity) =>
        Math.log10(Math.max(1, farm.tvlUsd ?? 1)) *
        Math.log10(
          Math.max(1, farm.volume24hProjectedUsd ?? farm.activityScore),
        );
      return score(b) - score(a);
    });
  }, [data, risk, search, sort]);

  const selected =
    data?.farms.find((farm) => farm.poolAddress === selectedAddress) ??
    farms[0] ??
    null;
  const simulation = useMemo(
    () =>
      selected
        ? simulateRange(selected, depositUsd, lowerPercent, upperPercent)
        : null,
    [depositUsd, lowerPercent, selected, upperPercent],
  );

  useEffect(() => {
    setMintPlan(null);
    setMintError(null);
    setSubmitted({});
    setCreatedTokenId(null);
    setReviewed(false);
  }, [depositUsd, lowerPercent, selectedAddress, slippageBps, upperPercent]);

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
      if (!response.ok || !body.plan)
        throw new Error(body.error || "Mint plan failed");
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
        data: step.calldata as Hex,
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
        data: step.calldata as Hex,
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

  return (
    <div className="discover-page">
      <section className="discover-hero">
        <div>
          <div className="eyebrow">Robinhood Chain liquidity intelligence</div>
          <h1>Find the range before you fund it.</h1>
          <p>
            Scan verified V3 pools, compare farm economics, and model a
            concentrated liquidity range with live on-chain data—no wallet
            required.
          </p>
        </div>
        <div className="hero-proof">
          <ShieldCheck size={18} />
          <div>
            <strong>Factory verified</strong>
            <span>Public mainnet data · refreshes every 75 seconds</span>
          </div>
        </div>
      </section>

      <section className="scanner-toolbar" aria-label="Pool scanner controls">
        <form className="scanner-search" onSubmit={submitSearch}>
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search token name, symbol, pool, or paste a token contract"
            aria-label="Search tokens and pools"
          />
          {/^0x[0-9a-fA-F]{40}$/.test(search.trim()) && (
            <button className="button primary" type="submit" disabled={loading}>
              Search chain
            </button>
          )}
        </form>
        <div className="scanner-filters">
          <label>
            <ArrowDownUp size={13} />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="opportunity">Opportunity score</option>
              <option value="apr">Projected APR</option>
              <option value="tvl">TVL</option>
              <option value="volume">Projected volume</option>
              <option value="activity">Recent swaps</option>
            </select>
          </label>
          <label>
            <Filter size={13} />
            <select
              value={risk}
              onChange={(event) => setRisk(event.target.value)}
            >
              <option value="ALL">All risk levels</option>
              <option value="LOW">Low risk</option>
              <option value="MEDIUM">Medium risk</option>
              <option value="HIGH">High risk</option>
              <option value="UNPRICED">Unpriced</option>
            </select>
          </label>
          <button
            className="button icon"
            onClick={() => void load(chainQuery ?? undefined, true)}
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            <span className="sr-only">Refresh scanner</span>
          </button>
        </div>
      </section>

      <div className="scanner-meta">
        <span>
          <span className="live-pulse" /> {data?.farms.length ?? 0} active pools
        </span>
        <span>
          <Clock3 size={12} /> Updated{" "}
          {data ? new Date(data.updatedAt).toLocaleTimeString() : "—"}
        </span>
        <span>
          APR uses a {Math.round(data?.sampleMinutes ?? 0)}-minute rolling
          sample
        </span>
        {chainQuery && (
          <button
            className="text-button"
            onClick={() => {
              setSearch("");
              void load();
            }}
          >
            Clear contract search
          </button>
        )}
      </div>

      <section className="scanner-panel">
        {loading ? (
          <div className="scanner-loading">
            <LoaderCircle className="spin" size={24} />
            <strong>Reading active pools and farm economics</strong>
            <span>
              Validating factory, tokens, reserves, prices, and swap activity…
            </span>
          </div>
        ) : error ? (
          <div className="scanner-loading error-state">
            <CircleAlert size={24} />
            <strong>Scanner data is temporarily unavailable</strong>
            <span>{error}</span>
            <button
              className="button"
              onClick={() => void load(chainQuery ?? undefined)}
            >
              Try again
            </button>
          </div>
        ) : farms.length ? (
          <div className="farm-table-wrap">
            <table className="farm-table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Fee</th>
                  <th>TVL</th>
                  <th>Projected 24h volume</th>
                  <th>Pool fee APR</th>
                  <th>Price move</th>
                  <th>Recent swaps</th>
                  <th>Risk</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {farms.map((farm) => (
                  <tr
                    key={farm.poolAddress}
                    className={
                      selected?.poolAddress === farm.poolAddress
                        ? "selected"
                        : ""
                    }
                    onClick={() => setSelectedAddress(farm.poolAddress)}
                  >
                    <td>
                      <TokenPair farm={farm} />
                    </td>
                    <td>
                      <span className="fee-pill">{farm.feePercent}%</span>
                    </td>
                    <td>
                      <strong>{money(farm.tvlUsd)}</strong>
                    </td>
                    <td>{money(farm.volume24hProjectedUsd)}</td>
                    <td className="apr-cell">
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
                    <td>
                      <span className={`risk-pill ${farm.risk.toLowerCase()}`}>
                        {farm.risk}
                      </span>
                    </td>
                    <td>
                      <ChevronRight size={14} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="scanner-loading">
            <Layers3 size={24} />
            <strong>No pools match this search</strong>
            <span>
              Try another symbol or paste the exact token contract address.
            </span>
          </div>
        )}
      </section>

      {selected && simulation && (
        <section className="farm-workbench">
          <div className="farm-detail-card">
            <div className="workbench-head">
              <div>
                <span className="eyebrow">Selected opportunity</span>
                <TokenPair farm={selected} />
              </div>
              <a
                href={`https://robinhoodchain.blockscout.com/address/${selected.poolAddress}`}
                target="_blank"
                rel="noreferrer"
                className="button"
              >
                Explorer <ExternalLink size={12} />
              </a>
            </div>
            <div className="metric-ribbon">
              <div>
                <span>Pool price</span>
                <strong>
                  {selected.priceToken1PerToken0.toLocaleString(undefined, {
                    maximumSignificantDigits: 7,
                  })}
                </strong>
                <small>
                  {selected.token1.symbol} per {selected.token0.symbol}
                </small>
              </div>
              <div>
                <span>TVL</span>
                <strong>{money(selected.tvlUsd)}</strong>
                <small>Live token reserves</small>
              </div>
              <div>
                <span>Projected fees / day</span>
                <strong>{money(selected.fees24hProjectedUsd)}</strong>
                <small>Rolling sample projection</small>
              </div>
              <div>
                <span>Pool APR</span>
                <strong className="green-text">
                  {percent(selected.projectedPoolApr)}
                </strong>
                <small>Before range selection</small>
              </div>
            </div>
            <div className="range-visual">
              <div className="range-labels">
                <span>
                  Lower{" "}
                  {simulation.lowerPrice.toLocaleString(undefined, {
                    maximumSignificantDigits: 6,
                  })}
                </span>
                <strong>
                  Current{" "}
                  {selected.priceToken1PerToken0.toLocaleString(undefined, {
                    maximumSignificantDigits: 6,
                  })}
                </strong>
                <span>
                  Upper{" "}
                  {simulation.upperPrice.toLocaleString(undefined, {
                    maximumSignificantDigits: 6,
                  })}
                </span>
              </div>
              <div className="range-track">
                <span className="range-fill" />
                <span className="range-marker" />
              </div>
              <div className="range-caption">
                Your simulated active range · ticks{" "}
                {simulation.tickLower.toLocaleString()} to{" "}
                {simulation.tickUpper.toLocaleString()}
              </div>
            </div>
            <div className="token-metrics-grid">
              {[selected.token0, selected.token1].map((token, index) => (
                <div className="token-metric-card" key={token.address}>
                  <div>
                    <span className="token-letter">
                      {token.symbol.slice(0, 1)}
                    </span>
                    <strong>{token.symbol}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Price</dt>
                      <dd>{money(token.priceUsd, false)}</dd>
                    </div>
                    <div>
                      <dt>Pool reserve</dt>
                      <dd>
                        {(index
                          ? selected.reserve1
                          : selected.reserve0
                        ).toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>Contract</dt>
                      <dd className="mono">
                        {compactAddress(token.address, 6)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            {selected.riskReasons.length > 0 && (
              <div className="risk-note">
                <CircleAlert size={15} />
                <div>
                  <strong>Risk signals</strong>
                  <span>{selected.riskReasons.join(" · ")}</span>
                </div>
              </div>
            )}
          </div>

          <aside className="simulator-card">
            <div className="simulator-title">
              <div>
                <span className="eyebrow">Range simulator</span>
                <h2>Model your position</h2>
              </div>
              <Sparkles size={18} />
            </div>
            <label className="sim-input">
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
              </div>
            </label>
            <div className="range-inputs">
              <label>
                <span>Below current</span>
                <div>
                  <input
                    type="number"
                    min="0.1"
                    max="95"
                    step="0.5"
                    value={lowerPercent}
                    onChange={(event) =>
                      setLowerPercent(Number(event.target.value))
                    }
                  />
                  <b>%</b>
                </div>
              </label>
              <label>
                <span>Above current</span>
                <div>
                  <input
                    type="number"
                    min="0.1"
                    max="500"
                    step="0.5"
                    value={upperPercent}
                    onChange={(event) =>
                      setUpperPercent(Number(event.target.value))
                    }
                  />
                  <b>%</b>
                </div>
              </label>
            </div>
            <div className="sim-results">
              <div>
                <span>Estimated range APR</span>
                <strong>{percent(simulation.estimatedApr)}</strong>
              </div>
              <div>
                <span>Estimated annual fees</span>
                <strong>
                  {money(simulation.estimatedAnnualFeesUsd, false)}
                </strong>
              </div>
              <div>
                <span>Observed in-range activity</span>
                <strong>
                  {percent(simulation.observedRangeActivity * 100)}
                </strong>
              </div>
              <div>
                <span>Capital efficiency</span>
                <strong>{simulation.capitalEfficiency.toFixed(1)}×</strong>
              </div>
            </div>
            <div className="deposit-split">
              <span>Estimated deposit split</span>
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
            <label className="slippage-control">
              <span>
                Maximum slippage <b>{slippageBps / 100}%</b>
              </span>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={slippageBps}
                onChange={(event) => setSlippageBps(Number(event.target.value))}
              />
            </label>
            <p className="model-note">
              Estimate uses the rolling swap sample, current active liquidity,
              your projected liquidity share, and observed in-range activity. It
              is not a guaranteed return.
            </p>

            {!wallet.address ? (
              <button
                className="button primary create-button"
                onClick={() => void wallet.connect()}
                disabled={wallet.busy}
              >
                <WalletCards size={15} />{" "}
                {wallet.busy
                  ? "Connecting…"
                  : "Connect wallet to create position"}
              </button>
            ) : createdTokenId ? (
              <div className="mint-success">
                <span>
                  <Check size={17} />
                </span>
                <div>
                  <strong>Position #{createdTokenId} created</strong>
                  <small>
                    The NFT is owned by {compactAddress(wallet.address)}
                  </small>
                </div>
              </div>
            ) : !mintPlan ? (
              <button
                className="button primary create-button"
                onClick={() => void buildPositionPlan()}
                disabled={
                  mintBusy ||
                  selected.token0.priceUsd == null ||
                  selected.token1.priceUsd == null
                }
              >
                {mintBusy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <ArrowUpRight size={15} />
                )}
                Review position transactions
              </button>
            ) : (
              <div className="mint-plan">
                <div className="mint-plan-head">
                  <strong>Wallet transaction plan</strong>
                  <span>
                    {mintPlan.steps.length} step
                    {mintPlan.steps.length === 1 ? "" : "s"}
                  </span>
                </div>
                {mintPlan.steps.map((step) => (
                  <div className="mint-step" key={step.ordinal}>
                    <span className={submitted[step.ordinal] ? "done" : ""}>
                      {submitted[step.ordinal] ? (
                        <Check size={12} />
                      ) : (
                        step.ordinal + 1
                      )}
                    </span>
                    <div>
                      <strong>{step.label}</strong>
                      <small>
                        {step.method} · {compactAddress(step.target, 5)}
                      </small>
                    </div>
                  </div>
                ))}
                <div className="mint-gas">
                  Maximum estimated gas{" "}
                  <b>
                    {Number(
                      formatEther(BigInt(mintPlan.maximumGasCostWei)),
                    ).toFixed(6)}{" "}
                    ETH
                  </b>
                </div>
                <label className="review-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                  />{" "}
                  I reviewed the token amounts, range, slippage, and transaction
                  targets.
                </label>
                <button
                  className="button primary create-button"
                  disabled={!reviewed || mintBusy || !nextStep}
                  onClick={() => void submitNextStep()}
                >
                  {mintBusy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <WalletCards size={15} />
                  )}
                  {nextStep
                    ? `Confirm step ${nextStep.ordinal + 1} in wallet`
                    : "Transactions submitted"}
                </button>
              </div>
            )}
            {mintError && <div className="error-box">{mintError}</div>}
          </aside>
        </section>
      )}
    </div>
  );
}
