import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchDailyHistory } from "../api/history";
import {
  cancelForecastJob,
  createForecastJob,
  listForecastEvaluations,
  listForecastJobs,
  listForecastModels,
  listForecastResults,
  type CreateForecastJobBody,
} from "../api/forecasts";
import { ForecastChart } from "../components/ForecastChart";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  SkeletonBlock,
} from "../features/dashboard/components";
import type { ForecastEvaluation, ForecastJob, ForecastResult } from "../types/schemas";
import { formatDateTime } from "../utils/format";

const pageDescription =
  "Preview model-generated price paths from cached history. This is not a prediction and places no trades.";

const statusTone: Record<ForecastJob["status"], string> = {
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

function CreateForecastJobCard() {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("");
  const [provider, setProvider] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("");
  const [lookback, setLookback] = useState("");
  const [horizon, setHorizon] = useState("");
  const [sampleCount, setSampleCount] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queuedSymbol, setQueuedSymbol] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: (body: CreateForecastJobBody) => createForecastJob(body),
    onSuccess: async (job) => {
      setErrorMessage(null);
      setQueuedSymbol(job.symbol);
      setSymbol("");
      setProvider("");
      setAdjustmentType("");
      setLookback("");
      setHorizon("");
      setSampleCount("");
      await queryClient.invalidateQueries({ queryKey: ["forecast-jobs"] });
    },
    onError: (error) => {
      setQueuedSymbol(null);
      setErrorMessage(requestErrorMessage(error, "Forecast job could not be queued."));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedSymbol = symbol.trim();
    const trimmedProvider = provider.trim();
    const trimmedAdjustment = adjustmentType.trim();
    const lookbackText = lookback.trim();
    const horizonText = horizon.trim();
    const sampleCountText = sampleCount.trim();
    if (
      trimmedSymbol.length === 0 ||
      trimmedProvider.length === 0 ||
      trimmedAdjustment.length === 0 ||
      lookbackText.length === 0 ||
      horizonText.length === 0 ||
      sampleCountText.length === 0
    ) {
      return;
    }
    setErrorMessage(null);
    setQueuedSymbol(null);
    createMutation.mutate({
      symbol: trimmedSymbol,
      provider: trimmedProvider,
      adjustment_type: trimmedAdjustment,
      lookback: Number(lookbackText),
      horizon: Number(horizonText),
      sample_count: Number(sampleCountText),
    });
  }

  return (
    <DashboardCard title="Queue a forecast job">
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
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Provider
          </span>
          <input
            aria-label="Provider"
            className="field-control font-mono"
            onChange={(event) => setProvider(event.target.value)}
            required
            type="text"
            value={provider}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Adjustment type
          </span>
          <input
            aria-label="Adjustment type"
            className="field-control font-mono"
            onChange={(event) => setAdjustmentType(event.target.value)}
            required
            type="text"
            value={adjustmentType}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Lookback
          </span>
          <input
            aria-label="Lookback"
            className="field-control font-mono"
            min={1}
            onChange={(event) => setLookback(event.target.value)}
            required
            step={1}
            type="number"
            value={lookback}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Horizon
          </span>
          <input
            aria-label="Horizon"
            className="field-control font-mono"
            min={1}
            onChange={(event) => setHorizon(event.target.value)}
            required
            step={1}
            type="number"
            value={horizon}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Sample count
          </span>
          <input
            aria-label="Sample count"
            className="field-control font-mono"
            min={1}
            onChange={(event) => setSampleCount(event.target.value)}
            required
            step={1}
            type="number"
            value={sampleCount}
          />
        </label>
        <p className="text-xs text-slate-500">
          This queues one generated path from cached history. It does not place a trade. The symbol
          must already be in this app's market list.
        </p>
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
          Forecast job queued for {queuedSymbol}.
        </p>
      ) : null}
    </DashboardCard>
  );
}

