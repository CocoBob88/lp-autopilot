"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatFeeTier, formatToken } from "@/src/domain/format";
import type { PositionData } from "./types";

function StateBadge({ state }: { state: PositionData["state"] }) {
  return (
    <span
      className={`badge ${state === "IN_RANGE" ? "green" : state === "NEAR_BOUNDARY" ? "amber" : "red"}`}
    >
      <span
        className={`status-dot ${state === "IN_RANGE" ? "good" : state === "NEAR_BOUNDARY" ? "warn" : ""}`}
      />
      {state.replaceAll("_", " ")}
    </span>
  );
}

export function PositionTable({ positions }: { positions: PositionData[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Status</th>
            <th>Current amounts</th>
            <th>Fees available</th>
            <th>Range</th>
            <th>Liquidity</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.tokenId}>
              <td>
                <div className="pair">
                  <div className="token-stack">
                    <span className="token-dot">
                      {position.token0.symbol.slice(0, 2)}
                    </span>
                    <span className="token-dot">
                      {position.token1.symbol.slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    {position.token0.symbol} / {position.token1.symbol}
                    <div
                      className="mono"
                      style={{ color: "#626d66", fontSize: 9, marginTop: 2 }}
                    >
                      NFT #{position.tokenId} ·{" "}
                      {formatFeeTier(position.pool.fee)}
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <StateBadge state={position.state} />
              </td>
              <td className="mono">
                <div>
                  {formatToken(position.amount0, position.token0.decimals)}{" "}
                  {position.token0.symbol}
                </div>
                <div style={{ color: "#7f8a83", marginTop: 3 }}>
                  {formatToken(position.amount1, position.token1.decimals)}{" "}
                  {position.token1.symbol}
                </div>
              </td>
              <td className="mono">
                <div>
                  {formatToken(
                    position.feePreview.amount0,
                    position.token0.decimals,
                  )}{" "}
                  {position.token0.symbol}
                </div>
                <div style={{ color: "#7f8a83", marginTop: 3 }}>
                  {formatToken(
                    position.feePreview.amount1,
                    position.token1.decimals,
                  )}{" "}
                  {position.token1.symbol}
                </div>
              </td>
              <td className="mono">
                <div>{position.lowerPriceToken1PerToken0.toPrecision(6)}</div>
                <div style={{ color: "#7f8a83", marginTop: 3 }}>
                  {position.upperPriceToken1PerToken0.toPrecision(6)}
                </div>
              </td>
              <td className="mono">
                {BigInt(position.liquidity).toLocaleString()}
              </td>
              <td>
                <Link
                  aria-label={`Open position ${position.tokenId}`}
                  className="button icon ghost"
                  href={`/positions/${position.tokenId}?owner=${position.owner}&chainId=${position.chainId}`}
                >
                  <ArrowUpRight size={14} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
