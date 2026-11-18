import { compactWidth, useMaxWidth } from "./compactLayout";
import { SheetSelect } from "../../design/SheetSelect";
import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowsDownUp } from "@phosphor-icons/react";
import { Card, Segmented, TableRow, EmptyState, Skeleton } from "../../design/primitives";
import { fetchMarketTrending } from "../../api/market";
import type { MarketHeatmapResponse } from "../../types/schemas";
import { formatCurrency, formatSignedPercent, formatQuantity } from "../../utils/format";
import { useAdjustedProvider } from "./useAdjustedProvider";
import { inspectEvents } from "./inspectEvents";
import { sectorName } from "./sectorName";
import { useRowMotion } from "./wallMotion";

type TrendPlot = typeof import("./SymbolHistory").SymbolSparkline;

const queryOptions = { refetchInterval: 300000, retry: false } as const;
export function MarketActivity({
  quotes,
  loading,
  refreshFailed,
  linkedSymbol,
  linkedSector,
  inspectMover,
}: {
  quotes?: MarketHeatmapResponse;
  loading: boolean;
  refreshFailed: boolean;
  linkedSymbol: string | null;
  linkedSector: string | null;
  inspectMover: (s: string | null) => void;
}) {
  const compact = useMaxWidth(compactWidth);
  const [expanded, expand] = useState(false);
  const { provider } = useAdjustedProvider();
  const trending = useQuery({
    queryKey: ["market", "trending"],
    queryFn: fetchMarketTrending,
    ...queryOptions,
  });
  const [activitySource, setActivitySource] = useState<"Provider" | "Cached volume" | null>(null);
  const providerMovers = useMemo(
    () =>
      (trending.data?.most_active ?? []).map((m) => {
        const quote = quotes?.items.find((q) => q.symbol === m.symbol);
        const fields: string[] = [];
        const row = { ...m, cacheNote: "" };
        if (!quote) return row;
        if (!(Number(m.price) > 0) && quote.price > 0) {
          row.price = quote.price;
          fields.push("price");
        }
        if (
          quote.data_status !== "stale" &&
          m.change_percent == null &&
          Number.isFinite(quote.change_percent)
        ) {
          row.change_percent = quote.change_percent;
          fields.push("change");
        }
        if (quote.data_status !== "stale" && m.volume == null && Number.isFinite(quote.volume)) {
          row.volume = quote.volume;
          fields.push("volume");
        }
        if (fields.length)
          row.cacheNote = [
            `${m.symbol} ${fields.join(", ")} from the stock cache`,
            quote.data_status,
            quote.source,
            quote.as_of?.slice(0, 10),
            quote.price_basis === "end_of_day_previous_close" && "End-of-day previous close",
          ]
            .filter(Boolean)
            .join(" · ");
        return row;
      }),
    [trending.data, quotes],
  );
  const cachedMovers = (quotes?.items ?? [])
    .filter((item) => item.data_status !== "stale" && Number.isFinite(item.volume) && item.volume > 0)
    .sort((a, b) => b.volume - a.volume || a.symbol.localeCompare(b.symbol))
    .slice(0, 8);
  const activityView =
    activitySource ?? (providerMovers.length || !cachedMovers.length ? "Provider" : "Cached volume");
  const movers = activityView === "Provider" ? providerMovers : cachedMovers;
  const previewCount = compact ? 3 : 8;
  const visible = expanded ? movers : movers.slice(0, previewCount);
  const moverRows = useRowMotion(activityView + ":" + visible.map((m) => m.symbol).join("|"));
  const maxVolume = movers.reduce((max, m) => Math.max(max, m.volume ?? 0), 0);
  const hasMovers = movers.length > 0;
  const [Trend, setTrend] = useState<TrendPlot | "unavailable" | null>(null);
  useEffect(() => {
    const body = moverRows.current;
    if (Trend || !hasMovers || !body) return;
    let cancelled = false;
    function load() {
      void import("./SymbolHistory").then(
        (module) => {
          if (!cancelled) setTrend(() => module.SymbolSparkline);
        },
        () => {
          if (!cancelled) setTrend("unavailable");
        },
      );
    }
    let observer: IntersectionObserver | undefined;
    if (!window.IntersectionObserver) load();
    else {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          observer?.disconnect();
          load();
        }
      }, { rootMargin: "0px 0px -52px" });
      observer.observe(body);
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [hasMovers, moverRows, Trend]);
  const hasPrice = movers.some((m) => Number(m.price) > 0);
  const hasChange = movers.some((m) => m.change_percent != null);
  const hasVolume = movers.some((m) => m.volume != null);
  return (
    <Card className="movers-panel">
      <div className="paper-head">
        <div>
          <div className="eyebrow">
            <ArrowsDownUp size={13} /> Activity
          </div>
          <h2 id="trending-movers">Trending movers</h2>
        </div>
        {compact && cachedMovers.length ? (
          <SheetSelect
            label="Mover source"
            value={activityView}
            options={["Provider", "Cached volume"].map((text) => ({ text, value: text }))}
            onChange={(v) => {
              setActivitySource(v as typeof activityView);
              expand(false);
            }}
          />
        ) : cachedMovers.length ? (
          <Segmented
            label="Mover source"
            options={["Provider", "Cached volume"]}
            value={activityView}
            onChange={(value) => {
              setActivitySource(value);
              expand(false);
            }}
          />
        ) : (
          <ArrowsDownUp size={21} />
        )}
      </div>
      <p className="section-note">
        {activityView === "Provider"
          ? "Most active tickers from the market data provider."
          : "Ranked by reported share volume in the stock cache."}
        {provider && ` Trends use ${provider} split-adjusted closes (1M).`}
      </p>
      {((activityView === "Provider" && trending.isRefetchError) ||
        (activityView === "Cached volume" && refreshFailed)) &&
        movers.length > 0 && <p className="data-note">Refresh failed. Showing stored activity.</p>}
      {movers.length ? (
        <div className="movers-scroll" tabIndex={0} role="region" aria-labelledby="trending-movers">
          <table className="desk-table" id="activity-rankings">
            <thead>
              <tr>
                {[
                  "Symbol",
                  ...(hasPrice ? ["Price"] : []),
                  ...(hasChange ? ["Change"] : []),
                  ...(hasVolume ? ["Volume"] : []),
                  "Trend",
                ].map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody ref={moverRows}>
              {visible.map((m) => (
                <TableRow
                  key={m.symbol}
                  data-symbol={m.symbol}
                  tabIndex={0}
                  data-linked={
                    linkedSymbol === m.symbol ||
                    (!!linkedSector &&
                      quotes?.items.some(
                        (s) => s.symbol === m.symbol && sectorName(s.sector) === sectorName(linkedSector),
                      ))
                  }
                  {...inspectEvents(
                    () => inspectMover(m.symbol),
                    () => inspectMover(null),
                  )}
                >
                  <th scope="row">
                    {m.detail_available === true ? (
                      <Link to={`/market/${encodeURIComponent(m.symbol)}`}>{m.symbol}</Link>
                    ) : (
                      m.symbol
                    )}
                  </th>
                  {hasPrice && (
                    <td className="mover-price">
                      {m.price != null && m.price > 0 ? (
                        formatCurrency(m.price)
                      ) : (
                        <span className="mover-absent">
                          <span className="sr-only">Unavailable</span>
                          <i aria-hidden="true" />
                        </span>
                      )}
                    </td>
                  )}
                  {hasChange && (
                    <td
                      className={
                        "mover-change " +
                        (m.change_percent == null || m.change_percent === 0
                          ? ""
                          : m.change_percent < 0
                            ? "down"
                            : "up")
                      }
                    >
                      {m.change_percent != null ? (
                        formatSignedPercent(m.change_percent)
                      ) : (
                        <span className="mover-absent">
                          <span className="sr-only">Unavailable</span>
                          <i aria-hidden="true" />
                        </span>
                      )}
                    </td>
                  )}
                  {hasVolume && (
                    <td className="mover-volume">
                      {m.volume != null ? (
                        <>
                          {formatQuantity(m.volume)}
                          <i className="volume-meter" aria-hidden="true">
                            <i style={{ width: (maxVolume ? (100 * m.volume) / maxVolume : 0) + "%" }} />
                          </i>
                        </>
                      ) : (
                        <span className="mover-absent">
                          <span className="sr-only">Unavailable</span>
                          <i aria-hidden="true" />
                        </span>
                      )}
                    </td>
                  )}
                  <td className="mover-trace">
                    {Trend === "unavailable" ? (
                      <span className="mover-absent">
                        <span className="sr-only">Trend unavailable</span>
                        <i aria-hidden="true" />
                      </span>
                    ) : (
                      Trend && <Trend className="mover-spark" empty="compact" range="1m" symbol={m.symbol} />
                    )}
                  </td>
                </TableRow>
              ))}
            </tbody>
          </table>
          {movers.length > previewCount && (
            <button className="expand-rows" aria-controls="activity-rankings" aria-expanded={expanded} onClick={() => expand(!expanded)}>
              {expanded ? "Show fewer movers" : "All " + movers.length + " movers"}
            </button>
          )}
          {activityView === "Provider" &&
            providerMovers
              .filter((m) => m.cacheNote && visible.some((v) => v.symbol === m.symbol))
              .map((m) => (
                <p key={m.symbol} className="data-note">
                  {m.cacheNote}
                </p>
              ))}
        </div>
      ) : (activityView === "Provider" ? trending.isLoading : loading) ? (
        <Skeleton label="Loading most-active stocks" />
      ) : (
        <EmptyState
          message={activityView === "Provider" ? "Most-active data unavailable" : "No cached volume leaders"}
          detail={
            activityView !== "Provider"
              ? "No current cached quotes include volume."
              : trending.isError || trending.data?.errors?.length
                ? "The provider has no activity feed for this session."
                : "No most-active stocks were returned."
          }
        />
      )}
    </Card>
  );
}
