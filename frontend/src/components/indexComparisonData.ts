import type { LineData, Time, WhitespaceData } from "lightweight-charts";

export const INDEX_PROXIES = [
  { symbol: "SPY", name: "S&P 500" },
  { symbol: "QQQ", name: "Nasdaq 100" },
  { symbol: "DIA", name: "Dow Jones" },
  { symbol: "IWM", name: "Russell 2000" },
] as const;

export const PULSE_RANGES = ["1m", "3m", "6m", "1y", "2y"] as const;

export type PulseChartRange = (typeof PULSE_RANGES)[number];

const SESSION_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CloseBar = {
  session_date: string;
  close: string;
};

export type NormalizedPoint = LineData<Time> | WhitespaceData<Time>;

export type NormalizedSeries = {
  points: NormalizedPoint[];
  firstClose: number;
  lastClose: number;
  changePercent: number;
  asOf: string;
  sessionCount: number;
  hasGap: boolean;
};

function sessionDay(value: string) {
  const match = SESSION_DATE.exec(value);
  if (!match) {
    return null;
  }
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(day) ? day / 86_400_000 : null;
}

function nextDate(value: string) {
  const day = sessionDay(value);
  if (day == null) {
    return null;
  }
  return new Date((day + 1) * 86_400_000).toISOString().slice(0, 10);
}

function missingWeekdays(startDay: number, endDay: number) {
  let count = 0;
  for (let day = startDay + 1; day < endDay; day += 1) {
    const weekday = new Date(day * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      count += 1;
    }
  }
  return count;
}

/**
 * Percent change from the first positive close in the window.
 * A break longer than a holiday weekend becomes a whitespace point so the line does not span it.
 */
export function normalizeCloses(bars: readonly CloseBar[]): NormalizedSeries | null {
  const ordered = bars
    .map((bar) => ({
      date: bar.session_date,
      close: Number(bar.close),
      day: sessionDay(bar.session_date),
    }))
    .filter((bar) => bar.day != null && Number.isFinite(bar.close) && bar.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (!first || !last || first.day == null) {
    return null;
  }

  const points: NormalizedPoint[] = [];
  let hasGap = false;
  for (let index = 0; index < ordered.length; index += 1) {
    const bar = ordered[index];
    const previous = ordered[index - 1];
    if (previous && bar.day != null && previous.day != null && missingWeekdays(previous.day, bar.day) > 1) {
      const breakDate = nextDate(previous.date);
      if (breakDate && breakDate < bar.date) {
        points.push({ time: breakDate });
        hasGap = true;
      }
    }
    points.push({
      time: bar.date,
      value: Number((((bar.close / first.close) - 1) * 100).toFixed(6)),
    });
  }

  return {
    points,
    firstClose: first.close,
    lastClose: last.close,
    changePercent: Number((((last.close / first.close) - 1) * 100).toFixed(6)),
    asOf: last.date,
    sessionCount: ordered.length,
    hasGap,
  };
}
