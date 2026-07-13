"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PositionData } from "./types";

type Swap = { blockNumber: string; tick: number; timestamp?: string | null };

export function RangeChart({ position }: { position: PositionData }) {
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [evidence, setEvidence] = useState("Loading indexed evidence…");
  const [orientation, setOrientation] = useState<"normal" | "inverse">(
    "normal",
  );
  useEffect(() => {
    void fetch(
      `/api/positions/${position.tokenId}/history?chainId=${position.chainId}&manager=${position.managerAddress}`,
      { cache: "no-store" },
    )
      .then((response) => response.json())
      .then((body: { swaps?: Swap[]; evidence?: string }) => {
        setSwaps(body.swaps ?? []);
        setEvidence(body.evidence ?? "No indexed evidence");
      })
      .catch(() => setEvidence("Indexer database is not configured"));
  }, [position]);
  const data = useMemo(
    () =>
      swaps.map((swap) => {
        const price =
          Math.pow(1.0001, swap.tick) *
          Math.pow(10, position.token0.decimals - position.token1.decimals);
        return {
          block: Number(swap.blockNumber),
          price: orientation === "normal" ? price : 1 / price,
        };
      }),
    [swaps, position, orientation],
  );
  const lower =
    orientation === "normal"
      ? position.lowerPriceToken1PerToken0
      : 1 / position.upperPriceToken1PerToken0;
  const upper =
    orientation === "normal"
      ? position.upperPriceToken1PerToken0
      : 1 / position.lowerPriceToken1PerToken0;
  const current =
    orientation === "normal"
      ? position.priceToken1PerToken0
      : 1 / position.priceToken1PerToken0;
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 style={{ margin: 0 }}>Price range</h2>
          <div className="metric-label" style={{ marginTop: 4 }}>
            {evidence}
          </div>
        </div>
        <button
          className="button"
          onClick={() =>
            setOrientation((value) =>
              value === "normal" ? "inverse" : "normal",
            )
          }
        >
          {orientation === "normal"
            ? `${position.token1.symbol} / ${position.token0.symbol}`
            : `${position.token0.symbol} / ${position.token1.symbol}`}
        </button>
      </div>
      {data.length > 1 ? (
        <div style={{ width: "100%", height: 330, padding: "16px 10px 4px 0" }}>
          <ResponsiveContainer>
            <LineChart
              data={data}
              margin={{ top: 10, right: 18, bottom: 12, left: 14 }}
            >
              <CartesianGrid stroke="#202621" vertical={false} />
              <XAxis
                dataKey="block"
                tick={{ fill: "#667169", fontSize: 9 }}
                tickFormatter={(value) => Number(value).toLocaleString()}
                axisLine={{ stroke: "#2b332e" }}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "#667169", fontSize: 9 }}
                tickFormatter={(value) => Number(value).toPrecision(4)}
                axisLine={false}
                width={72}
              />
              <Tooltip
                contentStyle={{
                  background: "#0b0e0c",
                  border: "1px solid #2b332e",
                  borderRadius: 6,
                  fontSize: 10,
                }}
                labelFormatter={(value) =>
                  `Block ${Number(value).toLocaleString()}`
                }
                formatter={(value) => [Number(value).toPrecision(8), "Price"]}
              />
              <ReferenceArea
                y1={lower}
                y2={upper}
                fill="#00d632"
                fillOpacity={0.07}
              />
              <ReferenceLine y={lower} stroke="#667169" strokeDasharray="3 3" />
              <ReferenceLine y={upper} stroke="#667169" strokeDasharray="3 3" />
              <ReferenceLine y={current} stroke="#00d632" />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#eaf2ed"
                strokeWidth={1.6}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="range-wrap">
          <div className="range-track">
            <div className="range-line" />
            <div className="range-band" />
            <div className="range-bound lower" />
            <div className="range-bound upper" />
            <div
              className="range-current"
              style={{
                left: `${Math.max(2, Math.min(98, 18 + ((position.tick - position.tickLower) / Math.max(1, position.tickUpper - position.tickLower)) * 64))}%`,
              }}
            />
          </div>
          <div className="range-labels">
            <div>
              Lower<strong>{lower.toPrecision(8)}</strong>
            </div>
            <div style={{ textAlign: "center" }}>
              Current
              <strong style={{ color: "#00d632" }}>
                {current.toPrecision(8)}
              </strong>
            </div>
            <div style={{ textAlign: "right" }}>
              Upper<strong>{upper.toPrecision(8)}</strong>
            </div>
          </div>
          <div className="info-box" style={{ marginTop: 18 }}>
            Historical swaps appear after the durable indexer has backfilled
            this pool. The boundaries and marker above are current on-chain
            values, not synthetic history.
          </div>
        </div>
      )}
    </div>
  );
}
