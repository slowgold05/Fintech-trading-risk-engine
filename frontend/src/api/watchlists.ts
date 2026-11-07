import { apiClient } from "./client";

const REQUEST_ERROR = "Invalid watchlist request";
const RESPONSE_ERROR = "Invalid watchlist response";

const LIST_CAP = 20;
const MEMBER_CAP = 50;
const NAME_CAP = 40;
const SYMBOL_CAP = 20;

export interface WatchlistSymbol {
  symbol: string;
  position: number;
}

export interface Watchlist {
  id: number;
  name: string;
  symbols: WatchlistSymbol[];
}

export interface WatchlistCollection {
  watchlists: Watchlist[];
}

interface WatchlistExpect {
  id?: number;
  name?: string;
  symbolOrder?: string[];
  containsSymbol?: string;
  emptySymbols?: boolean;
}

function requestError(): never {
  throw new Error(REQUEST_ERROR);
}

function responseError(): never {
  throw new Error(RESPONSE_ERROR);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") requestError();
  const name = value.trim();
  const length = codePointLength(name);
  if (length < 1 || length > NAME_CAP) requestError();
  return name;
}

function normalizeSymbol(value: unknown): string {
  if (typeof value !== "string") requestError();
  const symbol = value.trim().toUpperCase();
  const length = codePointLength(symbol);
  if (length < 1 || length > SYMBOL_CAP) requestError();
  return symbol;
}

function normalizeOrder(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MEMBER_CAP) requestError();
  const seen = new Set<string>();
  return value.map((item) => {
    const symbol = normalizeSymbol(item);
    if (seen.has(symbol)) requestError();
    seen.add(symbol);
    return symbol;
  });
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim()) responseError();
  const length = codePointLength(value);
  if (length < 1 || length > NAME_CAP) responseError();
  return value;
}

function parseSymbol(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim().toUpperCase()) responseError();
  const length = codePointLength(value);
  if (length < 1 || length > SYMBOL_CAP) responseError();
  return value;
}

function parseWatchlist(data: unknown, expected: WatchlistExpect = {}): Watchlist {
  if (!isRecord(data) || !isPositiveSafeInteger(data.id)) responseError();
  if (expected.id !== undefined && data.id !== expected.id) responseError();
  const name = parseName(data.name);
  if (expected.name !== undefined && name !== expected.name) responseError();
  if (!Array.isArray(data.symbols) || data.symbols.length > MEMBER_CAP) responseError();
  if (expected.emptySymbols && data.symbols.length !== 0) responseError();

  const seen = new Set<string>();
  let lastPosition = 0;
  const symbols = data.symbols.map((item) => {
    if (!isRecord(item) || !isPositiveSafeInteger(item.position) || item.position <= lastPosition) responseError();
    const symbol = parseSymbol(item.symbol);
    if (seen.has(symbol)) responseError();
    seen.add(symbol);
    lastPosition = item.position;
    return { symbol, position: item.position };
  });

  if (expected.symbolOrder !== undefined) {
    if (symbols.length !== expected.symbolOrder.length || symbols.some((item, index) => item.symbol !== expected.symbolOrder?.[index])) {
      responseError();
    }
  }
  if (expected.containsSymbol !== undefined && !seen.has(expected.containsSymbol)) responseError();

  return { id: data.id, name, symbols };
}

function parseCollection(data: unknown): WatchlistCollection {
  if (!isRecord(data) || !Array.isArray(data.watchlists) || data.watchlists.length > LIST_CAP) responseError();
  const ids = new Set<number>();
  const names = new Set<string>();
  const watchlists = data.watchlists.map((item) => {
    const parsed = parseWatchlist(item);
    if (ids.has(parsed.id) || names.has(parsed.name)) responseError();
    ids.add(parsed.id);
    names.add(parsed.name);
    return parsed;
  });
  return { watchlists };
}

function assertEmpty(data: unknown): void {
  if (data !== undefined && data !== null && data !== "") responseError();
}

async function call(
  method: "get" | "post" | "patch" | "delete",
  url: string,
  signal: AbortSignal | undefined,
  allowed: readonly number[],
  body?: unknown,
): Promise<unknown> {
  signal?.throwIfAborted();
  const response = await apiClient.request<unknown>({
    method,
    url,
    signal,
    ...(body !== undefined ? { data: body } : {}),
  });
  signal?.throwIfAborted();
  if (!allowed.includes(response.status)) responseError();
  return response.data;
}

export async function fetchWatchlists(signal?: AbortSignal): Promise<WatchlistCollection> {
  const data = await call("get", "/watchlists", signal, [200]);
  return parseCollection(data);
}

export async function createWatchlist(name: string, signal?: AbortSignal): Promise<Watchlist> {
  const normalized = normalizeName(name);
  const data = await call("post", "/watchlists", signal, [201], { name: normalized });
  return parseWatchlist(data, { name: normalized, emptySymbols: true });
}

export async function updateWatchlist(
  id: number,
  patch: { name?: string; symbol_order?: string[] },
  signal?: AbortSignal,
): Promise<Watchlist> {
  if (!isPositiveSafeInteger(id) || !isRecord(patch)) requestError();
  const body: { name?: string; symbol_order?: string[] } = {};
  for (const key of Object.keys(patch)) {
    if (key === "name") body.name = normalizeName(patch.name);
    else if (key === "symbol_order") body.symbol_order = normalizeOrder(patch.symbol_order);
    else requestError();
  }
  if (body.name === undefined && body.symbol_order === undefined) requestError();
  const data = await call("patch", `/watchlists/${id}`, signal, [200], body);
  return parseWatchlist(data, { id, name: body.name, symbolOrder: body.symbol_order });
}

export async function deleteWatchlist(id: number, signal?: AbortSignal): Promise<void> {
  if (!isPositiveSafeInteger(id)) requestError();
  assertEmpty(await call("delete", `/watchlists/${id}`, signal, [204]));
}

export async function addWatchlistSymbol(id: number, symbol: string, signal?: AbortSignal): Promise<Watchlist> {
  if (!isPositiveSafeInteger(id)) requestError();
  const canonical = normalizeSymbol(symbol);
  const data = await call("post", `/watchlists/${id}/symbols`, signal, [200, 201], { symbol: canonical });
  return parseWatchlist(data, { id, containsSymbol: canonical });
}

export async function removeWatchlistSymbol(id: number, symbol: string, signal?: AbortSignal): Promise<void> {
  if (!isPositiveSafeInteger(id)) requestError();
  const canonical = normalizeSymbol(symbol);
  assertEmpty(await call("delete", `/watchlists/${id}/symbols/${encodeURIComponent(canonical)}`, signal, [204]));
}
