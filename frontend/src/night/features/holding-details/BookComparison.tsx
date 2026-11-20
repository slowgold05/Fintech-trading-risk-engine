import { useState } from "react";
import { formatCurrency } from "../../../utils/format";
import { RestInstrument } from "../../inner";
import { useLook } from "../../looks/preferences";
import { numeric } from "../portfolio/valuation";
import type { HoldingLots } from "./lots";

const labels = ["Open basis", "Market value"];
const compact = new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", notation:"compact", maximumFractionDigits:1 });

function arc(radius: number, fraction: number) {
  const angle = (f: number) => (135 + 270 * f) * Math.PI / 180;
  const point = (f: number) => [160 + radius * Math.cos(angle(f)), 135 + radius * Math.sin(angle(f))].join(" ");
  return "M" + point(0) + " A" + radius + " " + radius + " 0 " + (fraction > 2/3 ? 1 : 0) + " 1 " + point(fraction);
}

export function BookComparison({ book }: { book: HoldingLots }) {
  const { prefs } = useLook();
  const [selected, setSelected] = useState(0);
  const values = [numeric(book.cost_basis_usd), book.mark ? numeric(book.market_value_usd) : null];
  const max = Math.max(...values.map(value => value ?? 0));
  // Use a common zero and a rounded ceiling for both independent USD readings.
  const step = max > 0 ? 10 ** Math.floor(Math.log10(max)) / 2 : 1;
  const ceiling = Math.ceil(max / step) * step;
  const dial = prefs.look === "dial";
  const selectedValue = values[selected];
  const display = selectedValue === null ? "Unavailable" : formatCurrency(selectedValue);
  return <div className="book-comparison">
    {max <= 0 ? <RestInstrument label="Book valuation" status={{kind:"unavailable",
      title:numeric(book.quantity) === 0 ? "This book has no open shares." : "A recorded basis or market value fills the comparison."}} /> :
    <div className="book-plate" data-centrepiece="true">
      {dial ? <svg viewBox="0 0 320 247" role="img" aria-label="Cost basis and market value on a common dollar scale">
        {Array.from({length:55}, (_,i) => {
          const angle = (135 + 5*i) * Math.PI / 180;
          const length = i%9 === 0 ? 9 : 4;
          return <path key={i} stroke="#9c9e94" d={`M${160+120*Math.cos(angle)} ${135+120*Math.sin(angle)}l${length*Math.cos(angle)} ${length*Math.sin(angle)}`}/>;
        })}
        {values.map((value,i) => <g key={labels[i]} fill="none" strokeWidth="13">
          <path d={arc(105-i*20,1)} stroke="#333632" />
          {value !== null && value > 0 && <path d={arc(105-i*20,value/ceiling)} stroke={i === selected ? "var(--accent)" : "#b0b3a8"} />}
        </g>)}
        <text x="160" y="119" textAnchor="middle">{labels[selected]}</text>
        <text className="book-dial-value" x="160" y="149" textAnchor="middle">{display}</text>
        <text x="70" y="240" textAnchor="middle">$0</text><text x="250" y="240" textAnchor="middle">{compact.format(ceiling)}</text>
      </svg> : <svg viewBox="0 0 460 190" role="img" aria-label="Cost basis and market value on a common dollar scale">
        {[0,.25,.5,.75,1].map(f => <g key={f}><path d={`M${24+390*f} 12v140`} className="ins-gridline"/><text x={24+390*f} y="176" textAnchor="middle">{compact.format(ceiling*f)}</text></g>)}
        {values.map((value,i) => {
          const y = 56+i*58, width = (value ?? 0)/ceiling*390;
          return <g key={labels[i]}>
            <text x="24" y={y-26}>{labels[i]}</text>
            <path d={`M24 ${y+15}h390`} stroke="#555954"/>
            {width > 0 && <g fill={selected === i ? "var(--accent)" : "#b1b3a9"}>
              <path d={`M24 ${y}h${width}v15H24Z`} opacity=".75"/>
              <path d={`M24 ${y}l12 -9h${width}l-12 9Z`}/>
              <path d={`M${24+width} ${y}l12 -9v15l-12 9Z`} opacity=".5"/>
            </g>}
            {value === null && <text x="24" y={y+5}>Unavailable</text>}
          </g>;
        })}
      </svg>}
    </div>}
    <div className="book-readings" aria-label="Inspect book amounts">
      {values.map((value,i) => <button type="button" key={labels[i]} aria-pressed={selected===i} disabled={max <= 0} onClick={()=>setSelected(i)}>
        <span>{labels[i]}</span><b>{value === null ? "Unavailable" : formatCurrency(value)}</b>
      </button>)}
    </div>
  </div>;
}
