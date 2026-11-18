import "./pulse.css";
import { inspectEvents } from "./inspectEvents";
import { useArrival } from "./wallMotion";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pulse, ArrowDownRight, ArrowUpRight, CaretDown, Clock, Minus } from "@phosphor-icons/react";
import type { MarketOverviewResponse, MarketTrendResponse } from "../../types/schemas";
import { formatCurrency, formatSignedPercent, formatUtcDateTime } from "../../utils/format";
import { Badge, EmptyState, Figure, Segmented, Skeleton } from "../../design/primitives";
import { changeView } from "../../design/changeView";
import { useAdjustedProvider } from "./useAdjustedProvider";
import { IndexComparisonChart } from "../IndexComparisonChart";
import { INDEX_PROXIES, proxyHistoryQuery, PULSE_RANGES, type PulseChartRange } from "../indexComparisonData";

function SessionReturns({
  trends,
  selected,
  onSelect,
  onPreview,
}: {
  trends: MarketTrendResponse[];
  selected: string;
  onSelect: (symbol: string) => void;
  onPreview: (s: string | null) => void;
}) {
  const values = trends.map((t) => t.change_percent);
  const largest = Math.max(...values.map(Math.abs));
  const unit = largest > 0 ? 10 ** Math.floor(Math.log10(largest)) : 1;
  const limit = ((Math.ceil(largest / (unit / 4)) || 1) * unit) / 4;
  const left = Math.min(...values) < 0 ? -limit : 0;
  const right = Math.max(...values) > 0 || left === 0 ? limit : 0;
  const zero = (-left / (right - left)) * 100;
  const ordered = [...trends].sort((a, b) => b.change_percent - a.change_percent);
  return (
    <div className="session-plot">
      <div className="plot-heading">
        <span>Session returns</span>
        <span>Change, %</span>
      </div>
      <div className="return-list" aria-label="Index ETF session returns">
        {trends.map((t, index) => {
          const negative = t.change_percent < 0;
          const width = (Math.abs(t.change_percent) / (right - left)) * 100;
          return (
            <button
              type="button"
              key={t.source_symbol}
              className="return-row"
              aria-pressed={selected === t.source_symbol}
              aria-label={`Inspect ${t.source_symbol}, ${t.name}, ${formatSignedPercent(t.change_percent)}`}
              {...inspectEvents(
                () => onPreview(t.source_symbol),
                () => onPreview(null),
              )}
              onClick={() => onSelect(t.source_symbol)}
            >
              <span className="plot-symbol">{t.source_symbol}</span>
              <span className="return-track" aria-hidden="true">
                <i className="zero-line" style={{ left: `${zero}%` }} />
                <i
                  className={`return-bar ${negative ? "fall" : "rise"}`}
                  style={
                    {
                      left: `${negative ? zero - width : zero}%`,
                      width: `${width}%`,
                      "--delay": `${135 + index * 85}ms`,
                    } as CSSProperties
                  }
                />
              </span>
              <span className={negative ? "loss-text" : t.change_percent > 0 ? "gain-text" : ""}>
                <Figure value={formatSignedPercent(t.change_percent)} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="gauge-axis" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => {
          const tick = left + ((right - left) * i) / 4;
          return <span key={i}>{Number(tick.toFixed(3))}%</span>;
        })}
      </div>
      {ordered.length > 1 && (
        <div className="session-spread">
          <span>
            Session spread{" "}
            <small>
              {ordered[0].source_symbol} / {ordered.at(-1)!.source_symbol}
            </small>
          </span>
          <b>{(ordered[0].change_percent - ordered.at(-1)!.change_percent).toFixed(2)} pp</b>
        </div>
      )}
    </div>
  );
}

export function MarketPulse({
  overview,
  loading,
  failed,
  selected,
  setSelected,
  onPreview,
  onDate,
}: {
  overview?: MarketOverviewResponse;
  loading: boolean;
  failed: boolean;
  onDate: (date: string | null) => void;
  selected: string;
  setSelected: (symbol: string) => void;
  onPreview: (s: string | null) => void;
}) {
  const arrival = useArrival<HTMLElement>();
  const { provider } = useAdjustedProvider();
  const [requestedRange, setRange] = useState<PulseChartRange | "session" | null>(null);
  const range = requestedRange ?? (provider ? "3m" : "session");
  const client = useQueryClient();
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const [pendingRange, setPendingRange] = useState<PulseChartRange | null>(null);
  async function chooseRange(next: PulseChartRange | "session") {
    const turn = ++sequence.current;
    if (next === range || next === "session") {
      setPendingRange(null);
      changeView(() => setRange(next), "pulse");
      return;
    }
    setPendingRange(next);
    await Promise.all(
      INDEX_PROXIES.map((p) =>
        client.prefetchQuery(proxyHistoryQuery(p.symbol, provider ?? "massive", "split_adjusted", next)),
      ),
    );
    if (turn !== sequence.current) return;
    changeView(() => {
      if (turn !== sequence.current) return;
      setRange(next);
      setPendingRange(null);
    }, "pulse");
  }
  const trends = (overview?.trends ?? []).slice(0, 4);
  const active = trends.find((t) => t.source_symbol === selected) ?? trends[0];
  const lower = trends.filter((t) => t.change_percent < 0).length;
  const higher = trends.filter((t) => t.change_percent > 0).length;
  const unchanged = trends.length - lower - higher;
  const breadth =
    lower === trends.length
      ? `${lower} of ${trends.length} proxies declined`
      : higher === trends.length
        ? `${higher} of ${trends.length} proxies advanced`
        : [`${higher} advanced`, `${lower} declined`, unchanged ? `${unchanged} unchanged` : null]
            .filter(Boolean)
            .join(" · ");
  const latest = formatUtcDateTime(overview?.as_of);
  const Direction =
    active && active.change_percent < 0
      ? ArrowDownRight
      : active && active.change_percent > 0
        ? ArrowUpRight
        : Minus;
  return (
    <section ref={arrival} className="pulse-panel" aria-labelledby="market-pulse">
      <div className="pulse-head">
        <div className="panel-title">
          <span className="pulse-icon">
            <Pulse size={23} weight="bold" />
          </span>
          <h2 id="market-pulse">Market pulse</h2>
        </div>
        <Segmented
          label="Market pulse range"
          value={pendingRange ?? range}
          options={["session", ...PULSE_RANGES]}
          onChange={(v) => void chooseRange(v)}
          format={(v) => (v === "session" ? "1D" : v.toUpperCase())}
          accessibleLabel={(v) => `Market pulse range ${v === "session" ? "1D" : v.toUpperCase()}`}
        />
      </div>
      <div className="pulse-view" aria-busy={pendingRange !== null}>
        {pendingRange && (
          <div className="range-pending" role="status">
            Loading {pendingRange.toUpperCase()} · showing {range === "session" ? "1D" : range.toUpperCase()}
          </div>
        )}
        <div className="pulse-session">
          <div className="pulse-focus">
            <div className="focus-quote">
              {active ? (
                <>
                  <div className="quote-name">
                    <h3>{active.name}</h3>
                    <Badge>{active.source_symbol} ETF</Badge>
                  </div>
                  <div className="quote-price">
                    <Figure value={formatCurrency(active.value)} />
                  </div>
                  <div className="quote-delta">
                    <span
                      className={
                        active.change_percent < 0 ? "loss-chip" : active.change_percent > 0 ? "gain-chip" : ""
                      }
                    >
                      <Direction size={16} />
                      <Figure value={formatSignedPercent(active.change_percent)} />
                    </span>
                    <span>
                      {active.change < 0 ? "−" : "+"}
                      {formatCurrency(Math.abs(active.change))}
                    </span>
                  </div>
                  <p>
                    Change from previous close <span>·</span> USD
                  </p>
                </>
              ) : loading ? (
                <Skeleton className="quote-skeleton" label="Loading quote cache" />
              ) : (
                <EmptyState
                  message="Market quotes unavailable"
                  detail={
                    failed
                      ? "The latest snapshot could not be loaded."
                      : "No index quotes in the market cache."
                  }
                />
              )}
            </div>
            {range !== "session" && trends.length > 0 && (
              <SessionReturns
                selected={active.source_symbol}
                trends={trends}
                onSelect={setSelected}
                onPreview={onPreview}
              />
            )}
          </div>
          {range !== "session" ? (
            <IndexComparisonChart
              showVolume
              onDate={onDate}
              provider={provider ?? "massive"}
              selected={active?.source_symbol ?? selected}
              onSelect={setSelected}
              onPreview={onPreview}
              quotes={trends.map((t) => ({
                symbol: t.source_symbol,
                value: t.value,
                changePercent: t.change_percent,
              }))}
              range={range}
            />
          ) : trends.length ? (
            <SessionReturns
              selected={active.source_symbol}
              trends={trends}
              onSelect={setSelected}
              onPreview={onPreview}
            />
          ) : loading ? (
            <Skeleton className="gauge-skeleton" label="Loading session returns" />
          ) : (
            <div className="empty-plot">Session returns appear with the next cached close.</div>
          )}
        </div>
      </div>
      <div className="pulse-foot">
        <Badge>
          <Clock size={14} />{" "}
          {failed && overview ? "Cached snapshot · refresh failed" : "End-of-day snapshot"}
        </Badge>
        {trends.length > 0 && (
          <div className="close-breadth">
            <span aria-hidden="true">
              {trends.map((t) => (
                <i
                  key={t.source_symbol}
                  className={
                    t.change_percent < 0 ? "declined" : t.change_percent > 0 ? "advanced" : "unchanged"
                  }
                />
              ))}
            </span>
            {breadth}
          </div>
        )}
        <details>
          <summary>
            Data notes <CaretDown size={12} />
          </summary>
          <div className="pulse-notes">
            <p>
              <span className="touch-data-note">
                The index strip pairs cached USD quotes with three months of split-adjusted closes when
                available.{" "}
              </span>
              SPY, QQQ, DIA and IWM are ETF proxies. The daily view compares cached provider changes.
              Historical ranges use split-adjusted closes from {provider ?? "massive"}.
            </p>
            <p>Latest cached quote: {latest ?? "unavailable"}. Individual quotes may be older.</p>
            {overview?.data_notice && <p>{overview.data_notice}</p>}
          </div>
        </details>
      </div>
    </section>
  );
}
