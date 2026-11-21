import { phoneWidth, useMaxWidth } from "./compactLayout";
import { inspectEvents } from "./inspectEvents";
import { useSessionPaint } from "./sessionCursor";
import { memo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartLineUp } from "./terrainIcons";
import type { MarketTrendResponse } from "../../types/schemas";
import { Figure, Skeleton, Tooltip } from "../../design/primitives";
import { formatCurrency, formatSignedPercent } from "../../utils/format";
import { proxyHistoryQuery } from "../indexComparisonData";
import { useAdjustedProvider } from "./useAdjustedProvider";

const IndexTile = memo(function IndexTile({
  phone,
  provider,
  pending,
  trend,
  choose,
  preview,
  onPreview,
  onDate,
}: {
  phone: boolean;
  provider: string | undefined;
  pending: boolean;
  trend: MarketTrendResponse;
  choose: (s: string) => void;
  preview: string | null;
  onPreview: (s: string | null) => void;
  onDate: (date: string | null) => void;
}) {
  const [inspecting, setInspecting] = useState(false);
  const { data, isLoading } = useQuery({
    ...proxyHistoryQuery(trend.source_symbol, provider ?? "massive", "split_adjusted", "3m"),
    enabled: !!provider,
  });
  const bars =
    data?.symbol === trend.source_symbol &&
    data.provider === provider &&
    data.adjustment_type === "split_adjusted" &&
    data.range === "3m" &&
    data.status !== "unavailable"
      ? data.bars
          .filter((b) => Number(b.close) > 0)
          .sort((a, b) => a.session_date.localeCompare(b.session_date))
      : [];
  const values = bars.map((b) => Number(b.close)),
    min = Math.min(...values),
    max = Math.max(...values);
  const y = (v: number) => 32 - ((v - min) / (max - min || 1)) * 27;
  const x = (i: number) => 1 + (i * 111) / Math.max(1, bars.length - 1);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const rule = useRef<SVGGElement>(null);
  const detail = useRef<HTMLSpanElement>(null);
  useSessionPaint((date) => {
    const i = date ? bars.findIndex((b) => b.session_date === date) : -1;
    if (rule.current) {
      rule.current.style.display = i < 0 ? "none" : "";
      if (i >= 0) {
        rule.current.setAttribute("transform", `translate(${x(i)} 0)`);
        rule.current.lastElementChild?.setAttribute("cy", String(y(values[i])));
      }
    }
    if (detail.current)
      detail.current.textContent =
        i >= 0 ? bars[i].session_date + " · " + formatCurrency(values[i]) : "Cached ETF quote · USD";
  });
  return (
    <a
      href="#market-pulse"
      className="index-tile"
      data-linked={preview === trend.source_symbol}
      {...inspectEvents(
        () => {
          setInspecting(true);
          onPreview(trend.source_symbol);
        },
        () => {
          setInspecting(false);
          onPreview(null);
          onDate(null);
        },
      )}
      onClick={() => choose(trend.source_symbol)}
      aria-label={`Compare ${trend.name} using ${trend.source_symbol}`}
      data-testid={`market-index-${trend.source_symbol}`}
    >
      <div className="index-name">
        <b>{trend.source_symbol}</b>
        <span>{trend.name}</span>
      </div>
      <strong>{phone ? formatCurrency(trend.value) : <Figure value={formatCurrency(trend.value)} />}</strong>
      <span
        className={
          trend.change_percent < 0
            ? "index-delta down"
            : trend.change_percent > 0
              ? "index-delta up"
              : "index-delta"
        }
      >
        {trend.change_percent < 0 ? "↘" : trend.change_percent > 0 ? "↗" : "→"}{" "}
        {formatSignedPercent(trend.change_percent)}
      </span>
      <div
        className="index-trace"
        onPointerMove={(e) => {
          if (!bars.length || e.pointerType === "touch") return;
          const rect = e.currentTarget.getBoundingClientRect();
          const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onDate(bars[Math.round(f * (bars.length - 1))].session_date);
        }}
        onPointerLeave={() => onDate(null)}
      >
        {values.length > 1 ? (
          <svg
            viewBox="0 0 114 39"
            preserveAspectRatio="none"
            role="img"
            aria-label={trend.source_symbol + " three-month split-adjusted closes, " + provider}
          >
            <path d={line + " L112 39 L1 39Z"} fill="#d5d5cf0d" />
            <path
              className="trace-ink"
              d={line}
              pathLength="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle
              cx={x(values.length - 1)}
              cy={y(values.at(-1)!)}
              r="2.5"
              fill={
                values.at(-1)! < values[0]
                  ? "var(--desk-loss)"
                  : values.at(-1)! > values[0]
                    ? "var(--desk-gain)"
                    : "#bbb"
              }
            />
            <g ref={rule} style={{ display: "none" }} stroke="var(--desk-accent)">
              <path d="M0 0v39" strokeDasharray="2 2" />
              <circle r="2" />
            </g>
          </svg>
        ) : isLoading || pending ? (
          <Skeleton className="spark-skeleton" label="Loading index close history" />
        ) : (
          <small>History unavailable</small>
        )}
      </div>
      {inspecting && (
        <Tooltip>
          <b>{trend.source_symbol} · index fund proxy</b>
          <br />
          <span ref={detail}>Cached ETF quote · USD</span>
          <br />
          {bars.length
            ? `3M · ${provider} split-adjusted · ${bars.at(-1)!.session_date}`
            : "Stored history unavailable"}
        </Tooltip>
      )}
    </a>
  );
});
export function IndexStrip({
  trends,
  choose,
  preview,
  onPreview,
  onDate,
  loading,
}: {
  trends: MarketTrendResponse[];
  choose: (s: string) => void;
  preview: string | null;
  onPreview: (s: string | null) => void;
  onDate: (date: string | null) => void;
  loading: boolean;
}) {
  const phone = useMaxWidth(phoneWidth);
  const { provider, pending } = useAdjustedProvider();
  return (
    <section className="index-strip" aria-label="End-of-day index fund proxies">
      <div className="strip-caption">
        <ChartLineUp size={20} />
        <span>
          Index
          <br />
          proxies
        </span>
      </div>
      {trends.length ? (
        trends.map((t) => (
          <IndexTile
            phone={phone}
            provider={provider}
            pending={pending}
            key={t.source_symbol}
            trend={t}
            choose={choose}
            preview={preview}
            onPreview={onPreview}
            onDate={onDate}
          />
        ))
      ) : loading ? (
        <Skeleton label="Loading index proxies" />
      ) : (
        <span className="index-missing">No cached index fund quotes</span>
      )}
    </section>
  );
}
