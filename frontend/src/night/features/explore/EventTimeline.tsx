import { useMemo, useState, type PointerEvent } from "react";
import { RestInstrument } from "../../inner";
import { useLook } from "../../looks/preferences";

type DatedRecord = { date: string; title: string };
const dayMs = 86_400_000;
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function binRecords(records: readonly DatedRecord[]) {
  const dated = records.map(record => ({ record, day: Date.parse(record.date + "T00:00:00Z") / dayMs }))
    .filter(row => Number.isInteger(row.day));
  if (!dated.length) return [];
  const first = Math.min(...dated.map(row => row.day));
  const last = Math.max(...dated.map(row => row.day));
  const days = Math.ceil((last - first + 1) / 56);
  const iso = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);
  const bins = Array.from({ length: Math.floor((last - first) / days) + 1 }, (_, i) => {
    const start = first + i * days;
    return { start: iso(start), end: iso(Math.min(start + days - 1, last)), records: [] as DatedRecord[] };
  });
  dated.forEach(({ record, day }) => bins[Math.floor((day - first) / days)].records.push(record));
  return bins;
}

type Bin = ReturnType<typeof binRecords>[number];
function dateLabel(bin: Bin) {
  return bin.start === bin.end ? bin.start : bin.start + " – " + bin.end;
}
const turn = Math.PI * 1.68;
const angle = (fraction: number) => turn * (fraction - 0.5);
function point(a: number, radius: number) {
  return [140 + Math.sin(a) * radius, 140 - Math.cos(a) * radius];
}
function wedge(a: number, b: number, inner: number, outer: number) {
  const large = b - a > Math.PI ? 1 : 0;
  return `M${point(a, outer)}A${outer},${outer} 0 ${large} 1 ${point(b, outer)}L${point(b, inner)}A${inner},${inner} 0 ${large} 0 ${point(a, inner)}Z`;
}

function CalendarDial({ bins, index, max }: { bins: Bin[]; index: number; max: number }) {
  const span = turn / bins.length;
  const arc = (i: number) => angle(i / bins.length);
  return <>
    <circle cx="140" cy="140" r="131" className="event-rim"/>
    {Array.from({ length: 96 }, (_, i) => {
      const a = i * Math.PI / 48;
      return <path key={i} d={`M${point(a, 130)}L${point(a, i % 4 ? 126 : 122)}`} className="event-tick"/>;
    })}
    <path d={wedge(arc(0), arc(bins.length), 68, 116)} className="event-track"/>
    {bins.map((bin, i) => <g key={bin.start}>
      <path d={`M${point(arc(i), 68)}L${point(arc(i), 116)}`} className="event-gridline"/>
      {bin.records.map((_, j) => <path key={j} d={wedge(arc(i) + span * .08, arc(i + 1) - span * .08,
        69 + 46 * j / max, 69 + 46 * (j + .94) / max)} className={i === index ? "event-active" : "event-mark"}/>)}
    </g>)}
    <path d={`M${point(arc(index + .5), 119)}L${point(arc(index + .5), 132)}`} className="event-hand"/>
    <text x="140" y="121" textAnchor="middle" className="event-dial-caption">LINKED RECORDS</text>
    <text x="140" y="157" textAnchor="middle" className="event-dial-count">{bins[index].records.length}</text>
    <text x="140" y="176" textAnchor="middle">{shortDate.format(Date.parse(bins[index].start))}</text>
    {[...new Set([0, Math.floor((bins.length - 1) / 2), bins.length - 1])].map(i => {
      const a = arc(i + .5), [x, y] = point(a, 121);
      const degrees = a * 180 / Math.PI;
      return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="event-date-tick"
        transform={`rotate(${Math.abs(degrees) > 90 ? degrees + 180 : degrees} ${x} ${y})`}>{shortDate.format(Date.parse(bins[i].start))}</text>;
    })}
  </>;
}

