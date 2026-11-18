import { memo, useEffect, useMemo, useRef } from "react";
import type { MarketHeatmapItemResponse, MarketSectorResponse, MarketTrendResponse } from "../../types/schemas";
import { formatCurrency, formatSignedPercent } from "../../utils/format";
import { directionOf, focusHandlers, sectorKey, pinSector, setFocus, useCompactWall, useDraw, useWallFocus, type Direction } from "../../ui/lib";
import { RollingNumber } from "../../ui/motion";
import { Delta, Skeleton } from "../../ui/primitives";
import { companyName, sectorCode, sectorRank } from "./sectors";

type Item = MarketHeatmapItemResponse;

const C = 500;
const R0 = 324;
const CLIP = 6;
const LEN = 102;
const TOP_GAP = 22;
const SECTOR_GAP = 2.2;
const ARC_RADIUS = 452;
const WIDTHS: Record<Item["size"], number> = { mega: 23, large: 20, medium: 17, small: 15, micro: 13 };

function reach(change: number) {
  return LEN * Math.sqrt(Math.min(Math.abs(change), CLIP) / CLIP);
}

type Spoke = {
  item: Item;
  angle: number;
  index: number;
  dir: Direction | "stale";
  f: number;
  clipped: boolean;
  width: number;
};

type Wedge = { key: string; name: string; code: string; from: number; to: number };

function polar(radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [C + radius * Math.sin(radians), C - radius * Math.cos(radians)];
}

function arcPath(radius: number, from: number, to: number) {
  const [x1, y1] = polar(radius, from);
  const [x2, y2] = polar(radius, to);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${radius} ${radius} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to >= from ? 1 : 0} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function sectorBand(inner: number, outer: number, from: number, to: number) {
  const large = to - from > 180 ? 1 : 0;
  return `${arcPath(outer, from, to)} L ${polar(inner, to)} A ${inner} ${inner} 0 ${large} 0 ${polar(inner, from)} Z`;
}

function isStale(item: Item) {
  return item.data_status === "stale" || !Number.isFinite(item.change_percent);
}

function layoutDial(items: readonly Item[]) {
  const sorted = [...items].sort((a, b) => (
    sectorRank(a.sector) - sectorRank(b.sector)
    || sectorKey(a.sector).localeCompare(sectorKey(b.sector))
    || b.change_percent - a.change_percent
    || a.symbol.localeCompare(b.symbol)
  ));
  const sectorCount = new Set(sorted.map((item) => sectorKey(item.sector))).size;
  const step = (360 - TOP_GAP - SECTOR_GAP * Math.max(0, sectorCount - 1)) / Math.max(1, sorted.length);
  const spokes: Spoke[] = [];
  const wedges: Wedge[] = [];
  let angle = TOP_GAP / 2;

  sorted.forEach((item, index) => {
    const key = sectorKey(item.sector);
    let wedge = wedges.at(-1);
    if (!wedge || wedge.key !== key) {
      if (wedge) angle += SECTOR_GAP;
      wedge = { key, name: item.sector, code: sectorCode(item.sector), from: angle, to: angle };
      wedges.push(wedge);
    }
    const stale = isStale(item);
    const magnitude = stale ? 0 : Math.abs(item.change_percent);
    spokes.push({
      item,
      angle: angle + step / 2,
      index,
      dir: stale ? "stale" : directionOf(item.change_percent),
      f: reach(magnitude) / LEN,
      clipped: magnitude > CLIP,
      width: Math.min(WIDTHS[item.size] ?? 15, (R0-LEN) * step * Math.PI / 180 * .86),
    });
    angle += step;
    wedge.to = angle;
  });

  return { spokes, wedges, step };
}

