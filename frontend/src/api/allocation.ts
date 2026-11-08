import { apiClient } from "./client";
import type { AllocationResponse } from "../types/schemas";

export async function fetchAllocation(): Promise<AllocationResponse> {
  const response = await apiClient.get<AllocationResponse>("/portfolio/allocation");
  return response.data;
}