function ForecastJobRow({
  job,
  onViewForecast,
}: {
  job: ForecastJob;
  onViewForecast: (jobId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelMutation = useMutation({
    mutationFn: () => cancelForecastJob(job.id),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["forecast-jobs"] });
    },
    onError: (error) => {
      setErrorMessage(requestErrorMessage(error, "Forecast job could not be cancelled."));
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
        onClick={() => onViewForecast(job.id)}
        type="button"
      >
        View forecast
      </button>
    );
  }

  return (
    <li className="rounded border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-100">{job.symbol}</span>
            <span className={["risk-chip", statusTone[job.status]].join(" ")}>{job.status}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {job.provider} · {job.adjustment_type} · lookback {job.lookback} · horizon {job.horizon}{" "}
            · samples {job.sample_count}
          </div>
          <div className="mt-1 text-xs text-slate-500">{formatDateTime(job.created_at)}</div>
        </div>
        {action}
      </div>
      {job.error_message ? <p className="mt-2 text-xs text-slate-500">{job.error_message}</p> : null}
      {errorMessage ? <p className="mt-2 text-xs text-rose-300">{errorMessage}</p> : null}
    </li>
  );
}

function ForecastJobsCard({ onViewForecast }: { onViewForecast: (jobId: number) => void }) {
  const jobsQuery = useQuery({
    queryKey: ["forecast-jobs"],
    queryFn: listForecastJobs,
  });

  let body: ReactNode;
  if (jobsQuery.isPending) {
    body = <LoadingRows />;
  } else if (jobsQuery.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(jobsQuery.error, "Forecast jobs could not be loaded.")}
        onRetry={() => {
          void jobsQuery.refetch();
        }}
      />
    );
  } else if (jobsQuery.data.jobs.length === 0) {
    body = <EmptyState message="No forecast jobs yet." />;
  } else {
    body = (
      <ul className="space-y-3">
        {jobsQuery.data.jobs.map((job) => (
          <ForecastJobRow job={job} key={job.id} onViewForecast={onViewForecast} />
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
      title="Forecast jobs"
    >
      {body}
    </DashboardCard>
  );
}

function ForecastHistoryChart({ result }: { result: ForecastResult }) {
  const historyQuery = useQuery({
    queryKey: ["forecast-history", result.symbol, result.provider, result.adjustment_type],
    queryFn: () =>
      fetchDailyHistory(result.symbol, result.provider, result.adjustment_type, "2y"),
  });

  if (historyQuery.isPending) {
    return <LoadingRows />;
  }
  if (historyQuery.isError) {
    return (
      <QueryError
        message={requestErrorMessage(historyQuery.error, "Observed history could not be loaded.")}
        onRetry={() => {
          void historyQuery.refetch();
        }}
      />
    );
  }

  const history = historyQuery.data;
  const freshness =
    history.available_end == null
      ? "Cached history end is unavailable"
      : `Cached history through ${history.available_end}`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {freshness} · Read {formatDateTime(history.read_at)}
      </p>
      <ForecastChart bars={history.bars} forecast={result} />
    </div>
  );
}

function ForecastChartCard({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const resultsQuery = useQuery({
    queryKey: ["forecast-results"],
    queryFn: listForecastResults,
  });
  const result = resultsQuery.data?.results.find((item) => item.job_id === jobId) ?? null;

  let body: ReactNode;
  if (resultsQuery.isPending) {
    body = <LoadingRows />;
  } else if (resultsQuery.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(resultsQuery.error, "Forecasts could not be loaded.")}
        onRetry={() => {
          void resultsQuery.refetch();
        }}
      />
    );
  } else if (result == null) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-slate-300">
          Forecast not found yet for this job. It may still be writing — try refreshing.
        </p>
        <RefreshButton
          label="Refresh forecasts"
          onClick={() => {
            void resultsQuery.refetch();
          }}
        />
      </div>
    );
  } else {
    body = <ForecastHistoryChart result={result} />;
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
      title="Forecast chart"
    >
      {body}
    </DashboardCard>
  );
}

