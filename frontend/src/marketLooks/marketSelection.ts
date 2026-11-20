import { createContext, useContext, useState } from "react";
import { createSessionCursor } from "../components/market/sessionCursor";
import type { PulseChartRange } from "../components/indexComparisonData";

export function useMarketState() {
  const symbolInput = useState("NVDA");
  const researchSymbol = useState("NVDA");
  const historyDraft = useState("");
  const proxy = useState("SPY");
  const range = useState<PulseChartRange | "session" | null>(null);
  const [cursor] = useState(createSessionCursor);
  return { symbolInput, researchSymbol, historyDraft, proxy, range, cursor };
}
export const MarketSelection = createContext<ReturnType<typeof useMarketState>|null>(null);
export function useMarketSelection() {
  const state = useContext(MarketSelection);
  if (!state) throw new Error("Market selection requires the market route");
  return state;
}
