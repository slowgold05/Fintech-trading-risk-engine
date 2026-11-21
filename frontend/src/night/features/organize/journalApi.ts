import { apiClient } from "../../../api/client";
import type { Page, Utc } from "../../api";

export type NoteBody = { note: string; tags: string[] };
export type JournalEntry = NoteBody & { id: number; order_id: number; created_at: Utc; updated_at: Utc };

export async function fetchJournal(cursor: string | null) {
  return (await apiClient.get<Page<JournalEntry>>("/night/journal", { params: { cursor: cursor ?? undefined, limit: 25 } })).data;
}
export async function createNote(order_id: number, body: NoteBody) {
  return (await apiClient.post<JournalEntry>("/night/journal", { order_id, ...body })).data;
}
export async function updateNote(id: number, body: NoteBody) {
  return (await apiClient.patch<JournalEntry>(`/night/journal/${id}`, body)).data;
}
export async function deleteNote(id: number) {
  await apiClient.delete(`/night/journal/${id}`);
}
