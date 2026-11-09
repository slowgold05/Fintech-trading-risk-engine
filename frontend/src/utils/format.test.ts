import { describe, expect, it } from "vitest";

import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
  formatUtcDateTime,
} from "./format";

describe("format utilities", () => {
  it("formats currency with precise and compact modes", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(1234.5, false)).toBe("$1,235");
  });

  it("formats percentages and quantities consistently", () => {
    expect(formatPercent(3.456)).toBe("3.46%");
    expect(formatSignedPercent(3.456)).toBe("+3.46%");
    expect(formatSignedPercent(-3.456)).toBe("-3.46%");
    expect(formatQuantity(12.34567891)).toBe("12.34567891");
  });
});

describe("formatUtcDateTime", () => {
  it("shows the year and UTC time for an explicit Z timestamp", () => {
    const formatted = formatUtcDateTime("2026-11-05T15:00:00Z");

    expect(formatted).not.toBeNull();
    expect(formatted).toContain("2026");
    expect(formatted).toContain("15:00:00");
    expect(formatted).toContain("UTC");
  });

  it("converts an explicit numeric offset to UTC", () => {
    const formatted = formatUtcDateTime("2026-11-05T10:00:00-05:00");

    expect(formatted).not.toBeNull();
    expect(formatted).toContain("2026");
    expect(formatted).toContain("15:00:00");
    expect(formatted).toContain("UTC");
    expect(formatted).not.toContain("10:00:00");
  });

  it("returns null for missing, empty, naive, and non-date values", () => {
    expect(formatUtcDateTime(null)).toBeNull();
    expect(formatUtcDateTime(undefined)).toBeNull();
    expect(formatUtcDateTime("")).toBeNull();
    expect(formatUtcDateTime("2026-11-05T15:00:00")).toBeNull();
    expect(formatUtcDateTime("not-a-date")).toBeNull();
  });

  it("returns null when an ISO-shaped value is not a real UTC timestamp", () => {
    expect(formatUtcDateTime("2026-13-05T15:00:00Z")).toBeNull();
  });
});
