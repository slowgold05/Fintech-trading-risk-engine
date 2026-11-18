import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { fetchMarketResearch } from "../api/market";
import {
  cancelResearchJob,
  createResearchJob,
  fetchResearchFilings,
  fetchResearchNews,
  listResearchBriefs,
  listResearchJobs,
  listResearchReports,
} from "../api/research";
import { apiClient } from "../api/client";
import { keys } from "../night/api";
import { Button, Field, Page, Panel, State } from "../night/kit";
import { DeskAccount, EmptyState, LoadingRows, QueryError, RefreshButton } from "../night/features/desks/DeskStates";
import { StoredContext } from "../night/features/desks/StoredContext";
import "../night/features/desks/research.css";
import type { ResearchJob, ResearchReport } from "../types/schemas";
import { formatDateTime } from "../utils/format";

const DailyHistory = lazy(() => import("../components/DailyHistory").then(module => ({ default: module.DailyHistory })));

function requestErrorMessage(error: unknown, fallback: string) {
  return isAxiosError(error)
    ? String(error.response?.data?.detail ?? fallback)
    : fallback;
}

function unavailableField() {
  return <span className="text-slate-400">Unavailable</span>;
}

function formatDetailValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function CreateResearchJobCard({ owner }: { owner: number }) {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queuedSymbol, setQueuedSymbol] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: (nextSymbol: string) => createResearchJob(nextSymbol),
    onSuccess: async (job) => {
      setErrorMessage(null);
      setQueuedSymbol(job.symbol);
      setSymbol("");
      await queryClient.invalidateQueries({ queryKey: keys.account(owner, "research", "jobs") });
    },
    onError: (error) => {
      setQueuedSymbol(null);
      setErrorMessage(requestErrorMessage(error, "Research job could not be queued."));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = symbol.trim();
    if (trimmed.length === 0) {
      return;
    }
    setErrorMessage(null);
    setQueuedSymbol(null);
    createMutation.mutate(trimmed);
  }

  return (
    <Panel title="Queue a research job">
      <form className="desk-inline-form" onSubmit={handleSubmit}>
        <Field id="research-job-symbol" label="Symbol"><input maxLength={20} required value={symbol} onChange={event => setSymbol(event.target.value)} /></Field>
        <Button variant="primary" busy={createMutation.isPending} type="submit">{createMutation.isPending ? "Queuing…" : "Queue job"}</Button>
      </form>
      <p className="mt-3 desk-meta">Jobs gather source records. Generated analysis requires an enabled synthesis model.</p>
      {errorMessage ? (
        <div
          className="desk-alert"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}
      {queuedSymbol ? (
        <p className="mt-4 text-sm text-slate-300" role="status">
          Research job queued for {queuedSymbol}.
        </p>
      ) : null}
    </Panel>
  );
}

function ResearchJobRow({
  job,
  owner,
  onViewReport,
}: {
  job: ResearchJob;
  owner: number;
  onViewReport: (jobId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelMutation = useMutation({
    mutationFn: () => cancelResearchJob(job.id),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: keys.account(owner, "research", "jobs") });
    },
    onError: (error) => {
      setErrorMessage(requestErrorMessage(error, "Research job could not be cancelled."));
    },
  });

  let action: ReactNode = null;
  if (job.status === "queued") {
    action = (
      <Button
        disabled={cancelMutation.isPending}
        onClick={() => cancelMutation.mutate()}
        type="button"
      >
        Cancel
      </Button>
    );
  } else if (job.status === "completed") {
    action = (
      <Button
        onClick={() => onViewReport(job.id)}
        type="button"
      >
        View report
      </Button>
    );
  }

  return (
    <li className="desk-record">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-100">{job.symbol}</span>
            <span className="desk-status" data-status={job.status}>
              {job.status}
            </span>
          </div>
          <div className="mt-1 desk-meta">Job #{job.id} · Updated {formatDateTime(job.updated_at)}</div>
        </div>
        {action}
      </div>
      {job.error_message ? (
        <p className="mt-2 text-xs text-slate-500">{job.error_message}</p>
      ) : null}
      {errorMessage ? <p className="mt-2 text-xs text-rose-300">{errorMessage}</p> : null}
    </li>
  );
}

