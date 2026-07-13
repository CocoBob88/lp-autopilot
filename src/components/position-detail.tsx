"use client";
import Link from "next/link";
import { ArrowLeft, CircleAlert, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatFeeTier, formatToken } from "@/src/domain/format";
import type { PositionData } from "./types";

export function PositionDetail({
  tokenId,
  owner,
  chainId,
}: {
  tokenId: string;
  owner?: string;
  chainId: number;
}) {
  const [position, setPosition] = useState<PositionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!owner) {
      setError("The owner address is required to validate this position.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/positions/${tokenId}?owner=${owner}&chainId=${chainId}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as PositionData & { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Position validation failed");
      setPosition(body);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Position validation failed",
      );
    } finally {
      setLoading(false);
    }
  }, [owner, tokenId, chainId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (loading)
    return (
      <>
        <div className="skeleton" style={{ height: 70, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 420 }} />
      </>
    );
  if (!position || error)
    return (
      <div className="panel empty">
        <div>
          <div className="empty-icon">
            <CircleAlert size={18} />
          </div>
          <h2>Position validation stopped</h2>
          <p>{error}</p>
          <Link href="/positions" className="button">
            <ArrowLeft size={13} /> Back to positions
          </Link>
        </div>
      </div>
    );
  return (
    <>
      <div className="page-head">
        <div>
          <Link
            href="/positions"
            style={{
              color: "#7d8881",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              marginBottom: 12,
            }}
          >
            <ArrowLeft size={12} /> All positions
          </Link>
          <div className="eyebrow">Position #{position.tokenId}</div>
          <h1>
            {position.token0.symbol} / {position.token1.symbol}{" "}
            <span style={{ color: "#68736c", fontWeight: 450 }}>
              {formatFeeTier(position.pool.fee)}
            </span>
          </h1>
          <p className="page-description">
            Owner, pool immutables, tokens, range, amounts, and fee preview
            validated at block{" "}
            <span className="mono">
              {Number(position.blockNumber).toLocaleString()}
            </span>
            .
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button" onClick={() => void refresh()}>
            <RefreshCw size={13} /> Refresh
          </button>
          <a
            className="button"
            href={`https://robinhoodchain.blockscout.com/token/${position.managerAddress}/instance/${position.tokenId}`}
            target="_blank"
            rel="noreferrer"
          >
            Explorer <ExternalLink size={12} />
          </a>
        </div>
      </div>
      <div className="stats-grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="stat-label">Range status</div>
          <div style={{ marginTop: 14 }}>
            <span
              className={`badge ${position.state === "IN_RANGE" ? "green" : position.state === "NEAR_BOUNDARY" ? "amber" : "red"}`}
            >
              {position.state.replaceAll("_", " ")}
            </span>
          </div>
          <div className="stat-meta">Tick {position.tick.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{position.token0.symbol} amount</div>
          <div className="stat-value">
            {formatToken(position.amount0, position.token0.decimals)}
          </div>
          <div className="stat-meta mono">raw {position.amount0}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{position.token1.symbol} amount</div>
          <div className="stat-value">
            {formatToken(position.amount1, position.token1.decimals)}
          </div>
          <div className="stat-meta mono">raw {position.amount1}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Raw liquidity</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {BigInt(position.liquidity).toLocaleString()}
          </div>
          <div className="stat-meta">
            Pool {BigInt(position.pool.liquidity).toLocaleString()}
          </div>
        </div>
      </div>
      <div className="detail-grid">
        <div style={{ display: "grid", gap: 14 }}>
          <div className="panel">
            <div className="panel-header">
              <h2 style={{ margin: 0 }}>Position accounting</h2>
              <span className="badge blue">Raw + formatted</span>
            </div>
            <div className="panel-body">
              <div className="field-row">
                <div>
                  <div className="kv">
                    <span>Uncollected {position.token0.symbol}</span>
                    <span className="mono">
                      {formatToken(
                        position.feePreview.amount0,
                        position.token0.decimals,
                      )}
                    </span>
                  </div>
                  <div className="kv">
                    <span>Uncollected {position.token1.symbol}</span>
                    <span className="mono">
                      {formatToken(
                        position.feePreview.amount1,
                        position.token1.decimals,
                      )}
                    </span>
                  </div>
                  <div className="kv">
                    <span>Static collect preview</span>
                    <span>
                      {position.feePreview.available
                        ? "Succeeded"
                        : "Owed-counter fallback"}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="kv">
                    <span>Lower / upper tick</span>
                    <span className="mono">
                      {position.tickLower} / {position.tickUpper}
                    </span>
                  </div>
                  <div className="kv">
                    <span>Pool unlocked</span>
                    <span>{position.pool.unlocked ? "Yes" : "No"}</span>
                  </div>
                  <div className="kv">
                    <span>Observation capacity</span>
                    <span className="mono">
                      {position.pool.observationCardinality} →{" "}
                      {position.pool.observationCardinalityNext}
                    </span>
                  </div>
                </div>
              </div>
              <div className="warning-box" style={{ marginTop: 14 }}>
                Fiat value, realized performance, impermanent loss, fee APR,
                volume, and position age appear only when the indexer has
                sufficient canonical history and a reviewed price source. No APY
                is projected from incomplete evidence.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