function DialCore({ items, index: pinned, trends, loading, sectors }: SessionDialProps) {
  const { symbol, sector } = useWallFocus();
  const index = !sector && symbol ? trends.find(trend => trend.source_symbol === symbol) : pinned;
  const hovered = symbol ? items.find((item) => item.symbol === symbol) : undefined;

  if (hovered) {
    const stale = isStale(hovered);
    return (
      <div className="dial-core">
        <span className="lbl">{sectorCode(hovered.sector)} / {hovered.exchange}</span>
        <span className="fig fig-lg">{hovered.symbol}</span>
        <span className="dial-company">{companyName(hovered.company)}</span>
        <span className="fig flex items-baseline gap-1.5 text-[18px]">
          {stale ? "Stale" : formatSignedPercent(hovered.change_percent)}
          {stale ? null : <Delta dir={directionOf(hovered.change_percent)} />}
        </span>
        <span className="num text-[10px] leading-4 text-fg-3">
          {hovered.price > 0 ? formatCurrency(hovered.price) : "No price"} / {hovered.data_status} / {hovered.source}
        </span>
      </div>
    );
  }

  if (sector) {
    const members = items.filter((item) => sectorKey(item.sector) === sector && !isStale(item));
    const proxy = sectors.find((item) => sectorKey(item.sector) === sector);
    if (proxy || members.length) {
      const change = proxy?.change_percent ?? members.reduce((sum, item) => sum + item.change_percent, 0) / members.length;
      return <div className="dial-core">
        <span className="lbl">{proxy ? proxy.symbol + " / ETF day" : "Cached mean"}</span>
        <strong className="dial-company">{proxy?.sector ?? members[0].sector}</strong>
        <span className="fig fig-lg">{formatSignedPercent(change)}</span>
        <span className="num text-[10px]">{members.length} current stock quotes</span>
      </div>;
    }
  }

  if (!index) {
    return (
      <div className="dial-core">
        {loading ? <Skeleton className="h-9 w-28" /> : <span className="lbl">Index quote unavailable</span>}
      </div>
    );
  }

  return (
    <div className="dial-core">
      <span className="lbl">{index.name} · {index.source_symbol}</span>
      <span className="fig fig-xl flex items-baseline gap-2">
        <RollingNumber delay={940} value={formatSignedPercent(index.change_percent)} />
      </span>
      <span className="num text-[12px] leading-4 text-fg-2">{formatCurrency(index.value)} ETF quote</span>
      <span className="core-counts num" aria-label="Advancing, flat and declining stocks">
        {(["up", "flat", "down"] as const).map(dir => <span key={dir}><Delta dir={dir} /> {items.filter(item => !isStale(item) && directionOf(item.change_percent) === dir).length}</span>)}
      </span>
    </div>
  );
}

type SessionDialProps = {
  items: readonly Item[];
  sectors: readonly MarketSectorResponse[];
  /** The first index proxy of the overview, shown at the centre. */
  index?: MarketTrendResponse;
  trends: readonly MarketTrendResponse[];
  loading: boolean;
};

function DialExtremes({ items, sectors }: Pick<SessionDialProps, "items" | "sectors">) {
  const proxies = [...sectors].filter((s) => Number.isFinite(s.change_percent)).sort((a,b) => b.change_percent - a.change_percent);
  const quotes = items.filter((s) => !isStale(s)).sort((a,b) => b.change_percent - a.change_percent);
  const extremes = [
    { label: "Leading ETF", row: proxies[0] },
    { label: "Lagging ETF", row: proxies.length > 1 ? proxies.at(-1) : undefined },
    { label: "Highest stock", row: quotes[0] },
    { label: "Lowest stock", row: quotes.length > 1 ? quotes.at(-1) : undefined },
  ];
  return <div className="dial-extremes" {...focusHandlers}>
    {extremes.map(({ label, row }, i) => row && <div key={label} className={`dial-extreme x-sec ${"company" in row ? "x-sym" : "x-seclit"}`} data-slot={i}
      data-sector={sectorKey(row.sector)} data-sym={"company" in row ? row.symbol : undefined} tabIndex={0}>
      <span className="lbl">{label}</span>
      <strong>{"company" in row ? row.symbol : row.sector}</strong>
      {"company" in row && <small>{companyName(row.company)}</small>}
      <span className="num">{formatSignedPercent(row.change_percent)}</span>
    </div>)}
  </div>;
}

const SectorLight = memo(function SectorLight({ wedge }: { wedge?: Wedge }) {
  if (!wedge) return null;
  return <svg className="needle-layer" viewBox="0 0 1000 1000" aria-hidden="true">
    <path fill="rgb(var(--signal-rgb) / .22)" stroke="rgb(var(--signal-rgb) / .72)" strokeWidth="2"
      d={sectorBand(216, 431, wedge.from, wedge.to)} />
    <path fill="none" stroke="rgb(var(--signal-rgb))" strokeWidth="8" d={arcPath(433, wedge.from, wedge.to)} />
  </svg>;
});

