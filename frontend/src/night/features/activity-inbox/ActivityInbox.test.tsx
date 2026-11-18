import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { fetchMe } from "../../../api/auth";
import { useAuth } from "../../../context/useAuth";
import { ActivityInbox } from "./ActivityInbox";
import { markInboxRead, readInbox, type InboxEvent, type InboxPage } from "./inbox";

vi.mock("../../../api/auth", () => ({fetchMe:vi.fn()}));
vi.mock("../../../context/useAuth", () => ({useAuth:vi.fn()}));
vi.mock("./inbox", () => ({readInbox:vi.fn(),markInboxRead:vi.fn(),pageSize:5}));
const registry = vi.hoisted(() => ({ features: [] as { id: string; path: string }[] }));
vi.mock("../../registry", () => registry);
afterEach(() => { cleanup(); vi.resetAllMocks(); registry.features = []; });

const event: InboxEvent = {id:"fill:41",kind:"fill",occurred_at:"2026-11-18T12:00:00Z",read_at:null,
  symbol:"AAPL", order_id:20, alert_id:null,side:"buy",quantity:"1.000000",price:"32.555555",
  target:null,session_date:"2026-11-17",source:null};
const page: InboxPage = {items:[event],next_cursor:"older",unread_count:9,read_at:"2026-11-18T12:30:00Z",
  history_days:30,sources:{fills:true,demo:true,alerts:false}};
function mount(role: "trader" | "auditor" = "trader") {
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  vi.mocked(useAuth).mockReturnValue({isAuthenticated:true,isInitializing:false,token:"test",signIn:vi.fn(),signOut:vi.fn()});
  vi.mocked(fetchMe).mockResolvedValue({id:7,role,email:"trader@example.test",is_demo:true});
  render(<QueryClientProvider client={client}><MemoryRouter><ActivityInbox /></MemoryRouter></QueryClientProvider>);
  return client;
}
it("pages an owner's book and drops the cursor and old entries on identity change", async () => {
  const user=userEvent.setup();
  vi.mocked(readInbox).mockResolvedValueOnce(page).mockResolvedValueOnce({...page,items:[{...event,symbol:"MSFT"}],next_cursor:null})
    .mockResolvedValueOnce({...page,items:[],next_cursor:null,unread_count:0});
  const client=mount();
  expect(await screen.findByRole("link",{name:"Open receipt #20"})).toHaveAttribute("href","/trades?order=20");
  expect(screen.getByText("Source unavailable")).toBeVisible();
  expect(screen.getByTestId("inbox-unread-count")).toHaveTextContent("9 unread");
  await user.click(screen.getByText("Older entries"));
  await screen.findByText("Paper fill · MSFT");
  act(()=>{client.setQueryData(["me"],{id:8,role:"trader",is_demo:true});});
  expect(await screen.findByText("No activity on this page")).toBeVisible();
  expect(screen.queryByText(/Paper fill/)).toBeNull();
  expect(client.getQueryData(["acct",8,"activity-inbox","all",null,5])).toBeDefined();
});
it("retries a failed read marker and recounts the active unread filter",async()=>{
  const user=userEvent.setup();
  vi.mocked(readInbox).mockResolvedValueOnce(page).mockResolvedValueOnce(page)
    .mockResolvedValueOnce({...page,items:[],next_cursor:null,unread_count:0});
  vi.mocked(markInboxRead).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce({id:event.id,read_at:page.read_at});
  mount();
  await screen.findByText("Paper fill · AAPL");
  await user.click(screen.getByText("Unread only"));
  await screen.findByText("Paper fill · AAPL");
  await user.click(screen.getByTestId("inbox-mark-read"));
  await user.click(await screen.findByText("Retry mark read"));
  expect(await screen.findByText("No unread entries on this page")).toBeVisible();
  expect(screen.getByTestId("inbox-unread-count")).toHaveTextContent("0 unread");
  await waitFor(()=>expect(screen.getByText("Unread only")).toHaveFocus());
});
it("withholds private reads from a non-trader",async()=>{
  mount("auditor");
  expect(await screen.findByText("Trader access required")).toBeVisible();
  expect(readInbox).not.toHaveBeenCalled();
});
it("hides private entries after a permission failure and recovers by explicit retry",async()=>{
  const user=userEvent.setup();
  vi.mocked(readInbox).mockResolvedValueOnce(page).mockRejectedValueOnce({isAxiosError:true,response:{status:403}}).mockResolvedValueOnce(page);
  mount();
  await screen.findByText("Paper fill · AAPL");
  await user.click(screen.getByText("Refresh inbox"));
  expect(await screen.findByText("Trader access required")).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull();
  await user.click(screen.getByText("Retry inbox"));
  expect(await screen.findByText("Paper fill · AAPL")).toBeVisible();
});
it.each([null, "/activity/alerts"])(
  "shows alert provenance and links only to an admitted path (%s)",
  async path => {
    registry.features = path ? [{ id: "alerts", path }] : [];
    vi.mocked(readInbox).mockResolvedValue({...page,sources:{...page.sources,alerts:true},items:[{...event,
      kind:"alert_triggered",id:"alert_triggered:2",price:"12.345678",target:"12.34",order_id:null}]});
    mount();
    expect(await screen.findByText("Alert triggered · AAPL")).toBeVisible();
    expect(screen.getByText(/Trigger close/)).toHaveTextContent("12.345678 USD");
    expect(screen.getByText(/Evaluation session/)).toHaveTextContent("2026-11-17");
    expect(screen.queryByRole("link", { name: "Open alerts" })?.getAttribute("href") ?? null).toBe(path);
  },
);
