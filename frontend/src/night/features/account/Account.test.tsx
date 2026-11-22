import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Account } from "./Account";
import { fetchMe } from "../../../api/auth";

vi.mock("../../../api/auth", () => ({fetchMe:vi.fn()}));
vi.mock("../../../api/history", () => ({fetchCachedSeries:async () => ({canonical_history:{series:[]}})}));
afterEach(() => {cleanup();vi.unstubAllEnvs();});
describe("Account access", () => {
  it.each([[true,"false"],[false,"true"]])("hides demo actions for is_demo=%s and build flag=%s", async (isDemo,enabled) => {
    vi.stubEnv("VITE_DEMO_ENABLED", enabled);
    vi.mocked(fetchMe).mockResolvedValue({id:9,email:"test@example.com",role:"trader",is_demo:isDemo as boolean});
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><MemoryRouter><Account /></MemoryRouter></QueryClientProvider>);
    await screen.findByText(isDemo ? /trader · Demo account/ : /trader · Regular account/);
    expect(screen.getByTestId("density-setting")).toBeEnabled();
    expect(screen.queryByTestId("demo-reset")).not.toBeInTheDocument();
    expect(screen.queryByText("Start walkthrough")).not.toBeInTheDocument();
  });
});
