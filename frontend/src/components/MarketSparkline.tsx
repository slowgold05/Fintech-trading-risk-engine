import { useRef } from "react";
import { useSessionPaint } from "./market/sessionCursor";
export type SparklineProps = {
  values: readonly number[];
  /** Prefix for the accessible name. Direction is appended so color is not the only signal. */
  label: string;
  className?: string;
  activeIndex?: number;
  dates?: string[];
};

const WIDTH = 120;
const HEIGHT = 36;
const PAD = 3;

function linePoints(values: readonly number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  return values
    .map((value, index) => {
      const x = PAD + (index / (values.length - 1)) * (WIDTH - PAD * 2);
      // A flat series stays centered so equal closes still draw a line.
      const y = span === 0 ? HEIGHT / 2 : PAD + (1 - (value - min) / span) * (HEIGHT - PAD * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline({ values, label, className, activeIndex = -1, dates }: SparklineProps) {
  const points = values.filter((value) => Number.isFinite(value));
  const path = points.length > 1 ? linePoints(points) : "";
  const coords = path.split(" ");
  const rule = useRef<SVGGElement>(null);
  const cursor = useSessionPaint((date) => {
    const i = date && dates ? dates.indexOf(date) : activeIndex;
    const mark = coords[i]?.split(",");
    const g = rule.current;
    if (!g) return;
    g.style.display = mark ? "" : "none";
    if (mark) {
      g.setAttribute("transform", `translate(${mark[0]} 0)`);
      g.lastElementChild?.setAttribute("cy", mark[1]);
    }
  });
  if (points.length < 2) return null;
  const endpoint = path.slice(path.lastIndexOf(" ") + 1).split(",");
  const first = points[0];
  const last = points[points.length - 1];
  const direction = last > first ? "up" : last < first ? "down" : "flat";
  const tone = last >= first ? "stroke-emerald-400" : "stroke-rose-400";

  return (
    <svg
      onPointerMove={
        dates && cursor
          ? (e) => {
              if (e.pointerType === "touch") return;
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.round(
                Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (dates.length - 1),
              );
              cursor.set(dates[i]);
            }
          : undefined
      }
      onPointerLeave={dates && cursor ? () => cursor.set(null) : undefined}
      aria-label={`${label}, ${direction}`}
      className={["block", className ?? "h-8 w-full"].join(" ")}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <polyline
        className={tone}
        fill="none"
        points={path}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <circle className={`trace-end ${direction}`} cx={endpoint[0]} cy={endpoint[1]} r="2.5" />
      {(dates || activeIndex >= 0) && (
        <g
          ref={rule}
          transform={
            activeIndex >= 0 ? "translate(" + coords[activeIndex]?.split(",")[0] + " 0)" : undefined
          }
          style={{ display: activeIndex >= 0 ? "" : "none" }}
          stroke="var(--desk-accent)"
          fill="var(--desk-accent)"
        >
          <path d={`M0 0V${HEIGHT}`} strokeDasharray="2 2" strokeWidth="1" />
          <circle cx="0" cy={coords[activeIndex]?.split(",")[1]} r="2" />
        </g>
      )}
    </svg>
  );
}
