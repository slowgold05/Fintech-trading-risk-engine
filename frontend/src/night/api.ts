import type { QueryClient } from "@tanstack/react-query";

export type Decimal = string;
export type SessionDate = string;
export type Utc = string;
export type Coverage = "available" | "partial" | "missing" | "stale";
export type Provenance = {
  provider: string;
  basis: "raw" | "split_adjusted" | "filing" | "publisher";
  session_date: SessionDate | null;
  observed_at: Utc | null;
  coverage: Coverage;
};
export type Page<T> = { items: T[]; next_cursor: string | null };
export type NightError = { detail: { code: string; message: string; fields?: Record<string,string> } };

export const keys = {
  me: ["me"] as const,
  market: (resource: string) => ["market", resource] as const,
  universe: (viewer: number | "public", term: string, limit = 100, offset = 0) => ["universe", viewer, term, limit, offset] as const,
  quote: (symbol: string) => ["quote", symbol] as const,
  history: (symbol: string, provider: string, adjustment: string, range: string) => ["history", symbol, "1d", provider, adjustment, range] as const,
  indicators: (symbol: string, provider: string, adjustment: string, range: string, name: string, period: number) => ["indicators",symbol,"1d",provider,adjustment,range,name,period] as const,
  account: (userId: number, resource: string, ...args: unknown[]) => ["acct",userId,resource,...args] as const,
  feature: (feature: string, params: unknown) => ["night",feature,params] as const,
};

const executionReads = new Set(["holding-lots","portfolio-review","portfolio","performance","allocation","attribution","risk","orders","receipt","trades"]);
const legacyReads = new Set(["portfolio","positions","performance","orders","order-detail","trades","risk","risk-detail","trade-risk","dashboard","portfolio-performance"]);

export function refreshExecution(client: QueryClient, owner?: number, reset = false) {
  return client.invalidateQueries({ predicate: ({ queryKey: [key,id,resource] }) =>
    key === "acct" ? (owner == null || owner === id) && (reset || executionReads.has(String(resource))) :
      legacyReads.has(String(key)) || (reset && key === "me")
  });
}
