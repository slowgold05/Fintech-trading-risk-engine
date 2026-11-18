import { useId, useState } from "react";
import type { HistoryBar } from "../api/history";
import { formatCurrency, formatQuantity } from "../utils/format";

export function StockDetailSession({ bars }: { bars: readonly HistoryBar[] }) {
  const sessionId = useId();
  const [date, setDate] = useState("");
  const bar = bars.find((row) => row.session_date === date) ?? bars.at(-1);
  if (!bar) return null;
  return <details className="company-session">
    <summary>Inspect a daily bar</summary>
    <div className="company-session-field">
      <label htmlFor={sessionId}>Exchange session</label>
      <select id={sessionId} value={bar.session_date} onChange={(event) => setDate(event.target.value)}>
        {bars.slice().reverse().map((row) => <option key={row.session_date}>{row.session_date}</option>)}
      </select>
    </div>
    <dl aria-live="polite">
      {(["open", "high", "low", "close", "volume"] as const).map((metric) =>
        <div key={metric}><dt>{metric}</dt><dd>{metric === "volume" ?
          formatQuantity(Number(bar.volume)) : formatCurrency(Number(bar[metric]))}</dd></div>)}
    </dl>
  </details>;
}
