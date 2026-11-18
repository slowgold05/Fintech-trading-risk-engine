import type { HistoryBar, HistoryResponse } from "../../api/history";
import type { MarketSectorResponse } from "../../types/schemas";

export type TerrainPeriod = "1M" | "3M" | "1Y" | "2Y";
export type Reading = {
  date: string;
  close: number;
  high: number;
  low: number;
  volume: number | null;
  amplitude: number;
};
export type Ridge = {
  symbol: string;
  sector: string;
  points: Map<string, Reading>;
  low: number;
  high: number;
};
export type Surface = { dates: string[]; ridges: Ridge[]; ceiling: number };

function readings(bars: HistoryBar[], sessions: number, validDates: Map<string, boolean>) {
  const sorted = [...bars].sort((a, b) =>
    a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : 0,
  );
  const window: number[] = [];
  const points = new Map<string, Reading>();
  for (const bar of sorted) {
    const close = Number(bar.close),
      high = Number(bar.high),
      low = Number(bar.low);
    let valid = validDates.get(bar.session_date);
    if (valid === undefined) {
      valid = /^\d{4}-\d{2}-\d{2}$/.test(bar.session_date) && Number.isFinite(Date.parse(bar.session_date));
      validDates.set(bar.session_date, valid);
    }
    if (!valid) continue;
    if (!(low > 0 && high >= close && close >= low && Number.isFinite(high))) continue;
    window.push((100 * (high - low)) / close);
    if (window.length > sessions) window.shift();
    const volume = Number(bar.volume);
    if (window.length === sessions)
      points.set(bar.session_date, {
        date: bar.session_date,
        close,
        high,
        low,
        volume: bar.volume?.trim() && Number.isFinite(volume) && volume >= 0 ? volume : null,
        amplitude: window.reduce((sum, v) => sum + v, 0) / window.length,
      });
  }
  return points;
}

export function buildRidge(
  sector: MarketSectorResponse,
  history: HistoryResponse | undefined,
  provider: string | undefined,
  sessions: 1 | 5,
  validDates: Map<string, boolean>,
) {
  if (
    !history ||
    history.status === "unavailable" ||
    history.symbol !== sector.symbol ||
    history.provider !== provider ||
    history.adjustment_type !== "split_adjusted" ||
    history.range !== "2y"
  )
    return null;

  const points = readings(history.bars, sessions, validDates);
  return points.size > 1 ? { ...sector, points } : null;
}

export function buildRidges(
  sectors: MarketSectorResponse[],
  histories: (HistoryResponse | undefined)[],
  provider?: string,
  sessions: 1 | 5 = 5,
) {
  // Funds share a trading calendar. Validate each date once across the wall.
  const validDates = new Map<string, boolean>();
  const ridges = sectors.flatMap((sector, i) => {
    const ridge = buildRidge(sector, histories[i], provider, sessions, validDates);
    return ridge ? [ridge] : [];
  });
  // Keep sector positions stable as the window changes.
  return ridges.sort((a, b) => a.sector.localeCompare(b.sector));
}

export function windowSurface(raw: ReturnType<typeof buildRidges>, period: TerrainPeriod): Surface {
  const sessions = new Set<string>();
  for (const ridge of raw) for (const date of ridge.points.keys()) sessions.add(date);
  const dates = [...sessions].sort();
  if (!dates.length) return { dates: [], ridges: [], ceiling: 1 };
  const cutoff = new Date(dates[dates.length - 1] + "T00:00:00Z");
  const dayOfMonth = cutoff.getUTCDate();
  const months = { "1M": 1, "3M": 3, "1Y": 12, "2Y": 24 }[period];
  // Day zero of the following month gives the target month's last day.
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months + 1, 0);
  cutoff.setUTCDate(Math.min(dayOfMonth, cutoff.getUTCDate()));
  const start = cutoff.toISOString().slice(0, 10);
  const visibleDates = dates.filter((d) => d >= start);
  let ceiling = 0;
  const ridges = raw.flatMap((r) => {
    const points = new Map<string, Reading>();
    let low = Infinity,
      high = -Infinity,
      peak = 0;
    for (const [date, reading] of r.points) {
      if (date < start) continue;
      points.set(date, reading);
      low = Math.min(low, reading.low);
      high = Math.max(high, reading.high);
      peak = Math.max(peak, reading.amplitude);
    }
    if (points.size < 2) return [];
    ceiling = Math.max(ceiling, peak);
    return [{ ...r, points, low, high }];
  });
  return { dates: visibleDates, ridges, ceiling };
}
