import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Journal } from "../Journal";
import * as api from "../journalApi";
import { fetchMe } from "../../../../api/auth";
import { fetchOrders } from "../../../../api/orders";
import { renderScreen } from "./renderScreen";

vi.mock("../journalApi");
vi.mock("../../../../api/auth");
vi.mock("../../../../api/orders");
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("edits a paginated note on an older receipt without changing its tags", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 3, email: "fixture@example.com", role: "trader" });
  vi.mocked(fetchOrders).mockResolvedValue({ orders: [] });
  const entry = { id: 11, order_id: 51, note: "Older note", tags: ["cash, USD", "entry"],
    created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z" };
  vi.mocked(api.fetchJournal).mockImplementation(async cursor => cursor
    ? { items: [entry], next_cursor: null }
    : { items: [{ ...entry, id: 12, order_id: 53, note: "Latest note" }], next_cursor: "12" });
  renderScreen(<Journal />);
  fireEvent.click(await screen.findByRole("button", { name: "Load older notes" }));
  expect(await screen.findByText("Older note")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View receipt #51" })).toHaveAttribute("href", "/trades?order=51");
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
  fireEvent.change(screen.getByTestId("journal-note"), { target: { value: "Revised" } });
  fireEvent.click(screen.getByTestId("journal-save"));
  await waitFor(() => expect(api.updateNote).toHaveBeenCalledWith(11, { note: "Revised", tags: entry.tags }));
});

it("matches notes to recent receipts and keeps unloaded journal pages explicit", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 3, email: "fixture@example.com", role: "trader" });
  const order = { id: 23, symbol: "AAPL", side: "buy" as const, order_type: "market" as const,
    quantity: 1, remaining_quantity: 0, limit_price: null, status: "filled" as const, created_at: "2026-11-17T12:00:00Z" };
  vi.mocked(fetchOrders).mockResolvedValue({orders:[order, {...order,id:22}]});
  const note = { id:11, order_id:23, note:"Close review", tags:[], created_at:order.created_at, updated_at:order.created_at };
  vi.mocked(api.fetchJournal).mockImplementation(async cursor => cursor ? {items:[note],next_cursor:null}
    : {items:[{...note, id:10,order_id:15}],next_cursor:"10"});
  renderScreen(<Journal />);
  expect(await screen.findByText("No loaded note on selected receipt")).toBeVisible();
  expect(screen.getByRole("slider", {name:"Inspect order receipt"})).toHaveAttribute("aria-valuetext","Receipt #23, AAPL");
  fireEvent.click(screen.getByRole("button", {name:"Load older notes"}));
  expect(await screen.findByRole("link",{name:"Read selected note"})).toHaveAttribute("href","#journal-entry-11");
});
