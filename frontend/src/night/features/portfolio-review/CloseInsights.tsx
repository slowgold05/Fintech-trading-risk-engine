import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../api/client";
import { formatUtcDateTime } from "../../../utils/format";
import { keys, type Coverage, type Provenance } from "../../api";
import { Button, DataStamp, Panel, State } from "../../kit";
import { dates, pct, periods, usd, type Period } from "./review";
import "./insights.css";

const rules = {close_change:"Close-to-close change",spy_comparison:"SPY comparison",largest_holding:"Largest holding",coverage_gap:"Valuation coverage"};
type Rule = keyof typeof rules;
type Surface = "today" | "portfolio";
type Evidence = {label:string;value:string | number;unit:"usd"|"ratio"|"count";from_date:string;to_date:string;source:Provenance|null};
type InsightRead = {surface:Surface;read_at:string;coverage:Coverage;items:{rule:Rule;text:string;evidence:Evidence[]}[];omitted:{rule:Rule;reason:string}[]};
function figure(row:Evidence) {
  if (row.unit === "usd") return usd(String(row.value)) + " USD";
  if (row.unit === "ratio") return pct(String(row.value));
  return String(row.value);
}

export function CloseInsights({owner,surface}: {owner:number;surface:Surface}) {
  const [window,setWindow] = useState<Period>("1m");
  const windowOrNull = surface === "portfolio" ? window : null;
  const query = useQuery({queryKey:keys.account(owner,"close-insights",surface,windowOrNull),retry:false,
    queryFn:async ({signal}) => (await apiClient.get<InsightRead>("/night/portfolio/insights",{
      params:windowOrNull ? {surface,window:windowOrNull} : {surface},signal})).data});
  const result = query.data;
  return <Panel className="close-insights" title="Close insights" data-testid="night-close-insights"
    subtitle={result && "Coverage " + result.coverage + " · Read " + (formatUtcDateTime(result.read_at) ?? "date unavailable")}
    actions={surface === "portfolio" && <label>Insight period <select value={window} onChange={e => setWindow(e.target.value as Period)}>
      {Object.entries(periods).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>}>
    {query.isError ? <State kind="error" title="Close insights could not be loaded" action={<Button onClick={() => void query.refetch()}>Retry insights</Button>} /> :
      query.isPending ? <State kind="loading" title="Loading closing figures…" /> : <>
        {result?.items.length ? <ul className="insight-items">{result.items.map(item => <li key={item.rule}>
          <p>{item.text}</p>
          {item.evidence.length > 0 && <details><summary>{rules[item.rule]} evidence</summary>
            <dl>{item.evidence.map((row,i) => <div key={row.label + i}>
              <dt>{row.label.replaceAll("_"," ")}</dt><dd><b>{figure(row)}</b> · {dates(row.from_date,row.to_date)}
                {row.source && <DataStamp source={row.source} />}</dd>
            </div>)}</dl></details>}
        </li>)}</ul> : <State kind="unavailable" title="No supported closing figures for this period" />}
        {!!result?.omitted.length && <details><summary>Omitted figures ({result.omitted.length})</summary>
          <ul>{result.omitted.map(item => <li key={item.rule}><strong>{rules[item.rule]}</strong> · {item.reason}</li>)}</ul>
        </details>}
      </>}
  </Panel>;
}
