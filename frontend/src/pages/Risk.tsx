import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../api/auth";
import { fetchPortfolio } from "../api/portfolio";
import { fetchRisk } from "../api/risk";
import { keys } from "../night/api";
import { Button, Page, Panel, RestInstrument, State, ValueGauge } from "../night/inner";
import { CompanyFactors } from "../night/features/portfolio/CompanyFactors";
import { accountWeight, hasMark, numeric } from "../night/features/portfolio/valuation";
import { formatCurrency, formatPercent } from "../utils/format";
import { getRiskLevel } from "../utils/riskTone";
import type { RiskAssessmentResponse } from "../types/schemas";
import "./Risk.css";

function tradeNotional(trade: RiskAssessmentResponse["trade"]) {
  if (!trade || numeric(trade.quantity) === null || numeric(trade.price_at_execution) === null) return null;
  return numeric(trade.quantity * trade.price_at_execution);
}
function scoreOf(row?: RiskAssessmentResponse) {
  const score = numeric(row?.risk_score);
  return score !== null && score >= 0 && score <= 100 ? score : null;
}

const rules = [
  { code: "MANY_TRADES_5MIN", reason: "At least 5 non-seed trades in the last 5 minutes", points: 40 },
  { code: "LARGE_TRADE", reason: "Trade notional of $10,000 or more", points: 30 },
];

export function Risk() {
  const me = useQuery({ queryKey: keys.me, queryFn: fetchMe, retry: false });
  if (me.isPending) return <RestInstrument label="Trade assessment" status={{kind:"loading", title:"Loading account…"}}/>;
  if (me.isError || !me.data.id) return <RestInstrument label="Trade assessment" status={{kind:"error", title:"Account unavailable", action:<Button onClick={() => void me.refetch()}>Retry account</Button>}}/>;
  return <AccountRisk key={me.data.id} owner={me.data.id} />;
}

