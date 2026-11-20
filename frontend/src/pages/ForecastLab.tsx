import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchCachedSeries, fetchDailyHistory } from "../api/history";
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
import { keys } from "../night/api";
import { Button, Field, Page, Panel, RestInstrument, State } from "../night/inner";
import { DeskAccount, EmptyState, LoadingRows, QueryError, RefreshButton } from "../night/features/desks/DeskStates";
import { ForecastWindow } from "../night/features/desks/ForecastWindow";
import "../night/features/desks/forecast.css";
import type { ForecastEvaluation, ForecastJob, ForecastModel, ForecastResult } from "../types/schemas";
import { formatDateTime } from "../utils/format";

function requestErrorMessage(error: unknown, fallback: string) {
  return isAxiosError(error)
    ? String(error.response?.data?.detail ?? fallback)
    : fallback;
}

function CreateForecastJobCard({ owner, model }: { owner: number; model?: ForecastModel }) {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("");
  const [provider, setProvider] = useState("");
  const [basis, setBasis] = useState("");
  const [lookback, setLookback] = useState("");
  const [horizon, setHorizon] = useState("");
  const [sampleCount, setSampleCount] = useState("");
  const catalog = useQuery({
    queryKey: keys.market("data-status"), queryFn: fetchCachedSeries, retry: false,
  });
  const series = (catalog.data?.canonical_history.series ?? []).filter(row =>
    row.provider && (row.adjustment_type === "raw" || row.adjustment_type === "split_adjusted") && row.row_count !== 0);
  const providers = [...new Set(series.map(row => row.provider))];
  const selectedProvider = providers.includes(provider) ? provider : providers[0] ?? "";
  const adjustments = [...new Set(series.filter(row => row.provider === selectedProvider).map(row => row.adjustment_type))];
  const selectedBasis = adjustments.includes(basis) ? basis : adjustments[0] ?? "";
  const canQueue = Boolean(model && selectedProvider && selectedBasis && !catalog.isError);
  const mutation = useMutation({
    mutationFn: (body: CreateForecastJobBody) => createForecastJob(body),
    onSuccess: async () => {
      setSymbol(""); setLookback(""); setHorizon(""); setSampleCount("");
      await queryClient.invalidateQueries({ queryKey: keys.account(owner, "forecasts", "jobs") });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canQueue || !symbol.trim() || mutation.isPending || !event.currentTarget.checkValidity()) return;
    mutation.mutate({ symbol: symbol.trim(), provider: selectedProvider, adjustment_type: selectedBasis,
      lookback: Number(lookback), horizon: Number(horizon), sample_count: Number(sampleCount) });
  }

  return <Panel title="Queue a forecast job" className="forecast-request">
    {!model && <State kind="unavailable" title="New runs unavailable" detail="An enabled server model is required to queue a new run from this desk." />}
    {model && catalog.isError && <QueryError message="Stored series could not be loaded." onRetry={catalog.refetch} />}
    {model && catalog.isSuccess && !series.length && <State kind="empty" title="No stored series available for a run." />}
    <form onSubmit={submit}>
      <fieldset disabled={!canQueue || mutation.isPending} className="forecast-inputs" aria-label="Forecast parameters">
        <Field id="forecast-symbol" label="Symbol"><input required maxLength={20} value={symbol} onChange={e => setSymbol(e.target.value)} /></Field>
        <Field id="forecast-provider" label="Provider"><select value={selectedProvider} onChange={e => setProvider(e.target.value)}>
          {!providers.length && <option value="">Unavailable</option>}{providers.map(value => <option key={value}>{value}</option>)}
        </select></Field>
        <Field id="forecast-basis" label="Adjustment type"><select value={selectedBasis} onChange={e => setBasis(e.target.value)}>
          {!adjustments.length && <option value="">Unavailable</option>}{adjustments.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </select></Field>
        <Field id="forecast-lookback" label="Lookback" hint="Observed sessions"><input required type="number" min={1} max={model?.max_lookback} step={1} value={lookback} onChange={e => setLookback(e.target.value)} /></Field>
        <Field id="forecast-horizon" label="Horizon" hint="Generated sessions"><input required type="number" min={1} max={model?.max_horizon} step={1} value={horizon} onChange={e => setHorizon(e.target.value)} /></Field>
        <Field id="forecast-samples" label="Sample count"><input required type="number" min={1} max={model?.max_sample_count} step={1} value={sampleCount} onChange={e => setSampleCount(e.target.value)} /></Field>
      </fieldset>
      <Button type="submit" variant="primary" disabled={!canQueue} busy={mutation.isPending}>{mutation.isPending ? "Queuing…" : "Queue job"}</Button>
    </form>
    {mutation.isError && <p className="desk-alert" role="alert">{requestErrorMessage(mutation.error, "Forecast job could not be queued.")}</p>}
    {mutation.data && <p className="desk-notice" role="status">Forecast job queued for {mutation.data.symbol}.</p>}
  </Panel>;
}

function ForecastJobRow({
  job,
  owner,
  onViewForecast,
}: {
  job: ForecastJob;
  owner: number;
  onViewForecast: (jobId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelMutation = useMutation({
    mutationFn: () => cancelForecastJob(job.id),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: keys.account(owner, "forecasts", "jobs") });
    },
    onError: (error) => {
      setErrorMessage(requestErrorMessage(error, "Forecast job could not be cancelled."));
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
        onClick={() => onViewForecast(job.id)}
        type="button"
      >
        View forecast
      </Button>
    );
  }

  return (
    <li className="desk-record">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-100">{job.symbol}</span>
            <span className="desk-status" data-status={job.status}>{job.status}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {job.provider} · {job.adjustment_type} · lookback {job.lookback} · horizon {job.horizon}{" "}
            · samples {job.sample_count}
          </div>
          <div className="mt-1 desk-meta">Job #{job.id} · Updated {formatDateTime(job.updated_at)}</div>
        </div>
        {action}
      </div>
      {job.error_message ? <p className="mt-2 text-xs text-slate-500">{job.error_message}</p> : null}
      {errorMessage ? <p className="mt-2 text-xs text-rose-300">{errorMessage}</p> : null}
    </li>
  );
}

function ForecastJobsCard({ owner, onViewForecast }: { owner: number; onViewForecast: (jobId: number) => void }) {
  const jobsQuery = useQuery({
    queryKey: keys.account(owner, "forecasts", "jobs"),
    queryFn: listForecastJobs, retry: false,
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
          <ForecastJobRow owner={owner} job={job} key={job.id} onViewForecast={onViewForecast} />
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
      title="Forecast jobs"
    >
      {body}
    </Panel>
  );
}

function ForecastHistoryChart({ result }: { result: ForecastResult }) {
  const historyQuery = useQuery({
    queryKey: keys.history(result.symbol, result.provider, result.adjustment_type, "2y"),
    queryFn: () =>
      fetchDailyHistory(result.symbol, result.provider, result.adjustment_type, "2y"), retry: false,
  });

  if (!historyQuery.data) {
    return <>
      {historyQuery.isPending ? <LoadingRows /> : <QueryError message={requestErrorMessage(historyQuery.error, "Observed history could not be loaded.")} onRetry={historyQuery.refetch} />}
      {historyQuery.isError && <ForecastChart bars={[]} forecast={result} />}
    </>;
  }

  const history = historyQuery.data;
  const freshness =
    history.available_end == null
      ? "Cached history end is unavailable"
      : `Cached history through ${history.available_end}`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {result.symbol} · {result.provider} · {result.adjustment_type.replaceAll("_", " ")} · {freshness} · Read {formatDateTime(history.read_at)}
      </p>
      <ForecastChart bars={history.symbol === result.symbol && history.provider === result.provider && history.adjustment_type === result.adjustment_type ? history.bars : []} forecast={result} />
    </div>
  );
}

function ForecastChartCard({ owner, jobId, onClose }: { owner: number; jobId: number; onClose: () => void }) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => { region.current?.focus(); }, [jobId]);
  const resultsQuery = useQuery({
    queryKey: keys.account(owner, "forecasts", "results"),
    queryFn: listForecastResults, retry: false,
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
    <Panel
      actions={
        <Button
          onClick={onClose}
          type="button"
        >
          Close
        </Button>
      }
      title="Forecast chart"
    >
      <div className="desk-section" ref={region} tabIndex={-1} aria-label="Selected forecast">{body}</div>
    </Panel>
  );
}

function EvaluationRow({ evaluation }: { evaluation: ForecastEvaluation }) {
  return (
    <li className="desk-record">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-slate-100">{evaluation.symbol}</span>
        <span className="text-xs text-slate-500">horizon {evaluation.horizon}</span>
      </div>
      <p className="mt-2 text-sm text-slate-300">
        Model MAE {evaluation.model_mae} · directional accuracy {(evaluation.model_directional_accuracy * 100).toFixed(1)}%
      </p>
      <p className="mt-1 text-sm text-slate-300">
        {evaluation.baseline_type} baseline MAE {evaluation.baseline_mae} · directional accuracy{" "}
        {(evaluation.baseline_directional_accuracy * 100).toFixed(1)}%
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {evaluation.weights_exercised ? "Weights exercised" : "Weights not exercised"}
      </p>
      <p className="desk-meta">{evaluation.window_count} windows · {evaluation.provider} · {evaluation.adjustment_type.replaceAll("_", " ")} · {formatDateTime(evaluation.created_at)}</p>
      {evaluation.notes ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">
          {evaluation.notes}
        </p>
      ) : null}
    </li>
  );
}

