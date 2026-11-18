import { useAdjustedProvider } from "../components/market/useAdjustedProvider";
import { formatCurrency } from "../utils/format";
import { useMarketSelection } from "../night/looks/marketSelection";
import { CursorContext } from "../components/market/sessionCursor";
import { usePowerOn, useArrival } from "../components/market/wallMotion";
import { DeferredInstrument } from "../components/market/DeferredInstrument";
import { compactWidth, phoneWidth, useMaxWidth } from "../components/market/compactLayout";
import { InstrumentFold } from "../components/market/InstrumentFold";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CaretDown } from "@phosphor-icons/react";
import { CalendarBlank, ChartLine, GlobeHemisphereWest } from "../components/market/terrainIcons";
import { fetchMarketHeatmap, fetchMarketOverview } from "../api/market";
import { useAuth } from "../context/useAuth";

import { MarketInstruments } from "../components/market/MarketInstruments";
import { IndexStrip } from "../components/market/IndexStrip";

import { MarketHeader, MarketFooter } from "../components/market/MarketShell";

import "../night/looks/terrain/fonts/fonts.css";
import "../market.css";
import "../marketTouch.css";

const loadHeatmap = () => import("../components/market/StockHeatmap").then((m) => m.StockHeatmap);
const loadActivity = () => import("../components/market/MarketActivity").then((m) => m.MarketActivity);
const loadNews = () => import("../components/market/MarketNews").then((m) => m.MarketNews);
const loadMarketPulse = () => import("../components/market/MarketPulse").then((m) => m.MarketPulse);
const loadCompanyResearch = () =>
  import("../components/market/CompanyResearch").then((m) => m.CompanyResearch);
const WatchlistPreview = lazy(() =>
  import("../components/Watchlists").then((m) => ({ default: m.WatchlistPreview })),
);
const loadWatchlists = () => import("../components/Watchlists").then((m) => m.Watchlists);
const loadDailyHistory = () => import("../components/DailyHistory").then((m) => m.DailyHistory);
const queryOptions = { refetchInterval: 300000, retry: false } as const;
const sessionDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function HistoryPreview() {
  const { rowCount, pending } = useAdjustedProvider();
  return (
    <span className="fold-preview history-preview">
      <em>{rowCount != null ? rowCount.toLocaleString("en-US") : pending ? "Loading" : "Unavailable"}</em>
      <small>Adjusted bars</small>
    </span>
  );
}

