import type { MarketResearchResponse } from "../../types/schemas";
import { type Vars } from "../../ui/lib";

const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

export function FilingFigures({ data }: { data: MarketResearchResponse["fundamentals"] }) {
  if (!data) return null;
  const amounts = [["Revenue", data.revenue], ["Net income", data.net_income]] as const;
  const reported = amounts.filter((entry): entry is readonly ["Revenue" | "Net income", number] => entry[1] != null && Number.isFinite(entry[1]));
  if (!reported.length) return null;
  const scale = Math.max(1, ...reported.map(([,value]) => Math.abs(value)));
  return <div className="filing">
    <p className="lbl">Reported financials{data.source && ` / ${data.source}`}</p>
    {reported.map(([label, value]) => <div className="filing-row" key={label}>
      <span>{label}</span><strong className="num">{compact.format(value)}</strong>
      <i aria-hidden="true" style={{ "--value": Math.abs(value) / scale } as Vars} />
    </div>)}
  </div>;
}
