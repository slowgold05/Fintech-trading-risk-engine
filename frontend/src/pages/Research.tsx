import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { DailyHistory } from "../components/DailyHistory";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  SkeletonBlock,
} from "../features/dashboard/components";
import type { ResearchJob, ResearchReport } from "../types/schemas";
import { formatDateTime } from "../utils/format";

const pageDescription =
  "Preview AI-assisted research notes for a symbol. This does not place trades.";

const statusTone: Record<ResearchJob["status"], string> = {
  queued: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  running: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  completed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  failed: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  cancelled: "border-rose-400/40 bg-rose-400/10 text-rose-300",
};

function requestErrorMessage(error: unknown, fallback: string) {
  return isAxiosError(error)
    ? String(error.response?.data?.detail ?? fallback)
    : fallback;
}

function RefreshButton({ onClick, label = "Refresh" }: { onClick: () => void; label?: string }) {
  return (
    <button
      className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200"
      role="alert"
    >
      <p>{message}</p>
      <button
        className="mt-3 rounded-md border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-100"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      <SkeletonBlock className="h-14" />
      <SkeletonBlock className="h-14" />
      <SkeletonBlock className="h-14" />
    </div>
  );
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

function CreateResearchJobCard() {
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
      await queryClient.invalidateQueries({ queryKey: ["research-jobs"] });
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
    <DashboardCard title="Queue a research job">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Symbol
          </span>
          <input
            aria-label="Symbol"
            className="field-control font-mono"
            onChange={(event) => setSymbol(event.target.value)}
            required
            type="text"
            value={symbol}
          />
        </label>
        <p className="text-xs text-slate-500">This queues a research note. It does not place a trade.</p>
        <button className="primary-action" disabled={createMutation.isPending} type="submit">
          {createMutation.isPending ? "Queuing..." : "Queue job"}
        </button>
      </form>
      {errorMessage ? (
        <div
          className="mt-4 rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200"
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
    </DashboardCard>
  );
}

function ResearchJobRow({
  job,
  onViewReport,
}: {
  job: ResearchJob;
  onViewReport: (jobId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelMutation = useMutation({
    mutationFn: () => cancelResearchJob(job.id),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["research-jobs"] });
    },
    onError: (error) => {
      setErrorMessage(requestErrorMessage(error, "Research job could not be cancelled."));
    },
  });

  let action: ReactNode = null;
  if (job.status === "queued") {
    action = (
      <button
        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-50"
        disabled={cancelMutation.isPending}
        onClick={() => cancelMutation.mutate()}
        type="button"
      >
        Cancel
      </button>
    );
  } else if (job.status === "completed") {
    action = (
      <button
        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100"
        onClick={() => onViewReport(job.id)}
        type="button"
      >
        View report
      </button>
    );
  }

  return (
    <li className="rounded border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-100">{job.symbol}</span>
            <span className={["risk-chip", statusTone[job.status]].join(" ")}>
              {job.status}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{formatDateTime(job.created_at)}</div>
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

function ResearchJobsCard({ onViewReport }: { onViewReport: (jobId: number) => void }) {
  const jobsQuery = useQuery({
    queryKey: ["research-jobs"],
    queryFn: listResearchJobs,
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
          <ResearchJobRow job={job} key={job.id} onViewReport={onViewReport} />
        ))}
      </ul>
    );
  }

  return (
    <DashboardCard
      action={
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
    </DashboardCard>
  );
}

function ReportField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
        {value == null ? unavailableField() : value}
      </div>
    </div>
  );
}

function BackendDetail({ detail }: { detail: Record<string, unknown> }) {
  const signal = typeof detail.signal === "string" && detail.signal.length > 0 ? detail.signal : null;
  const entries = Object.entries(detail).filter(([key]) => signal == null || key !== "signal");

  return (
    <div className="space-y-3">
      {signal != null ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
        <div className="font-mono text-sm font-semibold text-slate-100">{report.symbol}</div>
        <div className="mt-1 text-xs text-slate-500">{formatDateTime(report.created_at)}</div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Sources
        </div>
        <ul className="mt-2 space-y-1 text-sm text-slate-300">
          {report.sources.map((source, index) => (
            <li key={`${source.type}-${source.status}-${index}`}>
              {source.type} — {source.status} ({source.detail})
            </li>
          ))}
        </ul>
      </div>
      <ReportField label="Bull case" value={report.bull_case} />
      <ReportField label="Bear case" value={report.bear_case} />
      <ReportField label="Synthesis" value={report.synthesis} />
      <ReportField label="Risks" value={report.risks} />
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
    queryFn: () => fetchMarketResearch(symbol),
  });

  if (query.isPending) return <SkeletonBlock className="h-10" />;
  if (query.isError || query.data.price == null) return null;

  const isUp = (query.data.change_percent ?? 0) >= 0;
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-2xl font-semibold text-slate-100">
        ${query.data.price.toFixed(2)}
      </span>
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
  return <DailyHistory value={symbol} />;
}

function ReportFilings({ symbol }: { symbol: string }) {
  const query = useQuery({
    queryKey: ["research-filings", symbol],
    queryFn: () => fetchResearchFilings(symbol),
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
              className="text-xs font-semibold text-sky-300 hover:underline"
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        SEC filings
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}

function ReportNews({ symbol }: { symbol: string }) {
  const query = useQuery({
    queryKey: ["research-news", symbol],
    queryFn: () => fetchResearchNews(symbol),
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
        message={query.data.error ?? "No recent news for this symbol."}
      />
    );
  } else {
    body = (
      <ul className="space-y-3">
        {query.data.articles.map((article) => (
          <li className="rounded border border-slate-800 bg-slate-900/60 p-3" key={article.url}>
            <a
              className="text-sm font-semibold text-slate-100 hover:underline"
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        News
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}

function ResearchReportCard({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const reportsQuery = useQuery({
    queryKey: ["research-reports"],
    queryFn: listResearchReports,
  });
  const report = reportsQuery.data?.reports.find((item) => item.job_id === jobId) ?? null;

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
        <ReportPriceHeader symbol={report.symbol} />
        <ReportChart symbol={report.symbol} />
        <ReportBody report={report} />
        <ReportFilings symbol={report.symbol} />
        <ReportNews symbol={report.symbol} />
      </div>
    );
  }

  return (
    <DashboardCard
      action={
        <button
          className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-100"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      }
      title="Research report"
    >
      {body}
    </DashboardCard>
  );
}

function ResearchBriefsCard() {
  const briefsQuery = useQuery({
    queryKey: ["research-briefs"],
    queryFn: listResearchBriefs,
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
          <li className="rounded border border-slate-800 bg-slate-900/60 p-3" key={brief.id}>
            <div className="font-mono text-sm font-semibold text-slate-100">{brief.brief_date}</div>
            <ul className="mt-2 space-y-1">
              {brief.entries.map((entry, index) => (
                <li className="text-sm text-slate-300" key={`${brief.id}-${entry.symbol}-${index}`}>
                  {entry.report_id == null
                    ? `${entry.symbol}: no report yet`
                    : `${entry.symbol}: report #${entry.report_id}`}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <DashboardCard
      action={
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
    </DashboardCard>
  );
}

export function Research() {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader description={pageDescription} title="Research Desk" />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <CreateResearchJobCard />
        <ResearchJobsCard onViewReport={setSelectedJobId} />
        {selectedJobId != null ? (
          <ResearchReportCard jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />
        ) : null}
        <ResearchBriefsCard />
      </div>
    </div>
  );
}
