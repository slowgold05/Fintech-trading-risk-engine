import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const api = vi.hoisted(() => ({ fetchMe: vi.fn(), signOut: vi.fn() }));
vi.mock("../api/auth", () => ({ fetchMe: api.fetchMe }));
vi.mock("../context/useAuth", () => ({
  useAuth: () => ({ token: "shell-test", signOut: api.signOut }),
}));

let desktop = false;
const changes = new Set<() => void>();
const originalDialogMethods = ["showModal", "close"].map((name) => ({
  name, descriptor: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
}));

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard"]}>
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
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(await within(dialog).findByRole("link", { name: "Trades" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    fireEvent.click(screen.getByRole("link", { name: "Portfolio" }));
    expect(screen.getByRole("heading", { name: "Portfolio destination" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    view.unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(changes.size).toBe(0);
  });

  it("closes a mobile modal on desktop resize and preserves role-specific navigation", async () => {
    api.fetchMe.mockResolvedValue({ role: "compliance_officer" });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("link", { name: "Compliance" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Trades" })).not.toBeInTheDocument();
    act(() => { desktop = true; changes.forEach((change) => change()); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Sidebar")).getByRole("link", { name: "Compliance" })).toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("desktop shell", () => {
  it("shows the formatted date and signed-in identity in the top bar", async () => {
    desktop = true;
    api.fetchMe.mockResolvedValue({ role: "trader", email: "ada@example.com" });
    renderShell();
    const header = screen.getByRole("banner");
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
    expect(header).toHaveTextContent(new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric",
    }).format(new Date()));
    expect(await within(header).findByText("ada@example.com")).toBeInTheDocument();
    expect(within(header).getByText("trader")).toBeInTheDocument();
  });
});
