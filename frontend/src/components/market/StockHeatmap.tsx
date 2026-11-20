import { reducedMotion } from "../../marketLooks/preferences";
import { compactWidth, useMaxWidth } from "./compactLayout";
import { inspectEvents } from "./inspectEvents";
import { sectorName } from "./sectorName";
import { Select } from "../../design/Select";
import "./stockMatrix.css";
import { Fragment, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { SquaresFour } from "@phosphor-icons/react";
import type {
  MarketHeatmapItemResponse,
  MarketHeatmapResponse,
  MarketSectorResponse,
} from "../../types/schemas";
import { Card, EmptyState, Segmented, Skeleton } from "../../design/primitives";
import { formatCurrency, formatSignedPercent, formatUtcDateTime } from "../../utils/format";

const sizes = ["compact", "standard", "expanded"] as const;
type Scale = (typeof sizes)[number];
type Stock = MarketHeatmapItemResponse;
const weights = { mega: 12, large: 8, medium: 5, small: 4, micro: 3 };

function tileTone(value: number, stale = false) {
  if (stale || !Number.isFinite(value)) return "aged";
  if (value === 0) return "flat";
  const level = Math.abs(value) >= 3 ? 3 : Math.abs(value) > 0.75 ? 2 : 1;
  return `${value < 0 ? "loss" : "gain"}-${level}`;
}

function QuoteReadout({ reading, compact }: { reading: Stock; compact: boolean }) {
  return (
    <>
      <div className="quote-register">
        <b>{reading.symbol}</b>
        <strong>{formatCurrency(reading.price)}</strong>
        <span>{reading.company}</span>
      </div>
      <div className="quote-origin">
        {[
          reading.sector,
          reading.size + " cap",
          reading.data_status,
          reading.source,
          formatUtcDateTime(reading.as_of) ?? reading.as_of ?? "Date unavailable",
          reading.age_seconds != null && `Age ${reading.age_seconds}s`,
          reading.price_basis === "end_of_day_previous_close" && "End-of-day previous close",
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {compact && reading.detail_available && (
        <Link className="quote-detail-link" to={"/market/" + encodeURIComponent(reading.symbol)}>
          Open {reading.symbol}
        </Link>
      )}
    </>
  );
}

function StockMatrix({
  groups,
  compact,
  scale,
  linked,
  sector,
  inspected,
  inlineReading,
  select,
}: {
  groups: Map<string, Stock[]>;
  compact: boolean;
  scale: Scale;
  linked?: string | null;
  sector?: string | null;
  inspected?: string;
  inlineReading?: Stock;
  select: (stock: Stock | null) => void;
}) {
  return (
    <div className={`stock-matrix scale-${scale}${compact ? " touch-quotes" : ""}`}>
      {[...groups].map(([name, stocks], index) => (
        <Fragment key={name}>
          <section
            className="matrix-sector"
            aria-label={name}
            data-active={sectorName(sector) === sectorName(name)}
            style={{ "--delay": index * 45 + "ms" } as CSSProperties}
          >
            <header>
              <b>{name}</b>
              <span>{stocks.length}</span>
            </header>
            <div className="matrix-quotes">
              {stocks.map((stock) => {
                const stale = stock.data_status === "stale";
                const change = stale
                  ? "Stale"
                  : Number.isFinite(stock.change_percent)
                    ? formatSignedPercent(stock.change_percent)
                    : "Unavailable";
                const description = [
                  stock.company,
                  stock.size + " cap",
                  stock.data_status,
                  stock.source,
                  stock.as_of,
                  stock.age_seconds != null && `Age: ${stock.age_seconds}s`,
                  stock.price_basis === "end_of_day_previous_close" && "End-of-day previous close",
                ]
                  .filter(Boolean)
                  .join(" / ");
                const props = {
                  "data-tile": "stock:" + stock.symbol,
                  "data-testid": "heatmap-stock-" + stock.symbol,
                  "data-sector": sectorName(name),
                  "data-linked": linked === stock.symbol,
                  "aria-description": description,
                  className: "matrix-cell tone-" + tileTone(stock.change_percent, stale),
                  style: { "--weight": weights[stock.size] } as CSSProperties,
                  ...(!compact &&
                    inspectEvents(
                      () => select(stock),
                      () => select(null),
                    )),
                };
                const face = (
                  <>
                    <b>{stock.symbol}</b>
                    <span data-testid="heatmap-quote-status">{change}</span>
                  </>
                );
                return compact ? (
                  <button
                    key={stock.symbol}
                    type="button"
                    {...props}
                    aria-pressed={inspected === stock.symbol}
                    onClick={() => select(stock)}
                  >
                    {face}
                  </button>
                ) : stock.detail_available ? (
                  <Link
                    key={stock.symbol}
                    {...props}
                    aria-label={`${stock.symbol}, ${stock.company}, ${change}`}
                    to={`/market/${encodeURIComponent(stock.symbol)}`}
                  >
                    {face}
                  </Link>
                ) : (
                  <div key={stock.symbol} {...props} tabIndex={0}>
                    {face}
                  </div>
                );
              })}
            </div>
          </section>
          {inlineReading?.sector === name && (
            <div className="heat-inspect inline-inspect" data-reading="true">
              <QuoteReadout reading={inlineReading} compact />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function StockHeatmap({
  data,
  loading,
  failed,
  sectors,
  sectorLoading,
  linked,
  sector,
  onInspect,
  onSector,
}: {
  data?: MarketHeatmapResponse;
  loading: boolean;
  failed: boolean;
  sectors: MarketSectorResponse[];
  sectorLoading: boolean;
  linked?: string | null;
  sector?: string | null;
  onInspect?: (stock: Stock | null) => void;
  onSector?: (sector: string | null) => void;
}) {
  const region = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"Stocks" | "Sectors">("Stocks");
  const [scale, setScale] = useState<Scale>("standard");
  const compact = useMaxWidth(compactWidth);
  const [showAll, setShowAll] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const groups = useMemo(() => {
    const result = new Map<string, Stock[]>();
    for (const stock of data?.items ?? []) {
      const list = result.get(stock.sector) ?? [];
      list.push(stock);
      result.set(stock.sector, list);
    }
    for (const list of result.values())
      list.sort((a, b) => weights[b.size] - weights[a.size] || a.symbol.localeCompare(b.symbol));
    return result;
  }, [data]);
  const selected = selection && groups.has(selection) ? selection : "*";
  const stocks = useMemo(
    () => (selected === "*" ? [...groups.values()].flat() : (groups.get(selected) ?? [])),
    [groups, selected],
  );
  const ranked = useMemo(
    () =>
      compact
        ? [...stocks].sort((a, b) => weights[b.size] - weights[a.size] || a.symbol.localeCompare(b.symbol))
        : [],
    [stocks, compact],
  );
  const visibleGroups = useMemo(() => {
    const visible = compact && !showAll ? new Set(ranked.slice(0, 8)) : null;
    const result = new Map<string, Stock[]>();
    for (const [name, quotes] of groups) {
      if (selected !== "*" && selected !== name) continue;
      const items = visible ? quotes.filter((q) => visible.has(q)) : quotes;
      if (items.length) result.set(name, items);
    }
    return result;
  }, [compact, showAll, ranked, groups, selected]);
  const reading = data?.items.find((q) => q.symbol === (inspect ?? linked));
  const inlineReading = compact && showAll && mode === "Stocks" ? reading : undefined;
  function changeTiles(update: () => void) {
    if (!region.current?.animate || reducedMotion()) {
      update();
      return;
    }
    void import("./mosaicMotion").then(
      ({ moveTiles }) => moveTiles(region.current, update),
      update,
    );
  }
  function select(stock: Stock | null) {
    setInspect(stock?.symbol ?? null);
    onInspect?.(stock);
  }
  const count = data?.items.length ?? 0;
  const sectorStatus = sectors.length
    ? `${sectors.length} returned sector ${sectors.length === 1 ? "proxy" : "proxies"}`
    : sectorLoading
      ? "Loading sector cache"
      : "Sector quotes unavailable";
  const status =
    mode === "Sectors"
      ? sectorStatus
      : loading
        ? "Loading cache"
        : count
          ? `${count} returned ${count === 1 ? "quote" : "quotes"}`
          : "No cached quotes";
  return (
    <Card className="heat-panel">
      <div className="paper-head">
        <div>
          <div className="eyebrow">
            <SquaresFour size={14} /> Equity breadth
          </div>
          <h2 id="stock-heatmap">Stock heatmap</h2>
        </div>
        <Segmented
          label="Heatmap view"
          options={["Stocks", "Sectors"]}
          value={mode}
          onChange={(v) =>
            changeTiles(() => {
              setMode(v);
              select(null);
            })
          }
        />
      </div>
      <div className="heat-toolbar">
        {mode === "Stocks" && count > 0 ? (
          <Select
            label="Stock sector"
            value={selected ?? "*"}
            onValueChange={(value) => {
              changeTiles(() => {
                setSelection(value);
                setShowAll(false);
                select(null);
              });
            }}
          >
            {[...groups.keys()].map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option value="*">All sectors</option>
          </Select>
        ) : (
          <span>{mode === "Sectors" ? "ETF proxies" : "Cached stocks"}</span>
        )}
        <span className="heat-status" role="status">
          {status}
        </span>
      </div>
      <div className="heat-region" ref={region} role="region" aria-labelledby="stock-heatmap" tabIndex={0}>
        {mode === "Stocks" ? (
          count ? (
            <StockMatrix
              groups={visibleGroups}
              compact={compact}
              scale={scale}
              linked={linked}
              sector={sector}
              inspected={inspect ?? undefined}
              inlineReading={inlineReading}
              select={select}
            />
          ) : loading ? (
            <Skeleton label="Loading stock cache" className="mosaic-skeleton" />
          ) : (
            <EmptyState
              message="Stock heatmap unavailable"
              detail={failed ? "The stock cache could not be loaded." : "No stock quotes in the cache."}
            />
          )
        ) : sectors.length ? (
          <div className={`proxy-map scale-${scale}`}>
            {sectors.map((s, i) => (
              <div
                key={s.symbol}
                data-tile={"fund:" + s.symbol}
                data-sector={sectorName(s.sector)}
                tabIndex={0}
                onClick={compact ? () => onSector?.(s.sector) : undefined}
                data-linked={sectorName(sector ?? linked) === sectorName(s.sector)}
                {...inspectEvents(
                  () => onSector?.(s.sector),
                  () => onSector?.(null),
                )}
                className={`proxy-cell weight-${s.weight} tone-${tileTone(s.change_percent)}`}
                style={{ "--delay": `${i * 25}ms` } as CSSProperties}
              >
                <small>{s.symbol}</small>
                <b>{s.sector}</b>
                <span>
                  {s.change_percent === 0 ? "FLAT" : s.change_percent > 0 ? "UP" : "DOWN"}{" "}
                  {formatSignedPercent(s.change_percent)}
                </span>
                <small>{s.leaders.join(" · ")}</small>
              </div>
            ))}
          </div>
        ) : sectorLoading ? (
          <Skeleton label={sectorStatus} />
        ) : (
          <EmptyState message={sectorStatus} />
        )}
      </div>
      {compact && mode === "Stocks" && ranked.length > 8 && (
        <button className="expand-rows" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer quotes" : "All " + ranked.length + " quotes"}
        </button>
      )}
      {!inlineReading && (
        <div className="heat-inspect" data-reading={!!reading && mode === "Stocks"}>
          {reading && mode === "Stocks" ? (
            <QuoteReadout reading={reading} compact={compact} />
          ) : mode === "Stocks" ? (
            <>
              <b>Quote inspection</b>
              <span>
                {compact ? "Tap" : "Hover or focus"} a ticker for its price and source. Quotes are sized by
                cap tier within each sector.
              </span>
            </>
          ) : (
            "Session changes from cached sector ETF proxies."
          )}
        </div>
      )}
      <div className="heat-foot">
        <div className="heat-key" aria-label="Pattern density increases with the size of the move">
          <b>Move</b>
          <span>≤−3%</span>
          <i className="tone-loss-3" />
          <i className="tone-loss-2" />
          <i className="tone-loss-1" />
          <i className="tone-flat" />
          <i className="tone-gain-1" />
          <i className="tone-gain-2" />
          <i className="tone-gain-3" />
          <span>≥+3%</span>
        </div>
        <Segmented
          label="Heatmap size"
          value={scale}
          options={sizes}
          onChange={(v) => changeTiles(() => setScale(v))}
          format={(v) => v[0].toUpperCase() + v.slice(1)}
          accessibleLabel={(v) => `Set heatmap size to ${v}`}
        />
      </div>
      {failed && count > 0 && (
        <p className="data-note">Showing cached stock quotes. The latest refresh failed.</p>
      )}
      {data?.data_notice && <p className="data-note">{data.data_notice}</p>}
    </Card>
  );
}
