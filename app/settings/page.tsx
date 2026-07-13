"use client";
import {
  Copy,
  Database,
  KeyRound,
  Network,
  PlugZap,
  WalletCards,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useWallet } from "@/src/components/wallet-provider";

type Capabilities = {
  database: boolean;
  mainnetRpc: boolean;
  fallbackRpc: boolean;
  testnetRpc: boolean;
  automationEncryption: boolean;
  autopilotGate: boolean;
  notifications: Record<string, boolean>;
};
export default function SettingsPage() {
  const wallet = useWallet();
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState("LP strategy wallet");
  const [confirmation, setConfirmation] = useState("");
  const [created, setCreated] = useState<{
    address: string;
    recoveryPrivateKey: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void fetch("/api/settings/capabilities")
      .then((response) => response.json())
      .then(setCapabilities);
  }, []);
  async function createWallet() {
    setError(null);
    try {
      const response = await fetch("/api/wallets/automation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": wallet.csrf || "",
        },
        body: JSON.stringify({
          label,
          maxGasPerExecutionWei: "5000000000000000",
          maxDailyGasWei: "15000000000000000",
          confirmation,
        }),
      });
      const body = (await response.json()) as {
        address?: string;
        recoveryPrivateKey?: string;
        error?: string;
      };
      if (!response.ok || !body.address || !body.recoveryPrivateKey)
        throw new Error(body.error || "Wallet creation failed");
      setCreated({
        address: body.address,
        recoveryPrivateKey: body.recoveryPrivateKey,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wallet creation failed",
      );
    }
  }
  async function copyKey() {
    if (!created) return;
    await navigator.clipboard.writeText(created.recoveryPrivateKey);
    setCopied(true);
  }
  const notificationCount = capabilities
    ? Object.values(capabilities.notifications).filter(Boolean).length
    : 0;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Environment & custody</div>
          <h1>Settings</h1>
          <p className="page-description">
            Network separation, provider readiness, notification adapters, and
            dedicated automation custody live here.
          </p>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <div className="stat-label">Database</div>
          <div style={{ marginTop: 14 }}>
            <span
              className={`badge ${capabilities?.database ? "green" : "amber"}`}
            >
              {capabilities?.database ? "Configured" : "Required"}
            </span>
          </div>
          <div className="stat-meta">PostgreSQL durable state</div>
        </div>
        <div className="stat">
          <div className="stat-label">RPC providers</div>
          <div className="stat-value">
            {capabilities
              ? Number(capabilities.mainnetRpc) +
                Number(capabilities.fallbackRpc)
              : "—"}
          </div>
          <div className="stat-meta">Primary + independent fallback</div>
        </div>
        <div className="stat">
          <div className="stat-label">Notification routes</div>
          <div className="stat-value">
            {capabilities ? notificationCount : "—"}
          </div>
          <div className="stat-meta">Webhook, Discord, Telegram, email</div>
        </div>
        <div className="stat">
          <div className="stat-label">Autopilot gate</div>
          <div style={{ marginTop: 14 }}>
            <span
              className={`badge ${capabilities?.autopilotGate ? "amber" : ""}`}
            >
              {capabilities?.autopilotGate ? "Available" : "Off"}
            </span>
          </div>
          <div className="stat-meta">Does not imply wallet authorization</div>
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 14 }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="panel">
            <div className="panel-header">
              <h2 style={{ margin: 0 }}>Network configuration</h2>
              <Network size={16} />
            </div>
            <div className="panel-body">
              <div className="kv">
                <span>Mainnet chain ID</span>
                <span className="mono">4663</span>
              </div>
              <div className="kv">
                <span>Native gas asset</span>
                <span>ETH · 18 decimals</span>
              </div>
              <div className="kv">
                <span>Mainnet manifest</span>
                <span className="badge green">Reviewed + runtime checked</span>
              </div>
              <div className="kv">
                <span>Testnet chain ID</span>
                <span className="mono">46630</span>
              </div>
              <div className="kv">
                <span>Testnet contracts</span>
                <span className="badge amber">
                  Independent manifest required
                </span>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <h2 style={{ margin: 0 }}>External prerequisites</h2>
              <PlugZap size={16} />
            </div>
            <div className="panel-body">
              <div className="kv">
                <span>
                  <Database
                    size={12}
                    style={{ display: "inline", marginRight: 7 }}
                  />
                  PostgreSQL URL
                </span>
                <span>{capabilities?.database ? "Present" : "Missing"}</span>
              </div>
              <div className="kv">
                <span>
                  <Network
                    size={12}
                    style={{ display: "inline", marginRight: 7 }}
                  />
                  Authenticated mainnet RPC
                </span>
                <span>
                  {capabilities?.mainnetRpc
                    ? "Present"
                    : "Public fallback only"}
                </span>
              </div>
              <div className="kv">
                <span>Independent fallback RPC</span>
                <span>{capabilities?.fallbackRpc ? "Present" : "Missing"}</span>
              </div>
              <div className="kv">
                <span>Testnet RPC + manifest</span>
                <span>
                  {capabilities?.testnetRpc ? "RPC present" : "Missing"}
                </span>
              </div>
              <div className="kv">
                <span>Notification credentials</span>
                <span>{notificationCount} adapters</span>
              </div>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2 style={{ margin: 0 }}>Dedicated automation wallet</h2>
              <div className="metric-label" style={{ marginTop: 4 }}>
                Never converts a browser wallet
              </div>
            </div>
            <KeyRound size={16} color="#f5b840" />
          </div>
          <div className="panel-body form-stack">
            <div className="warning-box">
              Development-only local custody uses AES-256-GCM envelope
              encryption. Production should use KMS/HSM or a reviewed
              smart-account/session-key policy.
            </div>
            <div className="kv">
              <span>Encryption key</span>
              <span>
                {capabilities?.automationEncryption ? "Configured" : "Missing"}
              </span>
            </div>
            <div className="kv">
              <span>Server feature gate</span>
              <span>
                {capabilities?.autopilotGate ? "Enabled" : "Disabled"}
              </span>
            </div>
            <button
              className="button primary"
              disabled={
                !wallet.authenticated ||
                !capabilities?.autopilotGate ||
                !capabilities?.automationEncryption
              }
              onClick={() => setShowCreate(true)}
            >
              <WalletCards size={13} /> Create dedicated wallet
            </button>
            <div className="info-box">
              New automation wallets start disabled and unfunded with strict
              per-execution and daily gas budgets. Strategy permissions must be
              activated separately.
            </div>
          </div>
        </div>
      </div>
      {showCreate && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>Create dedicated automation wallet</h2>
              <button
                className="button icon ghost"
                onClick={() => {
                  setShowCreate(false);
                  setCreated(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {created ? (
                <>
                  <div className="warning-box">
                    This private key is shown once. Back it up offline before
                    funding the address. Closing this dialog erases it from the
                    interface.
                  </div>
                  <div className="field">
                    <label>Automation address</label>
                    <input
                      className="input mono"
                      readOnly
                      value={created.address}
                    />
                  </div>
                  <div className="field">
                    <label>One-time recovery private key</label>
                    <input
                      className="input mono"
                      readOnly
                      value={created.recoveryPrivateKey}
                    />
                  </div>
                  <button className="button" onClick={() => void copyKey()}>
                    <Copy size={13} />
                    {copied ? "Copied" : "Copy once"}
                  </button>
                </>
              ) : (
                <>
                  <div className="field">
                    <label>Wallet label</label>
                    <input
                      className="input"
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                    />
                  </div>
                  <div className="kv">
                    <span>Max gas / execution</span>
                    <span className="mono">0.005 ETH</span>
                  </div>
                  <div className="kv">
                    <span>Max daily gas</span>
                    <span className="mono">0.015 ETH</span>
                  </div>
                  <div className="field">
                    <label>Type CREATE DEDICATED AUTOPILOT WALLET</label>
                    <input
                      className="input mono"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </div>
                  {error && <div className="error-box">{error}</div>}
                </>
              )}
            </div>
            <div className="modal-foot">
              <button
                className="button"
                onClick={() => {
                  setShowCreate(false);
                  setCreated(null);
                }}
              >
                Close
              </button>
              {!created && (
                <button
                  className="button primary"
                  disabled={
                    confirmation !== "CREATE DEDICATED AUTOPILOT WALLET"
                  }
                  onClick={() => void createWallet()}
                >
                  Create encrypted wallet
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
