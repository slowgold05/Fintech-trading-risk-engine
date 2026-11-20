import { useLook } from "../../looks/preferences";
import { RankedRow, ShareInstrument, State, type InstrumentStatus } from "../../inner";
import type { Ranking } from "./leaderboardApi";

const categories = ["Gained", "Unchanged", "Declined"];
const countFormat = new Intl.NumberFormat("en-US").format;

// The service suppresses the standings for fewer than two comparable demos.
// Keep the scale visible without assigning suppressed participants to a direction.
function RestScale() {
  const { prefs } = useLook();
  return prefs.look === "terrain" ? <svg viewBox="0 0 300 155" className="breadth-rest" role="img" aria-label="Unfilled return distribution">
    <g fill="none" stroke="#686d68">
      <path d="M24 53l38-24h214v80l-38 24H24Z M24 53h214l38-24 M238 53v80" />
      {[0,1,2,3,4,5,6,7,8].map(i=><path key={i} stroke="#424643" strokeDasharray="2 4" d={`M24 ${53+i*10}h214l38-24`} />)}
    </g>
  </svg> : <svg className="breadth-rest" viewBox="0 0 240 240" role="img" aria-label="Unfilled return distribution">
    <g fill="none" stroke="#52564f"><circle cx="120" cy="120" r="110"/><circle cx="120" cy="120" r="92"/><circle cx="120" cy="120" r="67"/></g>
    {Array.from({length:72},(_,i)=><line key={i} x1="120" x2="120" y1="12" y2={i%6===0?25:18} transform={`rotate(${i*5} 120 120)`} stroke="#8c9186" />)}
    <text x="120" y="119" textAnchor="middle" fill="var(--ink)" fontSize="28">—</text>
    <text x="120" y="143" textAnchor="middle" fill="var(--muted)" fontSize="11">Ranked demos</text>
  </svg>;
}

export function ReturnBreadth({ board, status }: { board?: Ranking; status?: InstrumentStatus }) {
  if (!board || status) return <>
    <div className="breadth-body"><RestScale /><div>{categories.map(name=><RankedRow key={name} name={name} max={0} value={null} display="—" />)}</div></div>
    {status && <State {...status} />}
  </>;
  const parts = categories.map(name => ({name,value:0}));
  for (const row of board.items) {
    const value = Number(row.return_ratio);
    parts[value > 0 ? 0 : value < 0 ? 2 : 1].value++;
  }
  return <ShareInstrument centrepiece label="Eligible demos by direction of return" parts={parts.sort((a,b)=>b.value-a.value)}
    total={board.items.length} format={countFormat} />;
}
