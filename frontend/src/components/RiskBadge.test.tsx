import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiskBadge } from "./RiskBadge";

describe("RiskBadge", () => {
  it("renders the risk label", () => {
    render(<RiskBadge label="High" />);

    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("uses the shared tone classes for the label", () => {
    render(<RiskBadge label="Medium" />);

    expect(screen.getByText("Medium")).toHaveClass("risk-chip");
    expect(screen.getByText("Medium")).toHaveClass("text-amber-300");
  });
});
