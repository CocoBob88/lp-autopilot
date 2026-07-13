"use client";
import { useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  http,
} from "viem";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Combine,
  Flame,
  Layers2,
  RefreshCw,
  X,
} from "lucide-react";
import { compactAddress, formatToken } from "@/src/domain/format";
import { useWallet } from "./wallet-provider";
import type { PositionData, WorkflowPlan } from "./types";

type Action =
  | "collect"
  | "increase"
  | "remove"
  | "compound"
  | "rebalance"
  | "burn";
const actionLabels: Record<Action, string> = {
  collect: "Collect fees",
  increase: "Add liquidity",
  remove: "Remove liquidity",
  compound: "Compound",
  rebalance: "Rebalance",
  burn: "Burn empty NFT",
};

export function ActionPanel({
  position,
  onRefresh,
}: {
  position: PositionData;
  onRefresh: () => void;
}) {
  const wallet = useWallet();
  const [action, setAction] = useState<Action | null>(null);
  const [amount0, setAmount0] = useState("0");
  const [amount1, setAmount1] = useState("0");
  const [percentage, setPercentage] = useState(25);
  const [lower, setLower] = useState(position.tickLower);
  const [upper, setUpper] = useState(position.tickUpper);
  const [slippage, setSlippage] = useState(100);
  const [unwrap, setUnwrap] = useState(false);
  const [plan, setPlan] = useState<WorkflowPlan | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [submitted, setSubmitted] = useState<Record<number, string>>({});
  const [key, setKey] = useState("");
  const confirmationText = action
    ? `EXECUTE ${actionLabels[action].toUpperCase()} ON ROBINHOOD`
    : "";
  function open(next: Action) {
    setAction(next);
    setKey(`manual:${next}:${position.tokenId}:${Date.now()}`);
    setPlan(null);
    setWorkflowId(null);
    setError(null);
    setConfirmation("");
    setSubmitted({});
  }
  async function preview() {
    if (!action) return;
    if (!wallet.authenticated || wallet.mode !== "assisted") {
      setError(
        "Connect and authenticate the owning wallet in assisted mode before planning a write.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    const body: Record<string, unknown> = {
      action,
      chainId: wallet.chainId,
      owner: wallet.address,
      tokenId: position.tokenId,
      workflowKey: key,
      slippageBps: slippage,
      deadlineSeconds: 600,
      unwrapWeth: unwrap,
    };
    if (action === "increase") Object.assign(body, { amount0, amount1 });
    if (action === "remove")
      Object.assign(body, { percentageBps: percentage * 100 });
    if (action === "compound")
      Object.assign(body, { allowBalancingSwap: false });
    if (action === "rebalance")
      Object.assign(body, {
        newTickLower: lower,
        newTickUpper: upper,
        allowBalancingSwap: false,
      });
    try {
      const response = await fetch("/api/workflows/plan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": wallet.csrf || "",
        },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        plan?: WorkflowPlan;
        workflow?: { id: string };
        error?: string;
      };
      if (!response.ok || !result.plan || !result.workflow)
        throw new Error(result.error || "Plan could not be built");
      setPlan(result.plan);
      setWorkflowId(result.workflow.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plan failed");
    } finally {
      setLoading(false);
    }
  }
  async function submitStep(step: WorkflowPlan["steps"][number]) {
    if (!wallet.provider || !wallet.address || !workflowId || !plan) return;
    if (!plan.liveExecutionEnabled) {
      setError(
        "Live execution is disabled by the server gate. A passing simulation does not authorize mainnet writes.",
      );
      return;
    }
    if (confirmation !== confirmationText) {
      setError(
        "Type the exact execution confirmation before submitting this visible step.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rpc =
        wallet.chainId === 4663
          ? "https://rpc.mainnet.chain.robinhood.com"
          : process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC || "";
      if (!rpc) throw new Error("RPC is not configured for this network");
      const chain = defineChain({
        id: wallet.chainId,
        name:
          wallet.chainId === 4663
            ? "Robinhood Chain"
            : "Robinhood Chain Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
      });
      const publicClient = createPublicClient({ chain, transport: http(rpc) });
      await publicClient.call({
        account: wallet.address,
        to: step.target,
        data: step.calldata,
        value: BigInt(step.value),
      });
      const client = createWalletClient({
        account: wallet.address,
        chain,
        transport: custom(wallet.provider),
      });
      const hash = await client.sendTransaction({
        account: wallet.address,
        chain,
        to: step.target,
        data: step.calldata,
        value: BigInt(step.value),
      });
      const transaction = await publicClient.getTransaction({ hash });
      const checkpoint = await fetch("/api/workflows/checkpoint", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": wallet.csrf || "",
        },
        body: JSON.stringify({
          workflowId,
          stepOrdinal: step.ordinal,
          transactionHash: hash,
          nonce: transaction.nonce.toString(),
        }),
      });
      if (!checkpoint.ok)
        throw new Error(
          "Transaction was submitted but its durable checkpoint failed. Save the transaction hash and use recovery.",
        );
      setSubmitted((current) => ({ ...current, [step.ordinal]: hash }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 style={{ margin: 0 }}>Position actions</h2>
          <div className="metric-label" style={{ marginTop: 4 }}>
            {wallet.mode === "assisted"
              ? "Wallet confirmation required"
              : "Connect assisted wallet to transact"}
          </div>
        </div>
        <span
          className={`badge ${wallet.health?.writesAllowed ? "green" : "amber"}`}
        >
          {wallet.health?.writesAllowed ? "Writes enabled" : "Writes gated"}
        </span>
      </div>
      <div className="panel-body">
        <div className="action-grid">
          <button className="button" onClick={() => open("collect")}>
            <ArrowDownToLine size={13} />
            Collect
          </button>
          <button className="button" onClick={() => open("increase")}>
            <ArrowUpFromLine size={13} />
            Add
          </button>
          <button className="button" onClick={() => open("remove")}>
            <Layers2 size={13} />
            Remove
          </button>
          <button className="button" onClick={() => open("compound")}>
            <Combine size={13} />
            Compound
          </button>
          <button className="button" onClick={() => open("rebalance")}>
            <RefreshCw size={13} />
            Rebalance
          </button>
          <button
            className="button"
            onClick={() => open("burn")}
            disabled={
              BigInt(position.liquidity) !== 0n ||
              BigInt(position.tokensOwed0) !== 0n ||
              BigInt(position.tokensOwed1) !== 0n
            }
          >
            <Flame size={13} />
            Burn NFT
          </button>
        </div>
        <div className="warning-box" style={{ marginTop: 12 }}>
          Mainnet transactions require fresh server gates and your explicit
          wallet approval. No button bypasses simulation, checkpointing, or
          reconciliation.
        </div>
      </div>
      {action && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-title"
        >
          <div className="modal">
            <div className="modal-head">
              <div>
                <h2 id="action-title" style={{ margin: 0 }}>
                  {actionLabels[action]}
                </h2>
                <div className="metric-label" style={{ marginTop: 4 }}>
                  Position #{position.tokenId} · {position.token0.symbol}/
                  {position.token1.symbol}
                </div>
              </div>
              <button
                className="button icon ghost"
                aria-label="Close action dialog"
                onClick={() => setAction(null)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="modal-body">
              {!plan && (
                <div className="form-stack">
                  {action === "increase" && (
                    <div className="field-row">
                      <div className="field">
                        <label>{position.token0.symbol} amount</label>
                        <input
                          className="input mono"
                          value={amount0}
                          onChange={(event) => setAmount0(event.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>{position.token1.symbol} amount</label>
                        <input
                          className="input mono"
                          value={amount1}
                          onChange={(event) => setAmount1(event.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  {action === "remove" && (
                    <div className="field">
                      <label>Liquidity to remove · {percentage}%</label>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={percentage}
                        onChange={(event) =>
                          setPercentage(Number(event.target.value))
                        }
                      />
                    </div>
                  )}
                  {action === "rebalance" && (
                    <div className="field-row">
                      <div className="field">
                        <label>New lower tick</label>
                        <input
                          className="input mono"
                          type="number"
                          value={lower}
                          onChange={(event) =>
                            setLower(Number(event.target.value))
                          }
                        />
                      </div>
                      <div className="field">
                        <label>New upper tick</label>
                        <input
                          className="input mono"
                          type="number"
                          value={upper}
                          onChange={(event) =>
                            setUpper(Number(event.target.value))
                          }
                        />
                      </div>
                    </div>
                  )}
                  <div className="field-row">
                    <div className="field">
                      <label>Maximum slippage · {slippage / 100}%</label>
                      <input
                        type="range"
                        min="1"
                        max="500"
                        value={slippage}
                        onChange={(event) =>
                          setSlippage(Number(event.target.value))
                        }
                      />
                    </div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#8f9a93",
                        fontSize: 11,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={unwrap}
                        onChange={(event) => setUnwrap(event.target.checked)}
                        disabled={
                          action === "increase" ||
                          action === "compound" ||
                          action === "rebalance" ||
                          action === "burn"
                        }
                      />{" "}
                      Unwrap WETH proceeds
                    </label>
                  </div>
                  <div className="info-box">
                    Preview uses current ownership, pool state, exact raw
                    amounts, bounded slippage, and the authenticated sender.
                    Compound and rebalance are intentionally split at
                    confirmed-state boundaries.
                  </div>
                </div>
              )}
              {plan && (
                <>
                  <div className="field-row">
                    <div className="kv">
                      <span>Wallet / chain</span>
                      <span className="mono">
                        {compactAddress(plan.owner)} · {plan.chainId}
                      </span>
                    </div>
                    <div className="kv">
                      <span>Quote block</span>
                      <span className="mono">
                        {Number(plan.quoteBlock).toLocaleString()}
                      </span>
                    </div>
                    <div className="kv">
                      <span>Slippage / deadline</span>
                      <span>
                        {plan.slippageBps / 100}% ·{" "}
                        {new Date(plan.expiresAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="kv">
                      <span>Maximum gas cost</span>
                      <span className="mono">
                        {formatEther(BigInt(plan.maximumGasCostWei))} ETH
                      </span>
                    </div>
                  </div>
                  <div className="plan-steps">
                    {plan.steps.map((step) => (
                      <div className="plan-step" key={step.ordinal}>
                        <span className="step-index">{step.ordinal + 1}</span>
                        <div>
                          <strong style={{ fontSize: 11 }}>{step.label}</strong>
                          <div
                            className="mono"
                            style={{
                              fontSize: 9,
                              color: "#647068",
                              marginTop: 4,
                            }}
                          >
                            {compactAddress(step.target, 8)} · {step.method}
                          </div>
                          {step.simulationError && (
                            <div
                              style={{
                                color: "#ff8790",
                                fontSize: 9,
                                marginTop: 5,
                              }}
                            >
                              {step.simulationError}
                            </div>
                          )}
                          {submitted[step.ordinal] && (
                            <a
                              href={`https://robinhoodchain.blockscout.com/tx/${submitted[step.ordinal]}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: "#69ef86",
                                fontSize: 9,
                                display: "block",
                                marginTop: 5,
                              }}
                            >
                              Submitted{" "}
                              {compactAddress(submitted[step.ordinal], 8)}
                            </a>
                          )}
                        </div>
                        <span
                          className={`badge ${step.simulated ? "green" : "amber"}`}
                        >
                          {step.simulated ? "Simulated" : "Needs JIT"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {plan.nextPhase && (
                    <div className="warning-box">
                      This workflow has a confirmed-state continuation:{" "}
                      {String(plan.nextPhase.reason)} The app will not construct
                      or replay dependent stale calldata.
                    </div>
                  )}
                  <div className="info-box">
                    Expected deltas:{" "}
                    {formatToken(
                      plan.expected.amount0,
                      position.token0.decimals,
                    )}{" "}
                    {position.token0.symbol} ·{" "}
                    {formatToken(
                      plan.expected.amount1,
                      position.token1.decimals,
                    )}{" "}
                    {position.token1.symbol}. {plan.recovery}
                  </div>
                  {plan.liveExecutionEnabled && (
                    <div className="field">
                      <label>Type: {confirmationText}</label>
                      <input
                        className="input mono"
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                      />
                    </div>
                  )}
                </>
              )}
              {error && <div className="error-box">{error}</div>}
            </div>
            <div className="modal-foot">
              <button
                className="button"
                onClick={() => (plan ? setPlan(null) : setAction(null))}
              >
                {plan ? "Back to inputs" : "Cancel"}
              </button>
              {!plan ? (
                <button
                  className="button primary"
                  disabled={loading}
                  onClick={() => void preview()}
                >
                  {loading ? "Reading chain…" : "Build & simulate plan"}
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  {plan.steps.map(
                    (step) =>
                      !submitted[step.ordinal] && (
                        <button
                          key={step.ordinal}
                          className="button primary"
                          disabled={
                            loading ||
                            !plan.liveExecutionEnabled ||
                            confirmation !== confirmationText ||
                            (step.ordinal > 0 && !submitted[step.ordinal - 1])
                          }
                          onClick={() => void submitStep(step)}
                        >
                          Submit step {step.ordinal + 1}
                        </button>
                      ),
                  )}
                  {Object.keys(submitted).length > 0 && (
                    <button className="button" onClick={onRefresh}>
                      Refresh position
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
