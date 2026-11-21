export const HISTORY_RANGES = ["1m", "3m", "6m", "1y", "2y", "all"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export function isHistoryRange(value: unknown): value is HistoryRange {
  return HISTORY_RANGES.some((range) => range === value);
}
