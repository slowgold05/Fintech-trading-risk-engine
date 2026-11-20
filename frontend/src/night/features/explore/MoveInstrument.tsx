import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel, State, type InstrumentStatus } from "../../inner";
import { polar, sector } from "../../inner/geometry";
import { useLook } from "../../looks/preferences";
import { priceMove } from "./marketRead";
import "./moveInstrument.css";

export type MoveReading = { name: string; mark: string; value: number | null; proxy?: number | null };
type Scale = { low: number; high: number };

function fraction(value: number, scale: Scale) {
  return scale.high === scale.low ? .5 : (value - scale.low) / (scale.high - scale.low);
}

function MoveRelief({ rows, scale, selected, inspect, label }: {
  rows: readonly MoveReading[]; scale: Scale; selected: number; inspect: (i: number) => void; label: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.min(960, Math.round(entry.contentRect.width)))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const left = 55, right = width - 16, step = (right - left) / Math.max(rows.length, 1);
  const y = (v: number) => 177 - fraction(v, scale) * 140;
  const base = y(0), labelStride = Math.max(1, Math.ceil(rows.length * 40 / (right - left)));
  return <svg ref={ref} viewBox={`0 0 ${width} 215`} role="img" aria-label={label}>
    {[0, .5, 1].map(f => <g key={f}><path className="move-grid" d={`M${left} ${177-f*140}H${right}`} />
      {rows.length > 0 && (scale.low !== scale.high || f === .5) && <text x={left-5} y={181-f*140} textAnchor="end">{priceMove(scale.low + f * (scale.high-scale.low))}</text>}</g>)}
    <path className="move-plane" d={`M${left} ${base}H${right}l7-6H${left+7}Z`} />
    {rows.map((row, i) => {
      const cx = left + step * (i + .5), w = Math.min(46, step * .65);
      const x = cx - w / 2, depth = Math.min(7, step * .2);
      const end = y(row.value ?? 0), top = Math.min(end, base), bottom = Math.max(end, base);
      return <g key={row.name} data-chosen={selected === i} onPointerMove={e => { if (e.pointerType === "mouse") inspect(i); }} onClick={() => inspect(i)}>
        {row.value !== null && <>
          <path className="move-wall" d={`M${x} ${top}h${w}V${bottom}h-${w}Z`} />
          <path className="move-edge" d={`M${x+w} ${top}l${depth} -${depth}V${bottom-depth}l-${depth} ${depth}Z`} />
          <path className="move-cap" d={`M${x} ${top}l${depth} -${depth}h${w}l-${depth} ${depth}Z`} />
          <path className="move-tip" d={`M${x} ${end}h${w}`} />
        </>}
        {row.proxy != null && <path className="proxy-mark" d={`M${cx-w*.65} ${y(row.proxy)}h${w*1.3}`} />}
        {(i % labelStride === 0 || rows.length === 1) && <text textAnchor="middle" x={cx} y="201">{row.mark}</text>}
        <rect fill="transparent" x={left+i*step} y="15" width={step} height="190" />
      </g>;
    })}
  </svg>;
}

function MoveDial({ rows, scale, selected, inspect, label }: Parameters<typeof MoveRelief>[0]) {
  const hatch = useId();
  const arcStep = Math.PI * 1.85 / Math.max(1, rows.length);
  const radius = (v: number) => 73 + fraction(v, scale) * 57;
  const zero = radius(0);
  return <svg viewBox="0 0 320 320" role="img" aria-label={label}>
    <defs><pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M-1 1l2-2M0 4l4-4M3 5l2-2" stroke="#b8bbae" strokeWidth="1.6" /></pattern></defs>
    <circle cx="160" cy="160" r="154" className="move-case" />
    {[72, 87, 101, 116, 131, 149].map(r => <circle key={r} cx="160" cy="160" r={r} className="move-ring" />)}
    <circle cx="160" cy="160" r={zero} className="move-zero" />
    {Array.from({length:96}, (_, i) => <path key={i} d={i % 4 ? "M160 7v2" : "M160 7v5"} stroke="#a5aa9e" transform={`rotate(${i*3.75} 160 160)`} />)}
    {rows.map((row, i) => {
      const mid = (i + .5 - rows.length / 2) * arcStep;
      const from = mid - arcStep*.46, to = mid + arcStep*.46;
      const end = radius(row.value ?? 0), [x,y] = polar(mid, 141), degrees = mid * 180 / Math.PI;
      return <g key={row.name} data-chosen={selected === i} onPointerMove={e => { if (e.pointerType === "mouse") inspect(i); }} onClick={() => inspect(i)}>
        {row.value !== null && <path className="move-span" d={sector(from,to,Math.min(end,zero),Math.max(end,zero)+.8)}
          fill={row.value < 0 ? `url(#${hatch})` : "#b5baaf"} />}
        {row.proxy != null && <path className="proxy-arc" d={sector(from,to,radius(row.proxy)-1,radius(row.proxy)+1)} />}
        {selected === i && <path className="move-pointer" d={`M${polar(mid,153)}L${polar(mid,132)}`} />}
        {(rows.length <= 16 || i % 2 === 0) && <text className="move-rim" x={x} y={y} dominantBaseline="middle" textAnchor="middle"
          transform={`rotate(${Math.abs(degrees)>90 ? degrees+180 : degrees} ${x} ${y})`}>{row.mark}</text>}
        <path fill="transparent" d={sector(from,to,66,153)} />
      </g>;
    })}
    <circle cx="160" cy="160" r="65" className="move-hub" />
    {rows[selected] && <g textAnchor="middle">
      <text x="160" y="145">{rows[selected].mark}</text>
      <text x="160" y="169" className="move-hub-value">{rows[selected].value == null ? "—" : priceMove(rows[selected].value)}</text>
      <text x="160" y="185" className="move-hub-unit">{label}</text>
    </g>}
  </svg>;
}

export function MoveInstrument({ title, subtitle, rows, initial, label, inspectLabel, status, reading, legend }: {
  title: string; subtitle?: string; rows: readonly MoveReading[]; initial?: string; label: string; inspectLabel: string;
  status?: InstrumentStatus; reading: (row: MoveReading) => ReactNode; legend: ReactNode;
}) {
  const { prefs } = useLook();
  const [chosen, setChosen] = useState<string>();
  const selected = Math.max(0, rows.findIndex(row => row.name === (rows.some(r => r.name === chosen) ? chosen : initial)));
  const row = rows[selected];
  const scale = useMemo(() => {
    const values = rows.flatMap(r => [r.value ?? 0, r.proxy ?? 0]);
    return { low:Math.min(0, ...values), high:Math.max(0, ...values) };
  }, [rows]);
  const Plot = prefs.look === "dial" ? MoveDial : MoveRelief;
  return <Panel className="move-panel" title={title} subtitle={subtitle}
    actions={!status && row && <select aria-label={inspectLabel} value={row.name} onChange={e => setChosen(e.target.value)}>
      {rows.map(r => <option key={r.name}>{r.name}</option>)}</select>}>
    <div className="move-plate" data-centrepiece={!status}>
      <Plot rows={status ? [] : rows} scale={scale} selected={selected} inspect={i => setChosen(rows[i].name)} label={label} />
      {!status && row && <div className="move-reading">{reading(row)}</div>}
    </div>
    {status ? <State {...status} /> : <div className="move-key">{legend}<span>{prefs.look === "dial" ? "Gain outward · loss inward" : "Zero = unchanged close"}</span>
      {prefs.look === "dial" && <span>Scale {priceMove(scale.low)} to {priceMove(scale.high)}</span>}</div>}
  </Panel>;
}
