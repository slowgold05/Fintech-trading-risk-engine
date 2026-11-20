import type { ReactNode } from "react";
import { Panel, ShareInstrument, type InstrumentStatus } from "../../inner";
import type { WatchlistSymbol } from "../../../api/watchlists";
import type { MarketUniverseItem } from "../../../types/schemas";
import { formatPercent } from "../../../utils/format";

export function WatchlistComposition({ members, catalog, name, selector, status }: {
  members: WatchlistSymbol[]; catalog?: ReadonlyMap<string,MarketUniverseItem>; name?: string;
  selector?: ReactNode; status?: InstrumentStatus;
}) {
  const counts = new Map<string, number>();
  for (const {symbol} of members) {
    const item = catalog?.get(symbol);
    const group = item?.is_etf ? "Exchange-traded funds" : item?.sector?.trim() || "Sector unavailable";
    counts.set(group,(counts.get(group) ?? 0)+1);
  }
  const parts = [...counts].map(([name,count]) => ({name,value:100*count/members.length}))
    .sort((a,b)=>b.value-a.value || a.name.localeCompare(b.name));
  const state = status ?? (!members.length ? {kind:"empty" as const,title:name ?
    "Add a symbol to see this list’s sector mix." : "Choose or create a list to inspect its sectors."} : undefined);
  return <Panel className="watch-composition" title="Sector mix" subtitle="Share of saved symbols" actions={selector}>
    <ShareInstrument parts={parts} total={100} label="Watchlist sectors by symbol count" format={formatPercent} status={state} centrepiece={!state}/>
    {members.length > 0 && <footer>{name} · {members.length} {members.length===1 ? "symbol" : "symbols"} · Market universe classifications</footer>}
  </Panel>;
}
