import { describe, expect, it } from "vitest";

import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
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
