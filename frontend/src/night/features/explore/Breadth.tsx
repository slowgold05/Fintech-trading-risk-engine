import { useMemo, useState } from "react";
import { Panel, RankedRow, State, Table, type InstrumentStatus } from "../../inner";
import { sector as arc } from "../../inner/geometry";
import { useLook } from "../../looks/preferences";
import { priceMove, sourceLabel } from "./marketRead";
import { stockCount } from "./marketInstrument";
import { ParticipationPage, type Participation } from "./Participation";

const directions = ["Advancing", "Declining", "Flat"] as const;

// Each close occupies one slot. Keep the SVG small by batching equal faces into paths.
function unitPaths(counts: number[], dial: boolean, moves: number[][]) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const columns = Math.ceil(Math.sqrt(total * (dial ? 8 : 2.7))) || 1;
  const rows = Math.ceil(total / columns) || 1;
  const dx = Math.min(32, 435 / columns), dy = Math.min(22, 150 / rows);
  const skew = dy * .66, depth = Math.min(6, dy * .48);
  const left = (600 - columns * dx - (rows - 1) * skew) / 2;
  const top = (220 - rows * dy) / 2;
  const peak = moves.reduce((max, group) => group.reduce((m, v) => Math.max(m, Math.abs(v)), max), 0);
  let slot = 0;
  return counts.flatMap((count, group) => {
    const bands = new Map<number, { group: number; face: string; edge: string }>();
    for (let i = 0; i < count; i++, slot++) {
      const col = slot % columns, row = Math.floor(slot / columns);
      const band = dial ? 0 : row;
      const faces = bands.get(band) ?? { group, face:"", edge:"" };
      bands.set(band, faces);
      if (dial) {
        const angle = Math.PI * 1.8 / columns, start = -Math.PI * .9 + col * angle;
        const radialStep = 69 / rows;
        faces.face += arc(start, start + angle * .88, 68 + row * radialStep, 68 + (row + .84) * radialStep);
      } else {
        const x = +(left + col * dx + (rows - row) * skew).toFixed(2), y = +(top + row * dy).toFixed(2);
        const w = +(dx * .94).toFixed(2), h = +(dy * .87).toFixed(2), tilt = +(skew * .87).toFixed(2);
        const height = peak ? 45 * Math.abs(moves[group][i] ?? 0) / peak : 0;
        const roof = +(y - height).toFixed(2);
        const wall = +(height + depth).toFixed(2);
        faces.face += `M${x} ${roof}h${w}l-${tilt} ${h}h-${w}Z`;
        faces.edge += `M${x-tilt} ${roof+h}h${w}l${tilt} -${h}v${wall}l-${tilt} ${h}h-${w}Z`;
      }
    }
    return [...bands.values()];
  });
}

