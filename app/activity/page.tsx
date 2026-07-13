"use client";
import { Activity, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { compactAddress } from "@/src/domain/format";
import { useWallet } from "@/src/components/wallet-provider";

type Workflow = {
  id: string;
  type: string;
  status: string;
  updatedAt: string;
  submissions: Array<{
    id: string;
    transactionHash: string;
    status: string;
    submittedAt: string;
  }>;
};
export default function ActivityPage() {
  const wallet = useWallet();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  useEffect(() => {
    if (wallet.authenticated)
      void fetch("/api/workflows", { cache: "no-store" })
        .then((response) => response.json())
        .then((body: { workflows?: Workflow[] }) =>
          setWorkflows(body.workflows ?? []),
        )
        .catch(() => undefined);
  }, [wallet.authenticated]);
  const rows = workflows.flatMap((workflow) =>
    workflow.submissions.map((submission) => ({
      ...submission,
      type: workflow.type,
      workflowStatus: workflow.status,
    })),
  );
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Confirmed chain trail</div>
          <h1>Activity</h1>
          <p className="page-description">
            Submitted transactions only. Plans and simulations without a
            broadcast remain in Workflows.
          </p>
        </div>
      </div>
      <div className="panel">
        {rows.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Transaction</th>
                  <th>Chain state</th>
                  <th>Workflow</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.submittedAt).toLocaleString()}</td>
                    <td>{row.type.replaceAll("_", " ")}</td>
                    <td>
                      <a
                        className="mono"
                        href={`https://robinhoodchain.blockscout.com/tx/${row.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {compactAddress(row.transactionHash, 9)}{" "}
                        <ExternalLink size={10} style={{ display: "inline" }} />
                      </a>
                    </td>
                    <td>
                      <span className="badge blue">{row.status}</span>
                    </td>
                    <td>
                      <span className="badge">{row.workflowStatus}</span>
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
                <Activity size={18} />
              </div>
              <h3>No submitted transactions</h3>
              <p>
                The activity ledger never includes fabricated demo transfers.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
