import { memo } from "react";
import type { MarketHeatmapItemResponse } from "../../types/schemas";
import { formatSignedPercent } from "../../utils/format";
import { directionOf, focusHandlers, sectorKey, useDraw, type Vars } from "../../ui/lib";
import { RollingNumber } from "../../ui/motion";
import { EmptyNote, Skeleton } from "../../ui/primitives";

type Item = MarketHeatmapItemResponse;

const BIN = 0.25;
const LIMIT = 4;
const COLUMNS = (LIMIT * 2) / BIN + 2;

function columnOf(change: number) {
  if (change < -LIMIT) return 0;
  if (change >= LIMIT) return COLUMNS - 1;
  return 1 + Math.floor((change + LIMIT) / BIN);
}

function medianOf(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Breadth as a dot matrix: one dot per cached stock, stacked by its day change in
 * quarter-percent steps. Solid dots rose, hollow dots fell.
 */
export const Breadth = memo(function Breadth({ items, loading }: { items: readonly Item[]; loading: boolean }) {
  const live = items.filter((item) => item.data_status !== "stale" && Number.isFinite(item.change_percent));
  const columns: Item[][] = Array.from({ length: COLUMNS }, () => []);
  for (const item of live) {
    columns[columnOf(item.change_percent)].push(item);
  }
  const tallest = Math.max(1, ...columns.map((column) => column.length));
  const up = live.filter((item) => item.change_percent > 0).length;
  const down = live.filter((item) => item.change_percent < 0).length;
  const flat = live.length - up - down;
  const median = medianOf(live.map((item) => item.change_percent));
  const draw = useDraw<HTMLDivElement>(live.length > 0);

  if (loading && live.length === 0) {
    return <Skeleton className="h-[148px] w-full" />;
  }

  if (live.length === 0) {
    return <EmptyNote detail="Breadth is counted from the cached stock quotes." message="No cached quotes to count" />;
  }

  const figures = [
    { label: "Advancing", value: String(up) },
    { label: "Declining", value: String(down) },
    { label: "Unchanged", value: String(flat) },
    { label: "Median", value: median == null ? "n/a" : formatSignedPercent(median) },
  ];

  return (
    <div className="breadth-layout grid gap-3">
      <dl className="grid grid-cols-4 gap-2">
        {figures.map((figure, order) => (
          <div className="min-w-0 border-l border-rule-2 pl-2" key={figure.label}>
            <dt className="lbl">{figure.label}</dt>
            <dd className="fig text-[18px] leading-6">
              <RollingNumber delay={700 + order * 90} value={figure.value} />
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <div
          aria-label={`Distribution of day changes: ${up} stocks up, ${down} down, ${flat} unchanged, in quarter-percent steps from -4% to +4%.`}
          className="br-cols relative"
          ref={draw}
          role="img"
          style={{ minHeight: `${Math.min(tallest, 14) * 11}px` }}
          {...focusHandlers}
        >
          {columns.map((column, c) => (
            <div className="br-col" key={c}>
              {column.map((item, r) => (
                <span
                  className="br-dot x-sym x-sec"
                  data-dir={directionOf(item.change_percent)}
                  data-sector={sectorKey(item.sector)}
                  data-sym={item.symbol}
                  key={item.symbol}
                  style={{ "--c": c, "--r": r } as Vars}
                />
              ))}
            </div>
          ))}
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-rule-2" />
        </div>
        <div aria-hidden="true" className="ruler mt-1" />
        <div aria-hidden="true" className="lbl mt-1 grid grid-cols-5 text-fg-4">
          <span>-4%</span>
          <span className="text-center">-2%</span>
          <span className="text-center">0</span>
          <span className="text-center">+2%</span>
          <span className="text-right">+4%</span>
        </div>
      </div>
      <p className="note">One dot per cached stock ({live.length}), in 0.25% steps; the end columns hold moves beyond 4%. Solid rose, hollow fell.</p>
    </div>
  );
});
