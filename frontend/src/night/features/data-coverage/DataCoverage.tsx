import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link, useSearchParams } from "react-router-dom";
import { fetchMe } from "../../../api/auth";
import { fetchMarketUniverse } from "../../../api/market";
import { useAuth } from "../../../context/useAuth";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import { Button, DataStamp, Field, Page, Panel, State, Stat } from "../../kit";
import { hasCompanyDetail } from "../discover/companyLookup";
import { readCoverage, type CoverageReport, type SymbolCoverage } from "./coverage";
import "./coverage.css";

const count = (n: number) => n.toLocaleString("en-US");
const basisLabel = (basis: string) => basis === "split_adjusted" ? "Split-adjusted" : "Raw";
const quoteStates = [
  ["fresh_eod", "Fresh close"], ["stale", "Stale"], ["invalid", "Invalid"],
  ["unconfirmed_or_other", "Unconfirmed or other"], ["missing", "Missing"],
] as const;

function CompanyLink({ symbol }: { symbol: string }) {
  const { isAuthenticated } = useAuth();
  const identity = useQuery({ queryKey: keys.me, queryFn: fetchMe, enabled: isAuthenticated, retry: false });
  const viewer = isAuthenticated ? identity.data?.id : "public";
  const universe = useQuery({
    queryKey: keys.universe(viewer ?? "public", symbol, 20), queryFn: () => fetchMarketUniverse(symbol),
    enabled: viewer !== undefined, retry: false,
  });
  const item = universe.data?.items.find(item => item.symbol === symbol);
  return viewer !== undefined && item && hasCompanyDetail(item) ?
    <Link className="coverage-link" to={'/market/' + encodeURIComponent(symbol)}>Open {symbol} company view</Link> : null;
}

function Lookup({ initial, onSubmit }: { initial: string; onSubmit: (input: string) => void }) {
  const [value, setValue] = useState(initial);
  const [previous, setPrevious] = useState(initial);
  if (previous !== initial) { setPrevious(initial); setValue(initial); }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(value.trim().toUpperCase());
  }
  return <form onSubmit={submit} className="coverage-lookup">
    <Field id="coverage-ticker" label="Inspect a symbol">
      <input data-testid="data-coverage-symbol" value={value} onChange={e => setValue(e.target.value)}
        placeholder="Ticker, e.g. AAPL" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
    </Field>
    <Button type="submit" variant="primary">Look up</Button>
  </form>;
}

function SymbolDetail({ item }: { item: SymbolCoverage }) {
  const { quote, history, reason, symbol } = item;
  return <Panel title={symbol + " coverage"} data-testid="data-coverage-detail">
    {quote ? <div className="coverage-reference">
      <Stat label="Stored quote · USD" value={quote.price} />
      <p>Execution reference · <strong>{quote.execution_reference}</strong></p>
      <DataStamp source={quote.source} />
      <small>Observed {formatUtcDateTime(quote.source.observed_at) ?? "time unavailable"}</small>
    </div> : <State kind="unavailable" title="Execution reference unavailable" />}
    {reason && <p className="coverage-note">{reason}</p>}
    {history.map(row => <div className="coverage-source" key={row.provider + row.basis}>
      <h3>{row.provider} · {basisLabel(row.basis)} history</h3>
      <p><strong>{row.observed_sessions} of {row.expected_sessions}</strong> expected sessions observed</p>
      <small>{row.start} through {row.end}</small>
      <p>Flagged or rejected sessions · {row.flagged_or_rejected_sessions}</p>
      {row.missing_recent_sessions.length > 0 && <p>Missing sessions · {row.missing_recent_sessions.join(", ")}</p>}
    </div>)}
    {history.length === 0 && <p>No stored daily history for this symbol.</p>}
    <CompanyLink symbol={symbol} />
  </Panel>;
}

