import { keccak256, stringToHex } from "viem";

function stable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function canonicalRequestHash(value: unknown) {
  return keccak256(stringToHex(JSON.stringify(stable(value))));
}

export const workflowStates = [
  "CREATED",
  "PLANNED",
  "SIMULATED",
  "AWAITING_AUTHORIZATION",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMING",
  "RECONCILIATION_REQUIRED",
  "COMPLETED",
  "REVERTED",
  "FAILED",
  "CANCELLED",
] as const;

const transitions: Record<
  (typeof workflowStates)[number],
  readonly (typeof workflowStates)[number][]
> = {
  CREATED: ["PLANNED", "CANCELLED", "FAILED"],
  PLANNED: ["SIMULATED", "CANCELLED", "FAILED"],
  SIMULATED: ["AWAITING_AUTHORIZATION", "SUBMITTING", "CANCELLED", "FAILED"],
  AWAITING_AUTHORIZATION: ["SUBMITTING", "CANCELLED", "FAILED"],
  SUBMITTING: ["SUBMITTED", "FAILED", "RECONCILIATION_REQUIRED"],
  SUBMITTED: ["CONFIRMING", "REVERTED", "RECONCILIATION_REQUIRED"],
  CONFIRMING: ["COMPLETED", "REVERTED", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["CONFIRMING", "COMPLETED", "REVERTED", "FAILED"],
  COMPLETED: [],
  REVERTED: [],
  FAILED: [],
  CANCELLED: [],
};

export function assertWorkflowTransition(
  from: (typeof workflowStates)[number],
  to: (typeof workflowStates)[number],
) {
  if (!transitions[from].includes(to))
    throw new Error(`Invalid workflow transition: ${from} -> ${to}`);
}
