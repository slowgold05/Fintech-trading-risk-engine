import type { CandlestickData, HistogramData, LineData, Time, WhitespaceData } from "lightweight-charts";
import type { IndicatorName } from "../api/indicators";
import type { HistoryCoverageStatus, HistoryResponse } from "../api/history";

const SESSION_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COVERAGE_STATUSES: readonly HistoryCoverageStatus[] = [
  "not_verified",
  "complete",
  "gaps",
  "unexpected_sessions",
  "gaps_and_unexpected_sessions",
];
/** Server Numeric(18,6): up to 12 integer digits and exactly 6 decimal places. */
const CANONICAL_PRICE = /^(?:0|[1-9]\d{0,11})\.\d{6}$/;
/** Same text as a price, with an optional minus. Zero and negatives are real MACD readings. */
const CANONICAL_SIGNED_VALUE = /^-?(?:0|[1-9]\d{0,11})\.\d{6}$/;
/** MACD status uses the fixed slow period. The request period is the signal length. */
const MACD_CLOSES_REQUIRED = 26;
const CANONICAL_VOLUME = /^(?:0|[1-9]\d*)$/;
const VOLUME_UP_COLOR = "rgba(52, 211, 153, 0.5)";
const VOLUME_DOWN_COLOR = "rgba(251, 113, 133, 0.5)";

/**
 * Validated display points for one cached daily response.
 * Envelope metadata is checked before an empty bar list can return.
 * Any malformed envelope or bar throws and nothing is plotted.
 * Prices become numbers only in the returned points.
 */
export function historyCandles(history: unknown): CandlestickData<Time>[] {
  return parseBars(history).candles;
}

/**
 * Validated volume histogram points for the same response historyCandles plots.
 * Bars are colored by that session's own open/close, matching the candle colors.
 * Throws under the exact same conditions as historyCandles (shared parsing).
 */
export function historyVolume(history: unknown): HistogramData<Time>[] {
  return parseBars(history).volume;
}

function parseBars(history: unknown): { candles: CandlestickData<Time>[]; volume: HistogramData<Time>[] } {
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
  if (body.range !== "1y" && body.range !== "2y") {
    throw new Error("Invalid range.");
  }
  if (body.bars.length === 0) {
    if (body.status !== "unavailable") {
      throw new Error("History status is invalid.");
    }
  } else if (body.status !== "partial") {
    throw new Error("History status is invalid.");
  }
  if (!COVERAGE_STATUSES.includes(body.coverage_status as HistoryCoverageStatus)) {
    throw new Error("Coverage status is invalid.");
  }
  const expectedSessionCount = body.expected_session_count;
  if (body.coverage_status === "not_verified") {
    if (expectedSessionCount !== null) {
      throw new Error("Expected session count is invalid.");
    }
  } else if (
    typeof expectedSessionCount !== "number" ||
    !Number.isSafeInteger(expectedSessionCount) ||
    expectedSessionCount < 0
  ) {
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
    return { candles: [], volume: [] };
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
    volume: number;
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
    const barVolume = parseVolume(bar.volume);
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
      volume: barVolume,
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

  return {
    candles: validated.map((bar) => ({
      time: bar.time,
      open: chartNumber(bar.open),
      high: chartNumber(bar.high),
      low: chartNumber(bar.low),
      close: chartNumber(bar.close),
    })),
    volume: validated.map((bar) => ({
      time: bar.time,
      value: bar.volume,
      color: chartNumber(bar.close) >= chartNumber(bar.open) ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
    })),
  };
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

function parseVolume(value: unknown): number {
  if (typeof value !== "string" || !CANONICAL_VOLUME.test(value)) {
    throw new Error("Volume is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Volume is invalid.");
  }
  return parsed;
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

/** Same canonical text as a price, but exactly zero is a real RSI reading. */
function canonicalIndicatorValue(value: unknown): { text: string; scaled: bigint } {
  if (typeof value !== "string" || !CANONICAL_PRICE.test(value)) {
    throw new Error("Price is invalid.");
  }
  const scaled = BigInt(value.replace(".", ""));
  if (scaled < 0n) {
    throw new Error("Price is invalid.");
  }
  return { text: value, scaled };
}

/** Same chart number as a price, but exactly zero is a real RSI reading. */
function chartIndicatorNumber(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("Price is invalid.");
  }
  return number;
}

/** Same canonical text shape as a price, but negative and zero are both real MACD readings. */
function canonicalSignedValue(value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_SIGNED_VALUE.test(value)) {
    throw new Error("Price is invalid.");
  }
  return value;
}

/** Same chart number as a price, but negative and zero are both real MACD readings. */
function chartSignedNumber(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("Price is invalid.");
  }
  return number;
}

function signedSeriesPoint(
  time: Time,
  value: unknown,
): { text: string | null; point: LineData<Time> | WhitespaceData<Time> } {
  if (value === null) {
    return { text: null, point: { time } };
  }
  const text = canonicalSignedValue(value);
  return { text, point: { time, value: chartSignedNumber(text) } };
}