function DialNeedle({ spokes, wedges, index, trends }: {
  spokes: Spoke[];
  wedges: Wedge[];
} & Pick<SessionDialProps, "index" | "trends">) {
  const { symbol, sector } = useWallFocus();
  const spoke = spokes.find(s => s.item.symbol === symbol);
  const wedge = wedges.find(w => w.key === sector);
  const proxy = !sector && symbol ? trends.find(t => t.source_symbol === symbol) : index;
  const change = spoke ? spoke.item.change_percent : proxy?.change_percent;
  const tip = C - R0 - Math.sign(change ?? 0) * reach(change ?? 0) - 64;
  return <>
    <SectorLight wedge={wedge} />
    {change != null && Number.isFinite(change) && (!sector || spoke) && spoke?.dir !== "stale" &&
      <div className="pointer-arm" style={{transform:`rotate(${spoke?.angle ?? 0}deg)`}} aria-hidden="true">
        <svg viewBox="0 0 28 436" className="dial-needle">
          <path fill="none" d={`M14 5V${tip}`} strokeWidth="4" />
          <circle cx="14" cy={tip} r="11" strokeWidth="3" fill="#1a1711" /><circle cx="14" cy={tip} r="4" />
          <path d="M8 2h12l-6 11Z" />
        </svg>
      </div>}
  </>;
}

function arcLabel(radius: number, from: number, to: number) {
  const middle = (from + to) / 2;
  return middle > 90 && middle < 270 ? arcPath(radius+15,to,from) : arcPath(radius,from,to);
}

const DialFace = memo(function DialFace({ layout }: { layout: ReturnType<typeof layoutDial> }) {
  const { spokes, wedges } = layout;
  const extremes: Spoke[] = [];
  for (const spoke of [...spokes].filter(s => s.dir !== "stale").sort((a,b) => Math.abs(b.item.change_percent) - Math.abs(a.item.change_percent))) {
    if (extremes.every(s => Math.abs((s.angle - spoke.angle + 540) % 360 - 180) > 39)
      && spoke.angle > 22 && spoke.angle < 338) extremes.push(spoke);
    if (extremes.length === 4) break;
  }
  return <svg className="dial-face" viewBox="0 0 1000 1000" aria-hidden="true">
    <defs>
      <radialGradient id="dial-steel" cx=".34" cy=".18" r=".9">
        <stop stopColor="#414440" /><stop offset=".43" stopColor="#272a28" /><stop offset="1" stopColor="#111312" />
      </radialGradient>
      <radialGradient id="dial-hub" cx=".45" cy=".24" r=".85">
        <stop stopColor="#353833" /><stop offset=".5" stopColor="#191c19" /><stop offset=".88" stopColor="#101210" /><stop offset="1" stopColor="#252825" />
      </radialGradient>
      <pattern id="dial-hatch" width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="#373b38" /><path d="M-4 4L4 -4M0 9L9 0M5 13L13 5" stroke="#d2d5ce" strokeWidth="3.4" />
      </pattern>
    </defs>
    <circle cx={C} cy={C} r="482" fill="#141614" stroke="#414540" strokeWidth="3" />
    <circle className="rim-ticks" cx={C} cy={C} r="479" pathLength="160" />
    <circle cx={C} cy={C} r="431" fill="url(#dial-steel)" stroke="#656963" strokeWidth="5" />
    {[-6,-3,-1,0,1,3,6].map(mark => <circle key={mark} cx={C} cy={C} r={R0+Math.sign(mark)*reach(mark)}
      fill="none" stroke={mark===0?"#b0b4aa":"#71766e"} strokeWidth={mark===0?6:2.5} opacity={mark===0?1:.45} />)}
    <circle cx={C} cy={C} r="211" fill="url(#dial-hub)" stroke="#484d46" strokeWidth="8" />
    <circle cx={C} cy={C} r="201" fill="none" stroke="#8b9386" strokeWidth="2" />
    {wedges.map(w => {
      const room = (w.to - w.from) * Math.PI / 180 * ARC_RADIUS;
      const full = w.name.replace(/^Consumer /, '').toUpperCase();
      const label = room > full.length * 16 + 15 ? full : room > w.code.length * 15 ? w.code : '';
      return <g key={w.key}>
        <path d={arcPath(ARC_RADIUS,w.from,w.to)} stroke="#303430" strokeWidth="34" fill="none" />
        <path id={`rim-${w.key}`} d={arcLabel(446,w.from,w.to)} fill="none" />
        <text className="rim-name"><textPath href={`#rim-${w.key}`} startOffset="50%" textAnchor="middle">{label}</textPath></text>
        <path d={`M${polar(221,w.from)} L${polar(432,w.from)}`} stroke="#111310" strokeWidth="4" />
      </g>;
    })}
    {spokes.map(s => {
      const height = Math.max(4, LEN*s.f);
      const base = C-R0;
      const tip = base + (s.dir === "up" ? -height : height);
      return <g className="spk" key={s.item.symbol} data-sym={s.item.symbol} data-sector={sectorKey(s.item.sector)} transform={`rotate(${s.angle} 500 500)`}>
        <rect x={C-s.width/2} y={Math.min(tip,base)} width={s.width} height={height}
          fill={s.dir === "up" ? "#dadcd5" : s.dir === "down" ? "url(#dial-hatch)" : "#8b9087"} />
        <path d={`M${C-s.width/2} ${tip} h${s.width}`} stroke={s.dir==="up"?"rgb(var(--gain-rgb))":s.dir==="down"?"rgb(var(--loss-rgb))":"#9c9f97"} strokeWidth="5" />
        {s.clipped && <path d={`M${C-s.width/2} ${tip+(s.dir==="up"?-7:7)}h${s.width}`} stroke="#e1e3dc" strokeWidth="3" />}
      </g>;
    })}
    {extremes.map(s => <g key={s.item.symbol} className="rim-mover">
      <path id={`mover-arc-${s.index}`} d={arcLabel(382,s.angle-20,s.angle+20)} fill="none" />
      <text><textPath href={`#mover-arc-${s.index}`} startOffset="50%" textAnchor="middle">{s.item.symbol} {formatSignedPercent(s.item.change_percent)}</textPath></text>
    </g>)}
    {[6,0,-6].map(mark => <text className="face-scale" key={mark} x="490" y={C-R0-Math.sign(mark)*reach(mark)+5} textAnchor="end">{mark>0?"+":""}{mark}{mark!==0?"%":""}</text>)}
  </svg>;
});

