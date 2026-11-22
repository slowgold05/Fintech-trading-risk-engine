import { useRef, useState } from "react";
import { useRankMotion } from "./useRankMotion";
import { Link } from "react-router-dom";
import type { MarketHeatmapItemResponse } from "../../types/schemas";
import { useCompactWall, focusHandlers, sectorKey, type Vars } from "../../ui/lib";
import { EmptyNote } from "../../ui/primitives";
import { formatSignedPercent } from "../../utils/format";
import { companyName } from "./sectors";

export function QuoteMovers({ items, loading }: { items: readonly MarketHeatmapItemResponse[]; loading: boolean }) {
  const compact=useCompactWall();
  const [all,setAll]=useState(false);
  const ranked = items.filter(item => item.data_status !== "stale" && Number.isFinite(item.change_percent))
    .sort((a, b) => Math.abs(b.change_percent) - Math.abs(a.change_percent) || a.symbol.localeCompare(b.symbol)).slice(0, 6);
  const list = useRef<HTMLOListElement>(null);
  useRankMotion(list, ranked.map(row => row.symbol).join("|"));
  if (loading || ranked.length === 0) {
    return <EmptyNote message={loading ? "Loading most-active stocks" : "Most-active data unavailable"} />;
  }
  const scale = Math.abs(ranked[0].change_percent) || 1;
  return <>
    <ol ref={list} className="movers-rank" data-collapsed={compact && !all} {...focusHandlers}>
      {(compact && !all ? ranked.slice(0,4) : ranked).map(item => <li className="mover-line x-sym x-sec" data-sector={sectorKey(item.sector)} data-sym={item.symbol} data-rank={item.symbol} key={item.symbol}
        title={`${item.company} · ${item.data_status} / ${item.source}`}>
        <span className="mover-identity">
          {item.detail_available ? <Link className="num" to={`/market/${encodeURIComponent(item.symbol)}`}>{item.symbol}</Link> : <b className="num">{item.symbol}</b>}
          <span>{companyName(item.company)}</span>
        </span>
        <i aria-hidden="true" className="mover-meter" data-loss={item.change_percent < 0}
          style={{ "--value": Math.abs(item.change_percent) / scale } as Vars} />
        <strong className="num">{formatSignedPercent(item.change_percent)}</strong>
      </li>)}
    </ol>
    {compact && ranked.length>3 && <button className="more-rows" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show less" : `All ${ranked.length} movers`}</button>}
    <p className="note mt-2">Most-active data unavailable. Ranked by absolute day change in non-stale cached stock quotes.</p>
  </>;
}
