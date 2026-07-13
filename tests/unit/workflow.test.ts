import { describe, expect, it } from "vitest";
import {
  assertWorkflowTransition,
  canonicalRequestHash,
} from "@/src/domain/workflow";
import { evaluateExecutionBudget } from "@/src/domain/budget";
import { nextAdaptiveRange, reorgRollbackBlock } from "@/src/domain/indexer";

describe("durable workflows", () => {
  it("hashes key order canonically", () =>
    expect(canonicalRequestHash({ b: 2, a: 1n })).toBe(
      canonicalRequestHash({ a: 1n, b: 2 }),
    ));
  it("rejects terminal-state replay", () =>
    expect(() =>
      assertWorkflowTransition("COMPLETED", "SUBMITTING"),
    ).toThrow());
  it("allows submitted confirmation", () =>
    expect(() =>
      assertWorkflowTransition("SUBMITTED", "CONFIRMING"),
    ).not.toThrow());
  it("applies all gas and count budgets", () => {
    expect(
      evaluateExecutionBudget({
        executionsToday: 4,
        maxExecutionsPerDay: 4,
        gasSpentWei: 0n,
        estimatedGasWei: 1n,
        maxGasPerExecutionWei: 2n,
        maxDailyGasWei: 10n,
      }).reason,
    ).toBe("DAILY_EXECUTION_COUNT");
    expect(
      evaluateExecutionBudget({
        executionsToday: 0,
        maxExecutionsPerDay: 4,
        gasSpentWei: 0n,
        estimatedGasWei: 3n,
        maxGasPerExecutionWei: 2n,
        maxDailyGasWei: 10n,
      }).reason,
    ).toBe("PER_EXECUTION_GAS");
    expect(
      evaluateExecutionBudget({
        executionsToday: 0,
        maxExecutionsPerDay: 4,
        gasSpentWei: 9n,
        estimatedGasWei: 2n,
        maxGasPerExecutionWei: 2n,
        maxDailyGasWei: 10n,
      }).reason,
    ).toBe("DAILY_GAS");
  });
  it("rolls reorg cursors back with overlap", () => {
    expect(reorgRollbackBlock(100n, 20)).toBe(80n);
    expect(reorgRollbackBlock(10n, 20)).toBe(0n);
  });
  it("shrinks rejected provider ranges adaptively", () => {
    expect(nextAdaptiveRange(100n, 200n)).toBe(150n);
    expect(nextAdaptiveRange(100n, 110n)).toBeNull();
  });
});
