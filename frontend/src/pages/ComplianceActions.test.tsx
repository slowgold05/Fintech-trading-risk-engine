import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Compliance } from "./Compliance";

const actions = vi.hoisted(() => ({
  requestRoleChange: vi.fn(() => Promise.resolve()),
  submitAccessReview: vi.fn(() => Promise.resolve()),
}));

vi.mock("../api/auth", () => ({ fetchMe: () => Promise.resolve({ id: 1, email: "admin@example.com", role: "admin" }) }));
vi.mock("../api/compliance", () => ({
  fetchControlStatuses: () => Promise.resolve({ controls: [] }),
  fetchRegisteredRisks: () => Promise.resolve({ method: "test", risks: [] }),
  fetchRoleChanges: () => Promise.resolve({ changes: [] }),
  fetchRoleRequests: () => Promise.resolve({ requests: [] }),
  fetchTradingHalt: () => Promise.resolve({ halted: false, operator_halted: false, emergency_override: false, actor_user_id: null, reason: null, changed_at: null }),
  fetchTradingHaltEvents: () => Promise.resolve({ events: [] }),
  setTradingHalt: vi.fn(),
  fetchAccessReview: () => Promise.resolve({ period: "2026-Q4", accounts: [
    { user_id: 2, email: "trader@example.com", role: "trader", status: "unreviewed" },
  ] }),
  requestRoleChange: actions.requestRoleChange,
  submitAccessReview: actions.submitAccessReview,
  approveRoleChange: vi.fn(),
}));

describe("Compliance actions", () => {
  it("submits an admin request and a separate account review with reasons", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Compliance /></QueryClientProvider>);

    fireEvent.change(await screen.findByLabelText("Account email"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Requested role"), { target: { value: "analyst" } });
    fireEvent.change(screen.getByLabelText("Role change reason"), { target: { value: "Moved to analysis" } });
    fireEvent.click(screen.getByRole("button", { name: "Request change" }));
    await waitFor(() => expect(actions.requestRoleChange).toHaveBeenCalledWith({
      email: "trader@example.com", role: "analyst", reason: "Moved to analysis",
    }, expect.anything()));

    fireEvent.change(await screen.findByLabelText("Review reason for trader@example.com"), { target: { value: "Quarterly access check" } });
    fireEvent.click(screen.getByRole("button", { name: "retain" }));
    await waitFor(() => expect(actions.submitAccessReview).toHaveBeenCalledWith({
      user_id: 2, decision: "retain", reason: "Quarterly access check",
    }, expect.anything()));
    client.clear();
  });
});
