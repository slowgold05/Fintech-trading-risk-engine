import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const api = vi.hoisted(() => ({ fetchMe: vi.fn(), signOut: vi.fn() }));
vi.mock("../api/auth", () => ({ fetchMe: api.fetchMe }));
vi.mock("../context/useAuth", () => ({
  useAuth: () => ({ token: "shell-test", isAuthenticated: true, signOut: api.signOut }),
}));

let desktop = false;
const changes = new Set<() => void>();
const originalDialogMethods = ["showModal", "close"].map((name) => ({
  name, descriptor: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
}));

function renderShell(initialPath = "/dashboard") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<button>Page action</button>} />
            <Route path="/portfolio" element={<h1>Portfolio destination</h1>} />
          </Route>
          <Route path="/login" element={<h1>Login destination</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  desktop = false;
  changes.clear();
  api.fetchMe.mockResolvedValue({ role: "trader" });
  api.signOut.mockClear();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    get matches() { return desktop; },
    media: query,
    onchange: null,
    addListener() {}, removeListener() {},
    addEventListener: (_type: string, callback: EventListenerOrEventListenerObject | null) => { changes.add(callback as () => void); },
    removeEventListener: (_type: string, callback: EventListenerOrEventListenerObject | null) => { changes.delete(callback as () => void); },
    dispatchEvent: () => true,
  }));
  // jsdom does not provide native modal focus/inert behavior. Selenium proves that.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    } },
  });
});

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); document.body.style.overflow = "";
  originalDialogMethods.forEach(({ name, descriptor }) => {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

describe("mobile shell", () => {
  it("opens a named modal, exposes expanded state, and closes on cancel and close", async () => {
    document.body.style.overflow = "auto";
    renderShell();
    const open = screen.getByRole("button", { name: "Open navigation" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("navigation", {name:"Workspace"})).toBeInTheDocument();
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
    expect(dialog.className).toContain("left-0");
    expect(dialog.className).toContain("w-[min(320px,calc(100%-3rem))]");
    expect(dialog.className).not.toContain("animate-");
    expect(dialog.className).not.toContain("drawer-in");
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(await within(dialog).findByRole("link", { name: "Activity" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Compliance" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("Paper trading")).toBeInTheDocument();
    expect(screen.queryByText("System live")).not.toBeInTheDocument();
    const close = within(dialog).getByRole("button", { name: "Close navigation" });
    const signOut = within(dialog).getByRole("button", { name: "Sign out" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(signOut).toHaveFocus();
    fireEvent.keyDown(signOut, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent(dialog, new Event("cancel"));
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(document.body.style.overflow).toBe("auto");
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes after navigation and cleans up the scroll lock on unmount", () => {
    const view = renderShell();
    const open = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(open);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Portfolio" }));
    expect(screen.getByRole("heading", { name: "Portfolio destination" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    fireEvent.click(open);
    view.unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(changes.size).toBe(0);
  });

  it("closes a mobile modal on desktop resize and preserves role-specific navigation", async () => {
    api.fetchMe.mockResolvedValue({ role: "compliance_officer" });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("link", { name: "Compliance" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Activity" })).toBeInTheDocument();
    act(() => { desktop = true; changes.forEach((change) => change()); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Sidebar")).getByRole("link", { name: "Compliance" })).toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("keeps symbol lookup and account actions in the compact header", () => {
    renderShell();
    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("link", {name:"Sentinel Markets"})).toHaveAttribute("href","/market");
    expect(header.getByRole("textbox", {name:"Search symbols"})).toBeInTheDocument();
    expect(header.getByRole("button", {name:"Switch to Dial"})).toBeInTheDocument();
    expect(header.getByRole("button", {name:"Open command menu"})).toBeInTheDocument();
    expect(header.getByRole("button", {name:"Account"})).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("button", {name:"Page action"})).toBeInTheDocument();
  });
});

describe("desktop shell", () => {
  it("shows the signed-in identity, direct symbol search and command menu", async () => {
    desktop = true;
    api.fetchMe.mockResolvedValue({ role: "trader", email: "ada@example.com" });
    renderShell();
    const header = within(screen.getByRole("banner"));
    expect(await header.findByText("ada@example.com · trader")).toBeInTheDocument();
    expect(header.getByRole("textbox", {name:"Search symbols"})).toBeInTheDocument();
    expect(header.getByRole("button", {name:"Open command menu"})).toBeInTheDocument();
    expect(header.getByRole("link", {name:"Sentinel Markets"})).toHaveAttribute("href","/market");
    expect(header.queryByRole("button", {name:"Open navigation"})).not.toBeInTheDocument();
  });

  it("opens Terrain with its icon rail and keeps the destination mounted when expanded", async () => {
    desktop = true;
    api.fetchMe.mockResolvedValue({role:"trader",email:"ada@example.com"});
    renderShell("/portfolio");
    const sidebar = screen.getByLabelText("Sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed","true");
    const expand = within(sidebar).getByRole("button",{name:"Expand sidebar"});
    expect(expand).toHaveAttribute("aria-expanded","false");
    fireEvent.click(expand);
    expect(sidebar).toHaveAttribute("data-collapsed","false");
    fireEvent.click(within(sidebar).getByRole("button",{name:"Collapse sidebar"}));
    expect(sidebar).toHaveAttribute("data-collapsed","true");
    for (const name of ["Markets","Today","Activity","Portfolio","Risk","Research","Forecast Lab"]) {
      expect(within(sidebar).getByRole("link",{name})).toBeInTheDocument();
    }
    expect(within(sidebar).queryByRole("link",{name:"Compliance"})).not.toBeInTheDocument();
    expect(screen.getByRole("heading",{name:"Portfolio destination"})).toBeInTheDocument();
  });
});
