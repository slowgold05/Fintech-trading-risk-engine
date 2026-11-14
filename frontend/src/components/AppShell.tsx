import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Brain,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  ChartPieSlice,
  HouseLine,
  List,
  SignOut,
  ShieldCheck,
  SquaresFour,
  Swap,
  TrendUp,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { fetchMe } from "../api/auth";
import type { UserResponse } from "../types/schemas";

const navigationItems: Array<{ label: string; to: string; Icon: Icon; end?: boolean }> = [
  { label: "Market", to: "/market", Icon: HouseLine, end: true },
  { label: "Dashboard", to: "/dashboard", Icon: SquaresFour },
  { label: "Trades", to: "/trades", Icon: Swap },
  { label: "Portfolio", to: "/portfolio", Icon: ChartPieSlice },
  { label: "Risk", to: "/risk", Icon: TrendUp },
  { label: "Research", to: "/research", Icon: Brain },
  { label: "Forecast Lab", to: "/forecasts", Icon: ChartLineUp },
];

const shellDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const roleTone: Record<UserResponse["role"], string> = {
  trader: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  analyst: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  compliance_officer: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  admin: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  auditor: "border-slate-600 bg-slate-800 text-slate-300",
};

function emailInitial(email: string | null | undefined): string {
  if (!email) return "";
  const letter = email.trim().charAt(0);
  return letter ? letter.toUpperCase() : "";
}

function Sidebar({
  onClose,
  collapsed = false,
  onToggle,
}: {
  onClose?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const { signOut, token } = useAuth();
  const me = useQuery({ queryKey: ["me", token], queryFn: fetchMe, enabled: Boolean(token) });
  const role = me.data?.role;
  const navigate = useNavigate();
  const compact = collapsed && !onClose;

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  return (
    <>
      <div className={["flex border-b border-line", compact ? "flex-col items-center gap-2 px-2 py-3" : "items-center gap-3 px-4 py-[18px]"].join(" ")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 shadow-[inset_0_0_0_1px_rgb(32_185_129_/_0.25)]" aria-hidden="true">
          <span className="font-mono text-[11px] font-bold tracking-tight text-brand-300">SM</span>
        </div>
        <div className={compact ? "sr-only" : "min-w-0 flex-1"}>
          <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-brand-300">Sentinel Markets</p>
          <p className="mt-0.5 truncate text-[10px] text-muted">Trading & Risk</p>
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={["inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-copy hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus", compact ? "order-first" : "ml-auto"].join(" ")}
          >
            {collapsed ? <CaretRight className="size-5" weight="light" aria-hidden="true" /> : <CaretLeft className="size-5" weight="light" aria-hidden="true" />}
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close navigation"
            className="ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-copy hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        <p className={["mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted", compact ? "sr-only" : ""].join(" ")}>
          Navigation
        </p>
        <ul className="space-y-0.5">
          {[...navigationItems.filter((item) => item.to !== "/trades" || role === "trader"),
            ...(role === "compliance_officer" || role === "admin" || role === "auditor"
              ? [{ label: "Compliance", to: "/compliance", Icon: ShieldCheck }] : []),
          ].map(({ label, to, Icon, end }) => (
            <li key={to}>
              <NavLink
                end={end}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  ["sidebar-nav-item", compact ? "justify-center px-2" : "", isActive ? "sidebar-nav-active" : "sidebar-nav-inactive"].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={["size-5 shrink-0", isActive ? "text-brand-300" : ""].join(" ")}
                      weight="light"
                      aria-hidden="true"
                    />
                    <span className={compact ? "sr-only" : "flex-1"}>{label}</span>
                    {isActive && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-line px-3 py-4">
        <div className={["flex items-center rounded-xl border border-line bg-raised", compact ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2.5"].join(" ")}>
          <span className={compact ? "sr-only" : "text-xs font-medium text-copy"}>Paper trading</span>
          {compact ? <span aria-hidden="true" className="size-2 rounded-full bg-brand-500" /> : null}
        </div>
        <button
          onClick={handleSignOut}
          type="button"
          className={["sidebar-nav-item sidebar-nav-inactive text-down hover:bg-hover hover:text-down", compact ? "justify-center px-2" : ""].join(" ")}
        >
          <SignOut className="size-4 shrink-0" weight="light" aria-hidden="true" />
          <span className={compact ? "sr-only" : undefined}>Sign out</span>
        </button>
      </div>
    </>
  );
}

export function AppShell() {
  const { token } = useAuth();
  const me = useQuery({ queryKey: ["me", token], queryFn: fetchMe, enabled: Boolean(token) });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initial = me.data ? emailInitial(me.data.email) : "";

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const change = () => {
      setDesktop(media.matches);
      if (media.matches) setSidebarOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !sidebarOpen || desktop) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [sidebarOpen, desktop]);

  return (
    <div className="flex min-h-[100dvh]">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand-300 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-canvas"
        href="#main-content"
      >
        Skip to main content
      </a>

      {desktop && (
        <aside
          className={["sticky top-0 flex h-[100dvh] shrink-0 flex-col border-r border-line bg-sidebar", collapsed ? "w-[72px]" : "w-60"].join(" ")}
          aria-label="Sidebar"
        >
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        </aside>
      )}

      <dialog ref={dialogRef} id="mobile-navigation" aria-label="Mobile navigation"
        onClose={() => setSidebarOpen(false)}
        onCancel={() => setSidebarOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
          const first = controls[0];
          const last = controls[controls.length - 1];
          const next = event.shiftKey && document.activeElement === first
            ? last : !event.shiftKey && document.activeElement === last ? first : null;
          if (next) {
            event.preventDefault();
            next.focus();
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            setSidebarOpen(false);
          }
        }}
        className="fixed inset-y-0 left-0 m-0 h-[100dvh] max-h-none w-[min(320px,100vw)] max-w-none border-0 border-r border-line bg-sidebar p-0 text-ink backdrop:bg-canvas/75">
        <div className="flex h-full flex-col">
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-4 sm:px-6 lg:px-10">
          <div className="flex flex-wrap items-center gap-6 py-3">
            {!desktop && (
              <>
                <button
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-line bg-raised p-2 text-copy hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={sidebarOpen}
                  aria-controls="mobile-navigation"
                  type="button"
                >
                  <List className="size-5" weight="light" aria-hidden="true" />
                </button>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 shadow-[inset_0_0_0_1px_rgb(32_185_129_/_0.2)]" aria-hidden="true">
                    <span className="font-mono text-[11px] font-bold text-brand-300">SM</span>
                  </div>
                  <span className="truncate text-sm font-semibold text-ink">Sentinel Markets</span>
                </div>
              </>
            )}
            <p className="text-sm text-copy lg:ml-auto">{shellDateFormatter.format(new Date())}</p>
            <Link
              to="/market"
              className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-ink hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Search markets
            </Link>
            <p role="status" className="inline-flex min-h-11 max-w-full items-center gap-2 text-sm text-muted">
              <Bell className="size-5 shrink-0" weight="light" aria-hidden="true" />
              <span>Notifications unavailable</span>
            </p>
            {me.data && (
              <div className="flex min-w-0 max-w-full items-center gap-2">
                {initial ? (
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-canvas">
                    {initial}
                  </span>
                ) : null}
                {me.data.email ? (
                  <span className="min-w-0 truncate text-xs font-medium text-ink">{me.data.email}</span>
                ) : null}
                <span className={["status-badge shrink-0", roleTone[me.data.role]].join(" ")}>{me.data.role}</span>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto" id="main-content">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
