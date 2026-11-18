import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { fetchMe } from "../../../api/auth";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Page, Panel, Stat, State, Table } from "../../kit";
import { safeReturnTo } from "../../registry";
import { ReturnChart } from "./ReturnChart";
import { dates, fetchReview, pct, periods, usd, type Period, type Review } from "./review";
import "./review.css";

function ReviewBody({ data }: { data: Review }) {
  const { metrics, exposure, contribution } = data;
  const gaps = new Set([...data.missing_sessions, ...data.points.filter(p => p.portfolio_return_ratio === null || p.spy_return_ratio === null).map(p => p.session_date)]);
  const spy = data.observations.find(o => o.symbol === "SPY");
  return <>
    <Page.Main>
      <Panel title="Period performance" subtitle={"Requested " + dates(data.requested_start, data.requested_end)} data-testid="portfolio-review-metrics">
        <div className="review-metrics"><Stat label="Account return" value={pct(metrics.return_ratio)} />
          <Stat label="SPY price return" value={pct(metrics.spy_return_ratio)} />
          <Stat label="Excess return" value={metrics.excess_return_ratio === null ? "Unavailable" : pct(metrics.excess_return_ratio).replace("%", " pp")} /></div>
        <p>Priced endpoints <strong>{dates(data.start_used, data.end_used)}</strong></p>
        <p>Coverage {data.coverage} · {data.valued_sessions} of {data.expected_sessions} sessions valued</p>
        <p>{spy ? "SPY · " + spy.provider + " · " + spy.basis.replaceAll("_", " ") + " · " + dates(spy.from_date, spy.to_date) : "SPY observations unavailable"}</p>
        {gaps.size > 0 && <details><summary>Inspect {gaps.size} sessions with gaps</summary>
          <ul>{Array.from(gaps).sort().map(date => {
            const p = data.points.find(row => row.session_date === date);
            return <li key={date}>{date} · Account {pct(p?.portfolio_return_ratio ?? null)} · SPY {pct(p?.spy_return_ratio ?? null)}</li>;
          })}</ul></details>}
      </Panel>
      <ReturnChart key={data.window} review={data} />
    </Page.Main>
    <Page.Aside>
      <Panel title="Current exposure" subtitle={formatUtcDateTime(exposure.as_of) ?? "Snapshot date unavailable"} data-testid="portfolio-review-exposure">
        <p>Market coverage {exposure.coverage}</p>
        <Stat label="Cash weight" value={pct(exposure.cash_weight_ratio)} />
        <Table caption="Sector share of account value including cash" rows={exposure.sectors} rowKey={row => row.sector} empty="No priced sectors."
          columns={[{key:"sector",header:"Sector",cell:r => r.sector}, {key:"value",header:"USD",align:"right",cell:r => usd(r.value_usd)},
            {key:"weight",header:"Weight",align:"right",cell:r => pct(r.weight_ratio)}]} />
        {exposure.unpriced_symbols.length > 0 && <p>Unpriced holdings · {exposure.unpriced_symbols.join(", ")}</p>}
      </Panel>
      <Panel title="Historical risk" subtitle={dates(data.start_used, data.end_used)}>
        <dl className="review-ledger">{[
          ["Maximum drawdown", pct(metrics.max_drawdown_ratio)], ["Annualized volatility", pct(metrics.annualized_volatility_ratio)],
          ["Beta to SPY", metrics.beta_to_spy === null ? "Unavailable" : Number(metrics.beta_to_spy).toFixed(3)],
          ["Correlation to SPY", metrics.correlation_to_spy === null ? "Unavailable" : Number(metrics.correlation_to_spy).toFixed(3)],
        ].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>{metrics.daily_sample_count} daily returns · {metrics.paired_sample_count} paired with SPY</p>
      </Panel>
    </Page.Aside>
    <Page.Full><Panel title="Period contribution" subtitle={"P&L in USD · " + dates(data.start_used, data.end_used)} data-testid="portfolio-review-contribution">
      <p>Contribution coverage {contribution.coverage} · Scope {contribution.scope}</p>
      {contribution.reason && <p>{contribution.reason}</p>}
      <Table caption="Contribution by holding" rows={contribution.items} rowKey={row => row.symbol} empty="No attributable amounts for this period."
        columns={[{key:"symbol",header:"Symbol",cell:r => r.symbol},{key:"pnl",header:"Period P&L (USD)",align:"right",cell:r => usd(r.pnl_usd)}]} />
      <p>Rounding or unattributed P&amp;L (USD) <strong>{usd(contribution.residual_usd)}</strong></p>
    </Panel>
    <details className="review-method"><summary>Calculation method and price sources</summary>
      <p>Excess return is the account return minus SPY’s price return, in percentage points. Drawdown measures the fall from an observed account peak.</p>
      <p>Daily returns use adjacent expected sessions. Volatility uses sample standard deviation × √252 with at least 20 daily returns.
        Beta divides sample covariance by SPY variance. Pearson correlation and beta require at least 20 matched returns and defined denominators.</p>
      <p>Period contribution uses closing value less opening value plus signed trade cash flows. It can include fully sold holdings.</p>
      <ul>{data.assumptions.map(item => <li key={item}>{item}</li>)}</ul>
      <Table caption="Observed marks" rows={data.observations} rowKey={r => [r.symbol,r.provider,r.basis,r.from_date].join("|")}
        columns={[{key:"symbol",header:"Symbol",cell:r => r.symbol},{key:"source",header:"Source and basis",cell:r => r.provider + " · " + r.basis.replaceAll("_"," ")},
          {key:"date",header:"Observed dates",cell:r => dates(r.from_date,r.to_date)}]} />
      <p>Read at {formatUtcDateTime(data.read_at) ?? "Unavailable"}</p>
    </details></Page.Full>
  </>;
}

export function PortfolioReview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("window") ?? "1m";
  const period = Object.hasOwn(periods, requested) ? requested as Period : "1m";
  const owner = useQuery({queryKey:keys.me,queryFn:fetchMe,retry:false});
  const review = useQuery({queryKey:keys.account(owner.data?.id ?? 0,"portfolio-review",period),
    queryFn:({signal}) => fetchReview(period,signal),enabled:!!owner.data?.id,retry:false});
  const back = safeReturnTo(params.get("returnTo") ?? "/portfolio");
  return <Page title="Portfolio review" className="portfolio-review" layout="analysis" testId="night-portfolio-review"
    actions={<div className="review-controls"><Link className="nk-button" to={back}>Back to portfolio</Link>
      <label>Review period <select value={period} onChange={e => {const next = new URLSearchParams(params); next.set("window",e.target.value); setParams(next);}}>
        {Object.entries(periods).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>}>
    {owner.isError || review.isError ? <Page.Full><State kind="error" title="Portfolio review could not be loaded"
      action={<Button onClick={() => void (owner.isError ? owner.refetch() : review.refetch())}>Retry review</Button>} /></Page.Full> :
      review.isPending ? <Page.Full><State kind="loading" title="Loading portfolio review…" /></Page.Full> : <ReviewBody data={review.data} />}
  </Page>;
}
