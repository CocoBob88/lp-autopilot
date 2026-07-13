"use client";
import {
  Bot,
  Plus,
  RefreshCw,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/src/components/wallet-provider";

type StoredPosition = { id: string; tokenId: string };
type Strategy = {
  id: string;
  kind: string;
  mode: string;
  enabled: boolean;
  updatedAt: string;
  position: {
    tokenId: string;
    token0: { symbol: string };
    token1: { symbol: string };
  };
  executions: Array<{ id: string; decision: string; errorCode?: string }>;
};

export default function StrategiesPage() {
  const wallet = useWallet();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [positions, setPositions] = useState<StoredPosition[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionId, setPositionId] = useState("");
  const [kind, setKind] = useState("RANGE_GUARD");
  const [mode, setMode] = useState("ALERT_ONLY");
  const load = useCallback(async () => {
    if (!wallet.authenticated) return;
    try {
      const response = await fetch("/api/strategies", { cache: "no-store" });
      const body = (await response.json()) as {
        strategies?: Strategy[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error);
      setStrategies(body.strategies ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load strategies",
      );
    }
  }, [wallet.authenticated]);
  useEffect(() => {
    void load();
  }, [load]);
  async function syncPositions() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/positions", {
        method: "POST",
        headers: { "x-csrf-token": wallet.csrf || "" },
      });
      const body = (await response.json()) as {
        positions?: StoredPosition[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error);
      setPositions(body.positions ?? []);
      if (body.positions?.[0]) setPositionId(body.positions[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Position sync failed");
    } finally {
      setBusy(false);
    }
  }
  async function createStrategy() {
    if (!positionId) {
      setError("Sync and choose a validated position first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/strategies", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": wallet.csrf || "",
        },
        body: JSON.stringify({
          positionId,
          kind,
          mode,
          minFeeThreshold0: "0",
          minFeeThreshold1: "0",
          triggerDistanceBps: 500,
          rangeWidthBps: 2000,
          cooldownSeconds: 3600,
          maxExecutionsPerDay: 4,
          maxGasPerExecutionWei: "5000000000000000",
          maxDailyGasWei: "15000000000000000",
          maxSlippageBps: 100,
          maxPriceImpactBps: 100,
          minPoolLiquidity: "1",
          maxQuoteAgeSeconds: 120,
          maxBlockLag: 50,
          minConfirmations: 12,
          allowedOutputAssets: [],
          config: { twapSeconds: 1800 },
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error);
      setShowForm(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Strategy creation failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggle(strategy: Strategy) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/strategies", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": wallet.csrf || "",
        },
        body: JSON.stringify({ id: strategy.id, enabled: !strategy.enabled }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Strategy update failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Deterministic automation</div>
          <h1>Strategies</h1>
          <p className="page-description">
            Rules are evaluated against indexed state and a reviewed 30-minute
            TWAP. Alert-only is the default; autopilot requires a separate,
            deliberately enabled signer.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="button"
            onClick={() => void syncPositions()}
            disabled={!wallet.authenticated || busy}
          >
            <RefreshCw size={13} /> Sync positions
          </button>
          <button
            className="button primary"
            onClick={() => setShowForm(true)}
            disabled={!wallet.authenticated}
          >
            <Plus size={13} /> New strategy
          </button>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <div className="stat-label">Configured</div>
          <div className="stat-value">
            {wallet.authenticated ? strategies.length : "—"}
          </div>
          <div className="stat-meta">User and chain scoped</div>
        </div>
        <div className="stat">
          <div className="stat-label">Enabled</div>
          <div className="stat-value">
            {wallet.authenticated
              ? strategies.filter((item) => item.enabled).length
              : "—"}
          </div>
          <div className="stat-meta">Worker-evaluated rules</div>
        </div>
        <div className="stat">
          <div className="stat-label">Autopilot</div>
          <div className="stat-value">
            {wallet.authenticated
              ? strategies.filter(
                  (item) => item.mode === "AUTOPILOT" && item.enabled,
                ).length
              : "—"}
          </div>
          <div className="stat-meta">Dedicated signer only</div>
        </div>
        <div className="stat">
          <div className="stat-label">Price policy</div>
          <div className="stat-value" style={{ fontSize: 17 }}>
            TWAP
          </div>
          <div className="stat-meta">
            Spot alone never authorizes value movement
          </div>
        </div>
      </div>
      {error && (
        <div className="error-box" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}
      <div className="section-title">
        <h2>Strategy registry</h2>
      </div>
      <div className="panel">
        {!wallet.authenticated ? (
          <div className="empty">
            <div>
              <div className="empty-icon">
                <ShieldCheck size={18} />
              </div>
              <h3>Authenticate the owning wallet</h3>
              <p>
                Strategy records, permissions, and execution budgets are
                protected user data.
              </p>
            </div>
          </div>
        ) : strategies.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Position</th>
                  <th>Mode</th>
                  <th>Last decision</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy) => (
                  <tr key={strategy.id}>
                    <td>
                      <strong>{strategy.kind.replaceAll("_", " ")}</strong>
                      <div className="metric-label" style={{ marginTop: 4 }}>
                        {new Date(strategy.updatedAt).toLocaleString()}
                      </div>
                    </td>
                    <td>
                      {strategy.position.token0.symbol}/
                      {strategy.position.token1.symbol}{" "}
                      <span className="mono" style={{ color: "#69746d" }}>
                        #{strategy.position.tokenId}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${strategy.mode === "AUTOPILOT" ? "amber" : strategy.mode === "APPROVAL_REQUIRED" ? "blue" : ""}`}
                      >
                        {strategy.mode.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>
                      {strategy.executions[0]?.errorCode ||
                        strategy.executions[0]?.decision ||
                        "No execution evidence"}
                    </td>
                    <td>
                      <span
                        className={`badge ${strategy.enabled ? "green" : ""}`}
                      >
                        {strategy.enabled ? "Enabled" : "Paused"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button icon ghost"
                        aria-label={`${strategy.enabled ? "Disable" : "Enable"} strategy`}
                        onClick={() => void toggle(strategy)}
                        disabled={busy}
                      >
                        {strategy.enabled ? (
                          <ToggleRight size={18} color="#00d632" />
                        ) : (
                          <ToggleLeft size={18} />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div>
              <div className="empty-icon">
                <Bot size={18} />
              </div>
              <h3>No strategies configured</h3>
              <p>
                Sync current on-chain positions, then create a reviewed rule.
                New strategies start paused.
              </p>
            </div>
          </div>
        )}
      </div>
      {showForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>Create deterministic strategy</h2>
              <button
                className="button icon ghost"
                onClick={() => setShowForm(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Validated position</label>
                <select
                  className="select"
                  value={positionId}
                  onChange={(event) => setPositionId(event.target.value)}
                >
                  <option value="">Sync a position first</option>
                  {positions.map((item) => (
                    <option key={item.id} value={item.id}>
                      NFT #{item.tokenId}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Strategy</label>
                  <select
                    className="select"
                    value={kind}
                    onChange={(event) => {
                      const nextKind = event.target.value;
                      setKind(nextKind);
                      if (nextKind !== "PROFIT_HARVEST" && mode === "AUTOPILOT")
                        setMode("APPROVAL_REQUIRED");
                    }}
                  >
                    <option value="RANGE_GUARD">Range Guard</option>
                    <option value="AUTO_COMPOUND">Auto Compound</option>
                    <option value="SCHEDULED_COMPOUND">
                      Scheduled Compound
                    </option>
                    <option value="RECENTER">Recenter</option>
                    <option value="ONE_SIDED_EXIT">One-Sided Exit</option>
                    <option value="PROFIT_HARVEST">Profit Harvest</option>
                  </select>
                </div>
                <div className="field">
                  <label>Execution mode</label>
                  <select
                    className="select"
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                  >
                    <option value="ALERT_ONLY">Alert only</option>
                    <option value="APPROVAL_REQUIRED">Approval required</option>
                    <option
                      value="AUTOPILOT"
                      disabled={kind !== "PROFIT_HARVEST"}
                    >
                      Autopilot signer (harvest only)
                    </option>
                  </select>
                </div>
              </div>
              <div className="warning-box">
                The initial policy uses a 30-minute TWAP, 1% slippage and impact
                caps, 12 confirmations, a one-hour cooldown, four executions per
                day, and strict gas budgets. Review and tailor these limits
                before enabling. Unattended signing is intentionally limited to
                single-phase profit harvest; multi-phase or exposure-changing
                strategies require review and approval.
              </div>
            </div>
            <div className="modal-foot">
              <button className="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !positionId}
                onClick={() => void createStrategy()}
              >
                Create paused strategy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
