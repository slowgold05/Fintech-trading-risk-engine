import { apiClient } from "../../../api/client";
import type { Coverage, Decimal, SessionDate } from "../../api";

export type Membership = { enabled: boolean; alias: string | null };
export type Ranking = {
  start: SessionDate; end: SessionDate; coverage: Coverage; excluded_count: number;
  items: { rank: number; alias: string; return_ratio: Decimal }[]; my_entry: Membership;
};
export async function fetchRanking() {
  return (await apiClient.get<Ranking>("/night/leaderboard")).data;
}
export async function setMembership(preference: { enabled: false } | { enabled: true; alias: string }) {
  return (await apiClient.put<Membership>("/night/leaderboard/me", preference)).data;
}
