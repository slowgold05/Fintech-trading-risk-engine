import { TouchSheet } from "../../design/TouchSheet";
import { compactWidth, useMaxWidth } from "./compactLayout";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  List,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import {
  SquaresFour, Waveform, GridFour, Fingerprint, ChartLine, NewspaperClipping,
  Pulse, BookmarkSimple, ArrowsDownUp, Stack,
} from "./terrainIcons";
import { ChartNotices } from "../ChartNotices";
import { MarketSearch } from "../MarketSearch";

const instruments = [
  [SquaresFour, "overview", "Overview"],
  [Stack, "volatility-terrain", "Volatility terrain"],
  [Waveform, "sector-etf-heatmap", "Sector funds"],
  [GridFour, "stock-heatmap", "Stock heatmap"],
  [ArrowsDownUp, "trending-movers", "Trending movers"],
  [NewspaperClipping, "market-news", "Market news"],
  [Pulse, "market-pulse", "Market pulse"],
  [Fingerprint, "company-research", "Company research"],
  [BookmarkSimple, "watchlists-title", "Watchlists"],
  [ChartLine, "daily-price-history-title", "Daily history"],
] as const;

const sections = [
  ["volatility-terrain", "Volatility terrain"],
  ["sector-etf-heatmap", "Sector ETF performance"],
  ["stock-heatmap", "Stock heatmap"],
  ["trending-movers", "Trending movers"],
  ["market-news", "Market news"],
  ["market-pulse", "Market pulse"],
  ["company-research", "Company research"],
  ["watchlists-title", "Watchlists"],
  ["daily-price-history-title", "Daily history chart"],
] as const;

function Wordmark() {
  return (
    <span className="wordmark">
      <svg viewBox="0 0 34 30" aria-hidden="true" fill="currentColor">
        <path d="M3 20 13 4h5L7.5 20zM10 25 24 3h5L15 25zM17.5 28 31 7v8l-8.5 13z" />
      </svg>
      <span>
        Sentinel<span className="brand-suffix"> Markets</span>
      </span>
    </span>
  );
}

