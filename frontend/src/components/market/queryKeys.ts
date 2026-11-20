export const marketKeys = {
  me: ["me"] as const,
  universe: (viewer: number | "public", term: string, limit: number) =>
    ["market", "universe", viewer, term, limit] as const,
  history: (symbol: string, provider: string, adjustment: string, range: string) =>
    ["history", symbol, "1d", provider, adjustment, range] as const,
  watchlists: (ownerId: number) => ["market", "watchlists", ownerId] as const,
};
