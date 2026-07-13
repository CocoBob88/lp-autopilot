"use client";
import {
  CircleAlert,
  ExternalLink,
  ListChecks,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { compactAddress } from "@/src/domain/format";
import { useWallet } from "@/src/components/wallet-provider";
import type { WorkflowPlan } from "@/src/components/types";

type Workflow = {
  id: string;
  type: string;
  workflowKey: string;
  requestHash: string;
  status: string;
  planVersion: number;
  quoteBlock?: string;
  quoteTimestamp?: string;
  plan?: WorkflowPlan;
  actualDeltas?: { collected0?: string; collected1?: string };
  updatedAt: string;
  errorCode?: string;
  errorMessage?: string;
  steps: Array<{
    id: string;
    ordinal: number;
    kind: string;
    status: string;
    target?: string;
    method?: string;
    simulation?: { ok?: boolean; error?: string };
  }>;
  submissions: Array<{
    id: string;
    transactionHash: string;
    status: string;
    nonce: string;
    submittedAt: string;
    receipt?: unknown;
  }>;
};

function statusClass(status: string) {
  return status === "COMPLETED" || status === "SIMULATED"
    ? "green"
    : status === "REVERTED" || status === "FAILED"
      ? "red"
      : status === "RECONCILIATION_REQUIRED"
        ? "amber"
        : "blue";
}

export default function WorkflowsPage() {
  const wallet = useWallet();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!wallet.authenticated) return;
    try {
      const response = await fetch("/api/workflows", { cache: "no-store" });
      const body = (await response.json()) as {
        workflows?: Workflow[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error);
      setWorkflows(body.workflows ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow load failed");
    }
  }, [wallet.authenticated]);
  useEffect(() => {
    void load();
  }, [load]);
  async function reconcile(workflow: Workflow) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workflows/reconcile", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": wallet.csrf || "",
        },
        body: JSON.stringify({ workflowId: workflow.id }),
      });
      const body = (await response.json()) as {
        workflow?: Workflow;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error);
      setSelected(body.workflow ?? null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Reconciliation failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function continueWorkflow(workflow: Workflow) {
    const next = workflow.plan?.nextPhase;
    if (!next || !workflow.actualDeltas) return;
    setBusy(true);
    setError(null);
    try {
      const action = String(next.action);
      const body: Record<string, unknown> = {
        action,
        chainId: workflow.plan!.chainId,
        owner: workflow.plan!.owner,
        tokenId: workflow.plan!.tokenId,
        workflowKey: `${workflow.workflowKey}:finalize:${Date.now()}`,
        slippageBps: workflow.plan!.slippageBps,
        deadlineSeconds: 600,
        unwrapWeth: false,
        amount0Raw: workflow.actualDeltas.collected0 || "0",
        amount1Raw: workflow.actualDeltas.collected1 || "0",
      };
      if (action === "rebalance_finalize")
        Object.assign(body, {
          newTickLower: next.newTickLower,
          newTickUpper: next.newTickUpper,
          allowBalancingSwap: false,
        });
      const response = await fetch("/api/workflows/plan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": wallet.csrf || "",
        },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        error?: string;
        workflow?: Workflow;
      };
      if (!response.ok) throw new Error(result.error);
      await load();
      if (result.workflow) setSelected(result.workflow);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Continuation plan failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Durable execution ledger</div>
          <h1>Workflows</h1>
          <p className="page-description">
            Every intent, simulation, authorization boundary, transaction hash,
            confirmation, and reconciled delta has an explicit state.
          </p>
        </div>
        <button
          className="button"
          onClick={() => void load()}
          disabled={!wallet.authenticated || busy}
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
        {!wallet.authenticated ? (
          <div className="empty">
            <div>
              <div className="empty-icon">
                <ListChecks size={18} />
              </div>
              <h3>Authenticate to view workflow records</h3>
              <p>
                Watch-only access never exposes another user&apos;s execution
                history.
              </p>
            </div>
          </div>
        ) : workflows.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>State</th>
                  <th>Plan</th>
                  <th>Submissions</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workflows.map((workflow) => (
                  <tr key={workflow.id}>
                    <td>
                      <strong>{workflow.type.replaceAll("_", " ")}</strong>
                      <div
                        className="mono"
                        style={{ color: "#657069", fontSize: 9, marginTop: 4 }}
                      >
                        {workflow.workflowKey}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${statusClass(workflow.status)}`}>
                        {workflow.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="mono">
                      v{workflow.planVersion} ·{" "}
                      {workflow.quoteBlock
                        ? `#${Number(workflow.quoteBlock).toLocaleString()}`
                        : "no quote"}
                    </td>
                    <td>
                      {workflow.submissions.length
                        ? workflow.submissions.map((submission) => (
                            <a
                              key={submission.id}
                              href={`https://robinhoodchain.blockscout.com/tx/${submission.transactionHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="badge blue"
                              style={{ marginRight: 4 }}
                            >
                              {compactAddress(submission.transactionHash, 5)}{" "}
                              <ExternalLink size={9} />
                            </a>
                          ))
                        : "—"}
                    </td>
                    <td>{new Date(workflow.updatedAt).toLocaleString()}</td>
                    <td>
                      <button
                        className="button"
                        onClick={() => setSelected(workflow)}
                      >
                        Inspect
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
                <ListChecks size={18} />
              </div>
              <h3>No workflow records</h3>
              <p>
                Preview a position action to create the first durable,
                idempotent workflow.
              </p>
            </div>
          </div>
        )}
      </div>
      {selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-head">
              <div>
                <h2 style={{ margin: 0 }}>
                  {selected.type.replaceAll("_", " ")}
                </h2>
                <div className="metric-label" style={{ marginTop: 4 }}>
                  {selected.workflowKey}
                </div>
              </div>
              <button
                className="button icon ghost"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="field-row">
                <div className="kv">
                  <span>Status</span>
                  <span className={`badge ${statusClass(selected.status)}`}>
                    {selected.status}
                  </span>
                </div>
                <div className="kv">
                  <span>Request hash</span>
                  <span className="mono">
                    {compactAddress(selected.requestHash, 9)}
                  </span>
                </div>
              </div>
              <div className="plan-steps">
                {selected.steps.map((step) => (
                  <div className="plan-step" key={step.id}>
                    <span className="step-index">{step.ordinal + 1}</span>
                    <div>
                      <strong>{step.kind}</strong>
                      <div
                        className="mono"
                        style={{ color: "#667169", fontSize: 9, marginTop: 4 }}
                      >
                        {step.target ? compactAddress(step.target, 8) : "—"} ·{" "}
                        {step.method}
                      </div>
                      {step.simulation?.error && (
                        <div
                          style={{
                            color: "#ff8790",
                            fontSize: 9,
                            marginTop: 4,
                          }}
                        >
                          {step.simulation.error}
                        </div>
                      )}
                    </div>
                    <span className={`badge ${statusClass(step.status)}`}>
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
              {selected.submissions.map((submission) => (
                <div
                  className="panel-body"
                  style={{ border: "1px solid #252c28", borderRadius: 6 }}
                  key={submission.id}
                >
                  <div className="kv">
                    <span>Transaction</span>
                    <a
                      href={`https://robinhoodchain.blockscout.com/tx/${submission.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                    >
                      {submission.transactionHash}
                    </a>
                  </div>
                  <div className="kv">
                    <span>Nonce / state</span>
                    <span className="mono">
                      {submission.nonce} · {submission.status}
                    </span>
                  </div>
                </div>
              ))}
              {selected.errorMessage && (
                <div className="error-box">
                  <CircleAlert size={12} /> {selected.errorCode}:{" "}
                  {selected.errorMessage}
                </div>
              )}
              {selected.plan?.nextPhase && (
                <div className="warning-box">
                  Confirmed-state continuation:{" "}
                  {String(selected.plan.nextPhase.reason)}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="button" onClick={() => setSelected(null)}>
                Close
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                {selected.submissions.length > 0 && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void reconcile(selected)}
                  >
                    <RotateCcw size={13} /> Reconcile
                  </button>
                )}
                {selected.status === "COMPLETED" &&
                  selected.plan?.nextPhase && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void continueWorkflow(selected)}
                    >
                      Build fresh continuation
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