export function MarketHeader({ isAuthenticated }: { isAuthenticated: boolean }) {
  const compact = useMaxWidth(compactWidth);
  const [activeSection, setActiveSection] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const closeMenuRef = useRef<HTMLButtonElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = tabs.current;
    if (!nav) return;
    function position() {
      const link = nav!.querySelector<HTMLElement>("a.active");
      const indicator = nav!.querySelector<HTMLElement>(".nav-indicator")!;
      if (link) indicator.style.transform = `translateX(${link.offsetLeft}px) scaleX(${link.offsetWidth})`;
      indicator.hidden = !link;
    }
    if (!window.ResizeObserver) {
      position();
      return;
    }
    const observer = new ResizeObserver(position);
    nav.querySelectorAll("a").forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [activeSection, compact]);
  const searchButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!marker.current || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) =>
      shell.current?.classList.toggle("scrolled", !entry.isIntersecting),
    );
    observer.observe(marker.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (window.scrollY < 12) {
        setActiveSection("overview");
        return;
      }
      const line = compact
        ? (document.querySelector(".index-strip")?.clientHeight ?? 76) + 28
        : (shell.current?.offsetHeight ?? 55) + 30;
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      const atBottom = remaining <= 3;
      if (compact) {
        if (atBottom) {
          setActiveSection("market-tools");
          return;
        }
        const starts = ["volatility-terrain", "trending-movers", "market-tools"];
        const current = starts
          .filter((id) => {
            const node = document.getElementById(id);
            const section = node?.closest(".desk-card") ?? node;
            return section && section.getBoundingClientRect().top <= line + 3;
          })
          .at(-1);
        setActiveSection(current ?? "overview");
        return;
      }
      const targets = instruments.slice(1).flatMap(([, id]) => {
        const node = document.getElementById(id);
        if (!node) return [];
        const closed = node.closest("details:not([open])");
        const panel = closed ?? node.closest(".desk-card,.pulse-panel,.dashboard-card") ?? node;
        return [
          { id, y: panel.getBoundingClientRect().top, heading: (closed ?? node).getBoundingClientRect().top },
        ];
      });
      const anchor = targets.find((t) => "#" + t.id === window.location.hash);
      if (
        anchor &&
        (Math.abs(anchor.heading - line) < 26 || (remaining <= 32 && anchor.y >= 0 && anchor.y < innerHeight))
      ) {
        setActiveSection(anchor.id);
        return;
      }
      if (atBottom) {
        setActiveSection("daily-price-history-title");
        return;
      }
      // Side-by-side panels share a scroll position. Prefer the first in
      // reading order unless a particular panel was explicitly addressed.
      const passed = targets.filter((t) => t.y <= line);
      const lastTop = Math.max(...passed.map((t) => t.y));
      setActiveSection(passed.find((t) => lastTop - t.y < 38)?.id ?? "overview");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, [compact]);
  useEffect(() => {
    if (searchOpen) document.getElementById("market-symbol-search")?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (!menuOpen || compact) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeMenuRef.current?.focus();

    function focusableControls() {
      const panel = menuPanelRef.current;
      if (!panel) {
        return [];
      }
      return Array.from(panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const controls = focusableControls();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        return;
      }
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !menuPanelRef.current?.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (menuButtonRef.current?.contains(target) || menuPanelRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [menuOpen, compact]);

  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }
  const accountHref = isAuthenticated ? "/dashboard" : "/login";
  const accountLabel = isAuthenticated ? "Open dashboard" : "Log in";
  return (
    <>
      <div ref={marker} className="scroll-marker" aria-hidden="true" />
      <header className="market-header" ref={shell}>
        <div className="market-wrap header-inner">
          <a className="brand-link" href="#overview" aria-label="Sentinel Markets overview">
            <Wordmark />
          </a>
          {!compact && (
            <nav ref={tabs} className="top-links" aria-label="Market navigation">
              <i aria-hidden="true" className="nav-indicator" />
              {[
                ["overview", "Overview"],
                ["stock-heatmap", "Heatmap"],
                ["company-research", "Research"],
              ].map(([id, name]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={
                    activeSection === id ||
                    (id === "overview" &&
                      ["volatility-terrain", "sector-etf-heatmap"].includes(activeSection)) ||
                    (id === "stock-heatmap" && ["trending-movers", "market-news"].includes(activeSection)) ||
                    (id === "company-research" &&
                      ["watchlists-title", "daily-price-history-title"].includes(activeSection))
                      ? "active"
                      : ""
                  }
                  aria-current={activeSection === id ? "location" : undefined}
                >
                  {name}
                </a>
              ))}
            </nav>
          )}
          <div
            className={`header-search ${searchOpen ? "search-open" : ""}`}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchOpen) {
                setSearchOpen(false);
                searchButton.current?.focus();
              }
            }}
          >
            <MarketSearch compact={compact} />
          </div>
          <button
            className="mobile-search"
            type="button"
            aria-label="Toggle symbol search"
            aria-expanded={searchOpen}
            ref={searchButton}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <MagnifyingGlass size={20} />
          </button>
          <Link className="account-link" to={accountHref}>
            {accountLabel} <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
          <button
            className="menu-button"
            type="button"
            aria-label="Open menu"
            ref={menuButtonRef}
            aria-expanded={menuOpen}
            aria-controls="public-market-menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <List size={22} />
          </button>
        </div>
      </header>
      {!compact && (
        <nav
          style={{ "--rail-slot": instruments.findIndex(([, id]) => id === activeSection) } as CSSProperties}
          className="instrument-rail"
          aria-label="Market instruments"
        >
          {instruments.map(([Glyph, id, label]) => (
            <a
              href={"#" + id}
              aria-label={label}
              onClick={() => {
                const target = document.getElementById(id);
                const disclosure = target?.closest("details");
                if (disclosure) disclosure.open = true;
                setActiveSection(id);
                target?.setAttribute("tabindex", "-1");
                target?.focus({ preventScroll: true });
              }}
              key={id}
              aria-current={activeSection === id ? "location" : undefined}
            >
              <Glyph size={17} />
              <span role="tooltip">{label}</span>
            </a>
          ))}
        </nav>
      )}
      {compact && (
        <nav className="touch-dock" aria-label="Market sections">
          {(
            [
              [SquaresFour, "overview", "Close", activeSection === "overview"],
              [Stack, "volatility-terrain", "Terrain", activeSection === "volatility-terrain"],
              [
                ArrowsDownUp,
                "trending-movers",
                "Movers",
                ["trending-movers", "sector-etf-heatmap", "stock-heatmap", "market-news"].includes(
                  activeSection,
                ),
              ],
              [
                ChartLine,
                "market-tools",
                "Tools",
                [
                  "market-tools",
                  "market-pulse",
                  "company-research",
                  "watchlists-title",
                  "daily-price-history-title",
                ].includes(activeSection),
              ],
            ] as const
          ).map(([Icon, id, label, active]) => (
            <a key={id} href={"#" + id} aria-current={active ? "location" : undefined}>
              <Icon size={19} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      )}
      {menuOpen && compact && (
        <TouchSheet title="Market sections" onClose={() => setMenuOpen(false)} returnFocusRef={menuButtonRef}>
          <nav id="public-market-menu" className="sheet-links" aria-label="Page sections">
            {sections.map(([id, label]) => (
              <a key={id} href={"#" + id}>
                {label}
                <ArrowUpRight size={16} />
              </a>
            ))}
          </nav>
        </TouchSheet>
      )}
      {menuOpen && !compact && (
        <div
          ref={menuPanelRef}
          className="drawer-wrap"
          role="dialog"
          aria-modal="true"
          aria-label="Market menu"
        >
          <div className="drawer-shade" onClick={closeMenu} />
          <nav id="public-market-menu" aria-label="Page sections" className="desk-drawer">
            <div className="drawer-top">
              <Wordmark />
              <button aria-label="Close menu" ref={closeMenuRef} type="button" onClick={closeMenu}>
                <X size={21} />
              </button>
            </div>
            <p className="eyebrow">On this page</p>
            <ul>
              {sections.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={() => {
                      setMenuOpen(false);
                      requestAnimationFrame(() => {
                        const target = document.getElementById(id);
                        target?.setAttribute("tabindex", "-1");
                        target?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    {label}
                    <ArrowUpRight size={14} />
                  </a>
                </li>
              ))}
            </ul>
            <Link className="account-link" to={accountHref}>
              {accountLabel}
              <ArrowUpRight size={15} />
            </Link>
          </nav>
        </div>
      )}
    </>
  );
}

export function MarketFooter({ isAuthenticated }: { isAuthenticated: boolean }) {
  const compact = useMaxWidth(compactWidth);
  return (
    <footer className="market-footer">
      <div className="market-wrap footer-inner">
        <Wordmark />
        <p>Paper trading only. Sign in for portfolio and risk tools.</p>
        <Link to={isAuthenticated ? "/dashboard" : "/login"}>
          {isAuthenticated ? "Open workspace" : "Get started"} <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="market-wrap footer-notices">
        {compact ? <details className="footer-credits">
          <summary>Chart credits &amp; licences <small>TradingView</small></summary>
          <ChartNotices />
        </details> : <ChartNotices />}
      </div>
    </footer>
  );
}
