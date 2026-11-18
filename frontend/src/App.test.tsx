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
  fetchMarketNews: vi.fn().mockRejectedValue(new Error("Unavailable")),
  fetchSymbolQuote: vi.fn().mockRejectedValue(new Error("Unavailable")),
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
vi.mock("./api/auth", () => ({
  fetchMe: vi.fn().mockResolvedValue({ role: "trader" }),
  startDemo: vi.fn(),
}));

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

it("opens the public market at root for visitors", async () => {
  open("/");
  expect(await screen.findByRole("heading", { name: "Market overview" }, { timeout: 7_000 })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  expect(accountDashboard).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Sign-in form" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Log in" }));
  expect(await screen.findByRole("heading", { name: "Sign-in form" })).toBeInTheDocument();
}, 10_000);

it("waits for session restoration before routing the root", () => {
  open("/", false, true);
  expect(screen.getByText("Restoring session…")).toBeInTheDocument();
  expect(accountDashboard).not.toHaveBeenCalled();
});

it.each(["/", "/dashboard"])("opens the private dashboard at %s after sign-in", async (path) => {
  open(path, true);
  expect(await screen.findByRole("heading", { name: "Account dashboard" })).toBeInTheDocument();
});

it.each(["/dashboard", "/portfolio", "/trades", "/risk", "/compliance"])("keeps %s behind sign-in", async (path) => {
  open(path);
  expect(await screen.findByRole("heading", { name: "Sign-in form" })).toBeInTheDocument();
});

it("keeps an anonymous /trades?symbol=AAPL handoff on the sign-in form", async () => {
  open("/trades?symbol=AAPL");
  expect(await screen.findByRole("heading", { name: "Sign-in form" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Trade symbol")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Preview order" })).not.toBeInTheDocument();
});