function Census({ report }: { report: CoverageReport }) {
  const { quotes, universe } = report;
  return <Panel title="Quote census" subtitle="Active US equity listings, excluding test issues and ETFs."
    data-testid="data-coverage-census">
    <div className="coverage-headline"><strong>{count(quotes.present)}</strong><span>of {count(universe.eligible)} listings have a stored quote</span></div>
    {universe.eligible > 0 && <div className="coverage-meter" aria-hidden="true">
      <span style={{ width: (100 * quotes.present / universe.eligible) + "%" }} />
    </div>}
    <dl className="coverage-states">{quoteStates.map(([key, label]) =>
      <div key={key}><dt>{label}</dt><dd>{count(quotes[key])}</dd></div>)}</dl>
    <p className="coverage-note">A fresh confirmed close can supply the ticket reference. Preview and risk checks still apply.</p>
  </Panel>;
}

function StoredHistory({ report }: { report: CoverageReport }) {
  return <Panel title="Daily history" subtitle="Valid bars in the quote census population, grouped by stored source and price basis.">
    {report.history.length === 0 && <State kind="empty" title="No stored daily bars" />}
    {report.history.map(row => <div key={row.provider + row.basis} className="coverage-source">
      <h3>{row.provider} · {basisLabel(row.basis)}</h3>
      <p>Latest valid session · {row.latest_valid_session ?? "Unavailable"}</p>
      <dl className="coverage-states">
        {([["Valid rows", row.valid_rows], ["Symbols", row.valid_symbols], ["On expected session", row.valid_symbols_on_expected_session],
          ["Flagged rows", row.flagged_rows], ["Rejected rows", row.rejected_rows]] as const).map(([label, value]) =>
            <div key={label}><dt>{label}</dt><dd>{count(value)}</dd></div>)}
      </dl>
    </div>)}
    <p className="coverage-note">Recent symbol windows follow the standard NYSE schedule and free-plan delay. Irregular closures and gaps in the archive can affect the counts.</p>
  </Panel>;
}

export function DataCoverage() {
  const [params, setParams] = useSearchParams();
  const symbol = params.get("symbol")?.trim().toUpperCase() || null;
  const query = useQuery({ queryKey: keys.feature("data-coverage", { symbol }),
    queryFn: ({ signal }) => readCoverage(symbol, signal), retry: false });
  function lookup(value: string) {
    if ((value || null) === symbol) { void query.refetch(); return; }
    const next = new URLSearchParams(params);
    if (value) next.set("symbol", value);
    else next.delete("symbol");
    setParams(next);
  }
  const report = query.data;
  const status = isAxiosError(query.error) ? query.error.response?.status : undefined;
  return <Page title="Data coverage" className="coverage-page" testId="night-data-coverage"
    description="Stored quotes, daily bars and reference feeds." actions={<Button busy={query.isFetching} onClick={() => void query.refetch()}>Refresh coverage</Button>}>
    <Page.Full className="coverage-toolbar">
      <div><span>Last expected session</span><strong>{report?.expected_session ?? "Unavailable"}</strong>
        {report && <small>Cache read {formatUtcDateTime(report.read_at)} · {report.coverage} coverage</small>}</div>
      <Lookup initial={symbol ?? ""} onSubmit={lookup} />
    </Page.Full>
    {query.isError ? <Page.Full><State kind={status === 404 ? "unavailable" : "error"}
      title={status === 404 ? "Unknown symbol · " + symbol : status === 422 ? "Check the ticker symbol" : "Coverage could not be loaded"}
      detail={status === 404 || status === 422 ? "Enter a listed ticker or clear the lookup to see the market census." : "Retry to read the selected cache report."}
      action={<Button onClick={() => void query.refetch()}>Retry coverage</Button>} /></Page.Full> :
      !report ? <Page.Full><State kind="loading" title="Reading the stored cache…" /></Page.Full> :
      <>
        <Census report={report} />
        {report.symbol && <SymbolDetail item={report.symbol} />}
        <StoredHistory report={report} />
        <Panel title="Reference feeds">
          {(["news", "filings"] as const).map(key => <div className="coverage-feed" key={key}>
            <h3>{key === "news" ? "News" : "Filings"}</h3><p>{count(report.reference[key].cached_rows)} cached rows</p>
            <small>Latest observation · {formatUtcDateTime(report.reference[key].latest_observed_at) ?? "Unavailable"}</small>
          </div>)}
          <p className="coverage-note">Dividends and splits require verified events. Price bars alone cannot establish either.</p>
        </Panel>
      </>}
  </Page>;
}
