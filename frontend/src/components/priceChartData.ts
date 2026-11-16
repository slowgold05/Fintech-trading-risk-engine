import type { HistoryBar, HistoryCoverageStatus } from "../api/history";
import { formatCurrency, formatQuantity } from "../utils/format";

export const CHART_RANGES = ["1M", "3M", "6M", "YTD", "1Y", "2Y"] as const;

export type ChartRange = (typeof CHART_RANGES)[number];

export type ChartType = "line" | "candlestick";

const RANGE_MONTHS: Record<Exclude<ChartRange, "YTD">, number> = {
  "1M": -1,
  "3M": -3,
  "6M": -6,
  "1Y": -12,
  "2Y": -24,
};

const VOLUME_UP = "rgba(103, 222, 170, 0.75)";
const VOLUME_DOWN = "rgba(240, 122, 120, 0.75)";

export type PlottedBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openText: string;
  highText: string;
  lowText: string;
  closeText: string;
  volumeText: string;
};

export type WhitespacePoint = { time: string };

export type CandlePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type LinePoint = { time: string; value: number };

export type VolumePoint = { time: string; value: number; color: string };

export type YearStats = {
  high: number | null;
  low: number | null;
  averageVolume: number | null;
};

export function rangeLabel(range: ChartRange): string {
  switch (range) {
    case "1M":
      return "1 month";
    case "3M":
      return "3 months";
    case "6M":
      return "6 months";
    case "YTD":
      return "year to date";
    case "1Y":
      return "1 year";
    case "2Y":
      return "2 years";
  }
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftMonths(isoDate: string, months: number): string | null {
  const date = parseIsoDate(isoDate);
  if (!date) return null;
  const day = date.getUTCDate();
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, last));
  return formatIsoDate(shifted);
}