function AccountRisk({ owner }: { owner: number }) {
  const risk = useQuery({ queryKey: keys.account(owner, "risk"), queryFn: fetchRisk, retry: false });
  const book = useQuery({ queryKey: keys.account(owner, "portfolio"), queryFn: fetchPortfolio, retry: false });
  const [selection, setSelection] = useState("");
  const rows = risk.isError ? [] : risk.data?.assessments ?? [];
  const latest = rows[0];
  const [assessmentId, setAssessmentId] = useState<number | null>(null);
  const inspected = rows.find(row => row.assessment_id === assessmentId) ?? latest;
  const score = scoreOf(inspected);
  const scoreStatus = risk.isError ? {kind:"error" as const, title:"Risk assessments could not be loaded",
    action:<Button onClick={() => void risk.refetch()}>Retry</Button>} :
    risk.isPending ? {kind:"loading" as const, title:"Loading scored trades…"} :
    !latest ? {kind:"empty" as const, title:"No trade assessments yet.", detail:"A trade must be assessed before it has a score."} :
    score === null ? {kind:"unavailable" as const, title:inspected === latest ? "Latest trade score unavailable." : "Trade score unavailable."} : undefined;
  const alerts = rows.flatMap(row => row.alerts);
  const positions = book.isError ? [] : book.data?.positions ?? [];
  const symbols = [...new Set([...positions.map(row => row.symbol), ...rows.flatMap(row => row.trade ? [row.trade.symbol] : [])])].sort();
  const symbol = symbols.includes(selection) ? selection : symbols.includes(latest?.trade?.symbol ?? "") ? latest.trade!.symbol : symbols[0];
  const position = positions.find(row => row.symbol === symbol);
  const wholeBook = book.data?.valuation_status !== "incomplete" && positions.every(hasMark);
  const weight = book.data && !book.isError && wholeBook
    ? accountWeight(position ? position.position_value : 0, numeric(book.data.summary.total_account_value)) : null;
  const notionals = rows.map(row => tradeNotional(row.trade));
  const priced = notionals.filter((value): value is number => value !== null);
  return <Page title="Risk" className="risk-workbench" eyebrow="Trade assessments">
    <div className="risk-split">
      <Panel className="risk-assessment" title={inspected === latest ? "Latest Trade Risk Score" : "Historical Trade Risk Score"}
        subtitle="Behavioral score recorded at execution" actions={rows.length > 1 && <select className="field-control"
          aria-label="Inspect trade assessment" value={inspected.assessment_id} onChange={e => setAssessmentId(Number(e.target.value))}>
          {rows.map((row,i) => <option key={row.assessment_id} value={row.assessment_id}>{i === 0 ? "Latest · " : ""}{row.trade?.symbol ?? "Trade"} #{row.trade_id}</option>)}
        </select>}>
        <div className="risk-meter">
          <div className="risk-meter-id"><small>{inspected?.trade?.symbol ?? "Trade assessment"}</small>
            <strong>{score === null ? "—" : getRiskLevel(score)}</strong>
            {inspected && <p>{inspected.trade?.side ?? "Side unavailable"} · trade #{inspected.trade_id}<br/>
              Assessed {inspected.created_at.slice(0, 10)}{inspected.trade?.demo_seed && <><br/>Seeded demo trade</>}</p>}
          </div>
          <div className="risk-scale" role={score !== null ? "img" : undefined} aria-label={score !== null ? `Risk score ${score} of 100, ${getRiskLevel(score)}` : undefined}>
            <ValueGauge centrepiece={score !== null} label="Score / 100" value={score} min={0} max={100} format={String}/>
          </div>
        </div>
        {scoreStatus ? <State {...scoreStatus}/> : <dl className="score-bands" aria-label="Score levels">
          {([["Low","0–49"],["Medium","50–79"],["High","80–100"]] as const).map(([level,range]) =>
            <div key={level} data-current={score !== null && level === getRiskLevel(score)}><dt>{level}</dt><dd>{range}</dd></div>)}</dl>}
        {inspected && score !== null && <div className="risk-trigger-note">
          <small>Recorded on this trade</small>
          {inspected.alerts.length ? <ul>{inspected.alerts.map((alert,i) => <li key={i}>{alert.reason}</li>)}</ul> : <p>No alerts recorded.</p>}
        </div>}
      </Panel>
    <Panel className="risk-company" title="Company price factors" subtitle="One month of stored price observations" actions={symbol &&
      <select aria-label="Company for price factors" className="field-control" value={symbol} onChange={event => setSelection(event.target.value)}>
        {symbols.map(s => <option key={s}>{s}</option>)}</select>}>
      {symbol ? <CompanyFactors symbol={symbol} /> : book.isPending || risk.isPending ? <State kind="loading" title="Loading symbols…" /> :
        <State kind="unavailable" title="No company symbol available" detail="Company factors use symbols from available holdings and assessed trades." />}
      <div className="risk-weight"><strong>Current account weight</strong><span>{symbol && weight !== null ? formatPercent(weight) : "Unavailable"}</span>
        <small>{symbol ?? "No symbol selected"} · includes cash in total account value. {book.isError ? "Holdings could not be loaded." : !wholeBook ? "Missing marks prevent a complete valuation." : ""}</small>
        {book.isError && <Button onClick={() => void book.refetch()}>Retry holdings</Button>}</div>
    </Panel>
    </div>
    <div className="risk-context">
      <Panel className="risk-rules" title="Trade scoring rules" subtitle="Points added when a rule fires at execution">
        <dl>{rules.map(rule => <div key={rule.code}><dt>{rule.reason}<small>{rule.code}</small></dt><dd>+{rule.points}</dd></div>)}</dl>
      </Panel>

      {!risk.isError && <Panel title="Assessed Trade Notional" subtitle="Includes buys and sells in the loaded assessments.">
      {risk.isPending ? <State kind="loading" title="Loading trade values…" /> : <><strong className="notional-value">{priced.length ? formatCurrency(priced.reduce((sum, n) => sum + n, 0)) : "Unavailable"}</strong>
        <p>{priced.length} of {rows.length} trades with a quantity and execution price · {alerts.length ? `${alerts.length} assessment alerts` : "No assessment alerts."}</p></>}
    </Panel>}
    </div>
    {!risk.isError && <Panel title="Assessment Feed" subtitle="Up to 50 scored trades, newest first. Each alert gives the recorded rule and reason.">
      {risk.isPending ? <State kind="loading" title="Loading assessments…" /> : rows.length === 0 ? <State kind="empty" title="No assessments yet." /> :
        <div className="risk-feed"><table><thead><tr><th>Trade</th><th>Score</th><th>Notional</th><th>Recorded alerts</th></tr></thead>
          <tbody>{rows.map((row, i) => <tr key={row.assessment_id}><td><b>{row.trade?.symbol ?? "Symbol unavailable"}</b><small>{row.trade?.side ?? "Side unavailable"} · #{row.trade_id} · {row.trade?.executed_at.slice(0, 10) ?? "Execution date unavailable"}{row.trade?.demo_seed && " · demo seed"}</small></td>
            <td data-label="Score">{scoreOf(row) ?? "Unavailable"}</td><td data-label="Notional">{notionals[i] === null ? "Unavailable" : formatCurrency(notionals[i])}</td>
            <td data-label="Alerts">{row.alerts.length === 0 ? "None recorded" : row.alerts.map((alert, j) => <div key={j}><b>{alert.rule_code}</b><small>{alert.severity} · {alert.reason}</small></div>)}</td></tr>)}</tbody></table></div>}
    </Panel>}
  </Page>;
}
