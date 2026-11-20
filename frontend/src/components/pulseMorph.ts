import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { NormalizedSeries } from "./indexComparisonData";

type Row = { symbol: string; color: string; dash: number; series: NormalizedSeries | null };
type Trace = { symbol: string; ink: string; dash: number; width: number; y: Float32Array };
type Frame = { width: number; height: number; traces: Trace[] };
export type Morph = { stop: () => Frame };

const PITCH = 2;
const STYLES = [[], [2, 3], [5, 4], [8, 4], [2, 6]];

/** Sample the plotted geometry once on each side of a change, including breaks. */
export function readPlot(api: IChartApi, lines: Map<string, ISeriesApi<"Line">>, rows: readonly Row[], active: string | null): Frame | null {
  const size = api.paneSize?.();
  if (!size || size.width < 1 || size.height < 1) return null;
  const time = api.timeScale();
  const traces: Trace[] = [];
  for (const row of rows) {
    const line = lines.get(row.symbol);
    if (!line || !row.series) continue;
    const y = new Float32Array(Math.ceil(size.width / PITCH)).fill(NaN);
    let last: { x: number; y: number } | null = null;
    for (const point of row.series.points) {
      const x = time.timeToCoordinate(point.time);
      const py = "value" in point ? line.priceToCoordinate(point.value) : null;
      if (x == null || py == null) { last = null; continue; }
      if (last && x > last.x) {
        for (let i = Math.max(0, Math.ceil(last.x / PITCH)); i < y.length && i * PITCH <= x; i++) {
          y[i] = last.y + (py - last.y) * (i * PITCH - last.x) / (x - last.x);
        }
      }
      last = { x, y: py };
    }
    traces.push({ symbol: row.symbol, ink: row.symbol === active ? "#ffb224" : row.color,
      dash: row.symbol === active ? 0 : row.dash, width: row.symbol === active ? 3 : 2, y });
  }
  return { ...size, traces };
}

/** Temporary ink layer. React and the chart data model are idle while the shapes interpolate. */
export function morphPlot(canvas: HTMLCanvasElement, from: Frame, target: () => Frame | null, finish: () => void): Morph | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia?.("(max-width: 959px)").matches ? 1.5 : Infinity);
  canvas.width = Math.round(from.width * dpr);
  canvas.height = Math.round(from.height * dpr);
  canvas.style.width = from.width + "px";
  canvas.style.height = from.height + "px";
  ctx.scale(dpr, dpr);
  canvas.hidden = false;
  let raf = 0;
  let current = from;
  function paint(frame: Frame) {
    if (!ctx) return;
    ctx.clearRect(0, 0, frame.width, frame.height);
    for (const trace of frame.traces) {
      ctx.beginPath();
      ctx.strokeStyle = trace.ink;
      ctx.lineWidth = trace.width;
      ctx.setLineDash(STYLES[trace.dash] ?? []);
      let connected = false;
      for (let i = 0; i < trace.y.length; i++) {
        const y = trace.y[i];
        if (!Number.isFinite(y)) { connected = false; continue; }
        if (connected) ctx.lineTo(i * PITCH, y);
        else ctx.moveTo(i * PITCH, y);
        connected = true;
      }
      ctx.stroke();
    }
  }
  const stop = () => {
    cancelAnimationFrame(raf);
    canvas.hidden = true;
    finish();
    return current;
  };
  paint(from);
  // fitContent is applied on the chart's next frame. Read the new coordinates after that paint.
  raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => {
      const to = target();
      if (!to || Math.abs(to.width - from.width) > 4) { stop(); return; }
      const pairs = to.traces.map(end => ({
        start: from.traces.find(trace => trace.symbol === end.symbol)?.y,
        end: end.y,
        trace: { ...end, y: new Float32Array(end.y.length) },
      }));
      current = { ...to, traces: pairs.map(pair => pair.trace) };
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / 470);
        const u = t * t * (3 - 2 * t);
        for (const { start, end, trace } of pairs) {
          for (let i = 0; i < end.length; i++) {
            const a = start?.[i], b = end[i];
            trace.y[i] = a != null && Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * u
              : t < .5 ? (a ?? NaN) : b;
          }
        }
        paint(current);
        if (t < 1) raf = requestAnimationFrame(step);
        else stop();
      };
      raf = requestAnimationFrame(step);
    });
  });
  return { stop };
}
