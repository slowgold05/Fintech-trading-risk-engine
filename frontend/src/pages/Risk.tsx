import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../api/auth";
import { fetchPortfolio } from "../api/portfolio";
import { fetchRisk } from "../api/risk";
import { keys } from "../night/api";
import { Button, Page, Panel, State } from "../night/kit";
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
  if (me.isPending) return <State kind="loading" title="Loading account…" />;
  if (me.isError || !me.data.id) return <State kind="error" title="Account unavailable" action={<Button onClick={() => void me.refetch()}>Retry account</Button>} />;
  return <AccountRisk key={me.data.id} owner={me.data.id} />;
}

function AccountRisk({ owner }: { owner: number }) {
  const risk = useQuery({ queryKey: keys.account(owner, "risk"), queryFn: fetchRisk, retry: false });
  const book = useQuery({ queryKey: keys.account(owner, "portfolio"), queryFn: fetchPortfolio, retry: false });
  const [selection, setSelection] = useState("");
  const rows = risk.isError ? [] : risk.data?.assessments ?? [];
  const latest = rows[0];
  const score = scoreOf(latest);
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
  return <Page title="Risk" className="risk-workbench" description="Trade behavior, position weights and company price history.">
    <div className="risk-split">
      <Panel className="risk-assessment" title="Latest Trade Risk Score" subtitle="Newest recorded assessment">
        {risk.isError ? <State kind="error" title="Risk assessments could not be loaded" action={<Button onClick={() => void risk.refetch()}>Retry</Button>} /> :
          risk.isPending ? <State kind="loading" title="Loading scored trades…" /> :
          !latest ? <State kind="empty" title="No trade assessments yet." detail="A trade must be assessed before it has a score." /> :
          score === null ? <State kind="unavailable" title="Latest trade score unavailable." /> :
          <><div role="img" aria-label={`Risk score ${score} of 100, ${getRiskLevel(score)}`} className="assessment-reading">
            <strong>{score}</strong><span>/ 100</span><b>{getRiskLevel(score)}</b>
          </div><p>{latest.trade?.symbol ?? "Symbol unavailable"} · {latest.trade?.side ?? "Side unavailable"} · trade #{latest.trade_id} · assessed {latest.created_at.slice(0, 10)}{latest.trade?.demo_seed && " · seeded demo trade"}</p></>}
      </Panel>
      <Panel className="risk-rules" title="Trade scoring rules" subtitle="Points added when a rule fires at execution">
        <dl>{rules.map(rule => <div key={rule.code}><dt>{rule.reason}<small>{rule.code}</small></dt><dd>+{rule.points}</dd></div>)}</dl>
      </Panel>
    </div>
    <Panel className="risk-company" title="Company price factors" subtitle="One month of stored price observations" actions={symbol &&
      <select aria-label="Company for price factors" className="field-control" value={symbol} onChange={event => setSelection(event.target.value)}>
        {symbols.map(s => <option key={s}>{s}</option>)}</select>}>
      {symbol ? <CompanyFactors symbol={symbol} /> : book.isPending || risk.isPending ? <State kind="loading" title="Loading symbols…" /> :
        <State kind="unavailable" title="No company symbol available" detail="Company factors use symbols from available holdings and assessed trades." />}
      <div className="risk-weight"><strong>Current account weight</strong><span>{symbol && weight !== null ? formatPercent(weight) : "Unavailable"}</span>
        <small>{symbol ?? "No symbol selected"} · includes cash in total account value. {book.isError ? "Holdings could not be loaded." : !wholeBook ? "Missing marks prevent a complete valuation." : ""}</small>
        {book.isError && <Button onClick={() => void book.refetch()}>Retry holdings</Button>}</div>
    </Panel>
    {!risk.isError && <><Panel title="Assessment Feed" subtitle="Up to 50 scored trades, newest first. Each alert gives the recorded rule and reason.">
      {risk.isPending ? <State kind="loading" title="Loading assessments…" /> : rows.length === 0 ? <State kind="empty" title="No assessments yet." /> :
        <div className="risk-feed"><table><thead><tr><th>Trade</th><th>Score</th><th>Notional</th><th>Recorded alerts</th></tr></thead>
          <tbody>{rows.map((row, i) => <tr key={row.assessment_id}><td><b>{row.trade?.symbol ?? "Symbol unavailable"}</b><small>{row.trade?.side ?? "Side unavailable"} · #{row.trade_id} · {row.trade?.executed_at.slice(0, 10) ?? "Execution date unavailable"}{row.trade?.demo_seed && " · demo seed"}</small></td>
            <td data-label="Score">{scoreOf(row) ?? "Unavailable"}</td><td data-label="Notional">{notionals[i] === null ? "Unavailable" : formatCurrency(notionals[i])}</td>
            <td data-label="Alerts">{row.alerts.length === 0 ? "None recorded" : row.alerts.map((alert, j) => <div key={j}><b>{alert.rule_code}</b><small>{alert.severity} · {alert.reason}</small></div>)}</td></tr>)}</tbody></table></div>}
    </Panel><Panel title="Assessed Trade Notional" subtitle="Includes buys and sells in the loaded assessments.">
      {risk.isPending ? <State kind="loading" title="Loading trade values…" /> : <><strong className="notional-value">{priced.length ? formatCurrency(priced.reduce((sum, n) => sum + n, 0)) : "Unavailable"}</strong>
        <p>{priced.length} of {rows.length} trades with a quantity and execution price · {alerts.length ? `${alerts.length} assessment alerts` : "No assessment alerts."}</p></>}
    </Panel></>}
  </Page>;
}