function CalendarTerrain({ bins, index, max }: { bins: Bin[]; index: number; max: number }) {
  const x = (i: number) => 26 + 564 * i / bins.length;
  const w = Math.min(48, 564 / bins.length * .78);
  const dy = 10;
  const h = 101 / max;
  return <>
    {[0, .5, 1].map(f => <path key={f} d={`M19,${146 - f * 101}H606`} className="event-gridline"/>)}
    <path d="M15 156H590l15-12H30Z" className="event-track"/>
    {bins.map((bin, i) => {
      const left = x(i) + (564 / bins.length - w) / 2;
      return <g key={bin.start}>
        <path d={`M${left},154l12,-${dy}`} className="event-gridline"/>
        {bin.records.map((_, j) => {
          const top = 151 - (j + 1) * h;
          return <g key={j} className={i === index ? "event-active" : "event-mark"}>
            <path d={`M${left},${top}h${w}v${h - Math.min(2, h * .1)}h-${w}Z`}/>
            <path d={`M${left},${top}l12,-${dy}h${w}l-12,${dy}Z`} className="event-top"/>
            <path d={`M${left + w},${top}l12,-${dy}v${h - Math.min(2, h * .1)}l-12,${dy}Z`} className="event-side"/>
          </g>;
        })}
      </g>;
    })}
    <path d={`M${x(index + .5)},161v8`} className="event-hand"/>
  </>;
}

export function EventTimeline({ records }: { records: readonly DatedRecord[] }) {
  const { prefs } = useLook();
  const dial = prefs.look === "dial";
  const bins = useMemo(() => binRecords(records), [records]);
  const [selected, setSelected] = useState<string>();
  const chosen = bins.findIndex(bin => bin.start === selected);
  const index = chosen < 0 ? bins.length - 1 : chosen;
  const bin = bins[index];
  if (!bin) return <RestInstrument label="Event timeline" status={{ kind:"unavailable", title:"No linked records with a usable event date" }}/>;
  const max = Math.max(...bins.map(item => item.records.length));
  function inspect(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "mouse" && !event.buttons) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    const fraction = dial ? .5 + Math.atan2(x - .5, .5 - y) / turn : (x * 620 - 26) / 564;
    setSelected(bins[Math.max(0, Math.min(bins.length - 1, Math.floor(fraction * bins.length)))].start);
  }
  const distinctDates = new Set(records.map(item => item.date)).size;
  return <div className="event-timeline">
    <div className="event-plate" data-centrepiece="true">
      <svg preserveAspectRatio={dial ? "xMidYMid meet" : "none"} viewBox={dial ? "0 0 280 280" : "0 0 620 180"} role="img" aria-label="Company event timeline, oldest to newest"
        onPointerDown={inspect} onPointerMove={inspect}>
        {dial ? <CalendarDial bins={bins} max={max} index={index}/> : <CalendarTerrain bins={bins} max={max} index={index}/>}
      </svg>
      {dial && <dl className="event-window"><div><dt>Linked records</dt><dd>{records.length}</dd></div>
        <div><dt>Distinct dates</dt><dd>{distinctDates}</dd></div></dl>}
    </div>
    <div className="event-inspection"><span>{dateLabel(bin)}</span><strong>{bin.records.length} {bin.records.length === 1 ? "record" : "records"}</strong>
      <small>{bin.records.length ? [...new Set(bin.records.map(item => item.title))].join(" · ") : "No linked records in this interval"}</small>
    </div>
    {bins.length > 1 && <div className="ins-scrub"><span>{bins[0].start}</span>
      <input type="range" aria-label="Inspect company event date" aria-valuetext={dateLabel(bin)} min={0} max={bins.length - 1} value={index}
        onChange={event => setSelected(bins[Number(event.target.value)].start)}/><span>{bins.at(-1)?.end}</span></div>}
    <p className="event-note">Each block marks one linked record in this selection. Dates run from oldest to newest.</p>
  </div>;
}
