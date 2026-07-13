import { formatUnits } from "viem";

export function formatToken(
  raw: bigint | string,
  decimals: number,
  maximumFractionDigits = 6,
) {
  const numeric = Number(formatUnits(BigInt(raw), decimals));
  if (!Number.isFinite(numeric)) return formatUnits(BigInt(raw), decimals);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(numeric);
}

export function compactAddress(address: string, chars = 5) {
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

export function formatFeeTier(fee: number) {
  return `${fee / 10_000}%`;
}