export function TerrainMarket() {
  const selection = useMarketSelection();
  const compact = useMaxWidth(compactWidth);
  const phone = useMaxWidth(phoneWidth);
  const { isAuthenticated } = useAuth();
  const [symbolInput, setSymbolInput] = selection.symbolInput;
  const [researchSymbol, setResearchSymbol] = selection.researchSymbol;
  const [selectedProxy, setProxy] = selection.proxy;
  const [previewProxy, setPreviewProxy] = useState<string | null>(null);
  const [pinnedSector, pinSector] = useState<string | null>(null);
  const [previewSector, setSector] = useState<string | null>(null);
  const linkedSector = previewSector ?? pinnedSector;
  const [linkedSymbol, setSymbol] = useState<string | null>(null);
  const { cursor } = selection;
  const [historyDraft, setHistoryDraft] = selection.historyDraft;
  const overview = useQuery({
    queryKey: ["market", "overview"],
    queryFn: fetchMarketOverview,
    ...queryOptions,
  });
  const heatmap = useQuery({
    queryKey: ["market", "heatmap"],
    queryFn: fetchMarketHeatmap,
    ...queryOptions,
  });
  const sectors = overview.data?.sectors ?? [];
  const asOf = overview.data?.as_of;
  const proxies = overview.data?.trends ?? [];
  const researchQuote = heatmap.data?.items.find((q) => q.symbol === researchSymbol);
  const greatestMove = Math.max(0.001, ...proxies.map((p) => Math.abs(p.change_percent)));
  const rising = proxies.filter((t) => t.change_percent > 0).length;
  const falling = proxies.filter((t) => t.change_percent < 0).length;
  const verdict =
    falling === proxies.length
      ? "Broad decline"
      : rising === proxies.length
        ? "Broad advance"
        : rising || falling
          ? "Mixed close"
          : "Flat close";
  useEffect(() => {
    const original = document.title;
    document.title = "Market overview · Sentinel Markets";
    return () => {
      document.title = original;
    };
  }, []);

  const wall = usePowerOn();
  const tools = useArrival<HTMLDivElement>();
  function inspectMover(symbol: string | null) {
    setSymbol(symbol);
    setSector(heatmap.data?.items.find((s) => s.symbol === symbol)?.sector ?? null);
  }
  const focusRequest = useRef<MutationObserver | null>(null);
  useEffect(() => () => focusRequest.current?.disconnect(), []);
  function prefill(id: string, setter: (v: string) => void, symbol: string) {
    setter(symbol);
    focusRequest.current?.disconnect();
    function focusField() {
      const field = document.getElementById(id);
      if (!field) return false;
      const disclosure = field.closest("details");
      if (disclosure) disclosure.open = true;
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: "center" });
      return true;
    }
    if (focusField()) return;
    const target = document.getElementById(
      id === "research-symbol" ? "company-research" : "daily-price-history-title",
    );
    const disclosure = target?.closest("details");
    if (disclosure) disclosure.open = true;
    target?.scrollIntoView({ block: "center" });
    const observer = new MutationObserver(() => {
      if (focusField()) observer.disconnect();
    });
    if (wall.current) observer.observe(wall.current, { subtree: true, childList: true });
    focusRequest.current = observer;
  }
  const movers = (
    <DeferredInstrument id="trending-movers" label="Trending movers" load={loadActivity}>
      {(Activity) => (
        <Activity
          quotes={heatmap.data}
          loading={heatmap.isLoading}
          refreshFailed={heatmap.isRefetchError}
          linkedSymbol={linkedSymbol}
          linkedSector={linkedSector}
          inspectMover={inspectMover}
        />
      )}
    </DeferredInstrument>
  );
  return (
    <CursorContext.Provider value={cursor}>
      <div
        onClickCapture={(event) => {
          if (!compact || !(event.target instanceof Element)) return;
          const href = event.target.closest("a")?.getAttribute("href");
          if (href?.startsWith("#")) {
            const details = document.getElementById(href.slice(1))?.closest("details");
            if (details) details.open = true;
          }
        }}
        ref={wall}
        className="market-desk"
        id="overview"
      >
        <a href="#market-content" className="desk-skip">
          Skip to market overview
        </a>
        <MarketHeader isAuthenticated={isAuthenticated} />
        <main id="market-content" tabIndex={-1} className="market-wrap market-main">
          <div className="market-mast">
            <div>
              <div className="eyebrow mast-label">
                <GlobeHemisphereWest size={13} /> {phone ? "U.S. equities" : "United States"} <i />{" "}
                {phone ? "Market overview" : "Equities"}
              </div>
              <h1>
                {phone && proxies.length ? verdict : "Market overview"}
                <span aria-hidden="true" className="mast-period">
                  .
                </span>
              </h1>
            </div>
            {proxies.length > 0 && (
              <div
                className="session-verdict"
                data-direction={
                  falling === proxies.length ? "down" : rising === proxies.length ? "up" : "mixed"
                }
              >
                <svg viewBox="0 0 44 27" role="img" aria-label="Index proxy session changes">
                  {proxies.map((t, i) => {
                    const v = t.change_percent / greatestMove;
                    return (
                      <rect
                        key={t.source_symbol}
                        x={(i * 44) / proxies.length}
                        y={v > 0 ? 13 - v * 12 : 13}
                        width={32 / proxies.length}
                        height={Math.max(1, Math.abs(v) * 12)}
                        fill={v < 0 ? "var(--desk-loss)" : v > 0 ? "var(--desk-gain)" : "#aaa"}
                      />
                    );
                  })}
                  <path d="M0 13H44" stroke="#7c7e80" />
                </svg>
                <div>
                  <b>{phone ? "Index ETFs" : verdict}</b>
                  <small>
                    {falling} lower · {rising} higher
                  </small>
                </div>
              </div>
            )}
            <div className="mast-date">
              <div className="session-label">
                <i /> End-of-day snapshot
              </div>
              <span>
                <CalendarBlank size={13} />
                {asOf && Number.isFinite(Date.parse(asOf)) ? (
                  <time dateTime={asOf}>{sessionDate.format(new Date(asOf))}</time>
                ) : (
                  "Awaiting snapshot"
                )}
              </span>
            </div>
          </div>
          <IndexStrip
            trends={overview.data?.trends ?? []}
            choose={setProxy}
            preview={previewProxy}
            onPreview={setPreviewProxy}
            onDate={cursor.set}
            loading={overview.isLoading}
          />
          <MarketInstruments
            movers={compact ? movers : null}
            sectors={sectors}
            heatmap={heatmap.data}
            loading={overview.isLoading}
            stockLoading={heatmap.isLoading}
            failed={overview.isError}
            sector={linkedSector}
            company={linkedSymbol}
            onCompany={inspectMover}
            onPin={pinSector}
            onSector={setSector}
            onDate={cursor.set}
          />
          <div className="wire-grid">
            <DeferredInstrument id="stock-heatmap" label="Stock heatmap" load={loadHeatmap}>
              {(StockHeatmap) => (
                <StockHeatmap
                  data={heatmap.data}
                  loading={heatmap.isLoading}
                  failed={heatmap.isError}
                  sectors={sectors}
                  sectorLoading={overview.isLoading}
                  linked={linkedSymbol ?? linkedSector}
                  sector={linkedSector}
                  onSector={setSector}
                  onInspect={(s) => {
                    setSymbol(s?.symbol ?? null);
                    setSector(s?.sector ?? null);
                  }}
                />
              )}
            </DeferredInstrument>
            {!compact && movers}
            <DeferredInstrument id="market-news" label="Market news" load={loadNews}>
              {(News) => <News />}
            </DeferredInstrument>
          </div>
          {compact && <span id="market-tools" className="tools-anchor" />}
          <InstrumentFold
            compact={compact}
            id="market-pulse"
            title="Market pulse"
            caption="Index comparisons and volume"
            preview={
              <span className="fold-preview pulse-preview" aria-label="Cached session returns">
                {proxies.length ? (
                  proxies.map((q) => (
                    <i
                      key={q.source_symbol}
                      title={q.source_symbol}
                      data-down={q.change_percent < 0}
                      style={{ height: Math.max(1, (16 * Math.abs(q.change_percent)) / greatestMove) }}
                    />
                  ))
                ) : (
                  <small>{overview.isLoading ? "Loading" : "Unavailable"}</small>
                )}
              </span>
            }
          >
            <DeferredInstrument id="market-pulse" label="Market pulse" load={loadMarketPulse}>
              {(MarketPulse) => (
                <MarketPulse
                  onDate={cursor.set}
                  selected={previewProxy ?? selectedProxy}
                  onPreview={setPreviewProxy}
                  setSelected={setProxy}
                  overview={overview.data}
                  loading={overview.isLoading}
                  failed={overview.isError}
                />
              )}
            </DeferredInstrument>
          </InstrumentFold>
          <InstrumentFold
            compact={compact}
            id="company-research"
            title="Company research"
            caption="Quotes, filings and risk"
            preview={
              <span className="fold-preview">
                <em>
                  {researchQuote && researchQuote.price > 0
                    ? formatCurrency(researchQuote.price)
                    : "Unavailable"}
                </em>
                <small>
                  {researchSymbol} · {researchQuote?.data_status ?? "cache"}
                </small>
              </span>
            }
          >
            <DeferredInstrument id="company-research" label="Company research" load={loadCompanyResearch}>
              {(CompanyResearch) => (
                <CompanyResearch
                  stocks={heatmap.data?.items ?? []}
                  linked={linkedSymbol}
                  sector={linkedSector}
                  onInspect={inspectMover}
                  symbol={researchSymbol}
                  setSymbol={setResearchSymbol}
                  draft={symbolInput}
                  setDraft={setSymbolInput}
                />
              )}
            </DeferredInstrument>
          </InstrumentFold>
          <div className="market-tools" ref={tools}>
            <InstrumentFold
              compact={compact}
              id="watchlists-title"
              title="Watchlists"
              caption="Saved symbols"
              preview={
                isAuthenticated ? (
                  <Suspense fallback={<small>Loading lists</small>}>
                    <WatchlistPreview />
                  </Suspense>
                ) : (
                  <span className="fold-preview access-preview">
                    <i aria-hidden="true" />
                    <small>Sign in</small>
                  </span>
                )
              }
            >
              <DeferredInstrument id="watchlists-title" label="Watchlists" load={loadWatchlists}>
                {(Watchlists) => (
                  <Watchlists
                    designed
                    onUseInChart={(s) => prefill("daily-history-symbol", setHistoryDraft, s)}
                    onUseInResearch={(s) => prefill("research-symbol", setSymbolInput, s)}
                  />
                )}
              </DeferredInstrument>
            </InstrumentFold>
            <details
              open={!compact || location.hash === "#daily-price-history-title"}
              className="desk-card history-tool"
              data-testid="market-history-entry"
            >
              <summary>
                <ChartLine size={22} />
                <span>
                  <span className="tool-title" id="daily-price-history-title" role="heading" aria-level={2}>
                    Daily price history
                  </span>
                  <small>Explore stored daily bars by symbol, source and adjustment.</small>
                </span>
                {compact && <HistoryPreview />}
                <CaretDown size={17} />
              </summary>
              <DeferredInstrument id="history-console" label="Daily price history" load={loadDailyHistory}>
                {(DailyHistory) => (
                  <DailyHistory
                    embedded
                    accountOverlays={isAuthenticated}
                    onValueChange={setHistoryDraft}
                    value={historyDraft}
                  />
                )}
              </DeferredInstrument>
            </details>
          </div>
        </main>
        <MarketFooter isAuthenticated={isAuthenticated} />
      </div>
    </CursorContext.Provider>
  );
}
