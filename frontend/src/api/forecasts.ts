import { apiClient } from "./client";
import type {
  ForecastEvaluation,
  ForecastJob,
  ForecastModel,
  ForecastResult,
} from "../types/schemas";

export interface CreateForecastJobBody {
  symbol: string;
  provider: string;
  adjustment_type: string;
  lookback: number;
  horizon: number;
  sample_count: number;
}

export async function createForecastJob(body: CreateForecastJobBody): Promise<ForecastJob> {
  const response = await apiClient.post<ForecastJob>("/forecasts/jobs", body);
  return response.data;
}

export async function listForecastJobs(): Promise<{ jobs: ForecastJob[] }> {
  const response = await apiClient.get<{ jobs: ForecastJob[] }>("/forecasts/jobs");
  return response.data;
}

export async function cancelForecastJob(jobId: number): Promise<ForecastJob> {
  const response = await apiClient.post<ForecastJob>(`/forecasts/jobs/${jobId}/cancel`);
  return response.data;
}

export async function listForecastResults(): Promise<{ results: ForecastResult[] }> {
  const response = await apiClient.get<{ results: ForecastResult[] }>("/forecasts");
  return response.data;
}

export async function listForecastModels(): Promise<{ models: ForecastModel[] }> {
  const response = await apiClient.get<{ models: ForecastModel[] }>("/forecasts/models");
  return response.data;
}

export async function listForecastEvaluations(): Promise<{ evaluations: ForecastEvaluation[] }> {
  const response = await apiClient.get<{ evaluations: ForecastEvaluation[] }>(
    "/forecasts/evaluations",
  );
  return response.data;
}
