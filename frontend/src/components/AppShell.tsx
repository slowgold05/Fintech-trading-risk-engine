import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
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
  { label: "Market", to: "/market", Icon: HouseLine, end: true },
  { label: "Dashboard", to: "/dashboard", Icon: SquaresFour },
  { label: "Trades", to: "/trades", Icon: Swap },
  { label: "Portfolio", to: "/portfolio", Icon: ChartPieSlice },
  { label: "Risk", to: "/risk", Icon: TrendUp },
  { label: "Research", to: "/research", Icon: Brain },
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
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close navigation"
            className="ml-auto flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
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
          <span className="text-xs font-medium text-slate-300">Paper trading</span>
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
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const dialogRef = useRef<HTMLDialogElement>(null);

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
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-emerald-300 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
        href="#main-content"
      >
        Skip to main content
      </a>

      {desktop && (
        <aside className="sticky top-0 flex h-[100dvh] w-[220px] shrink-0 flex-col border-r border-slate-800/80 bg-[#040b14]" aria-label="Sidebar">
          <Sidebar />
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
        className="fixed inset-y-0 left-0 m-0 h-[100dvh] max-h-none w-[min(320px,100vw)] max-w-none border-0 border-r border-slate-800 bg-[#040b14] p-0 text-slate-100 backdrop:bg-slate-950/75">
        <div className="flex h-full flex-col">
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        {!desktop && <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800/80 bg-slate-950/95 px-4 py-3">
          <button
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            aria-controls="mobile-navigation"
            type="button"
          >
            <List className="size-5" weight="light" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgb(52_211_153_/_0.2)]">
              <span className="font-mono text-[9px] font-bold text-emerald-400">GY</span>
            </div>
            <span className="text-sm font-semibold text-slate-100">getrichyesterday</span>
          </div>
        </header>}

        <main className="flex-1 overflow-auto" id="main-content">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