function ResearchJobsCard({ owner, onViewReport }: { owner: number; onViewReport: (jobId: number) => void }) {
  const jobsQuery = useQuery({
    queryKey: keys.account(owner, "research", "jobs"),
    queryFn: listResearchJobs,
    retry: false,
    refetchInterval: query => query.state.data?.jobs.some(job => job.status === "queued" || job.status === "running") ? 5000 : false,
  });

  let body: ReactNode;
  if (jobsQuery.isPending) {
    body = <LoadingRows />;
  } else if (jobsQuery.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(jobsQuery.error, "Research jobs could not be loaded.")}
        onRetry={() => {
          void jobsQuery.refetch();
        }}
      />
    );
  } else if (jobsQuery.data.jobs.length === 0) {
    body = <EmptyState message="No research jobs yet." />;
  } else {
    body = (
      <ul className="space-y-3">
        {jobsQuery.data.jobs.map((job) => (
          <ResearchJobRow owner={owner} job={job} key={job.id} onViewReport={onViewReport} />
        ))}
      </ul>
    );
  }

  return (
    <Panel
      actions={
        jobsQuery.isError ? undefined : (
          <RefreshButton
            onClick={() => {
              void jobsQuery.refetch();
            }}
          />
        )
      }
      title="Research jobs"
    >
      {body}
    </Panel>
  );
}

function ReportField({ label, value }: { label: string; value: string | null }) {
  return <div className="report-field">
    <dt>{label}</dt>
    <dd>{value == null ? unavailableField() : value}</dd>
  </div>;
}

