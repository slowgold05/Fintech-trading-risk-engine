import { State, Table } from "../../kit";
import { priceMove, sourceLabel } from "./marketRead";
import { ParticipationPage, type Participation } from "./Participation";

function BreadthCounts({ data }: { data: Participation }) {
  if (!data.covered_count) return <State kind="unavailable" title="No covered stock moves in this selection." detail="Direction shares need at least one compatible pair of closes." />;
  const groups = [
    { label: "Advancing", count: data.advancing, tone: "up" },
    { label: "Declining", count: data.declining, tone: "down" },
    { label: "Flat", count: data.flat, tone: "flat" },
  ];
  return <>
    <figure className="direction-counts"><figcaption>Direction among {data.covered_count.toLocaleString("en-US")} covered stocks</figcaption>
      {groups.map(group => {
        const share = group.count / data.covered_count;
        return <div className="direction" key={group.label}>
          <span>{group.label}</span><div className="track" aria-hidden="true"><i data-direction={group.tone} style={{width: `${share * 100}%`}} /></div>
          <strong>{group.count.toLocaleString("en-US")}</strong><span>{(share * 100).toFixed(1)}%</span>
        </div>;
      })}
    </figure>
    <details className="stock-observations"><summary>View {data.items.length} stock observations</summary>
      <Table caption="Stocks with compatible closes" rows={data.items} rowKey={r => r.symbol} columns={[
        { key: "symbol", header: "Symbol", cell: r => r.symbol },
        { key: "move", header: "Price move", align: "right", cell: r => priceMove(r.move) },
        { key: "source", header: "Source and basis", cell: r => sourceLabel(r.source) },
      ]} />
    </details>
  </>;
}

export function Breadth() {
  return <ParticipationPage title="Stock breadth" description="Count advancing, declining and unchanged stocks across two stored sessions."
    id="night-breadth" marker="breadth-counts">{data => <BreadthCounts data={data} />}</ParticipationPage>;
}
