import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPortfolioPerformance } from "../../api/portfolio";
import { keys } from "../../night/api";
import { Button, Panel, RestInstrument, SeriesInstrument, Stat, State } from "../../night/inner";
import { formatCurrency, formatSignedPercent } from "../../utils/format";
import { amount, compareCloses, type CloseHistory, type Close } from "./closeComparison";

const names = ["Closing value"];
const emptySeries: Close[] = [];

function Observation({ label, row }: { label: string; row: Close }) {
  return <div className="today-observation"><span>{label}</span>
    <strong>{formatCurrency(Number(row.account_value))}</strong><time>{row.session_date}</time></div>;
}

export function ClosingSessions({ owner }: { owner: number }) {
  const read = useQuery<CloseHistory>({ queryKey: keys.account(owner, "performance", "1y"),
    queryFn: fetchPortfolioPerformance, retry: false });
  const series = read.data?.series ?? emptySeries;
  const [inspected, setInspected] = useState<string>();
  const { latest, prior, gaps, newer, accountReturn, spyReturn, samples } = useMemo(() => {
    const closes = compareCloses(series);
    const end = closes.latest ? series.indexOf(closes.latest) + 1 : 0;
    const samples = series.slice(Math.max(0, end - 30)).map(row => ({
      label: row.session_date, values: [row.status === "unavailable" ? null : amount(row.account_value)],
    }));
    return { ...closes, samples };
  }, [series]);
  const latestDate = latest?.session_date;
  const selected = samples.findIndex(row => row.label === (inspected ?? latestDate));
  const pnl = prior ? amount(latest?.daily_pnl) : null;
  const source = read.data?.demo_price_series?.SPY;
  const adjusted = read.data?.split_adjusted_history_sources?.SPY;
  const spySource = source ? [source.provider, source.adjustment.replace("_", " ")].join(" · ") :
    adjusted ? adjusted + " · split adjusted" : "Portfolio performance series";
  const absentSpy = [prior, latest].filter(row => row && amount(row.benchmark_index) == null).map(row => row!.session_date);
  return <Panel className="today-closes" title="Closing sessions" subtitle="Account value through the latest priced close · USD" data-testid="today-closes">
    {read.isError ? <RestInstrument label="Closing value" status={{kind:"error",title:"Closing sessions could not be loaded",action:<Button onClick={() => void read.refetch()}>Retry history</Button>}} /> :
      read.isPending ? <RestInstrument label="Closing value" status={{kind:"loading",title:"Loading closing values…"}} /> :
      !latest ? <><RestInstrument label="Closing value" status={{kind:"unavailable",title:"No priced close in the past year"}} /><p>{series.length ? "The account is missing closing marks for its holdings." : "There are no recorded sessions in this account’s performance window."}</p></> :
        <>
          <SeriesInstrument samples={samples} names={names} format={formatCurrency} label="Inspect closing value"
            selected={selected < 0 ? samples.findIndex(row => row.label === latestDate) : selected} onSelect={i => setInspected(samples[i].label)} />
          <div className="today-observations">
            <Observation label="Latest close" row={latest} />
            {prior && <Observation label="Previous priced close" row={prior} />}
          </div>
          {!prior ? <State kind="unavailable" title="First priced close" detail="A second priced session is needed to compare the account and SPY." /> :
            <>
              <div className="today-returns">
                <Stat label="Interval P&L" value={pnl == null ? null : formatCurrency(pnl)} />
                <Stat label="Account return" value={accountReturn == null ? null : formatSignedPercent(accountReturn)} />
                <Stat label="SPY price return" value={spyReturn == null ? null : formatSignedPercent(spyReturn)} />
              </div>
              <p>Account return removes deposits and withdrawals between these closes. SPY measures price change over the same dates and excludes dividends.</p>
              {spyReturn == null ? <p data-testid="today-benchmark-missing">{absentSpy.length ? "SPY has no usable benchmark observation on " + absentSpy.join(" or ") + "." : "SPY’s starting index cannot support a return."}</p> :
                <details className="today-basis"><summary>SPY · {spySource}</summary>
                  <p>A split-adjusted close accounts for share splits across chart dates. A raw close records the session’s traded price. Check the execution price on the order receipt.</p>
                </details>}
              {accountReturn == null && <p>Account return needs a funded, comparable index at both closes.</p>}
            </>}
          {gaps.length > 0 && <p data-testid="today-gaps">Unpriced intervening sessions: {gaps.map(row => row.session_date).join(", ")}.</p>}
          {newer.length > 0 && <p>Later sessions without a complete valuation: {newer.map(row => row.session_date).join(", ")}.</p>}
        </>}
  </Panel>;
}
