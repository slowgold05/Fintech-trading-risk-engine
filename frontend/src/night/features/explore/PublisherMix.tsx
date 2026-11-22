import { useLook } from "../../looks/preferences";
import { RankedRow, type Share } from "../../inner";
import { polar, sector } from "../../inner/geometry";

type Props = { parts: Share[]; selected: string; onSelect: (publisher: string) => void };
const shades = ["#b3b5ae", "#92968e", "#7b8079", "#686f68"];

export function PublisherMix({ parts, selected, onSelect }: Props) {
  const dial = useLook().prefs.look === "dial";
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const current = parts.find(p => p.name === selected)!;
  const leaves = parts.flatMap((part, i) => Array.from({ length: part.value },
    () => ({ publisher: part.name, shade: shades[i % shades.length] })));
  return <div className="publisher-mix">
    <div className="publisher-plate" data-centrepiece="true">
      <svg viewBox={dial ? "0 0 320 320" : "0 0 340 165"} role="img" aria-label={`${selected}, ${current.value} of ${total} sourced headlines`}>
        {dial ? <><circle cx="160" cy="160" r="150" fill="#1d201b" stroke="#62675f"/>
          {Array.from({length:80}, (_, i) => {
            const a = i * Math.PI / 40;
            return <path key={i} stroke="#a3a69d" d={`M${polar(a,148)}L${polar(a, i % 5 ? 143 : 137)}`}/>;
          })}
          <circle cx="160" cy="160" r="89" fill="#101210" stroke="#62675f"/>
          <text x="160" y="146" textAnchor="middle" className="publisher-hub-label">HEADLINE SHARE</text>
          <text x="160" y="179" textAnchor="middle" className="publisher-hub-value">{Math.round(100 * current.value / total)}%</text>
          <text x="160" y="200" textAnchor="middle" className="publisher-hub-label">{current.value} of {total}</text></>
          : <><path d="M37 143h212l52-29H90Z" fill="#292d2a" stroke="#575d58"/>
            <text x="21" y="141" textAnchor="end">0</text><text x="21" y="44" textAnchor="end">{total}</text></>}
        {leaves.map(({ publisher, shade }, unit) => {
          const active = publisher === selected;
          const fill = active ? "var(--accent)" : shade;
          const h = 98 / total, top = 139 - h * (unit + 1);
          const start = 2 * Math.PI * unit / total, end = 2 * Math.PI * (unit + 1) / total;
          return <g key={unit} className="publisher-leaves" onClick={() => onSelect(publisher)}>
            {dial ? <path d={sector(start + .008, end - .008, 94, 133)} fill={fill}/> : <>
              <path d={`M38,${top}h211v${h}H38Z`} fill={active ? "#a39075" : fill} stroke="#252825" strokeWidth=".65"/>
              <path d={`M249,${top}l49,-27v${h}l-49,27Z`} fill={active ? "#77634c" : "#686d66"} stroke="#272b27" strokeWidth=".55"/>
              <path d={`M38,${top}h6v${h}h-6Z`} fill={fill}/>
              {unit === total - 1 && <path d={`M38,${top}l49,-27h211l-49,27Z`} fill={active ? "#b6aa96" : "#8d928a"} stroke="#2a2d2a"/>}
            </>}
          </g>;
        })}
      </svg>
    </div>
    <div className="publisher-register">
      <div className="publisher-heading"><span>{selected}</span><strong>{current.value} <small>/ {total} headlines</small></strong></div>
      <div className="publisher-rows">{parts.map(p => <RankedRow key={p.name} {...p} display={p.value} max={total}
        selected={p.name === selected} onSelect={() => onSelect(p.name)}/>)}</div>
      <label className="publisher-select">Inspect publisher<select value={selected} onChange={e => onSelect(e.target.value)}>
        {parts.map(p => <option value={p.name} key={p.name}>{p.name} · {p.value}</option>)}
      </select></label>
    </div>
  </div>;
}
