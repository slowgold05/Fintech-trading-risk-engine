import { powerTime } from "./wallMotion";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSessionPaint } from "./sessionCursor";
import type { drawSurface } from "./terrainDrawing";
import { createTerrainRenderer } from "./terrainGL";
import { makeMesh, project, type Mesh } from "./terrainMesh";
import type { Surface } from "./terrainData";

type Props = {
  surface: Surface;
  symbol: string;
  inspect: (symbol: string, date: string | null) => void;
  release: () => void;
};
type Renderer = NonNullable<Awaited<ReturnType<typeof createTerrainRenderer>>>;

const monthYear = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "2-digit" });
const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

const Axes = memo(function Axes({
  mesh,
  active,
  width,
  height,
}: {
  mesh: Mesh;
  active: number;
  width: number;
  height: number;
}) {
  const { surface, time } = mesh;
  const small = width < 470;
  const origin = project(0, 0);
  const x = origin.x * width - 5,
    axisY = (z: number) => project(0, 0, z).y * height;
  const days = (Date.parse(surface.dates.at(-1)!) - Date.parse(surface.dates[0])) / 86400000;
  const dateLabel = days > 270 ? monthYear : monthDay;
  const ticks = small ? 3 : 5;
  return (
    <svg className="terrain-axes" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`M${x} ${axisY(0)}V${axisY(1)}`} />
      {[0, 0.5, 1].map((z) => (
        <g key={z}>
          <path d={`M${x - 3} ${axisY(z)}h6`} />
          <text x={x - 4} y={axisY(z) - 3} textAnchor="end">
            {(z * surface.ceiling).toFixed(1)}%
          </text>
        </g>
      ))}
      {Array.from({ length: ticks }, (_, i) => {
        const col = Math.round((i * (time.length - 1)) / (ticks - 1)),
          p = project(time[col], 0);
        return (
          <g key={i}>
            <path d={`M${p.x * width} ${p.y * height + 2}v4`} />
            <text x={p.x * width} y={p.y * height + 17} textAnchor={i === ticks - 1 ? "end" : "middle"}>
              {dateLabel.format(Date.parse(surface.dates[col]))}
            </text>
          </g>
        );
      })}
      {surface.ridges.map((r, i) => {
        if (small && i % 2 && active !== i) return null;
        if (small && active % 2 && Math.abs(i - active) === 1) return null;
        const p = project(1, i / Math.max(1, surface.ridges.length - 1));
        const mid = (surface.ridges.length - 1) / 2;
        const pitch = Math.max(0, 15 - (height * 0.35) / Math.max(1, surface.ridges.length - 1));
        const labelY = Math.min(height - 6, p.y * height + (mid - i) * pitch);
        const labelX = Math.min(width - r.symbol.length * 6.4 - 5, p.x * width + 18);
        return (
          <g key={r.symbol}>
            <path fill="none" d={`M${p.x * width + 2} ${p.y * height}L${labelX - 6} ${labelY}h3`} />
            <text className={i === active ? "lit" : undefined} x={labelX} y={labelY + 3}>
              {r.symbol}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

export function TerrainPlot({ surface, symbol, inspect, release }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gpu, setGpu] = useState<Renderer | null>(null);
  const uploaded = useRef<Mesh | null>(null);
  const wake = useRef(() => {});
  const [rasterize, setRasterize] = useState<typeof drawSurface>();
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pointed = useRef<number | null>(null);
  const probe = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const reading = useRef<HTMLSpanElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const mesh = useMemo(() => makeMesh(surface), [surface]);
  const active = Math.max(
    0,
    surface.ridges.findIndex((r) => r.symbol === symbol),
  );
  const live = useRef({ active, col: -1 });
  const touchProbe = useRef(false);
  function positionTip(x: number, y: number) {
    if (tip.current)
      tip.current.style.transform = `translate(${Math.max(4, Math.min(size.w - 165, x + 10))}px,${touchProbe.current ? y - (tip.current.offsetHeight || 42) - 15 : Math.max(4, Math.min(size.h - 42, y - 45))}px)`;
  }
  function paintProbe(date: string | null) {
    const row = pointed.current ?? active;
    const col = date ? surface.dates.indexOf(date) : -1;
    live.current = { active: row, col };
    const marker = date ? mesh.rows[row]?.[col] : mesh.peaks[row];
    const read = marker && surface.ridges[row].points.get(surface.dates[marker.col]);
    const node = probe.current;
    const detail = tip.current;
    if (!node || !detail || !reading.current) return;
    node.hidden = !marker || !read || failed;
    const inspecting = pointed.current !== null;
    detail.hidden = node.hidden || !inspecting;
    wake.current();
    if (!marker || !read) {
      reading.current.textContent = "";
      return;
    }
    const fund = surface.ridges[row].symbol;
    const x = marker.x * size.w,
      y = marker.y * size.h;
    node.style.transform = `translate(${x}px,${y}px)`;
    node.dataset.inspecting = String(inspecting);
    const label = node.querySelector("span")!;
    label.hidden = inspecting;
    label.className = [marker.x > 0.74 ? "probe-left" : "", y < 34 ? "probe-below" : ""].join(" ");
    label.firstElementChild!.textContent = fund;
    label.lastElementChild!.textContent = read.amplitude.toFixed(2) + "%";
    detail.firstElementChild!.textContent = fund + " · " + read.amplitude.toFixed(2) + "%";
    detail.lastElementChild!.textContent = read.date + " · $" + read.close.toFixed(2);
    reading.current.textContent = inspecting
      ? fund +
        ", " +
        read.date +
        ", range " +
        read.amplitude.toFixed(2) +
        " percent, close " +
        read.close.toFixed(2) +
        " dollars."
      : "";
    positionTip(pointer.current?.x ?? x, pointer.current?.y ?? y);
  }
  useSessionPaint(paintProbe);
  const changed = useRef(0);
  useLayoutEffect(() => {
    probe.current?.style.setProperty("--lock-delay", Math.max(0, 1780 - powerTime(performance.now())) + "ms");
  }, []);
  useLayoutEffect(() => {
    if (!canvas.current || !window.ResizeObserver) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [fallback]);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || fallback) return;
    const controller = new AbortController();
    let instance: Renderer | null = null;
    void createTerrainRenderer(el, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          result?.destroy();
          return;
        }
        instance = result;
        if (result) setGpu(result);
        else setFallback(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFallback(true);
      });
    const lost = () => {
      setGpu(null);
      setFallback(true);
    };
    el.addEventListener("webglcontextlost", lost);
    return () => {
      controller.abort();
      el.removeEventListener("webglcontextlost", lost);
      instance?.destroy();
      uploaded.current = null;
    };
  }, [fallback]);
  useEffect(() => {
    if (!fallback) return;
    let live = true;
    void import("./terrainDrawing")
      .then((m) => {
        if (live) setRasterize(() => m.drawSurface);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [fallback]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !size.w || !size.h) return;
    const ctx = fallback ? el.getContext("2d") : null;
    if (!gpu && !ctx) {
      if (!fallback) return;
      const frame = requestAnimationFrame(() => setFailed(true));
      return () => cancelAnimationFrame(frame);
    }
    const scale = Math.min(size.w < 470 ? 1.25 : 1.5, window.devicePixelRatio || 1);
    const width = Math.round(size.w * scale),
      height = Math.round(size.h * scale);
    if (width !== el.width) el.width = width;
    if (height !== el.height) el.height = height;
    const rasters = new Map<number, HTMLCanvasElement>();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false,
      frame = 0,
      painted = -1,
      idle = 0;
    function paint(now: number) {
      frame = 0;
      if (!visible || document.hidden) return;
      if (gpu && uploaded.current !== mesh) {
        changed.current = uploaded.current ? now : 0;
        gpu.upload(mesh);
        uploaded.current = mesh;
      }
      const elapsed = powerTime(now);
      const { active, col } = live.current;
      const opening = (motion.matches || document.documentElement.dataset.motion === "reduced") ? 1 : Math.max(0, Math.min(1, (elapsed - 530) / 1460));
      const transition = (motion.matches || document.documentElement.dataset.motion === "reduced") || !changed.current ? 1 : Math.min(1, (now - changed.current) / 640);
      const sweep =
        col >= 0
          ? mesh.time[col]
          : (motion.matches || document.documentElement.dataset.motion === "reduced")
            ? (mesh.peaks[active]?.t ?? 0)
            : elapsed < 2200
              ? (elapsed - 650) / 1300
              : ((now % 5400) / 5400) * 1.24 - 0.12;
      gpu?.draw(
        active,
        sweep,
        col >= 0,
        transition * transition * (3 - 2 * transition),
        opening,
        (motion.matches || document.documentElement.dataset.motion === "reduced") ? 1 : Math.max(0, Math.min(1, (elapsed - 1780) / 420)),
        (motion.matches || document.documentElement.dataset.motion === "reduced") ? 0 : Math.sin(now / 1850),
      );
      if (probe.current) {
        const visibility = elapsed < 1780 && !(motion.matches || document.documentElement.dataset.motion === "reduced") ? "hidden" : "";
        if (probe.current.style.visibility !== visibility) probe.current.style.visibility = visibility;
        const marker = col < 0 ? mesh.peaks[active] : mesh.rows[active]?.[col];
        if (marker && gpu && changed.current) {
          const h = gpu.height(active, marker.t);
          if (h != null) {
            const p = project(marker.t, marker.d, h);
            probe.current.style.transform = `translate(${p.x * size.w}px,${p.y * size.h}px)`;
          }
          if (transition === 1) changed.current = 0;
        }
      }
      if (ctx && rasterize && painted !== active) {
        let raster = rasters.get(active);
        if (!raster) {
          raster = rasterize(surface, size.w, size.h, scale, active)?.image;
          if (raster) {
            if (rasters.size >= 3) rasters.delete(rasters.keys().next().value!);
            rasters.set(active, raster);
          }
        }
        if (raster) {
          ctx.clearRect(0, 0, el!.width, el!.height);
          ctx.drawImage(raster, 0, 0);
        }
        painted = active;
      }
      if ((gpu || painted >= 0) && !el!.hasAttribute("data-painted")) el!.setAttribute("data-painted", "");
      if (gpu && !(motion.matches || document.documentElement.dataset.motion === "reduced")) {
        if (elapsed < 530 && col < 0) idle = window.setTimeout(resume, 530 - elapsed);
        else if (elapsed < 2380 || transition < 1) frame = requestAnimationFrame(paint);
        else if (col < 0) idle = window.setTimeout(resume, 36);
      }
    }
    function resume() {
      clearTimeout(idle);
      if (visible && !document.hidden && !frame) frame = requestAnimationFrame(paint);
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      el.closest(".terrain-viewport")?.toggleAttribute("data-paused", !visible);
      if (visible) resume();
      else {
        clearTimeout(idle);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    observer.observe(el);
    wake.current = resume;
    document.addEventListener("visibilitychange", resume);
    motion.addEventListener("change", resume);
    return () => {
      observer.disconnect();
      clearTimeout(idle);
      cancelAnimationFrame(frame);
      wake.current = () => {};
      document.removeEventListener("visibilitychange", resume);
      motion.removeEventListener("change", resume);
    };
  }, [gpu, fallback, rasterize, mesh, size, surface]);

  function select(row: number, k: number) {
    if (!mesh.rows[row]?.[k]) return;
    if (pointed.current === row && live.current.col === k) return;
    pointed.current = row;
    paintProbe(surface.dates[k]);
    inspect(surface.ridges[row].symbol, surface.dates[k]);
  }
  function reset() {
    pointed.current = null;
    touchProbe.current = false;
    pointer.current = null;
    paintProbe(null);
    release();
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") {
      reset();
      return;
    }
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const row = Math.max(
      0,
      Math.min(mesh.rows.length - 1, active + (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0)),
    );
    pointer.current = null;
    const col = live.current.col;
    let k = col >= 0 ? col : (mesh.peaks[active]?.col ?? 0);
    if (e.key === "Home") k = 0;
    if (e.key === "End") k = mesh.time.length - 1;
    if (e.key === "ArrowRight") k++;
    if (e.key === "ArrowLeft") k--;
    k = Math.min(mesh.time.length - 1, Math.max(0, k));
    const step = e.key === "ArrowLeft" || e.key === "End" ? -1 : 1;
    while (k >= 0 && k < mesh.time.length && !mesh.rows[row][k]) k += step;
    select(row, k);
  }
  function track(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch" && !e.buttons) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    touchProbe.current = e.pointerType === "touch";
    pointer.current = { x, y };
    positionTip(x, y);
    const p = mesh.pick(x / rect.width, y / rect.height, rect.width, rect.height);
    if (p) select(p.row, p.col);
    else if (pointed.current !== null) reset();
  }
  return (
    <div className="terrain-viewport">
      <canvas
        key={fallback ? "raster" : "depth"}
        ref={canvas}
        data-renderer={fallback ? "canvas" : "webgl"}
        tabIndex={0}
        role="application"
        aria-label="Volatility terrain. Use left and right arrows for sessions, up and down for sector funds."
        aria-describedby="terrain-reading"
        onKeyDown={key}
        onBlur={reset}
        onPointerLeave={reset}
        onPointerMove={track}
        onPointerDown={track}
        onPointerCancel={reset}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") reset();
        }}
      />
      {size.w > 0 && <Axes mesh={mesh} active={active} width={size.w} height={size.h} />}
      <div ref={probe} className="terrain-probe" hidden>
        <i />
        <span>
          <em />
          <b />
        </span>
      </div>
      <span className="sr-only" ref={reading} id="terrain-reading" aria-live="polite" />
      <div ref={tip} className="desk-tooltip terrain-tip" role="tooltip" hidden>
        <b />
        <br />
        <span />
      </div>
      {failed && <p className="terrain-failure">Drawing unavailable. The fund readings are listed below.</p>}
    </div>
  );
}
