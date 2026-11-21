import { isAxiosError } from "axios";
import { apiClient } from "../../../api/client";
import type { Watchlist } from "../../../api/watchlists";

const outcomes = ["add", "existing", "invalid", "duplicate"] as const;
export type ImportOutcome = typeof outcomes[number];
export type ImportRow = { row: number; symbol: string; status: ImportOutcome };
export type ImportResult = { rows: ImportRow[]; added: number; watchlist: Watchlist };

export async function submitWatchlistImport(id: number, symbols: string[], dryRun: boolean): Promise<ImportResult> {
  const { data } = await apiClient.post<ImportResult>("/night/watchlist-import", {
    watchlist_id: id, symbols, dry_run: dryRun,
  });
  if (data?.watchlist?.id !== id || !Array.isArray(data.watchlist.symbols)
      || !Array.isArray(data.rows) || data.rows.length !== symbols.length
      || !data.rows.every((row, index) => row?.row === index + 2
        && typeof row.symbol === "string" && outcomes.includes(row.status))
      || data.added !== (dryRun ? 0 : data.rows.filter(row => row.status === "add").length)) {
    throw new Error("The import response could not be verified.");
  }
  return data;
}

export function importError(error: unknown, dryRun: boolean): string {
  const code = isAxiosError(error) ? error.response?.status : undefined;
  if (code === 404) return "This watchlist is unavailable. Choose another list.";
  if (code === 409) return "This watchlist has insufficient space. Preview again before importing.";
  if (code === 403) return "Only traders can import watchlist symbols.";
  return dryRun ? "The CSV preview could not be loaded. Try again." :
    "The import could not be confirmed. Preview again to check current membership.";
}