function ForecastModelsCard() {
  const modelsQuery = useQuery({
    queryKey: ["forecast-models"],
    queryFn: listForecastModels,
  });

  let body: ReactNode;
  if (modelsQuery.isPending) {
    body = <LoadingRows />;
  } else if (modelsQuery.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(modelsQuery.error, "Forecast models could not be loaded.")}
        onRetry={() => {
          void modelsQuery.refetch();
        }}
      />
    );
  } else if (modelsQuery.data.models.length === 0) {
    body = <EmptyState message="No forecast model is configured." />;
  } else {
    body = (
      <ul className="space-y-3">
        {modelsQuery.data.models.map((model) => (
          <li className="rounded border border-slate-800 bg-slate-900/60 p-3" key={model.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words font-mono text-sm font-semibold text-slate-100">
                {model.model_name}
              </span>
              <span
                className={[
                  "risk-chip",
                  model.enabled ? statusTone.completed : statusTone.failed,
                ].join(" ")}
              >
                {model.enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-300">Max lookback {model.max_lookback}</p>
            <p className="mt-1 text-sm text-slate-300">Max horizon {model.max_horizon}</p>
            <p className="mt-1 text-sm text-slate-300">Max sample count {model.max_sample_count}</p>
            {model.enabled ? null : (
              <p className="mt-3 text-sm text-slate-300">
                This model is disabled, so a queued forecast cannot run until it is enabled on the
                server.
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <DashboardCard
      action={
        modelsQuery.isError ? undefined : (
          <RefreshButton
            onClick={() => {
              void modelsQuery.refetch();
            }}
          />
        )
      }
      title="Forecast model"
    >
      {body}
    </DashboardCard>
  );
}

function EvaluationRow({ evaluation }: { evaluation: ForecastEvaluation }) {
  return (
    <li className="rounded border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-slate-100">{evaluation.symbol}</span>
        <span className="text-xs text-slate-500">horizon {evaluation.horizon}</span>
      </div>
      <p className="mt-2 text-sm text-slate-300">
        Model MAE {evaluation.model_mae} · directional accuracy {evaluation.model_directional_accuracy}
      </p>
      <p className="mt-1 text-sm text-slate-300">
        {evaluation.baseline_type} baseline MAE {evaluation.baseline_mae} · directional accuracy{" "}
        {evaluation.baseline_directional_accuracy}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {evaluation.weights_exercised ? "Weights exercised" : "Weights not exercised"}
      </p>
      {evaluation.notes ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">
          {evaluation.notes}
        </p>
      ) : null}
    </li>
  );
}

function ForecastEvaluationsCard() {
  const evaluationsQuery = useQuery({
    queryKey: ["forecast-evaluations"],
    queryFn: listForecastEvaluations,
  });

  let body: ReactNode;
  if (evaluationsQuery.isPending) {
    body = <LoadingRows />;
  } else if (evaluationsQuery.isError) {
    body = (
      <QueryError
        message={requestErrorMessage(
          evaluationsQuery.error,
          "Forecast evaluations could not be loaded.",
        )}
        onRetry={() => {
          void evaluationsQuery.refetch();
        }}
      />
    );
  } else if (evaluationsQuery.data.evaluations.length === 0) {
    body = (
      <EmptyState message="No evaluations recorded yet. This model's forecasting accuracy has not been validated." />
    );
  } else {
    body = (
      <ul className="space-y-3">
        {evaluationsQuery.data.evaluations.map((evaluation) => (
          <EvaluationRow evaluation={evaluation} key={evaluation.id} />
        ))}
      </ul>
    );
  }

  return (
    <DashboardCard
      action={
        evaluationsQuery.isError ? undefined : (
          <RefreshButton
            onClick={() => {
              void evaluationsQuery.refetch();
            }}
          />
        )
      }
      title="Forecast evaluations"
    >
      {body}
    </DashboardCard>
  );
}

export default function ForecastLab() {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader badge="Experimental" description={pageDescription} title="Forecast Lab" />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <CreateForecastJobCard />
        <ForecastJobsCard onViewForecast={setSelectedJobId} />
        {selectedJobId != null ? (
          <div className="min-w-0 xl:col-span-2">
            <ForecastChartCard jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />
          </div>
        ) : null}
        <ForecastModelsCard />
        <ForecastEvaluationsCard />
      </div>
    </div>
  );
}