function DialTouchReading({ items }: { items: readonly Item[] }) {
  const {symbol,sector} = useWallFocus();
  const stock = items.find(item => item.symbol === symbol);
  const name = stock?.sector ?? items.find(item => sectorKey(item.sector)===sector)?.sector;
  return <div className="dial-reading" data-active={Boolean(name)}>
    {stock ? <><b>{stock.symbol}</b><span>{companyName(stock.company)} · {name}</span><strong>{isStale(stock) ? "Stale" : formatSignedPercent(stock.change_percent)}</strong></> :
      name ? <><b>{name}</b><span>Selected sector</span></> : <span>Trace the ring to inspect · Tap a sector to select</span>}
  </div>;
}

export const SessionDial = memo(function SessionDial(props: SessionDialProps) {
  const layout = useMemo(() => layoutDial(props.items), [props.items]);
  const { spokes, wedges } = layout;
  const draw = useDraw<HTMLDivElement>(!props.loading);
  const compact = useCompactWall();
  const hit = useRef<SVGCircleElement>(null);
  // A vertical flick scrolls the page. A lateral start or a brief hold owns the ring until lift.
  useEffect(() => {
    const node = hit.current;
    if (!node || !compact) return;
    let origin: {x:number; y:number; time:number} | null = null;
    let scrub = false;
    const start = (e:TouchEvent) => {
      origin = e.touches.length===1 ? {x:e.touches[0].clientX,y:e.touches[0].clientY,time:e.timeStamp} : null;
      scrub=false;
    };
    const move = (e:TouchEvent) => {
      if (!origin || e.touches.length!==1) return;
      const finger=e.touches[0];
      if (!scrub) {
        scrub = Math.abs(finger.clientX-origin.x) >= Math.abs(finger.clientY-origin.y) || e.timeStamp-origin.time > 160;
        if (!scrub) {origin=null; return;}
      }
      e.preventDefault();
    };
    node.addEventListener("touchstart",start,{passive:true});
    node.addEventListener("touchmove",move,{passive:false});
    return () => {node.removeEventListener("touchstart",start);node.removeEventListener("touchmove",move);};
  }, [compact]);
  const active = useRef<{ id: number; box: DOMRect; sector?: string; symbol?: string } | null>(null);
  const reading = useRef(-1);
  const hoverBox = useRef<DOMRect | null>(null);
  const hoverFrame = useRef(0);
  const hoverPoint = useRef({x:0,y:0});
  useEffect(() => {
    const invalidate = () => { hoverBox.current = null; };
    window.addEventListener("scroll", invalidate, {passive:true});
    window.addEventListener("resize", invalidate);
    return () => {
      cancelAnimationFrame(hoverFrame.current);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
    };
  }, []);

  function readPoint(clientX: number, clientY: number, box: DOMRect) {
    const x = (clientX-box.left)/box.width - .5;
    const y = (clientY-box.top)/box.height - .5;
    const angle = (Math.atan2(x,-y)*180/Math.PI+360)%360;
    const radius = Math.hypot(x,y)*1000;
    const wedge = wedges.find(w => angle >= w.from && angle <= w.to);
    if (!wedge || radius < 208 || radius > 500) {
      if (active.current) {active.current.sector=undefined; active.current.symbol=undefined;}
      setFocus(null);
      return;
    }
    const stockRadius = compact ? Math.min(425, 497 - 44000 / box.width) : 425;
    const spoke = radius < stockRadius ? spokes.find(s => Math.abs(s.angle-angle) <= layout.step/2) : undefined;
    if (spoke) reading.current = spoke.index;
    if (active.current) {active.current.sector=wedge.key; active.current.symbol=spoke?.item.symbol;}
    setFocus({ sector:wedge.key, symbol:spoke?.item.symbol });
  }
  return <div className="dial-bed">
    {compact && <DialTouchReading items={props.items} />}
    <div className="dial" ref={draw} role="group" tabIndex={0} aria-label={`Session dial, ${props.items.length} cached stocks by sector. Use arrow keys to read stocks.`}
      onKeyDown={e => {
        if (e.key === "Escape") setFocus(null);
        if (!spokes.length || !["ArrowLeft","ArrowRight"].includes(e.key)) return;
        e.preventDefault();
        reading.current = (reading.current + (e.key==="ArrowRight"?1:-1) + spokes.length) % spokes.length;
        const s=spokes[reading.current]; setFocus({symbol:s.item.symbol,sector:s.item.sector});
      }} onBlur={() => setFocus(null)}>
      <DialFace layout={layout} />
      <div aria-hidden="true" className="dial-sweep" />
      <DialNeedle spokes={spokes} wedges={wedges} index={props.index} trends={props.trends} />
      <DialCore {...props} />
      <svg className="dial-input" viewBox="0 0 1000 1000" aria-hidden="true">
        <circle ref={hit} cx="500" cy="500" r="355" fill="none" stroke="transparent" strokeWidth="284"
          onPointerDown={e => {
            const box=e.currentTarget.ownerSVGElement!.getBoundingClientRect();
            active.current={id:e.pointerId,box}; e.currentTarget.setPointerCapture?.(e.pointerId);
            readPoint(e.clientX, e.clientY, box);
          }}
          onPointerMove={e => {
            const drag=active.current;
            if (drag?.id === e.pointerId) readPoint(e.clientX, e.clientY, drag.box);
            else if (e.pointerType === "mouse") {
              const surface = e.currentTarget.ownerSVGElement!;
              hoverPoint.current = {x:e.clientX, y:e.clientY};
              if (!hoverFrame.current) {
                hoverFrame.current = requestAnimationFrame(() => {
                  hoverFrame.current = 0;
                  hoverBox.current ??= surface.getBoundingClientRect();
                  readPoint(hoverPoint.current.x, hoverPoint.current.y, hoverBox.current);
                });
              }
            }
          }}
          onPointerUp={e => {
            const value=active.current;
            active.current=null;
            if (value?.sector && e.pointerType==="touch") {
              pinSector(value.sector, value.symbol);
            }
          }}
          onPointerCancel={() => {active.current=null;setFocus(null);}}
          onPointerLeave={e => {
            if (!active.current && e.pointerType === "mouse") {
              cancelAnimationFrame(hoverFrame.current);
              hoverFrame.current = 0;
              setFocus(null);
            }
          }} />
      </svg>
    </div>
    <DialExtremes items={props.items} sectors={props.sectors} />
  </div>;
});
