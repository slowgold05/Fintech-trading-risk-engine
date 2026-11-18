import { registerHandsetSurface } from "./wallMotion";
import { useCallback, useId, useLayoutEffect, useMemo, useRef } from "react";
import { FundCarousel } from "./FundCarousel";
import { useSessionPaint } from "./sessionCursor";
import type { Surface } from "./terrainData";

const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Profile view. Time runs across the paper and each fund has its own engraved datum.
function camera(
  row: number,
  count: number,
  t: number,
  amplitude: number,
  ceiling: number,
  w: number,
  h: number,
) {
  const depth = row / Math.max(1, count - 1);
  return {
    x: 12 + (1 - depth) * 20 + t * (w - 83),
    y: 78 + depth * (h - 98) - t * 13 - (amplitude / (ceiling || 1)) * 70,
  };
}

export function PhoneTerrain({
  surface,
  symbol,
  inspect,
  release,
  choose,
}: {
  surface: Surface;
  symbol: string;
  inspect: (s: string, date: string) => void;
  release: () => void;
  choose: (sector: string) => void;
}) {
  const readoutId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const unavailable = useRef<HTMLParagraphElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const active = Math.max(
    0,
    surface.ridges.findIndex((r) => r.symbol === symbol),
  );
  const start = Math.min(Math.floor(active / 4) * 4, Math.max(0, surface.ridges.length - 4));
  const ridges = useMemo(() => surface.ridges.slice(start, start + 4), [start, surface]);
  const selected = surface.ridges[active];
  const observations = useMemo(() => [...selected.points.values()], [selected]);
  const peak = useMemo(
    () => observations.reduce((a, b) => (a.amplitude > b.amplitude ? a : b)),
    [observations],
  );
  const dates = useMemo(() => surface.dates.map(Date.parse), [surface]);
  const span = dates.at(-1)! - dates[0] || 1;
  const current = useRef<string | null>(null);
  const read = useCallback(
    (date: string | null) => {
      const value = date ? selected.points.get(date) : peak;
      current.current = date;
      const node = readout.current,
        dot = marker.current,
        el = canvas.current;
      if (!node || !dot || !el) return;
      dot.hidden = !value;
      dot.dataset.inspecting = String(!!date);
      node.dataset.scrub = String(!!date);
      node.children[0].textContent = value ? (date ? "SESSION RANGE" : "WINDOW PEAK") : "NO MATCHING BAR";
      node.children[1].textContent = value ? value.amplitude.toFixed(2) + "%" : "—";
      node.children[2].textContent = selected.symbol + " · " + (value?.date ?? date);
      node.children[3].textContent = value ? "Close $" + value.close.toFixed(2) : "";
      if (value) {
        const p = camera(
          active - start,
          ridges.length,
          (Date.parse(value.date) - dates[0]) / span,
          value.amplitude,
          surface.ceiling,
          el.clientWidth,
          el.clientHeight,
        );
        dot.style.height = el.clientHeight - p.y + "px";
        dot.style.transform = `translate(${p.x}px,${p.y}px)`;
      }
    },
    [selected, peak, dates, span, active, start, ridges.length, surface.ceiling],
  );
  useSessionPaint(read);
  useLayoutEffect(() => {
    const viewport = canvas.current?.parentElement;
    registerHandsetSurface(viewport ?? null, 135);
    registerHandsetSurface(viewport?.parentElement?.querySelector(".fund-carousel") ?? null, 215);
  }, []);

  useLayoutEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (unavailable.current) unavailable.current.hidden = !!ctx;
    if (!ctx) return;
    let visible = false,
      paintedWidth = 0,
      paintedHeight = 0;
    function draw() {
      if (!visible || document.hidden || !ctx) return;
      const w = el.clientWidth,
        h = el.clientHeight,
        scale = Math.min(devicePixelRatio, 1.5);
      if (paintedWidth === w && paintedHeight === h) return;
      paintedWidth = w;
      paintedHeight = h;
      el.width = Math.round(w * scale);
      el.height = Math.round(h * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const budget = Math.max(32, Math.floor(w / 2.5));
      // A shared perspective grid ties the separated cuts to one time axis.
      ctx.strokeStyle = "#b9bac018";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let tick = 0; tick <= 16; tick++) {
        const t = tick / 16,
          back = camera(0, ridges.length, t, 0, surface.ceiling, w, h);
        const front = camera(ridges.length - 1, ridges.length, t, 0, surface.ceiling, w, h);
        ctx.moveTo(back.x, back.y);
        ctx.lineTo(front.x, front.y + 5);
      }
      ctx.stroke();
      ridges.forEach((ridge, row) => {
        const lit = ridge.symbol === symbol;
        const at = (t: number, amp = 0) => camera(row, ridges.length, t, amp, surface.ceiling, w, h);
        const base = at(0),
          end = at(1);
        ctx.strokeStyle = "#484a4e";
        ctx.lineWidth = 0.6;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(base.x - 7, base.y);
        ctx.lineTo(end.x + 5, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Keep both extrema of each time bucket. Flush on gaps so missing sessions never acquire a height.
        let run: { t: number; amp: number }[] = [];
        function drawRun() {
          if (!run.length || !ctx) return;
          const points = [];
          const size = Math.max(1, Math.ceil(run.length / budget));
          for (let i = 0; i < run.length; i += size) {
            const group = run.slice(i, i + size);
            const min = group.reduce((a, b) => (a.amp < b.amp ? a : b)),
              max = group.reduce((a, b) => (a.amp > b.amp ? a : b));
            points.push(...(min === max ? [min] : min.t < max.t ? [min, max] : [max, min]));
          }
          const crest = new Path2D();
          points.forEach(({ t, amp }, i) => {
            const p = at(t, amp);
            if (i) crest.lineTo(p.x, p.y);
            else crest.moveTo(p.x, p.y);
          });
          const fill = new Path2D(crest),
            first = at(points[0].t),
            last = at(points.at(-1)!.t);
          fill.lineTo(last.x, last.y);
          fill.lineTo(first.x, first.y);
          fill.closePath();
          const shade = ctx.createLinearGradient(0, base.y - 76, 0, base.y);
          shade.addColorStop(0, lit ? "#c49a70" : "#8c8e90");
          shade.addColorStop(1, lit ? "#362b24" : "#292c30");
          ctx.fillStyle = shade;
          ctx.fill(fill);
          ctx.save();
          ctx.clip(fill);
          ctx.strokeStyle = lit ? "#edc09555" : "#babcc148";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (let x = base.x - 40; x <= end.x; x += 3.6) {
            ctx.moveTo(x + 15, base.y - 78);
            ctx.lineTo(x, base.y + 1);
          }
          ctx.stroke();
          ctx.restore();
          // The narrow back edge catches light. Its facets use only the observed profile.
          const light = new Path2D(),
            shadow = new Path2D();
          for (let j = 1; j < points.length; j++) {
            const a = at(points[j - 1].t, points[j - 1].amp),
              b = at(points[j].t, points[j].amp);
            const face = b.y < a.y ? light : shadow;
            face.moveTo(a.x, a.y);
            face.lineTo(a.x + 4, a.y - 3.5);
            face.lineTo(b.x + 4, b.y - 3.5);
            face.lineTo(b.x, b.y);
            face.closePath();
          }
          ctx.fillStyle = lit ? "#87694e" : "#54585d";
          ctx.fill(shadow);
          ctx.fillStyle = lit ? "#c49c78" : "#94989a";
          ctx.fill(light);
          ctx.strokeStyle = lit ? "#ffd0a1" : "#afb1b4";
          ctx.lineWidth = lit ? 1.6 : 1;
          ctx.stroke(crest);
          run = [];
        }
        surface.dates.forEach((date, i) => {
          const bar = ridge.points.get(date);
          if (bar) run.push({ t: (dates[i] - dates[0]) / span, amp: bar.amplitude });
          else drawRun();
        });
        drawRun();
        ctx.fillStyle = lit ? "#f0bb88" : "#c1c2c4";
        ctx.font = "500 10px 'IBM Plex Mono', monospace";
        ctx.fillText(ridge.symbol, end.x + 7, end.y - 2);
      });
      read(current.current);
      el.dataset.painted = "true";
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      el.parentElement?.toggleAttribute("data-paused", !visible);
      draw();
    });
    const resize = new ResizeObserver(draw);
    observer.observe(el);
    resize.observe(el);
    document.addEventListener("visibilitychange", draw);
    return () => {
      observer.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", draw);
    };
  }, [ridges, symbol, dates, surface, span, read]);

  const stamps = useMemo(() => observations.map((b) => Date.parse(b.date)), [observations]);
  function scrub(x: number) {
    const el = canvas.current!;
    const { left, width } = el.getBoundingClientRect();
    const x0 = camera(active - start, ridges.length, 0, 0, surface.ceiling, width, el.clientHeight).x;
    const t = Math.max(0, Math.min(1, (x - left - x0) / (width - 83)));
    const stamp = dates[0] + t * span;
    let lo = 0,
      hi = stamps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (stamps[mid] < stamp) lo = mid + 1;
      else hi = mid;
    }
    const nearest = observations[lo > 0 && stamp - stamps[lo - 1] < stamps[lo] - stamp ? lo - 1 : lo];
    if (current.current !== nearest.date) inspect(symbol, nearest.date);
  }
  return (
    <div className="phone-relief">
      <div ref={readout} id={readoutId} className="profile-readout" aria-live="off">
        <small />
        <strong />
        <span />
        <b />
      </div>
      <div className="terrain-viewport profile-viewport">
        <canvas
          ref={canvas}
          aria-describedby={readoutId}
          role="application"
          tabIndex={0}
          aria-label={"Inspect " + symbol + " range. Slide across sessions or use the arrow keys."}
          onPointerDown={(e) => scrub(e.clientX)}
          onPointerMove={(e) => {
            if (e.buttons) scrub(e.clientX);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onBlur={release}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              release();
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const index = observations.findIndex((b) => b.date === (current.current ?? peak.date));
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? observations.length - 1
                  : index + (e.key === "ArrowLeft" ? -1 : 1);
            inspect(symbol, observations[Math.max(0, Math.min(observations.length - 1, next))].date);
          }}
        />
        <p ref={unavailable} className="terrain-failure" hidden>
          Profile drawing unavailable. The selected fund’s readings appear above.
        </p>
        <div ref={marker} className="profile-marker" aria-hidden="true">
          <i />
        </div>
      </div>
      <div className="terrain-axes profile-axis">
        <span>
          {dateLabel.format(dates[0])} ’{surface.dates[0].slice(2, 4)}
        </span>
        <i />
        <span>
          {dateLabel.format(dates.at(-1))} ’{surface.dates.at(-1)!.slice(2, 4)}
        </span>
      </div>
      <FundCarousel
        ridges={surface.ridges}
        active={active}
        choose={(i) => {
          release();
          choose(surface.ridges[i].sector);
        }}
      />
    </div>
  );
}