function parseMacdPoints(points: readonly unknown[], candles: CandlestickData<Time>[]): {
  values: (string | null)[];
  line: (LineData<Time> | WhitespaceData<Time>)[];
  macdSignal: (LineData<Time> | WhitespaceData<Time>)[];
  macdHistogram: (HistogramData<Time> | WhitespaceData<Time>)[];
} {
  const values: (string | null)[] = [];
  const line: (LineData<Time> | WhitespaceData<Time>)[] = [];
  const macdSignal: (LineData<Time> | WhitespaceData<Time>)[] = [];
  const macdHistogram: (HistogramData<Time> | WhitespaceData<Time>)[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const point = record(points[index], "Indicator point is invalid.");
    const candle = candles[index];
    if (candle === undefined || point.session_date !== candle.time) {
      throw new Error("Indicator point date does not match history.");
    }
    const macdLine = signedSeriesPoint(candle.time, point.value);
    const signal = signedSeriesPoint(candle.time, point.signal);
    const histogram = signedSeriesPoint(candle.time, point.histogram);
    values.push(macdLine.text);
    line.push(macdLine.point);
    macdSignal.push(signal.point);
    macdHistogram.push(histogram.point);
  }
  return { values, line, macdSignal, macdHistogram };
}

function parseBollingerPoints(
  points: readonly unknown[],
  candles: CandlestickData<Time>[],
  period: number,
): {
  values: (string | null)[];
  line: (LineData<Time> | WhitespaceData<Time>)[];
  bollingerUpper: (LineData<Time> | WhitespaceData<Time>)[];
  bollingerLower: (LineData<Time> | WhitespaceData<Time>)[];
} {
  const values: (string | null)[] = [];
  const line: (LineData<Time> | WhitespaceData<Time>)[] = [];
  const bollingerUpper: (LineData<Time> | WhitespaceData<Time>)[] = [];
  const bollingerLower: (LineData<Time> | WhitespaceData<Time>)[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const point = record(points[index], "Indicator point is invalid.");
    const candle = candles[index];
    if (candle === undefined || point.session_date !== candle.time) {
      throw new Error("Indicator point date does not match history.");
    }
    const time = candle.time;
    // Same leading nulls as SMA: period - 1. Upper and lower share that cutoff.
    const warming = index < period - 1;
    if (warming) {
      if (point.value !== null || point.upper !== null || point.lower !== null) {
        throw new Error("Indicator warmup value is invalid.");
      }
      values.push(null);
      line.push({ time });
      bollingerUpper.push(signedSeriesPoint(time, point.upper).point);
      bollingerLower.push(signedSeriesPoint(time, point.lower).point);
      continue;
    }
    if (point.upper === null || point.lower === null) {
      throw new Error("Indicator warmup value is invalid.");
    }
    // Middle band is the SMA, so it stays strictly positive. Bands may be signed.
    const middle = canonicalPrice(point.value);
    values.push(middle.text);
    line.push({ time, value: chartNumber(middle.text) });
    bollingerUpper.push(signedSeriesPoint(time, point.upper).point);
    bollingerLower.push(signedSeriesPoint(time, point.lower).point);
  }
  return { values, line, bollingerUpper, bollingerLower };
}

function assertBounds(open: bigint, high: bigint, low: bigint, close: bigint): void {
  // 999999999999.000001 and 999999999999.000000 collapse under IEEE rounding.
  const lower = open <= close ? open : close;
  const upper = open >= close ? open : close;
  if (low > lower || upper > high) {
    throw new Error("Invalid OHLC bounds.");
  }
}

/** One validated SMA, EMA, RSI, MACD, or Bollinger overlay over the nested history snapshot. Status is never "complete". */
export type IndicatorOverlay = {
  history: HistoryResponse;
  candles: CandlestickData<Time>[];
  line: (LineData<Time> | WhitespaceData<Time>)[];
  values: (string | null)[];
  macdSignal?: (LineData<Time> | WhitespaceData<Time>)[];
  macdHistogram?: (HistogramData<Time> | WhitespaceData<Time>)[];
  bollingerUpper?: (LineData<Time> | WhitespaceData<Time>)[];
  bollingerLower?: (LineData<Time> | WhitespaceData<Time>)[];
  name: IndicatorName;
  period: number;
  status: "unavailable" | "insufficient" | "partial";
};

const INDICATOR_META = [
  "symbol",
  "interval",
  "range",
  "provider",
  "adjustment_type",
  "coverage_status",
  "expected_session_count",
  "collection",
  "read_at",
  "requested_start",
  "requested_end",
  "available_start",
  "available_end",
  "excluded_row_count",
] as const;

/**
 * Validate one indicators payload against the caller's request.
 * Nested history is the original public history body and is checked only through historyCandles.
 * Any mismatch throws. Warm-up nulls become whitespace points with time only.
 */
