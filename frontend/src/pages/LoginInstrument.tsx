import { useLook } from "../night/looks/preferences";
import { polar, sector } from "../night/inner/geometry";
import { Panel } from "../night/inner";

type Entry = { label: string; filled: boolean };
type Props = { entries: Entry[]; status: string; destination: string; resting: boolean };

export function LoginInstrument({ entries, status, destination, resting }: Props) {
  const dial = useLook().prefs.look === "dial";
  const filled = entries.filter(entry => entry.filled).length;
  const label = `${filled} of ${entries.length} required fields filled`;
  const divisions = 40;
  return <Panel className="auth-instrument" title="Session entry" subtitle={destination}>
    <div className="auth-plate" data-centrepiece="true">
      {dial ? <svg role="img" aria-label={label} viewBox="0 0 320 320">
        <circle cx="160" cy="160" r="146" fill="#171b17" stroke="#55594f" />
        {Array.from({length:80}, (_, i) => <path key={i} d={`M${polar(i*Math.PI/40,143)}L${polar(i*Math.PI/40,i%5===0?131:138)}`} stroke="#9ca193" />)}
        {entries.map((entry, i) => {
          const start = i * 2 * Math.PI / entries.length + .015;
          const end = (i+1) * 2 * Math.PI / entries.length - .015;
          return <path key={entry.label} d={sector(start,end,97,125)} fill={entry.filled && !resting ? "var(--accent)" : "#3e443b"} />;
        })}
        <circle cx="160" cy="160" r="89" fill="none" stroke="#44483e"/>
        <text x="160" y="158" textAnchor="middle" className="auth-counter">{filled} / {entries.length}</text>
        <text x="160" y="182" textAnchor="middle" className="auth-engraving">FIELDS FILLED</text>
      </svg> : <svg role="img" aria-label={label} viewBox="0 0 530 184">
        <path d="M16 139h453l45-30H61Z" fill="#272b29" stroke="#5f645f"/>
        {entries.map((entry,i) => {
          const width = 442 / entries.length;
          const x = 22 + i * width;
          const raised = entry.filled && !resting;
          const y = raised ? 78 : 98;
          return <g key={entry.label}>
            <path d={`M${x} ${y}l42 -27h${width-4}l-42 27Z`} fill={raised ? "#b8ac91" : "#626962"} stroke="#272a28"/>
            <path d={`M${x} ${y}h${width-4}V132H${x}Z`} fill={raised ? "var(--accent)" : "#404540"} stroke="#282b28"/>
            <path d={`M${x+width-4} ${y}l42-27v${132-y}l-42 27Z`} fill="#363b35" stroke="#292d29"/>
            {Array.from({length:divisions/entries.length},(_, j) => {
              const tick = x + j * 442 / divisions;
              return <path key={j} d={`M${tick} ${y}l42 -27`} stroke="#323732" strokeWidth=".75"/>;
            })}
            <text x={x+8} y="121" className="auth-block-label">{entry.label.toUpperCase()}</text>
          </g>;
        })}
        <path d="M22 152h442" stroke="#757a73"/>
        {Array.from({length:divisions+1},(_,i) => <path key={i} d={`M${22+i*442/divisions} 152v${i%5===0?9:4}`} stroke="#92978e"/>)}
        <text x="22" y="42" className="auth-engraving">REQUIRED FIELDS</text>
        <text x="464" y="42" textAnchor="end" className="auth-counter">{filled} / {entries.length}</text>
      </svg>}
      <div className="auth-register"><span>Entry status</span><strong>{status}</strong>
        <dl>{entries.map(entry => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.filled ? "Filled" : "Required"}</dd></div>)}</dl>
      </div>
    </div>
  </Panel>;
}
