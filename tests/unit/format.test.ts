import { describe, expect, it } from "vitest";
import { formatToken } from "@/src/domain/format";

describe("decimal formatting", () => {
  it("honors six-decimal tokens", () =>
    expect(formatToken("1234567", 6)).toBe("1.234567"));
  it("honors eighteen-decimal tokens", () =>
    expect(formatToken("1000000000000000000", 18)).toBe("1"));
});
