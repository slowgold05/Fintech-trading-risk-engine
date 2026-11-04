import { apiClient } from "./client";

export async function createCashMovement(payload: {
  kind: "deposit" | "withdrawal";
  amount: string;
  stepUpCode?: string;
}): Promise<{ id: number; kind: string; amount: string }> {
  const headers: Record<string, string> = { "Idempotency-Key": crypto.randomUUID() };
  if (payload.stepUpCode) {
    headers["X-Step-Up-Code"] = payload.stepUpCode;
  }
  const response = await apiClient.post<{ id: number; kind: string; amount: string }>(
    "/cash/movements",
    { kind: payload.kind, amount: payload.amount },
    { headers },
  );
  return response.data;
}