function ForecastEvaluationsCard({ owner }: { owner: number }) {
  const evaluationsQuery = useQuery({
    queryKey: keys.account(owner, "forecasts", "evaluations"),
    queryFn: listForecastEvaluations, retry: false,
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
    <Panel
      actions={
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
    </Panel>
  );
}

function ForecastDesk({ owner }: { owner: number }) {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const models = useQuery({ queryKey: keys.account(owner, "forecasts", "models"), queryFn: listForecastModels, retry: false });
  const activeModel = models.data?.models.find(model => model.enabled);
  return <Page className="desk-page forecast-desk" eyebrow="Experimental" title="Forecast Lab"
    description="Inspect model availability, generated price paths and evaluations against a baseline.">
    {selectedJobId !== null && <Page.Full><ForecastChartCard owner={owner} jobId={selectedJobId} onClose={() => { setSelectedJobId(null); opener.current?.focus(); }} /></Page.Full>}
    <Page.Main className="desk-stack">
      <Panel title="Forecast model" actions={<RefreshButton onClick={models.refetch} />}>
        {models.isPending ? <RestInstrument label="Session window" status={{kind:"loading",title:"Reading model limits…"}}/> :
          models.isError ? <RestInstrument label="Session window" status={{kind:"error",title:"Forecast models could not be loaded.",action:<RefreshButton label="Retry" onClick={models.refetch}/>}}/> :
          <ForecastWindow models={models.data.models}/>}
      </Panel>
      <ForecastEvaluationsCard owner={owner} />
    </Page.Main>
    <Page.Aside className="desk-stack">
      {models.isPending ? <LoadingRows /> : <CreateForecastJobCard owner={owner} model={models.isError ? undefined : activeModel} />}
      <ForecastJobsCard owner={owner} onViewForecast={id => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setSelectedJobId(id);
      }} />
    </Page.Aside>
  </Page>;
}

export default function ForecastLab() {
  return <DeskAccount label="Session window">{owner => <ForecastDesk key={owner} owner={owner} />}</DeskAccount>;
}