function BackendDetail({ detail }: { detail: Record<string, unknown> }) {
  const signal = typeof detail.signal === "string" && detail.signal.length > 0 ? detail.signal : null;
  const entries = Object.entries(detail).filter(([key]) => signal == null || key !== "signal");

  return (
    <div className="space-y-3">
      {signal != null ? (
        <div>
          <div className="desk-meta">
            Signal
          </div>
          <div className="mt-1">
            <span className="status-badge border-slate-700 bg-slate-900 text-slate-300">{signal}</span>
          </div>
        </div>
      ) : null}
      {entries.length > 0 ? (
        <dl>
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{formatDetailValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function ReportBody({ report }: { report: ResearchReport }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Stored analysis</h3>
      </div>
      <div>
        <div className="desk-meta">
          Sources
        </div>
        {!report.sources.length && <p>No source records stored.</p>}
        <ul className="mt-2 space-y-1 text-sm text-slate-300">
          {report.sources.map((source, index) => (
            <li key={`${source.type}-${source.status}-${index}`}>
              {source.type.replace(/^sec_/, "SEC ").replaceAll("_", " ")} · {source.status === "ok" ? "Available" : source.status.replaceAll("_", " ")} · {source.detail}
            </li>
          ))}
        </ul>
      </div>
      <dl className="report-fields">
        <ReportField label="Bull case" value={report.bull_case} />
        <ReportField label="Bear case" value={report.bear_case} />
        <ReportField label="Synthesis" value={report.synthesis} />
        <ReportField label="Risks" value={report.risks} />
      </dl>
      {report.model_version || report.prompt_version ? (
        <p className="text-xs text-slate-500">
          {report.model_version ? `Model ${report.model_version}` : null}
          {report.model_version && report.prompt_version ? " · " : null}
          {report.prompt_version ? `Prompt ${report.prompt_version}` : null}
        </p>
      ) : null}
      {report.backend_detail != null ? <BackendDetail detail={report.backend_detail} /> : null}
    </div>
  );
}

function ReportPriceHeader({ symbol }: { symbol: string }) {
  const query = useQuery({
    queryKey: ["research-price", symbol],
    queryFn: () => fetchMarketResearch(symbol), retry: false,
  });

  if (query.isPending) return <LoadingRows />;
  if (query.isError) return <QueryError message="Market context could not be loaded." onRetry={query.refetch} />;
  if (query.data.price == null) return <State kind="unavailable" title="Price unavailable" />;

  const isUp = (query.data.change_percent ?? 0) >= 0;
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <span className="font-mono text-2xl font-semibold text-slate-100">
        ${query.data.price.toFixed(2)}
      </span>
      <small>{query.data.price_source ?? "Source unavailable"} · {query.data.price_as_of ?? "Date unavailable"} · {(query.data.price_basis ?? query.data.adjustment_type ?? "Basis unavailable").replaceAll("_", " ")}</small>
      {query.data.detail_available && <Link className="desk-link" to={`/market/${encodeURIComponent(symbol)}`}>Company record</Link>}
      {query.data.change_percent != null ? (
        <span className={isUp ? "text-sm text-emerald-400" : "text-sm text-rose-400"}>
          {isUp ? "+" : ""}
          {query.data.change_percent.toFixed(2)}%
        </span>
      ) : null}
    </div>
  );
}

function ReportChart({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Inspect daily price history</summary>
    {open && <Suspense fallback={<LoadingRows />}><DailyHistory value={symbol} /></Suspense>}
  </details>;
}

function ReportFilings({ symbol }: { symbol: string }) {
  const query = useQuery({
    queryKey: ["research-filings", symbol],
    queryFn: () => fetchResearchFilings(symbol), retry: false,
  });

  let body: ReactNode;
  if (query.isPending) {
    body = <LoadingRows />;
  } else if (query.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(query.error, "SEC filings could not be loaded.")}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (query.data.filings.length === 0) {
    body = <EmptyState message="No recent SEC filings." />;
  } else {
    body = (
      <ul className="space-y-2">
        {query.data.filings.map((filing) => (
          <li className="flex items-center justify-between gap-3 text-sm" key={filing.accession_number}>
            <span className="text-slate-300">
              {filing.form ?? "Filing"} — {filing.filing_date ?? "Unknown date"}
            </span>
            <a
              className="desk-link"
              href={filing.document_url}
              rel="noreferrer"
              target="_blank"
            >
              View
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <div className="desk-meta">
        SEC filings
      </div>
      {query.data && <small>{query.data.source} · Retrieved {formatDateTime(query.data.fetched_at)}</small>}
      <div className="mt-2">{body}</div>
    </div>
  );
}

function ReportNews({ symbol }: { symbol: string }) {
  const query = useQuery({
    queryKey: ["research-news", symbol],
    queryFn: () => fetchResearchNews(symbol), retry: false,
  });

  let body: ReactNode;
  if (query.isPending) {
    body = <LoadingRows />;
  } else if (query.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(query.error, "News could not be loaded.")}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (query.data.articles.length === 0) {
    body = (
      <EmptyState
        message="No recent news for this symbol."
      />
    );
  } else {
    body = (
      <ul className="space-y-3">
        {query.data.articles.map((article) => (
          <li className="desk-record" key={article.url}>
            <a
              className="desk-link"
              href={article.url}
              rel="noreferrer"
              target="_blank"
            >
              {article.headline}
            </a>
            <div className="mt-1 text-xs text-slate-500">
              {article.source} · {formatDateTime(article.published_at)}
            </div>
            {article.summary ? (
              <p className="mt-2 text-sm text-slate-300">{article.summary}</p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <div className="desk-meta">
        News
      </div>
      {query.data?.error && <State kind="unavailable" title="News source unavailable" detail={query.data.error} />}
      <div className="mt-2">{body}</div>
    </div>
  );
}

function ResearchReportCard({ owner, jobId, reportId, onClose }: { owner: number; jobId: number | null; reportId: number | null; onClose: () => void }) {
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, [jobId, reportId]);
  const reportsQuery = useQuery({
    queryKey: keys.account(owner, "research", "reports", reportId),
    retry: false,
    queryFn: async () => reportId === null ? listResearchReports() : {
      reports: [(await apiClient.get<ResearchReport>(`/research/reports/${reportId}`)).data],
    },
  });
  const report = reportsQuery.data?.reports.find((item) => reportId === null ? item.job_id === jobId : item.id === reportId) ?? null;

  let body: ReactNode;
  if (reportsQuery.isPending) {
    body = <LoadingRows />;
  } else if (reportsQuery.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(reportsQuery.error, "Research reports could not be loaded.")}
        onRetry={() => {
          void reportsQuery.refetch();
        }}
      />
    );
  } else if (report == null) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-slate-300">
          Report not found yet for this job. It may still be writing — try refreshing.
        </p>
        <RefreshButton
          label="Refresh reports"
          onClick={() => {
            void reportsQuery.refetch();
          }}
        />
      </div>
    );
  } else {
    body = (
      <div className="space-y-5">
        <h3 className="text-xl font-semibold">{report.symbol} · Report #{report.id}</h3>
        <p className="desk-meta">Job #{report.job_id} · Stored {formatDateTime(report.created_at)}</p>
        {report.synthesis == null && <State kind="unavailable" title="Generated synthesis unavailable" detail="The stored report contains source records without a synthesis." />}
        <ReportPriceHeader symbol={report.symbol} />
        <ReportChart symbol={report.symbol} />
        <ReportBody report={report} />
        <ReportFilings symbol={report.symbol} />
        <ReportNews symbol={report.symbol} />
      </div>
    );
  }

  return <div className="desk-section" ref={heading} tabIndex={-1} aria-label="Selected research report">
    <Panel title="Research report" actions={<Button onClick={onClose}>Close</Button>}>{body}</Panel>
  </div>;
}

function BriefReportLink({ id, symbol }: { id: number; symbol: string }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete("job");
  next.set("report", String(id));
  return <Link className="desk-link" to={{ search: next.toString() }}>{symbol}: report #{id}</Link>;
}

function ResearchBriefsCard({ owner }: { owner: number }) {
  const briefsQuery = useQuery({
    queryKey: keys.account(owner, "research", "briefs"),
    queryFn: listResearchBriefs, retry: false,
  });

  let body: ReactNode;
  if (briefsQuery.isPending) {
    body = <LoadingRows />;
  } else if (briefsQuery.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(briefsQuery.error, "Daily briefs could not be loaded.")}
        onRetry={() => {
          void briefsQuery.refetch();
        }}
      />
    );
  } else if (briefsQuery.data.briefs.length === 0) {
    body = <EmptyState message="No daily briefs yet." />;
  } else {
    body = (
      <ul className="space-y-3">
        {briefsQuery.data.briefs.map((brief) => (
          <li className="desk-record" key={brief.id}>
            <div className="font-mono text-sm font-semibold text-slate-100">{brief.brief_date}</div>
            <ul className="mt-2 space-y-1">
              {brief.entries.map((entry, index) => (
                <li className="text-sm text-slate-300" key={`${brief.id}-${entry.symbol}-${index}`}>
                  {entry.report_id == null
                    ? `${entry.symbol}: no report yet`
                    : <BriefReportLink id={entry.report_id} symbol={entry.symbol} />}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Panel
      actions={
        briefsQuery.isError ? undefined : (
          <RefreshButton
            onClick={() => {
              void briefsQuery.refetch();
            }}
          />
        )
      }
      title="Daily briefs"
    >
      {body}
    </Panel>
  );
}

function selectedId(value: string | null) {
  return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function ResearchDesk({ owner }: { owner: number }) {
  const [params, setParams] = useSearchParams();
  const [symbol, setSymbol] = useState("AAPL");
  const [showSources, setShowSources] = useState(false);
  const jobId = selectedId(params.get("job"));
  const reportId = selectedId(params.get("report"));
  const opener = useRef<HTMLElement | null>(null);
  function selectJob(id: number | null) {
    const next = new URLSearchParams(params);
    next.delete("report");
    if (id !== null) next.set("job", String(id));
    else next.delete("job");
    setParams(next);
    if (id === null) opener.current?.focus();
  }

  return <Page className="desk-page research-desk" title="Research Desk" description="Inspect stored prices, source records and research jobs for your account.">
    {(jobId !== null || reportId !== null) && <Page.Full><ResearchReportCard owner={owner} jobId={jobId} reportId={reportId} onClose={() => selectJob(null)} /></Page.Full>}
    <Page.Main className="desk-stack">
      <StoredContext symbol={symbol} onSymbol={setSymbol} />
      <Panel title={`${symbol} source records`}>
        <details onToggle={event => setShowSources(event.currentTarget.open)}>
          <summary>Browse news and SEC filings</summary>
          {showSources && <div className="research-sources"><ReportNews symbol={symbol} /><ReportFilings symbol={symbol} /></div>}
        </details>
      </Panel>
    </Page.Main>
    <Page.Aside className="desk-stack" onClickCapture={event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button,a") : null;
      if (target) opener.current = target;
    }}>
      <CreateResearchJobCard owner={owner} />
      <ResearchJobsCard owner={owner} onViewReport={selectJob} />
      <ResearchBriefsCard owner={owner} />
    </Page.Aside>
  </Page>;
}

export function Research() {
  return <DeskAccount>{owner => <ResearchDesk key={owner} owner={owner} />}</DeskAccount>;
}
