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
