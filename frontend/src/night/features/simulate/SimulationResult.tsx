import { DataStamp, Panel, State } from "../../kit";
import { PriceChart } from "./PriceChart";
import { money, type Request, type Simulation } from "./simulation";

export function SimulationResult({ result, request }: { result: Simulation; request: Request }) {
  const missing = result.coverage === "missing" || result.points.length < 2;
  const coverageSentence = result.assumptions.find(s => s.startsWith("Used ") || s.startsWith("At least two usable sessions"));
  return <section className="sim-result" data-testid="simulation-result" aria-label={result.symbol + " simulation result"}>
    <Panel className="sim-outcome" title={result.symbol + " outcome"} subtitle={result.start_used && result.end_used ?
      "Used sessions · " + result.start_used + " – " + result.end_used : undefined}>
      <div className="sim-source"><span>End-of-day source</span><DataStamp source={result.source} /></div>
      {missing ? <State kind="unavailable" title="Insufficient stored closes" detail={coverageSentence ?? "This run requires two usable sessions."} /> :
        <>
          <dl className="sim-totals"><div><dt>Ending value</dt><dd>{money(result.end_value_usd)}</dd></div>
            <div><dt>Total contributed</dt><dd>{money(result.contributed_usd)}</dd></div></dl>
          <PriceChart result={result} request={request} />
        </>}
    </Panel>
    <Panel title="Coverage & assumptions" className="sim-method">
      <div className="sim-coverage"><strong>{result.coverage === "available" ? "Full session coverage" :
        result.coverage === "partial" ? "Partial session coverage" : result.coverage === "missing" ? "Missing session coverage" : "Stale session coverage"}</strong>
        {!missing && coverageSentence && <p>{coverageSentence}</p>}
        <p>Requested window · {request.start} – {request.end}</p>
      </div>
      {result.mode === "recurring" && !missing && <p className="sim-skipped"><strong>Skipped contribution months</strong> · {result.skipped_months.join(", ") || "None"}</p>}
      <ul>{result.assumptions.filter(s => s !== coverageSentence).map(s => <li key={s}>{s}</li>)}</ul>
    </Panel>
  </section>;
}
