import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
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
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { fetchMe } from "../api/auth";

const navigationItems: Array<{ label: string; to: string; Icon: Icon; end?: boolean }> = [
  { label: "Home", to: "/", Icon: HouseLine, end: true },
  { label: "Dashboard", to: "/dashboard", Icon: SquaresFour },
  { label: "Trades", to: "/trades", Icon: Swap },
  { label: "Portfolio", to: "/portfolio", Icon: ChartPieSlice },
  { label: "Risk", to: "/risk", Icon: TrendUp },
];

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { signOut, token } = useAuth();
  const me = useQuery({ queryKey: ["me", token], queryFn: fetchMe, enabled: Boolean(token) });
  const role = me.data?.role;
  const navigate = useNavigate();

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-800/80 px-4 py-[18px]">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgb(52_211_153_/_0.25),0_0_20px_-6px_rgb(52_211_153_/_0.35)]">
          <span className="font-mono text-[11px] font-bold tracking-tight text-emerald-400">GY</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400">
            getrichyesterday
          </div>
          <div className="mt-0.5 truncate text-[10px] text-slate-500">Trading & Operations</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
                  ["sidebar-nav-item", isActive ? "sidebar-nav-active" : "sidebar-nav-inactive"].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={["size-5 shrink-0", isActive ? "text-emerald-400" : ""].join(" ")}
                      weight="light"
                    />
                    <span className="flex-1">{label}</span>
                    {isActive && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgb(52_211_153_/_0.5)]" />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-slate-800/80 px-3 py-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-800/80 bg-slate-900/50 px-3 py-2.5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[11px] font-medium text-slate-400">System live</span>
        </div>
        <button
          onClick={handleSignOut}
          type="button"
          className="sidebar-nav-item sidebar-nav-inactive text-rose-400/70 hover:bg-rose-950/40 hover:text-rose-300"
        >
          <SignOut className="size-4 shrink-0" weight="light" />
          Sign out
        </button>
      </div>
    </>
  );
}

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-[100dvh]">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-emerald-300 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
        href="#main-content"
      >
        Skip to main content
      </a>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/75 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          "flex w-[220px] shrink-0 flex-col",
          "border-r border-slate-800/80 bg-[#040b14]",
          "fixed inset-y-0 left-0 z-40",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:z-auto md:translate-x-0",
        ].join(" ")}
        aria-label="Sidebar"
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800/80 bg-slate-950/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            type="button"
          >
            {sidebarOpen ? (
              <X className="size-5" weight="light" />
            ) : (
              <List className="size-5" weight="light" />
            )}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgb(52_211_153_/_0.2)]">
              <span className="font-mono text-[9px] font-bold text-emerald-400">GY</span>
            </div>
            <span className="text-sm font-semibold text-slate-100">getrichyesterday</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto" id="main-content">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