function BreadthPlate({ data, status }: { data?: Participation; status?: InstrumentStatus }) {
  const { prefs } = useLook();
  const dial = prefs.look === "dial";
  const counts = useMemo(() => [data?.advancing ?? 0, data?.declining ?? 0, data?.flat ?? 0], [data]);
  const moves = useMemo(() => {
    const grouped: number[][] = [[], [], []];
    for (const item of data?.items ?? []) {
      const move = Number(item.move);
      grouped[move > 0 ? 0 : move < 0 ? 1 : 2].push(move);
    }
    return grouped;
  }, [data]);
  const paths = useMemo(() => unitPaths(counts, dial, moves), [counts, dial, moves]);
  const [inspected, setInspected] = useState<number>();
  const selected = inspected ?? counts.indexOf(Math.max(...counts));
  const total = data?.covered_count ?? 0;
  const rest = status ?? (!total ? { kind:"unavailable" as const, title:"No covered stock moves in this selection." } : undefined);
  return <Panel title="Direction of travel" subtitle={data?.session_date ? `End-of-day moves · ${data.session_date}` : "End-of-day moves"}>
    <div className="breadth-plate" data-centrepiece={!rest}>
      <svg className="breadth-graphic" role="img" aria-label={`Direction among ${stockCount(total)} covered stocks`} viewBox={dial ? "0 0 320 320" : "0 0 600 220"}>
        {dial ? <g className="breadth-dial-case">
          <circle cx="160" cy="160" r="151" /><circle cx="160" cy="160" r="141" />
          {Array.from({ length:96 }, (_, i) => <path key={i} transform={`rotate(${i * 3.75} 160 160)`} d={i % 4 === 0 ? "M160 10v7" : "M160 11v3"} />)}
          <circle cx="160" cy="160" r="61" />
        </g> : <g className="breadth-terrain-bed">
          <path d="M24 193h451l101-158H125Z" />
          {Array.from({length:11}, (_, i) => <path key={i} d={`M${24+i*45} 193l101-158`} />)}
          {Array.from({length:6}, (_, i) => <path key={i} d={`M${24+i*20.2} ${193-i*31.6}h451`} />)}
        </g>}
        {!rest && paths.map((path, i) => <g key={i} data-direction={path.group} data-active={path.group === selected} onClick={() => setInspected(path.group)}
          onPointerEnter={e => { if (e.pointerType === "mouse") setInspected(path.group); }}>
          <path className="breadth-edge" d={path.edge} /><path className="breadth-face" d={path.face} />
        </g>)}
        {dial && !rest && <g textAnchor="middle"><text className="breadth-dial-count" x="160" y="162">{stockCount(counts[selected])}</text>
          <text className="breadth-dial-caption" x="160" y="181">{directions[selected]}</text></g>}
      </svg>
      {!rest && <div className="breadth-focus"><small>{directions[selected]} stocks</small>
        <strong>{dial ? (counts[selected] / total * 100).toFixed(1) + "%" : stockCount(counts[selected])}</strong><span>of {stockCount(total)} covered</span>
        <p>{dial ? "One division per stock" : "One tile per stock · height by absolute move"}</p></div>}
    </div>
    {rest ? <State {...rest} /> : <div className="breadth-register">{directions.map((name, i) => <RankedRow key={name}
      name={name} value={counts[i]} max={total} selected={selected === i} onSelect={() => setInspected(i)}
      display={<><span>{stockCount(counts[i])}</span><span>{(counts[i] / total * 100).toFixed(1)}%</span></>} />)}</div>}
  </Panel>;
}

function Observations({ data }: { data: Participation }) {
  const [open, setOpen] = useState(false);
  const ordered = useMemo(() => [...data.items].sort((a,b) => Number(b.move) - Number(a.move)), [data.items]);
  if (!ordered.length) return null;
  return <Panel title="Stock observations" subtitle="Compatible closes in the selected universe">
    <div className="breadth-extremes">{[
      { title:"Largest gains", rows:ordered.filter(r => Number(r.move) > 0).slice(0, 4) },
      { title:"Largest losses", rows:ordered.filter(r => Number(r.move) < 0).reverse().slice(0, 4) },
    ].map(group => <section key={group.title}><h3>{group.title}</h3>
      {group.rows.length ? group.rows.map(row => <div key={row.symbol}><b>{row.symbol}</b><span>{priceMove(row.move)}</span></div>) :
        <p className="market-note">No {group.title === "Largest gains" ? "gains" : "losses"} on these closes.</p>}
    </section>)}</div>
    <details className="stock-observations" onToggle={event => setOpen(event.currentTarget.open)}><summary>View {data.items.length} stock observations</summary>
      {open && <Table caption="Stocks with compatible closes" rows={data.items} rowKey={r => r.symbol} columns={[
        { key:"symbol", header:"Symbol", cell:r => r.symbol },
        { key:"move", header:"Price move", align:"right", cell:r => priceMove(r.move) },
        { key:"source", header:"Source and basis", cell:r => sourceLabel(r.source) },
      ]} />}
    </details>
  </Panel>;
}

export function Breadth() {
  return <ParticipationPage title="Stock breadth" description="Advancing, declining and unchanged stocks across two stored closes."
    id="night-breadth" marker="breadth-counts" rest={status => <BreadthPlate status={status} />}
    ledger={data => <Observations data={data} />}>{data => <BreadthPlate data={data} />}</ParticipationPage>;
}
