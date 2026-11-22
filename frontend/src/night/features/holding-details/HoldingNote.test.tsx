import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { HoldingNote } from "./HoldingNote";

vi.mock("../../../api/client",() => ({apiClient:{get:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
afterEach(() => {cleanup();vi.resetAllMocks();});
const path="/night/holdings/AAPL/note";
function mount() {
  const client=new QueryClient();
  const invalidate=vi.spyOn(client,"invalidateQueries");
  render(<QueryClientProvider client={client}><HoldingNote owner={7} symbol="AAPL" /></QueryClientProvider>);
  return invalidate;
}
it("renders markup as plain text, saves a trimmed edit, and invalidates only this owner's note",async () => {
  let text="<em>closing observation</em>";
  const read=() => ({data:{symbol:"AAPL",note:text ? {text,updated_at:"2026-11-17T12:00:00Z"} : null}});
  vi.mocked(apiClient.get).mockImplementation(async () => read());
  vi.mocked(apiClient.put).mockImplementation(async (_url,body) => {text=(body as {text:string}).text;return read();});
  vi.mocked(apiClient.delete).mockImplementation(async () => {text="";return {status:204};});
  const invalidate=mount();
  expect(await screen.findByText("<em>closing observation</em>")).toBeVisible();
  expect(document.querySelector(".holding-note-text em")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Edit note"}));
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"  revised 📝  "}});
  fireEvent.click(screen.getByTestId("holding-note-save"));
  expect(await screen.findByText("revised 📝",{selector:".holding-note-text"})).toBeVisible();
  expect(apiClient.put).toHaveBeenCalledWith(path,{text:"revised 📝"});
  expect(invalidate).toHaveBeenCalledWith({queryKey:["acct",7,"holding-notes","AAPL"],exact:true});
  fireEvent.click(screen.getByRole("button",{name:"Delete note"}));
  fireEvent.click(screen.getByRole("button",{name:"Keep note"}));
  expect(apiClient.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Delete note"}));
  fireEvent.click(screen.getByRole("button",{name:"Confirm delete"}));
  await screen.findByText("No note saved for AAPL.");
  expect(apiClient.delete).toHaveBeenCalledWith(path);
});
it("counts Unicode code points, blocks blank or oversized input and keeps a failed draft",async () => {
  vi.mocked(apiClient.get).mockResolvedValue({data:{symbol:"AAPL",note:null}});
  vi.mocked(apiClient.put).mockRejectedValue(new Error("unavailable"));
  mount();fireEvent.click(await screen.findByRole("button",{name:"Add note"}));
  expect(screen.getByTestId("holding-note-save")).toBeDisabled();
  const input=screen.getByRole("textbox");
  fireEvent.change(input,{target:{value:"📝".repeat(2001)}});
  expect(screen.getByTestId("holding-note-save")).toBeDisabled();
  fireEvent.change(input,{target:{value:"📝".repeat(2000)}});
  expect(screen.getByTestId("holding-note-save")).toBeEnabled();
  fireEvent.change(input,{target:{value:"Keep this edit"}});
  fireEvent.click(screen.getByTestId("holding-note-save"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  expect(input).toHaveValue("Keep this edit");
});
