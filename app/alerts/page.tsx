"use client";
import { Bell, Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/src/components/wallet-provider";

type Alert = {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  createdAt: string;
  acknowledgedAt?: string | null;
  deliveredAt?: string | null;
};
export default function AlertsPage() {
  const wallet = useWallet();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!wallet.authenticated) return;
    try {
      const response = await fetch("/api/alerts", { cache: "no-store" });
      const body = (await response.json()) as {
        alerts?: Alert[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error);
      setAlerts(body.alerts ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Alert load failed");
    }
  }, [wallet.authenticated]);
  useEffect(() => {
    void load();
  }, [load]);
  async function acknowledge(id: string) {
    const response = await fetch("/api/alerts", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": wallet.csrf || "",
      },
      body: JSON.stringify({ id }),
    });
    if (response.ok) await load();
  }
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Risk notifications</div>
          <h1>Alerts</h1>
          <p className="page-description">
            Range, fee, execution, gas, liquidity, price, ownership, code, RPC,
            indexer, and circuit-breaker signals from durable workers.
          </p>
        </div>
        <button
          className="button"
          onClick={() => void load()}
          disabled={!wallet.authenticated}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      {error && (
        <div className="error-box" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      <div className="panel">
        {alerts.length ? (
          alerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr auto",
                gap: 12,
                padding: 15,
                borderBottom: "1px solid #1c211e",
                opacity: alert.acknowledgedAt ? 0.58 : 1,
              }}
            >
              <div
                className="empty-icon"
                style={{
                  width: 28,
                  height: 28,
                  margin: 0,
                  color:
                    alert.severity === "CRITICAL"
                      ? "#ff5b67"
                      : alert.severity === "WARNING"
                        ? "#f5b840"
                        : "#5e9eff",
                }}
              >
                <Bell size={13} />
              </div>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong>{alert.title}</strong>
                  <span
                    className={`badge ${alert.severity === "CRITICAL" ? "red" : alert.severity === "WARNING" ? "amber" : "blue"}`}
                  >
                    {alert.severity}
                  </span>
                </div>
                <p
                  style={{
                    color: "#8f9a93",
                    fontSize: 11,
                    margin: "7px 0 0",
                    lineHeight: 1.5,
                  }}
                >
                  {alert.message}
                </p>
                <div className="metric-label" style={{ marginTop: 7 }}>
                  {alert.type.replaceAll("_", " ")} ·{" "}
                  {new Date(alert.createdAt).toLocaleString()} ·{" "}
                  {alert.deliveredAt ? "delivered" : "in-app"}
                </div>
              </div>
              {!alert.acknowledgedAt && (
                <button
                  className="button"
                  onClick={() => void acknowledge(alert.id)}
                >
                  <Check size={12} /> Acknowledge
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="empty">
            <div>
              <div className="empty-icon">
                <Bell size={18} />
              </div>
              <h3>
                {wallet.authenticated
                  ? "No alerts"
                  : "Authenticate to view alerts"}
              </h3>
              <p>Only persisted worker signals appear here.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
