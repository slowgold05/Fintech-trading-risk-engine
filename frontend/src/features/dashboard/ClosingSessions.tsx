import { useQuery } from "@tanstack/react-query";
import { fetchPortfolioPerformance } from "../../api/portfolio";
import { keys } from "../../night/api";
import { Button, Panel, Stat, State } from "../../night/kit";
import { formatCurrency, formatSignedPercent } from "../../utils/format";
import { amount, compareCloses, type CloseHistory, type Close } from "./closeComparison";

function Observation({ label, row }: { label: string; row: Close }) {
  return <div className="today-observation"><span>{label}</span>
    <strong>{formatCurrency(Number(row.account_value))}</strong><time>{row.session_date}</time></div>;
}

export function ClosingSessions({ owner }: { owner: number }) {
  const read = useQuery<CloseHistory>({ queryKey: keys.account(owner, "performance", "1y"),
    queryFn: fetchPortfolioPerformance, retry: false });
  const series = read.data?.series ?? [];
  const { latest, prior, gaps, newer, accountReturn, spyReturn } = compareCloses(series);
  const pnl = prior ? amount(latest?.daily_pnl) : null;
  const source = read.data?.demo_price_series?.SPY;
  const adjusted = read.data?.split_adjusted_history_sources?.SPY;
  const spySource = source ? [source.provider, source.adjustment.replace("_", " ")].join(" · ") :
    adjusted ? adjusted + " · split adjusted" : "Portfolio performance series";
  const absentSpy = [prior, latest].filter(row => row && amount(row.benchmark_index) == null).map(row => row!.session_date);
  return <Panel className="today-closes" title="Closing sessions" subtitle="Account value at the last two priced closes" data-testid="today-closes">
    {read.isError ? <State kind="error" title="Closing sessions could not be loaded" action={<Button onClick={() => void read.refetch()}>Retry history</Button>} /> :
      read.isPending ? <State kind="loading" title="Loading closing values…" /> :
      !latest ? <State kind="unavailable" title="No priced close in the past year" detail={series.length ? "The account is missing closing marks for its holdings." : "There are no recorded sessions in this account’s performance window."} /> :
        <>
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
                <small>SPY · {spySource}</small>}
              {accountReturn == null && <p>Account return needs a funded, comparable index at both closes.</p>}
            </>}
          {gaps.length > 0 && <p data-testid="today-gaps">Unpriced intervening sessions: {gaps.map(row => row.session_date).join(", ")}.</p>}
          {newer.length > 0 && <p>Later sessions without a complete valuation: {newer.map(row => row.session_date).join(", ")}.</p>}
        </>}
  </Panel>;
}