function addDays(isoDate: string, days: number): string | null {
  const date = parseIsoDate(isoDate);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

/**
 * True when the server compared the returned sessions against the NYSE calendar and
 * found none missing. A weekday without a bar is then a market holiday, not a hole.
 */
export function sessionsVerified(coverageStatus: HistoryCoverageStatus | undefined): boolean {
  return coverageStatus === "complete" || coverageStatus === "unexpected_sessions";
}

function weekdaysWithoutBar(previous: string, next: string): string[] {
  const missing: string[] = [];
  let cursor = addDays(previous, 1);
  while (cursor && cursor < next) {
    const date = parseIsoDate(cursor);
    const day = date?.getUTCDay();
    if (day !== 0 && day !== 6) missing.push(cursor);
    const nextCursor = addDays(cursor, 1);
    if (!nextCursor || nextCursor <= cursor) break;
    cursor = nextCursor;
  }
  return missing;
}

function uniqueSorted(bars: readonly HistoryBar[]): HistoryBar[] {
  const byDate = new Map<string, HistoryBar>();
  for (const bar of bars) {
    if (!parseIsoDate(bar.session_date)) continue;
    byDate.set(bar.session_date, bar);
  }
  return [...byDate.values()].sort((left, right) => left.session_date.localeCompare(right.session_date));
}

export function sliceBars(
  bars: readonly HistoryBar[],
  range: ChartRange,
  endDate: string,
): HistoryBar[] {
  if (!parseIsoDate(endDate)) return [];
  const start = range === "YTD"
    ? `${endDate.slice(0, 4)}-01-01`
    : shiftMonths(endDate, RANGE_MONTHS[range]);
  if (!start) return [];
  return uniqueSorted(bars).filter(
    (bar) => bar.session_date >= start && bar.session_date <= endDate,
  );
}

function plottedBar(bar: HistoryBar): PlottedBar | null {
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  const volume = Number(bar.volume);
  if (![open, high, low, close, volume].every((value) => Number.isFinite(value))) return null;
  return {
    time: bar.session_date,
    open,
    high,
    low,
    close,
    volume,
    openText: formatCurrency(open),
    highText: formatCurrency(high),
    lowText: formatCurrency(low),
    closeText: formatCurrency(close),
    volumeText: formatQuantity(volume),
  };
}

export function buildSeries(
  bars: readonly HistoryBar[],
  coverageStatus?: HistoryCoverageStatus,
): {
  plotted: PlottedBar[];
  candles: Array<CandlePoint | WhitespacePoint>;
  line: Array<LinePoint | WhitespacePoint>;
  volume: Array<VolumePoint | WhitespacePoint>;
  gapCount: number;
} {
  const plotted = uniqueSorted(bars).flatMap((bar) => {
    const next = plottedBar(bar);
    return next ? [next] : [];
  });
  const candles: Array<CandlePoint | WhitespacePoint> = [];
  const line: Array<LinePoint | WhitespacePoint> = [];
  const volume: Array<VolumePoint | WhitespacePoint> = [];
  // The coverage status covers the whole requested window, so a verified window has no
  // missing session in any slice of it. Without that check the client cannot tell a
  // market holiday from a missing session, so every weekday without a bar stays a gap.
  const drawGaps = !sessionsVerified(coverageStatus);
  let gapCount = 0;
  let previous: PlottedBar | null = null;
  for (const bar of plotted) {
    if (previous && drawGaps) {
      // A whitespace point has a time and no price, so the line breaks instead of bridging the hole.
      for (const time of weekdaysWithoutBar(previous.time, bar.time)) {
        gapCount += 1;
        candles.push({ time });
        line.push({ time });
        volume.push({ time });
      }
    }
    candles.push({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    });
    line.push({ time: bar.time, value: bar.close });
    volume.push({
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? VOLUME_UP : VOLUME_DOWN,
    });
    previous = bar;
  }
  return { plotted, candles, line, volume, gapCount };
}

export function trailingYearStats(bars: readonly HistoryBar[], endDate: string): YearStats {
  const window = sliceBars(bars, "1Y", endDate);
  let high: number | null = null;
  let low: number | null = null;
  let volumeSum = 0;
  let volumeCount = 0;
  for (const bar of window) {
    const nextHigh = Number(bar.high);
    const nextLow = Number(bar.low);
    const nextVolume = Number(bar.volume);
    if (Number.isFinite(nextHigh)) high = high == null ? nextHigh : Math.max(high, nextHigh);
    if (Number.isFinite(nextLow)) low = low == null ? nextLow : Math.min(low, nextLow);
    if (Number.isFinite(nextVolume)) {
      volumeSum += nextVolume;
      volumeCount += 1;
    }
  }
  return {
    high,
    low,
    averageVolume: volumeCount > 0 ? volumeSum / volumeCount : null,
  };
}

export function chartSummary(
  symbol: string,
  plotted: readonly PlottedBar[],
  gapCount: number,
  range: ChartRange,
  coverageStatus?: HistoryCoverageStatus,
): string {
  const label = rangeLabel(range);
  if (plotted.length === 0) {
    return `No cached daily bars for ${symbol} in the ${label} range.`;
  }
  const sessions = `${plotted.length} session${plotted.length === 1 ? "" : "s"}`;
  let gaps: string;
  if (sessionsVerified(coverageStatus)) {
    gaps = "No trading sessions are missing against the NYSE calendar.";
  } else if (gapCount === 0) {
    gaps = "Every weekday in this range has a bar.";
  } else {
    // Holidays cannot be told apart from missing sessions here, so the count says so.
    gaps = `${gapCount} weekday${gapCount === 1 ? "" : "s"} without a bar ${gapCount === 1 ? "is shown as a gap" : "are shown as gaps"} and not filled in. That count includes market holidays.`;
  }
  return `${symbol} daily prices, ${label}, ${plotted[0].time} to ${plotted[plotted.length - 1].time}, ${sessions}. ${gaps}`;
}
