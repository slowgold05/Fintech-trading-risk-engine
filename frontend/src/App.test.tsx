import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AuthContext } from "./context/authState";
import App from "./App";

const accountDashboard = vi.hoisted(() => vi.fn(() => <h1>Account dashboard</h1>));
vi.mock("./pages/Dashboard", () => ({ Dashboard: accountDashboard }));
vi.mock("./pages/Login", () => ({ Login: () => <h1>Sign-in form</h1> }));
vi.mock("./api/market", () => ({
  fetchMarketOverview: vi.fn().mockRejectedValue(new Error("Unavailable")),
  fetchMarketHeatmap: vi.fn().mockRejectedValue(new Error("Unavailable")),
  fetchMarketTrending: vi.fn().mockRejectedValue(new Error("Unavailable")),
  fetchMarketResearch: vi.fn().mockRejectedValue(new Error("Unavailable")),
}));
vi.mock("./api/history", () => ({
  fetchCachedSeries: vi.fn().mockResolvedValue({
    read_at: "2026-11-06T12:00:00Z",
    collection: "disabled",
    coverage_status: "not_verified",
    expected_session_count: null,
    canonical_history: { row_count: 0, series: [] },
  }),
  fetchDailyHistory: vi.fn().mockRejectedValue(new Error("No series selected")),
}));
vi.mock("./api/auth", () => ({ fetchMe: vi.fn().mockResolvedValue({ role: "trader" }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function open(path: string, authenticated = false, initializing = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{
        token: authenticated ? "test-token" : null,
        isAuthenticated: authenticated, isInitializing: initializing,
        signIn: vi.fn(), signOut: vi.fn(),
      }}>
        <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

it.each(["/", "/dashboard"])("opens %s for visitors without mounting the private account dashboard", (path) => {
  open(path);
  expect(screen.getByRole("heading", { name: "Market dashboard" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  expect(accountDashboard).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Sign-in form" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Log in" }));
  expect(screen.getByRole("heading", { name: "Sign-in form" })).toBeInTheDocument();
});

it("shows the public dashboard while session restoration is pending", () => {
  open("/", false, true);
  expect(screen.getByRole("heading", { name: "Market dashboard" })).toBeInTheDocument();
  expect(accountDashboard).not.toHaveBeenCalled();
});

it.each(["/", "/dashboard"])("opens the private dashboard at %s after sign-in", (path) => {
  open(path, true);
  expect(screen.getByRole("heading", { name: "Account dashboard" })).toBeInTheDocument();
});

it.each(["/portfolio", "/trades", "/risk", "/compliance"])("keeps %s behind sign-in", (path) => {
  open(path);
  expect(screen.getByRole("heading", { name: "Sign-in form" })).toBeInTheDocument();
});
