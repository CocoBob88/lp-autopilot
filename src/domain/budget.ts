export function evaluateExecutionBudget(input: {
  executionsToday: number;
  maxExecutionsPerDay: number;
  gasSpentWei: bigint;
  estimatedGasWei: bigint;
  maxGasPerExecutionWei: bigint;
  maxDailyGasWei: bigint;
}) {
  if (input.executionsToday >= input.maxExecutionsPerDay)
    return { allowed: false, reason: "DAILY_EXECUTION_COUNT" as const };
  if (input.estimatedGasWei > input.maxGasPerExecutionWei)
    return { allowed: false, reason: "PER_EXECUTION_GAS" as const };
  if (input.gasSpentWei + input.estimatedGasWei > input.maxDailyGasWei)
    return { allowed: false, reason: "DAILY_GAS" as const };
  return { allowed: true, reason: null } as const;
}
