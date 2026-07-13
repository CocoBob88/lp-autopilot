export function reorgRollbackBlock(
  lastFinalizedBlock: bigint,
  overlapBlocks: number,
) {
  if (!Number.isInteger(overlapBlocks) || overlapBlocks < 0)
    throw new RangeError("Overlap must be a non-negative integer");
  const overlap = BigInt(overlapBlocks);
  return lastFinalizedBlock > overlap ? lastFinalizedBlock - overlap : 0n;
}

export function nextAdaptiveRange(fromBlock: bigint, attemptedToBlock: bigint) {
  if (attemptedToBlock < fromBlock) throw new RangeError("Invalid block range");
  const width = attemptedToBlock - fromBlock;
  if (width <= 10n) return null;
  return fromBlock + width / 2n;
}