export function indicatorOverlay(
  payload: unknown,
  request: {
    symbol: string;
    provider: string;
    adjustment_type: string;
    name: IndicatorName;
    period: number;
  },
): IndicatorOverlay {
  const body = record(payload, "Indicator payload is invalid.");
  const history = record(body.history, "Indicator history is invalid.");
  const candles = historyCandles(history);

  for (const key of INDICATOR_META) {
    if (body[key] !== history[key]) {
      throw new Error("Indicator metadata does not match history.");
    }
  }
  if (
    body.symbol !== request.symbol ||
    history.symbol !== request.symbol ||
    body.provider !== request.provider ||
    history.provider !== request.provider ||
    body.adjustment_type !== request.adjustment_type ||
    history.adjustment_type !== request.adjustment_type
  ) {
    throw new Error("Indicator request identity does not match.");
  }
  if (
    body.name !== "sma" &&
    body.name !== "ema" &&
    body.name !== "rsi" &&
    body.name !== "macd" &&
    body.name !== "bollinger"
  ) {
    throw new Error("Indicator name is invalid.");
  }
  if (body.name !== request.name) {
    throw new Error("Indicator name does not match the request.");
  }
  const period = body.period;
  if (
    typeof period !== "number" ||
    !Number.isSafeInteger(period) ||
    period < 2 ||
    period > 200
  ) {
    throw new Error("Indicator period is invalid.");
  }
  if (period !== request.period) {
    throw new Error("Indicator period does not match the request.");
  }
  if (body.source !== "observed_valid_closes") {
    throw new Error("Indicator source is invalid.");
  }
  if (body.session_basis !== "not_exchange_sessions") {
    throw new Error("Indicator session basis is invalid.");
  }
  if (!Array.isArray(history.bars) || history.bars.length !== candles.length) {
    throw new Error("Indicator history bars are invalid.");
  }
  const count = candles.length;
  if (
    typeof body.observed_valid_closes !== "number" ||
    !Number.isSafeInteger(body.observed_valid_closes) ||
    body.observed_valid_closes !== count
  ) {
    throw new Error("Observed valid closes do not match history.");
  }
  if (!Array.isArray(body.points) || body.points.length !== count) {
    throw new Error("Indicator points are invalid.");
  }

  // RSI's first value needs `period` diffs, so it lands one close later than SMA/EMA.
  // MACD's status threshold is the fixed slow period, not the signal `period`.
  // Bollinger needs the same `period` closes as SMA, which is the final fallback.
  const closesRequired = body.name === "rsi" ? period + 1 : body.name === "macd" ? MACD_CLOSES_REQUIRED : period;
  let status: IndicatorOverlay["status"];
  if (count === 0) {
    status = "unavailable";
  } else if (count < closesRequired) {
    status = "insufficient";
  } else {
    status = "partial";
  }
  if (body.status !== status) {
    throw new Error("Indicator status is invalid.");
  }

  // value, signal, and histogram each leave warm-up on their own index. Do not share one cutoff.
  if (body.name === "macd") {
    const macd = parseMacdPoints(body.points, candles);
    return {
      history: history as HistoryResponse,
      candles,
      line: macd.line,
      values: macd.values,
      macdSignal: macd.macdSignal,
      macdHistogram: macd.macdHistogram,
      name: body.name,
      period,
      status,
    };
  }

  if (body.name === "bollinger") {
    const bands = parseBollingerPoints(body.points, candles, period);
    return {
      history: history as HistoryResponse,
      candles,
      line: bands.line,
      values: bands.values,
      bollingerUpper: bands.bollingerUpper,
      bollingerLower: bands.bollingerLower,
      name: body.name,
      period,
      status,
    };
  }

  const warmupLength = body.name === "rsi" ? period : period - 1;
  const warmup = Math.min(warmupLength, count);
  const values: (string | null)[] = [];
  const line: (LineData<Time> | WhitespaceData<Time>)[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = record(body.points[index], "Indicator point is invalid.");
    const candle = candles[index];
    if (candle === undefined || point.session_date !== candle.time) {
      throw new Error("Indicator point date does not match history.");
    }
    const time = candle.time;
    if (index < warmup) {
      if (point.value !== null) {
        throw new Error("Indicator warmup value is invalid.");
      }
      values.push(null);
      line.push({ time });
      continue;
    }
    // SMA and EMA stay strictly positive so the existing zero-rejection tests keep holding.
    // RSI uses its own helpers because an all-down window is the real value "0.000000".
    const indicatorPoint = body.name === "rsi" ? canonicalIndicatorValue(point.value) : canonicalPrice(point.value);
    values.push(indicatorPoint.text);
    line.push({
      time,
      value: body.name === "rsi" ? chartIndicatorNumber(indicatorPoint.text) : chartNumber(indicatorPoint.text),
    });
  }

  return {
    history: history as HistoryResponse,
    candles,
    line,
    values,
    name: body.name,
    period,
    status,
  };
}
