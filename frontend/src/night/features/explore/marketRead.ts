import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../api/client";
import { keys, type Coverage, type NightError, type Provenance } from "../../api";

export type SessionCoverage = {
  session_date: string | null;
  previous_session_date: string | null;
  universe_count: number;
  covered_count: number;
  coverage: Coverage;
};

export function useMarketRead<T>(feature: string, path: string, params: Record<string, string | number | undefined>, keyParams = params) {
  return useQuery({
    queryKey: keys.feature(feature, keyParams),
    queryFn: async ({ signal }) => (await apiClient.get<T>(path, { params, signal })).data,
    retry: false,
  });
}

export function errorDetail(error: unknown) {
  if (axios.isAxiosError<NightError>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail?.message === "string") return detail.message;
  }
  return "The stored market response could not be loaded.";
}

const percent = new Intl.NumberFormat("en-US", {
  style: "percent", signDisplay: "exceptZero", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
export function priceMove(ratio: string | number | null) {
  return ratio == null || !Number.isFinite(Number(ratio)) ? "Unavailable" : percent.format(Number(ratio));
}
export function sourceLabel(source: Provenance) {
  return [source.provider, source.basis.replace("_", " ")].join(" · ");
}
export function datedWindow(data: SessionCoverage) {
  if (!data.session_date || !data.previous_session_date) return "Comparable end-of-day sessions unavailable";
  return `End-of-day closes · ${data.previous_session_date} to ${data.session_date}`;
}
export function sourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
