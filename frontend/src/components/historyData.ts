import type { CandlestickData, Time } from "lightweight-charts";

const SESSION_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Server Numeric(18,6): up to 12 integer digits and exactly 6 decimal places. */
const CANONICAL_PRICE = /^(?:0|[1-9]\d{0,11})\.\d{6}$/;
const CANONICAL_VOLUME = /^(?:0|[1-9]\d*)$/;

/**
 * Validated display points for one cached daily response.
 * Envelope metadata is checked before an empty bar list can return.
 * Any malformed envelope or bar throws and nothing is plotted.
 * Prices become numbers only in the returned points.
 */
export function historyCandles(history: unknown): CandlestickData<Time>[] {
  const body = record(history, "Daily history payload is invalid.");
  if (!Array.isArray(body.bars)) {
    throw new Error("Daily history bars are invalid.");
  }

  identity(body.symbol, "symbol", 20);
  const provider = identity(body.provider, "provider", 32);
  const adjustment = adjustmentType(body.adjustment_type);
  if (body.interval !== "1d") {
    throw new Error("Invalid interval.");
  }
  if (body.range !== "2y") {
    throw new Error("Invalid range.");
  }
  if (body.bars.length === 0) {
    if (body.status !== "unavailable") {
      throw new Error("History status is invalid.");
    }
  } else if (body.status !== "partial") {
    throw new Error("History status is invalid.");
  }
  if (body.coverage_status !== "not_verified") {
    throw new Error("Coverage status is invalid.");
  }
  if (body.expected_session_count !== null) {
    throw new Error("Expected session count is invalid.");
  }
  if (body.collection !== "disabled") {
    throw new Error("Collection status is invalid.");
  }
  const excluded = body.excluded_row_count;
  if (typeof excluded !== "number" || !Number.isSafeInteger(excluded) || excluded < 0) {
    throw new Error("Excluded row count is invalid.");
  }
  readAt(body.read_at);

  const requestedStart = sessionDate(body.requested_start);
  const requestedEnd = sessionDate(body.requested_end);
  if (requestedStart > requestedEnd) {
    throw new Error("Requested history window is invalid.");
  }

  if (body.bars.length === 0) {
    if (body.available_start !== null || body.available_end !== null) {
      throw new Error("Available history window is invalid.");
    }
    return [];
  }

  if (typeof body.available_start !== "string" || typeof body.available_end !== "string") {
    throw new Error("Available history window is invalid.");
  }
  const availableStart = sessionDate(body.available_start);
  const availableEnd = sessionDate(body.available_end);

  const validated: {
    time: string;
    open: string;
    high: string;
    low: string;
    close: string;
  }[] = [];
  let previous: string | null = null;
  for (const entry of body.bars) {
    const bar = record(entry, "Daily history bar is invalid.");
    const session = sessionDate(bar.session_date);
    if (previous !== null && session <= previous) {
      throw new Error("Session dates must be ascending and unique.");
    }
    if (session < requestedStart || session > requestedEnd) {
      throw new Error("Session date is outside the requested window.");
    }
    if (identity(bar.provider, "provider", 32) !== provider) {
      throw new Error("Bar provenance does not match the selected response.");
    }
    if (adjustmentType(bar.adjustment_type) !== adjustment) {
      throw new Error("Bar provenance does not match the selected response.");
    }
    if (bar.quality_status !== "valid") {
      throw new Error("Bar quality is invalid.");
    }
    volume(bar.volume);
    fetchedAt(bar.fetched_at);

    const open = canonicalPrice(bar.open);
    const high = canonicalPrice(bar.high);
    const low = canonicalPrice(bar.low);
    const close = canonicalPrice(bar.close);
    assertBounds(open.scaled, high.scaled, low.scaled, close.scaled);
    previous = session;
    validated.push({
      time: session,
      open: open.text,
      high: high.text,
      low: low.text,
      close: close.text,
    });
  }

  const first = validated[0];
  const last = validated[validated.length - 1];
  if (
    first === undefined ||
    last === undefined ||
    availableStart !== first.time ||
    availableEnd !== last.time
  ) {
    throw new Error("Available history window is invalid.");
  }

  return validated.map((bar) => ({
    time: bar.time,
    open: chartNumber(bar.open),
    high: chartNumber(bar.high),
    low: chartNumber(bar.low),
    close: chartNumber(bar.close),
  }));
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identity(value: unknown, label: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim()
  ) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function adjustmentType(value: unknown): "raw" | "split_adjusted" {
  if (value !== "raw" && value !== "split_adjusted") {
    throw new Error("Invalid adjustment_type.");
  }
  return value;
}

function sessionDate(value: unknown): string {
  if (typeof value !== "string" || !SESSION_DATE.test(value)) {
    throw new Error("Session date is invalid.");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  // Date.UTC remaps years 0–99. Reject those before constructing a Date.
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("Session date is invalid.");
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utc.getTime())) {
    throw new Error("Session date is invalid.");
  }
  if (utc.toISOString().slice(0, 10) !== value) {
    throw new Error("Session date is invalid.");
  }
  return value;
}

function readAt(value: unknown): void {
  if (typeof value !== "string" || !value.endsWith("Z") || !Number.isFinite(Date.parse(value))) {
    throw new Error("Read time is invalid.");
  }
}

function fetchedAt(value: unknown): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Fetched time is invalid.");
  }
}

function volume(value: unknown): void {
  if (typeof value !== "string" || !CANONICAL_VOLUME.test(value)) {
    throw new Error("Volume is invalid.");
  }
}

function canonicalPrice(value: unknown): { text: string; scaled: bigint } {
  if (typeof value !== "string" || !CANONICAL_PRICE.test(value)) {
    throw new Error("Price is invalid.");
  }
  const scaled = BigInt(value.replace(".", ""));
  if (scaled <= 0n) {
    throw new Error("Price is invalid.");
  }
  return { text: value, scaled };
}

function chartNumber(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Price is invalid.");
  }
  return number;
}

function assertBounds(open: bigint, high: bigint, low: bigint, close: bigint): void {
  // 999999999999.000001 and 999999999999.000000 collapse under IEEE rounding.
  const lower = open <= close ? open : close;
  const upper = open >= close ? open : close;
  if (low > lower || upper > high) {
    throw new Error("Invalid OHLC bounds.");
  }
}
