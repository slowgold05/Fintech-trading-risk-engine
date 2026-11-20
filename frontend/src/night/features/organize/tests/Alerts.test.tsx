import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Alerts } from "../Alerts";
import * as api from "../alertsApi";
import { fetchMe } from "../../../../api/auth";
import { renderScreen } from "./renderScreen";

vi.mock("../alertsApi");
vi.mock("../../../../api/auth");
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("distinguishes an unchecked rule from an evaluated rule without a raw close", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 3, email: "fixture@example.com", role: "trader" });
  const rule: api.CloseAlert = { id: 8, symbol: "AAPL", direction: "at_or_above", target: "100",
    last_date: null, last_close: null, source: null, status: "armed", triggered_at: null };
  vi.mocked(api.fetchAlerts).mockResolvedValue([rule]);
  vi.mocked(api.evaluateAlerts).mockResolvedValue([rule]);
  renderScreen(<Alerts />);
  expect(await screen.findByText(/No close recorded/)).toBeInTheDocument();
  expect(api.evaluateAlerts).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("alert-evaluate"));
  expect(await screen.findByText(/No valid raw daily close/)).toBeInTheDocument();
});
it("blocks private reads for a non-trader", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 4, email: "fixture@example.com", role: "auditor" });
  renderScreen(<Alerts />);
  expect(await screen.findByTestId("night-forbidden")).toBeInTheDocument();
  expect(api.fetchAlerts).not.toHaveBeenCalled();
});

it("starts on a measured threshold and never carries its close to an unchecked rule", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 3, email: "fixture@example.com", role: "trader" });
  const rule: api.CloseAlert = { id: 1, symbol: "MSFT", direction: "at_or_below", target: "100",
    last_date: null, last_close: null, source: null, status: "armed", triggered_at: null };
  vi.mocked(api.fetchAlerts).mockResolvedValue([rule, { ...rule, id: 2, symbol: "AAPL", last_close: "98.5",
    last_date: "2026-11-16", status: "triggered" }]);
  renderScreen(<Alerts />);
  const selector = await screen.findByRole("combobox", { name: "Inspect threshold" });
  expect(selector).toHaveValue("2");
  expect(screen.getByText("1.5% below")).toBeVisible();
  fireEvent.change(selector, {target:{value:"1"}});
  expect(screen.queryByText("1.5% below")).toBeNull();
  expect(screen.getByRole("img", {name:/raw close unavailable/})).toBeVisible();
});
