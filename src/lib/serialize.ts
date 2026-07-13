export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as T;
}

export function sanitizeError(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/0x[0-9a-fA-F]{64}/g, "[redacted-hex]")
    .replace(
      /(key|secret|token|signature|authorization)=?\s*\S+/gi,
      "$1=[redacted]",
    )
    .slice(0, 500);
}
