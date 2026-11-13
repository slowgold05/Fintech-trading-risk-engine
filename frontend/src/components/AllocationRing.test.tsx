import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AllocationRing } from "./AllocationRing";

afterEach(() => { cleanup(); });

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const sectors = [
  { sector: "Technology", value: "300.00", weight_pct: "18.7500" },
  { sector: "Financials", value: "200.00", weight_pct: "12.5000" },
] as const;

function segment(name: string) {
  return document.querySelector(`[data-segment="${name}"]`);
}

describe("AllocationRing", () => {
  it("draws one segment per sector plus cash from the weight percents", () => {
    render(
      <AllocationRing
        cashBalance="1000.00"
        cashWeightPct="62.5000"
        sectors={sectors}
        totalAccountValue="1600.00"
      />,
    );

    expect(screen.getByRole("img", { name: /sector allocation ring/i }).querySelectorAll("[data-segment]")).toHaveLength(3);
    expect(screen.getByText("$1,600")).toBeInTheDocument();

    const cashLength = (62.5 / 100) * CIRCUMFERENCE;
    const technologyLength = (18.75 / 100) * CIRCUMFERENCE;
    const financialsLength = (12.5 / 100) * CIRCUMFERENCE;

    expect(segment("Cash")?.getAttribute("stroke-dasharray")).toBe(`${cashLength} ${CIRCUMFERENCE}`);
    expect(Number(segment("Cash")?.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 6);
    expect(segment("Cash")).toHaveClass("stroke-emerald-400");

    expect(segment("Technology")?.getAttribute("stroke-dasharray")).toBe(`${technologyLength} ${CIRCUMFERENCE}`);
    expect(Number(segment("Technology")?.getAttribute("stroke-dashoffset"))).toBeCloseTo(-cashLength, 6);

    expect(segment("Financials")?.getAttribute("stroke-dasharray")).toBe(`${financialsLength} ${CIRCUMFERENCE}`);
    expect(Number(segment("Financials")?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      -(cashLength + technologyLength),
      6,
    );
  });

  it("shows sector names and weight percentages in the legend", () => {
    render(
      <AllocationRing
        cashBalance="1000.00"
        cashWeightPct="62.5000"
        sectors={sectors}
        totalAccountValue="1600.00"
      />,
    );

    const legend = screen.getByRole("list", { name: "Allocation legend" });
    expect(legend).toHaveTextContent("Cash");
    expect(legend).toHaveTextContent("$1,000");
    expect(legend).toHaveTextContent("62.50%");
    expect(legend).toHaveTextContent("Technology");
    expect(legend).toHaveTextContent("18.75%");
    expect(legend).toHaveTextContent("Financials");
    expect(legend).toHaveTextContent("12.50%");
  });

  it("renders a neutral ring when there are no sectors and no weight", () => {
    render(
      <AllocationRing
        cashBalance="0.00"
        cashWeightPct={null}
        sectors={[]}
        totalAccountValue={null}
      />,
    );

    const ring = screen.getByRole("img", { name: /no allocation data/i });
    expect(ring.querySelectorAll("circle")).toHaveLength(1);
    expect(ring.querySelector("[data-segment]")).not.toBeInTheDocument();
    expect(ring.querySelector("circle")).toHaveClass("stroke-slate-600");
    expect(screen.getByText("No allocation data")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Allocation legend" })).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("renders a neutral ring when every weight is zero", () => {
    render(
      <AllocationRing
        cashBalance="0.00"
        cashWeightPct="0.0000"
        sectors={[{ sector: "Technology", weight_pct: "0.0000" }]}
        totalAccountValue="0.00"
      />,
    );

    expect(screen.getByRole("img", { name: /no allocation data/i }).querySelectorAll("[data-segment]")).toHaveLength(0);
    expect(screen.getByText("No allocation data")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.queryByText("Technology")).not.toBeInTheDocument();
  });

  it("repeats palette colors after the fixed set is exhausted", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      sector: `Sector ${index + 1}`,
      weight_pct: "5.0000",
    }));

    render(
      <AllocationRing
        cashBalance="0.00"
        cashWeightPct={null}
        sectors={many}
        totalAccountValue={null}
      />,
    );

    expect(document.querySelectorAll("[data-segment]")).toHaveLength(9);
    expect(segment("Sector 1")).toHaveClass("stroke-emerald-400");
    expect(segment("Sector 9")).toHaveClass("stroke-emerald-400");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
