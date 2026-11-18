import { describe, expect, it } from "vitest";
import { priceMove, sourceUrl } from "./marketRead";

describe("stored market presentation", () => {
  it("formats ratios, zeros and missing observations distinctly", () => {
    expect(priceMove("-0.0125")).toBe("-1.25%");
    expect(priceMove("0")).toBe("0.00%");
    expect(priceMove(null)).toBe("Unavailable");
  });
  it("allows only attributable HTTP sources", () => {
    expect(sourceUrl("https://www.sec.gov/Archives/a")).toBe("https://www.sec.gov/Archives/a");
    expect(sourceUrl("javascript:alert(1)")).toBeNull();
    expect(sourceUrl("relative/story")).toBeNull();
  });
});
