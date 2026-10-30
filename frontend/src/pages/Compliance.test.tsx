import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Compliance } from "./Compliance";

vi.mock("../api/compliance", () => ({
  fetchControlStatuses: () => Promise.resolve({ controls: [
    { id: "SM-PT-02", title: "Price band", owner: "Operations", frequency: "daily",
      status: "no_sample", run_at: "2026-10-28T20:00:00Z", checked: 0, sha256: "hash" },
  ] }),
  fetchRoleChanges: () => Promise.resolve({ changes: [] }),
  fetchRoleRequests: () => Promise.resolve({ requests: [] }),
  fetchAccessReview: () => Promise.resolve({ period: "2026-Q4", accounts: [] }),
  requestRoleChange: vi.fn(),
  approveRoleChange: vi.fn(),
  submitAccessReview: vi.fn(),
  fetchRegisteredRisks: () => Promise.resolve({ method: "test method", risks: [
    { id: "R-04", title: "Erroneous orders", owner: "Operations", inherent_rating: "high",
      residual_rating: "high", controls: ["SM-PT-02"], control_health: "unverified" },
  ] }),
}));
vi.mock("../api/auth", () => ({ fetchMe: () => Promise.resolve({ id: 1, email: "auditor@example.com", role: "auditor" }) }));

describe("Compliance", () => {
  it("labels an empty control sample without counting it as passing", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Compliance /></QueryClientProvider>);

    expect(await screen.findByText("Price band")).toBeInTheDocument();
    expect(screen.getByText("no sample")).toBeInTheDocument();
    expect(screen.getByText("No role changes recorded.")).toBeInTheDocument();
    expect(await screen.findByText("Erroneous orders")).toBeInTheDocument();
    expect(screen.getByText("unverified")).toBeInTheDocument();
    expect(await screen.findByText("No role changes requested.")).toBeInTheDocument();
    expect(screen.getByText("No accounts to review.")).toBeInTheDocument();
    client.clear();
  });
});
