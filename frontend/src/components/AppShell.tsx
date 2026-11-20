import { Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CaretLeft,
  CaretRight,
  ChartLineUp,
  ChartPieSlice,
  GridFour,
  HouseLine,
  List,
  ShieldCheck,
  SignOut,
  SquaresFour,
  Stack,
  Swap,
  TrendUp,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { useLook } from "../night/looks/preferences";
import { ChromeTools } from "../night/shell/ChromeTools";
import { State } from "../night/kit";
import { allowed, destinations, features, type Destination } from "../night/registry";
import { MarketSearch } from "./MarketSearch";
import { fetchMe } from "../api/auth";
import "../night/inner/frame.css";

const icons: Record<string, Icon> = {
  market: HouseLine,
  today: SquaresFour,
  portfolio: ChartPieSlice,
  activity: Swap,
  research: Stack,
  forecasts: ChartLineUp,
  risk: TrendUp,
  compliance: ShieldCheck,
};

function Brand() {
  return (
    <Link to="/market" className="inner-brand" aria-label="Sentinel Markets">
      <i aria-hidden="true">SM</i>
      <span>
        Sentinel <b>Markets</b>
      </span>
    </Link>
  );
}

export function AppShell() {
  const { prefs } = useLook();
  const { token, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigationType();
  const previousPath = useRef(location.pathname);
  useLayoutEffect(() => {
    if (
      previousPath.current !== location.pathname &&
      !location.hash &&
      navigation !== "POP" &&
      window.scrollY
    ) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    previousPath.current = location.pathname;
  }, [location.pathname, location.hash, navigation]);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: Boolean(token),
    retry: false,
    staleTime: 60000,
  });
  const links = token
    ? destinations.filter((d) => d.access === "authenticated" || allowed(d.access, me.data))
    : [...destinations, ...features.filter((f) => !f.slot)].filter((d) => d.access === "public");
  const identity = me.data?.is_demo ? me.data.display_name || "Demo trader" : me.data?.email;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigationOpener = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  function openNavigation(event: MouseEvent<HTMLButtonElement>) {
    navigationOpener.current = event.currentTarget;
    setSidebarOpen(true);
  }

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const change = () => {
      setDesktop(media.matches);
      if (media.matches) setSidebarOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !sidebarOpen || desktop) return;
    const workspace = workspaceRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      const opener = navigationOpener.current;
      if (opener?.isConnected && !window.matchMedia("(min-width: 768px)").matches) {
        opener.focus({ preventScroll: true });
      } else {
        requestAnimationFrame(() => {
          workspace
            ?.querySelector<HTMLElement>(
              'aside nav a[aria-current="page"], .inner-pills a[aria-current="page"]'
            )
            ?.focus({ preventScroll: true });
        });
      }
    };
  }, [sidebarOpen, desktop]);

  function routeLink(link: Destination, close = false) {
    const Glyph = icons[link.id] ?? GridFour;
    return (
      <NavLink
        key={link.id}
        to={link.href ?? link.path}
        title={link.label}
        onClick={close ? () => setSidebarOpen(false) : undefined}
      >
        <Glyph aria-hidden="true" size={18} />
        <span>{link.label}</span>
      </NavLink>
    );
  }

  return (
    <div className="night-workspace inner-shell" ref={workspaceRef}>
      <a className="sr-only focus:not-sr-only" href="#main-content">
        Skip to main content
      </a>
      <header className="inner-header">
        <div className="inner-utilities">
          <div className="inner-mode">
            <strong>Paper trading</strong>
            <Link to="/market/data-coverage">Data coverage</Link>
          </div>
          <div className="inner-user">
            {identity && (
              <span>
                {identity} · {me.data?.role}
              </span>
            )}
            <ChromeTools workspace />
            {!token && location.pathname !== "/login" && (
              <Link className="nk-button" to="/login">
                Log in
              </Link>
            )}
          </div>
        </div>
        <div className="inner-navigation">
          <Brand />
          {desktop && (
            <nav aria-label="Workspace" className="inner-pills">
              {(prefs.look === "dial" ? links : links.slice(0, 4)).map((link) => routeLink(link))}
            </nav>
          )}
          <div className="inner-search" key={location.pathname + location.search}>
            <MarketSearch compact id="workspace-symbol-search" />
          </div>
          {!desktop && (
            <button
              type="button"
              className="inner-menu"
              onClick={openNavigation}
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
              aria-controls="mobile-navigation"
            >
              <List size={20} />
            </button>
          )}
        </div>
      </header>
      <div className="inner-body">
        {desktop && prefs.look === "terrain" && (
          <aside className="inner-rail" data-collapsed={collapsed} aria-label="Sidebar">
            <nav aria-label="Market instruments">{links.map((link) => routeLink(link))}</nav>
            <button
              type="button"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <CaretRight /> : <CaretLeft />}
            </button>
          </aside>
        )}
        <main id="main-content" className="inner-content">
          <Suspense fallback={<State kind="loading" title="Loading page…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      {!desktop && (
        <nav className="inner-dock" aria-label="Workspace">
          {links.slice(0, 4).map((link) => routeLink(link))}
          <button
            type="button"
            onClick={openNavigation}
            aria-expanded={sidebarOpen}
            aria-controls="mobile-navigation"
          >
            <List size={18} />
            <span>More</span>
          </button>
        </nav>
      )}
      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        aria-label="Mobile navigation"
        onCancel={(event) => {
          event.preventDefault();
          setSidebarOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled])"
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          const next =
            event.shiftKey && document.activeElement === first
              ? last
              : !event.shiftKey && document.activeElement === last
                ? first
                : null;
          if (next) {
            event.preventDefault();
            next.focus();
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          ) {
            setSidebarOpen(false);
          }
        }}
        className="fixed inset-y-0 left-0 m-0 h-[100dvh] max-h-none w-[min(320px,calc(100%-3rem))] max-w-none border-0 border-r border-line bg-sidebar p-0 text-ink backdrop:bg-canvas/75"
      >
        <div className="flex h-full flex-col">
          <header className="inner-drawer-head">
            <button type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>
              <X />
            </button>
            <Brand />
          </header>
          <nav aria-label="Main navigation" className="inner-drawer-links">
            {links.map((link) => routeLink(link, true))}
          </nav>
          <footer className="inner-drawer-foot">
            Paper trading
            {token && (
              <button
                type="button"
                onClick={() => {
                  signOut();
                  navigate("/login");
                  setSidebarOpen(false);
                }}
              >
                <SignOut /> Sign out
              </button>
            )}
          </footer>
        </div>
      </dialog>
    </div>
  );
}
