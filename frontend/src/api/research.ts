import { apiClient } from "./client";
import type { ResearchBrief, ResearchJob, ResearchReport } from "../types/schemas";

export async function createResearchJob(symbol: string): Promise<ResearchJob> {
  const response = await apiClient.post<ResearchJob>("/research/jobs", { symbol });
  return response.data;
}

export async function listResearchJobs(): Promise<{ jobs: ResearchJob[] }> {
  const response = await apiClient.get<{ jobs: ResearchJob[] }>("/research/jobs");
  return response.data;
}

export async function cancelResearchJob(jobId: number): Promise<ResearchJob> {
  const response = await apiClient.post<ResearchJob>(`/research/jobs/${jobId}/cancel`);
  return response.data;
}

export async function listResearchReports(): Promise<{ reports: ResearchReport[] }> {
  const response = await apiClient.get<{ reports: ResearchReport[] }>("/research/reports");
  return response.data;
}

export async function listResearchBriefs(): Promise<{ briefs: ResearchBrief[] }> {
  const response = await apiClient.get<{ briefs: ResearchBrief[] }>("/research/briefs");
  return response.data;
}
