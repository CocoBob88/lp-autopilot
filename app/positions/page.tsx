"use client";
import { CircleAlert, Layers3, RefreshCw } from "lucide-react";
import { PositionTable } from "@/src/components/position-table";
import { usePositions } from "@/src/components/use-positions";

export default function PositionsPage() {
  const data = usePositions();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">On-chain inventory</div>
          <h1>Positions</h1>
          <p className="page-description">
            Every NFT candidate is ownership-checked and resolved through the
            reviewed V3 Factory before it appears here.
          </p>
        </div>
        <button
          className="button"
          disabled={!data.address || data.loading}
          onClick={() => void data.refresh()}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>Validated Uniswap V3 NFTs</h2>
            <div className="metric-label" style={{ marginTop: 4 }}>
              {data.address ? data.address : "No wallet selected"}
            </div>
          </div>
          {data.address && (
            <span className="badge blue">{data.mode.replace("_", " ")}</span>
          )}
        </div>
        {data.loading ? (
          <div className="panel-body">
            <div className="skeleton" style={{ height: 240 }} />
          </div>
        ) : data.error ? (
          <div className="empty">
            <div>
              <div className="empty-icon">
                <CircleAlert size={18} />
              </div>
              <h3>Discovery unavailable</h3>
              <p>{data.error}</p>
            </div>
          </div>
        ) : data.positions.length ? (
          <PositionTable positions={data.positions} />
        ) : (
          <div className="empty">
            <div>
              <div className="empty-icon">
                <Layers3 size={18} />
              </div>
              <h3>
                {data.address
                  ? "No current LP ownership found"
                  : "Inspect or connect a wallet"}
              </h3>
              <p>
                {data.address
                  ? "No position is displayed until current owner, position fields, pool identity, and token metadata all validate."
                  : "Use watch-only for public inspection or assisted mode for transaction planning."}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
