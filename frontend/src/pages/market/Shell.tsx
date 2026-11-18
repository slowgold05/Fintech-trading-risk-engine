import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, List, X } from "@phosphor-icons/react";
import { MarketSearch } from "../../components/MarketSearch";
import { useCompactWall } from "../../ui/lib";
import archivoLicense from "../../night/looks/dial/fonts/archivo-LICENSE.txt?url";
import martianLicense from "../../night/looks/dial/fonts/martian-mono-LICENSE.txt?url";
import { historySourceLabel } from "../../config/history";
import { useAdjustedProvider } from "../../components/market/useAdjustedProvider";
import { ButtonLink } from "../../ui/primitives";

export type PageSection = { id: string; label: string };

type MarketHeaderProps = {
  sections: readonly PageSection[];
  authenticated: boolean;
  /** The condensed pulse, shown once the pulse block is off screen. */
  chip: string | null;
};

type Drag = { id: number; startX: number; lastX: number; lastT: number; dx: number; velocity: number; active: boolean };

const FOCUSABLE = "a[href], button:not([disabled])";

export function MarketHeader({ sections, authenticated, chip }: MarketHeaderProps) {
  const compact = useCompactWall();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);

  /* The header reacts to scroll without rendering: attributes are written to the node. */
  useEffect(() => {
    const header = headerRef.current;
    const sentinel = sentinelRef.current;
    if (!header || !sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }
    const top = new IntersectionObserver(([entry]) => {
      header.setAttribute("data-scrolled", entry.isIntersecting ? "false" : "true");
    });
    top.observe(sentinel);

    const pulsePanel = document.getElementById("market-pulse")?.closest("[data-panel]");
    const pulse = new IntersectionObserver(([entry]) => {
      header.setAttribute("data-pulse", entry.isIntersecting ? "false" : "true");
    }, { rootMargin: "-52px 0px 0px 0px" });
    if (pulsePanel) {
      pulse.observe(pulsePanel);
    }

    const visible = new Set<string>();
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target.id);
        } else {
          visible.delete(entry.target.id);
        }
      }
      const current = sections.find((section) => visible.has(section.id))?.id;
      header.querySelectorAll<HTMLElement>("[data-spy]").forEach((link) => {
        if (link.dataset.spy === current) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }, { rootMargin: "-56px 0px -50% 0px" });
    for (const section of sections) {
      const node = document.getElementById(section.id);
      if (node) {
        spy.observe(node);
      }
    }

    return () => {
      top.disconnect();
      pulse.disconnect();
      spy.disconnect();
    };
  }, [sections]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !menuRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !menuRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || menuButton?.contains(target))) {
        return;
      }
      setMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
      menuButton?.focus();
    };
  }, [menuOpen]);

  /* The drawer follows the finger; a short fling or a long pull closes it. */
  function onDrawerPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    drag.current = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, lastT: event.timeStamp, dx: 0, velocity: 0, active: false };
  }

  function onDrawerPointerMove(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - state.startX;
    if (!state.active) {
      if (Math.abs(dx) < 8) {
        return;
      }
      state.active = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.currentTarget.style.transition = "none";
    }
    state.velocity = (event.clientX - state.lastX) / Math.max(1, event.timeStamp - state.lastT);
    state.lastX = event.clientX;
    state.lastT = event.timeStamp;
    state.dx = dx;
    event.currentTarget.style.transform = `translateX(${dx <= 0 ? dx : Math.pow(dx, 0.6)}px)`;
  }

  function onDrawerPointerEnd(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    drag.current = null;
    if (!state?.active) {
      return;
    }
    event.currentTarget.style.transition = "";
    event.currentTarget.style.transform = "";
    if (state.dx < -96 || state.velocity < -0.45) {
      setMenuOpen(false);
    }
  }

  const account = authenticated ? "/dashboard" : "/login";

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-4 w-px" ref={sentinelRef} />
      <header className="hdr" ref={headerRef}>
        <div className="hdr-in mx-auto max-w-[1480px] px-4 sm:px-6">
          {!compact && <button
            aria-controls="public-market-menu"
            aria-expanded={menuOpen}
            aria-label="Open menu"
            className="btn btn-ghost btn-icon min-h-11 min-w-11 xl:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            ref={menuButtonRef}
            type="button"
          >
            <List aria-hidden="true" size={18} />
          </button>}
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="brand-mark">SM</span>
            <span className="brand-name truncate">Sentinel Markets</span>
          </div>
          <nav aria-label="On this page" className="ml-3 hidden min-w-0 items-center gap-0.5 xl:flex">
            {sections.map((section) => (
              <a className="hdr-link" data-spy={section.id} href={`#${section.id}`} key={section.id}>
                {section.label}
              </a>
            ))}
          </nav>
          {compact && <div className="rv compact-search" data-seen="true"><MarketSearch compact /></div>}
          <div className="ml-auto flex items-center gap-2">
            {chip ? <span aria-hidden="true" className="hdr-chip pill max-sm:hidden">{chip}</span> : null}
            <ButtonLink size="sm" to={account} variant={authenticated ? "solid" : "ghost"}>
              {authenticated ? "Open dashboard" : "Log in"}
              {authenticated ? <ArrowRight aria-hidden="true" size={14} weight="bold" /> : null}
            </ButtonLink>
          </div>
        </div>
      </header>

      <div
        aria-hidden={menuOpen ? "false" : "true"}
        className="menu-layer fixed inset-0 z-50"
        data-open={menuOpen ? "true" : "false"}
        inert={!menuOpen}
      >
        <div className="scrim" onClick={() => setMenuOpen(false)} />
        <nav
          aria-label="Page sections"
          className="drawer absolute inset-y-0 left-0 flex w-[min(18rem,calc(100%-3rem))] flex-col gap-1 p-3"
          id="public-market-menu"
          onPointerCancel={onDrawerPointerEnd}
          onPointerDown={onDrawerPointerDown}
          onPointerMove={onDrawerPointerMove}
          onPointerUp={onDrawerPointerEnd}
          ref={menuRef}
        >
          <div className="mb-1 flex items-center justify-between pl-3">
            <span className="lbl">On this page</span>
            <button
              aria-label="Close menu"
              className="btn btn-ghost btn-icon min-h-11 min-w-11"
              onClick={() => setMenuOpen(false)}
              ref={closeButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
          {sections.map((section) => (
            <a className="drawer-link" href={`#${section.id}`} key={section.id} onClick={() => setMenuOpen(false)}>
              {section.label}
            </a>
          ))}
          <Link className="btn btn-solid mt-auto min-h-11" onClick={() => setMenuOpen(false)} to={account}>
            {authenticated ? "Open dashboard" : "Log in"}
          </Link>
        </nav>
      </div>
    </>
  );
}

export function MarketFooter() {
  const { provider } = useAdjustedProvider();
  return (
    <footer className="mx-auto mt-2 max-w-[1480px] px-4 pb-5 sm:px-6">
      <div aria-hidden="true" className="ruler" />
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
        <div className="flex items-center gap-2 self-start">
          <span aria-hidden="true" className="brand-mark">SM</span>
          <span className="brand-name">Sentinel Markets / public market</span>
        </div>
        <div className="note grid gap-1">
          <p>The market dashboard is public. Sign in for trading, portfolio and risk workflows.</p>
          <p>Quotes on this page are delayed, cached or end-of-day, and are not for order execution.</p>
          <p>Index and sector figures are ETF proxies, not index prints. Daily history: {provider ? historySourceLabel(provider) : "stored series unavailable"}.</p>
          <p>Typefaces · <a href={archivoLicense}>Archivo license</a> · <a href={martianLicense}>Martian Mono license</a></p>
          <p>Charts are drawn with <a className="underline underline-offset-2" href="https://www.tradingview.com/lightweight-charts/">TradingView Lightweight Charts</a>.</p>
        </div>
        <a className="btn btn-ghost btn-sm self-start" href="#main">Back to top</a>
      </div>
    </footer>
  );
}
