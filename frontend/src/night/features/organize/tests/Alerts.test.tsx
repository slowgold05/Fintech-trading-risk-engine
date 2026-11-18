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
