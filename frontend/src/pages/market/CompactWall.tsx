import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChartLine, CirclesThree, GridFour, SlidersHorizontal, Stack } from "@phosphor-icons/react";
import type { MarketTrendResponse } from "../../types/schemas";
import { formatSignedPercent } from "../../utils/format";
import { pinSector, usePinnedSector, sectorKey } from "../../ui/lib";
import { BottomSheet, SectorCarousel } from "./TouchControls";

const stops = [
  { id:"session-dial", label:"Session", Icon:CirclesThree },
  { id:"trending-movers", label:"Movers", Icon:ChartLine },
  { id:"stock-heatmap", label:"Map", Icon:GridFour },
  { id:"sector-etf-heatmap", label:"Sectors", Icon:Stack },
  { id:"market-pulse", label:"Tools", Icon:SlidersHorizontal },
];

export function WallDock() {
  const [toolsOpen, setToolsOpen] = useState(false);
  const dock=useRef<HTMLElement>(null);
  useEffect(() => {
    const links = Array.from(dock.current!.querySelectorAll("[data-stop]"));
    const nodes = stops.map(s => document.getElementById(s.id)!);
    let offsets: number[] = [];
    const mark = () => {
      const position = window.scrollY + Math.min(220, innerHeight*.22);
      const index = offsets.reduce((last,y,i) => y <= position && (last < 0 || y >= offsets[last]) ? i : last, -1);
      links.forEach((a,i) => { if(i===(scrollY < 16 ? 0 : Math.max(0,index))) a.setAttribute("aria-current","location"); else a.removeAttribute("aria-current"); });
    };
    const measure=() => { offsets=nodes.map(node => node ? node.getBoundingClientRect().top+scrollY : Infinity); mark(); };
    const observer=new ResizeObserver(measure);
    observer.observe(document.querySelector(".wall")!); measure();
    window.addEventListener("scroll",mark,{passive:true});
    return () => {observer.disconnect();window.removeEventListener("scroll",mark);};
  }, []);
  return <nav className="wall-dock" aria-label="Market sections" ref={dock}>
    {stops.map(({id,label,Icon}) => {
      const content = <><Icon size={19} aria-hidden="true" /><span>{label}</span></>;
      return id === "market-pulse" ? <button key={id} data-stop={id} type="button" aria-haspopup="dialog"
        onClick={() => setToolsOpen(true)}>{content}</button> : <a key={id} data-stop={id} href={`#${id}`}>{content}</a>;
    })}
    {toolsOpen && <BottomSheet title="Market tools" close={() => setToolsOpen(false)}>
      {[
        ["market-pulse","Market pulse"], ["breadth-title","Breadth"], ["market-news","Market news"],
        ["company-research","Company research"], ["daily-price-history-title","Daily history"], ["watchlists-title","Watchlists"],
      ].map(([id,label]) => <button key={id} onClick={() => {
        const target = document.getElementById(id);
        const fold = target?.closest("details");
        if (fold) fold.open = true;
        setToolsOpen(false);
        requestAnimationFrame(() => (fold ?? target)?.scrollIntoView({block:"start", behavior:"instant"}));
      }}>{label}</button>)}
    </BottomSheet>}
  </nav>;
}

export function QuoteStrip({ trends, selected, choose }: { trends: readonly MarketTrendResponse[]; selected: string; choose: (symbol: string) => void }) {
  return <div className="quote-strip" aria-label="Index ETF day changes">
    {trends.map(t => <button type="button" key={t.source_symbol} aria-label={`${t.name}, ${t.source_symbol}, ${formatSignedPercent(t.change_percent)} today`}
      aria-pressed={selected===t.source_symbol} onClick={() => {pinSector(null);choose(t.source_symbol);}}>
      <span>{t.source_symbol}</span><b className="fig">{formatSignedPercent(t.change_percent)}</b>
    </button>)}
  </div>;
}

export function ToolFold({ compact, title, children }: { compact: boolean; title: string; children: ReactNode }) {
  return compact ? <details className="tool-fold"><summary>{title}</summary>{children}</details> : children;
}

export function HeatPager({ names, pages }: { names: string[]; pages: ReactNode[] }) {
  const pinned = usePinnedSector();
  const index = Math.max(0,names.findIndex(name => sectorKey(name) === pinned));
  const [open,setOpen] = useState(false);
  function choose(i:number) {pinSector(names[i]);}
  return <>
    <div className="pager-head">
      <button type="button" className="sector-picker" aria-haspopup="dialog" onClick={() => setOpen(true)}>{names[index]} <span>⌄</span></button>
      <span className="num">{index+1} / {names.length}</span>
      <button className="pager-arrow" aria-label="Previous sector" disabled={index===0} onClick={() => choose(index-1)}>‹</button>
      <button className="pager-arrow" aria-label="Next sector" disabled={index===names.length-1} onClick={() => choose(index+1)}>›</button>
    </div>
    <SectorCarousel index={index} pages={pages} onSelect={choose} />
    {open && <BottomSheet title="Select sector" close={() => setOpen(false)}>{names.map((name,i) =>
      <button key={name} aria-pressed={i===index} onClick={() => {choose(i);setOpen(false);}}>{name}</button>)}</BottomSheet>}
  </>;
}
