import {
  memo,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useLook } from "../looks/preferences";
import { State } from "../kit";
import {
  angleAt,
  fixed,
  fractionAt,
  pathOf,
  polar,
  sector,
  sweep,
  traces,
  valid,
  type Sample,
  type XY,
} from "./geometry";
import "./instruments.css";

type Scale = { low: number; high: number; base: number };
type PlotProps = {
  samples: readonly Sample[];
  names: readonly string[];
  scale: Scale;
  format: (v: number) => string;
};
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function rimLabel(label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const date = new Date(label + "T00:00:00Z");
  return Number.isFinite(date.getTime()) ? shortDate.format(date) : label;
}
const palette = ["#d7a66f", "#c0c3bb", "#898e90"];
function bounds(samples: readonly Sample[], reference?: number): Scale {
  const base = reference ?? samples.find((s) => valid(s.values[0]))?.values[0] ?? 0;
  let low = base,
    high = base;
  for (const { values } of samples)
    for (const value of values) {
      if (valid(value)) {
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
  return { low, high, base };
}
function extent(scale: Scale, value: number) {
  return scale.high === scale.low ? 0.5 : (value - scale.low) / (scale.high - scale.low);
}
const HEIGHT = 240;
const RIDGE_LEFT = 52;
const RIDGE_RIGHT = 53;
const valueTicks = [0, 0.5, 1];
function ridgeX(width: number, left: number, index: number, count: number) {
  return fixed(left + fractionAt(index, count) * (width - left - RIDGE_RIGHT));
}
function ridgeY(scale: Scale, value: number) {
  return fixed(195 - extent(scale, value) * 133);
}

const Ridge = memo(function Ridge({ samples, names, scale, format, width, left }: PlotProps & { width: number; left: number }) {
  const grid = useId();
  const depth = names.length > 1 ? Math.min(18, 40 / (names.length - 1)) : 26;
  const ticks = samples.length < 2 ? [0.5] : [0, 0.25, 0.5, 0.75, 1];
  return (
    <g className="ins-relief">
      <defs>
        <pattern id={grid} width="13" height="13" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".8" fill="#383b3c" />
        </pattern>
      </defs>
      <rect width={width} height={HEIGHT} fill={`url(#${grid})`} />
      {valueTicks.map((f, i) => {
        const y = 195 - f * 133;
        return (
          <g key={i}>
            <path d={`M${left - 5} ${y}H${width - 45}`} className="ins-gridline" />
            <text className="ins-axis-value" x={left - 8} y={y - 5} textAnchor="end">
              {samples.length && (scale.low !== scale.high || f === 0.5)
                ? format(scale.low + f * (scale.high - scale.low))
                : ""}
            </text>
          </g>
        );
      })}
      {names
        .map((_, n) => names.length - 1 - n)
        .map((k) => {
          const z = k * depth;
          const runs = traces(samples, k, (i, v) => [
            ridgeX(width, left, i, samples.length) + z,
            ridgeY(scale, v) - z,
          ]);
          return (
            <g key={k}>
              {runs.map((run, j) => {
                const first = run[0],
                  last = run[run.length - 1],
                  floor = 208 - z;
                const cover = run.map(([x, y]): XY => [x + depth, y - depth]);
                const face = pathOf(run) + `L${last[0]},${floor}H${first[0]}Z`;
                const facets = Array.from({ length: 5 }, () => [] as string[]);
                for (let i = 1; i < run.length; i++) {
                  const [x, y] = run[i],
                    [px, py] = run[i - 1];
                  const slope = (py - y) / Math.max(0.1, x - px);
                  const shade = Math.max(0, Math.min(4, Math.round(2 + 1.4 * slope)));
                  facets[shade].push(
                    `M${px},${py}L${x},${y}l${depth},-${depth}L${px + depth},${py - depth}Z`
                  );
                }
                const roof =
                  pathOf(run) +
                  "L" +
                  cover
                    .slice()
                    .reverse()
                    .map((p) => p.join(","))
                    .join("L") +
                  "Z";
                const mesh = run
                  .filter((_, i) => i % Math.max(1, Math.ceil(samples.length / (width / 6))) === 0)
                  .map(([x, y]) => `M${x},${floor}V${y}l${depth},-${depth}`)
                  .join("");
                return (
                  <g key={j}>
                    <path d={face} fill={k ? "#282b2d" : "#373738"} />
                    <path d={roof} fill={k ? "#696d6c" : "#8b8176"} />
                    {facets.map((faces, i) => (
                      <path
                        key={i}
                        d={faces.join("")}
                        fill={["#4c4e4e", "#666866", "#80827d", "#a0a19a", "#b7b8ad"][i]}
                      />
                    ))}
                    <path
                      d={mesh}
                      fill="none"
                      stroke={k ? "#949996" : "#aea296"}
                      strokeOpacity=".45"
                      strokeWidth=".65"
                    />
                    <path d={pathOf(cover)} fill="none" stroke="#c6c8bf" strokeWidth=".8" />
                    <path
                      d={pathOf(run)}
                      fill="none"
                      stroke={palette[k % palette.length]}
                      strokeWidth={k ? 1.4 : 2.2}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      <path className="ins-gridline" d={`M${left} 211H${width - RIDGE_RIGHT}l28,-28`} />
      {ticks.map((f, i) => {
        const index = Math.round(f * (samples.length - 1)),
          x = ridgeX(width, left, index, samples.length);
        return (
          <g key={i}>
            <path stroke="#818784" d={`M${x} 211v4`} />
            {(width > 510 || i % 2 === 0) && (
              <text x={x} y="231" textAnchor="middle">
                {samples[index]?.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

const Dial = memo(function Dial({ samples, names, scale, pattern }: PlotProps & { pattern: string }) {
  const base = 74 + extent(scale, scale.base) * 55;
  const step = sweep / Math.max(1, samples.length - 1);
  return (
    <g>
      <defs>
        <pattern id={pattern} patternUnits="userSpaceOnUse" width="4" height="4">
          <path d="M-1,1l2,-2M0,4l4,-4M3,5l2,-2" stroke="#c4c5bb" strokeWidth="1.4" />
        </pattern>
      </defs>
      <circle cx="160" cy="160" r="151" fill="#191b18" stroke="#64665d" />
      <circle cx="160" cy="160" r="139" fill="#252722" stroke="#62655b" />
      {[76, 91, 105, 119, 131].map((r) => (
        <circle key={r} cx="160" cy="160" r={r} fill="none" stroke="#494c43" strokeWidth=".75" />
      ))}
      <circle cx="160" cy="160" r={base} fill="none" stroke="#b0b0a4" strokeWidth="1.3" />
      {Array.from({ length: 120 }, (_, i) => {
        const a = (i * Math.PI) / 60;
        return (
          <path
            key={i}
            d={`M${polar(a, 150)}L${polar(a, i % 5 === 0 ? 140 : 147)}`}
            stroke={i % 5 === 0 ? "#d3d4ca" : "#83877c"}
            strokeWidth={i % 5 === 0 ? 1.6 : 1}
          />
        );
      })}
      {samples.map((sample, i) => {
        const v = sample.values[0];
        if (!valid(v)) return null;
        const a = angleAt(fractionAt(i, samples.length)),
          r = 74 + extent(scale, v) * 55;
        return (
          <path
            key={i}
            fill={v < scale.base ? `url(#${pattern})` : "#c2c3b6"}
            d={sector(
              Math.max(-sweep / 2, a - step * 0.45),
              Math.min(sweep / 2, a + step * 0.45),
              Math.min(r, base),
              Math.max(r, base) + 0.65
            )}
          />
        );
      })}
      {names.slice(1).map((name, k) => (
        <path
          key={name}
          fill="none"
          stroke={k ? "#a2a69d" : "#f1f1e7"}
          strokeDasharray={k ? "1.5 2" : "4 2"}
          strokeWidth="1.5"
          d={traces(samples, k + 1, (i, v) =>
            polar(angleAt(fractionAt(i, samples.length)), 74 + extent(scale, v) * 55)
          )
            .map(pathOf)
            .join("")}
        />
      ))}
      {samples.length > 1 &&
        [0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const angle = angleAt(f),
            date = samples[Math.round(f * (samples.length - 1))].label;
          // Set the rim type tangent to the scale, upright on the lower half.
          const [x, y] = polar(angle, 135);
          const degrees = (angle * 180) / Math.PI;
          return (
            <g key={i}>
              <path d={`M${polar(angle, 72)}L${polar(angle, 131)}`} stroke="#080907" strokeOpacity=".6" />
              <text
                className="ins-rim"
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${Math.abs(degrees) > 90 ? degrees + 180 : degrees} ${x} ${y})`}
              >
                {rimLabel(date)}
              </text>
            </g>
          );
        })}
      <circle cx="160" cy="160" r="69" fill="#10120f" stroke="#777b6f" />
      <circle cx="160" cy="160" r="65" fill="none" stroke="#393c35" />
    </g>
  );
});

function useWidth(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!enabled || !node || typeof ResizeObserver === "undefined") return;
    let measured = Math.max(285, Math.round(node.clientWidth));
    let frame = 0;
    setWidth(measured);
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(285, Math.round(entry.contentRect.width));
      if (next === measured) return;
      measured = next;
      cancelAnimationFrame(frame);
      // Updating the SVG viewBox can also change its height. Commit after this delivery.
      frame = requestAnimationFrame(() => setWidth(next));
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return { ref, width };
}

export type InstrumentStatus = {
  kind: "loading" | "empty" | "unavailable" | "error";
  title: string;
  action?: ReactNode;
  role?: "alert" | "status";
};
export type SeriesProps = {
  samples: readonly Sample[];
  names: readonly string[];
  format: (v: number) => string;
  label: string;
  selected: number;
  onSelect: (index: number) => void;
  reference?: number;
  status?: InstrumentStatus;
  wideLabels?: boolean;
};
const NO_SAMPLES: readonly Sample[] = [];
export function SeriesInstrument({
  samples,
  names,
  format,
  label,
  selected,
  onSelect,
  reference,
  status,
  wideLabels = false,
}: SeriesProps) {
  const { prefs } = useLook();
  const dial = prefs.look === "dial";
  const pattern = useId();
  const readingsId = useId();
  const { ref, width } = useWidth(!dial);
  const hasReadings = useMemo(() => samples.some((s) => s.values.some(valid)), [samples]);
  const state =
    status ??
    (!hasReadings
      ? { kind: "empty" as const, title: `Recorded observations fill ${names[0] || "this series"}.` }
      : undefined);
  const points = state ? NO_SAMPLES : samples;
  const scale = useMemo(() => bounds(points, reference), [points, reference]);
  const axisLabelLength = wideLabels && !dial && points.length
    ? Math.max(...valueTicks.map(f => format(scale.low + f * (scale.high - scale.low)).length))
    : 0;
  // Terrain's 10px monospace labels advance 6px per character.
  const left = Math.max(RIDGE_LEFT, 12 + 6 * axisLabelLength);
  const plotProps = { samples: points, names, format, scale };
  const index = Math.max(0, Math.min(points.length - 1, selected));
  const observation = points[index],
    value = observation?.values[0];
  const a = angleAt(fractionAt(index, points.length));
  const r = valid(value) ? 74 + extent(scale, value) * 55 : 102;
  const selection = formatValue(value);
  // Keep long readings inside the 130px inner circle.
  const dialValueLength = wideLabels && selection.length > 11 ? 122 : undefined;
  function formatValue(v: number | null | undefined) {
    return valid(v) ? format(v) : "—";
  }
  function inspect(event: PointerEvent<SVGSVGElement>) {
    if (!points.length || (event.pointerType === "touch" && !event.buttons)) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width,
      y = (event.clientY - box.top) / box.height;
    const f = dial ? Math.atan2(x - 0.5, 0.5 - y) / sweep + 0.5 : (x * width - left) / (width - left - RIDGE_RIGHT);
    onSelect(Math.round(Math.min(1, Math.max(0, f)) * (points.length - 1)));
  }
  const extrema = useMemo(() => {
    const priced = points.filter((s) => valid(s.values[0]));
    if (!priced.length) return [];
    return [
      priced.reduce((l, s) => (s.values[0]! < l.values[0]! ? s : l)),
      priced.reduce((h, s) => (s.values[0]! > h.values[0]! ? s : h)),
    ];
  }, [points]);
  return (
    <div
      ref={ref}
      className={`series-instrument ${dial ? "series-dial" : "series-terrain"}`}
      data-rest={Boolean(state)}
      data-state={state?.kind}
      data-wide-labels={wideLabels || undefined}
      aria-label={label}
    >
      <div className="ins-plate">
        <svg
          className="ins-graphic"
          role="img"
          aria-label={label}
          viewBox={dial ? "0 0 320 320" : `0 0 ${width} ${HEIGHT}`}
          onPointerMove={inspect}
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse") e.currentTarget.setPointerCapture(e.pointerId);
            inspect(e);
          }}
        >
          {dial ? (
            <>
              <Dial {...plotProps} pattern={pattern} />
              {observation && (
                <g className="ins-needle">
                  <path d={`M${polar(a, 143)}L${polar(a, r)}`} />
                  <circle cx={polar(a, r)[0]} cy={polar(a, r)[1]} r="3.5" />
                </g>
              )}
              <text className="ins-dial-label" x="160" y="139" textAnchor="middle">
                {names[0]}
              </text>
              <text className="ins-dial-value" x="160" y="166" textAnchor="middle"
                textLength={dialValueLength} lengthAdjust="spacingAndGlyphs">
                {selection}
              </text>
              <text className="ins-date" x="160" y="184" textAnchor="middle">
                {observation?.label}
              </text>
            </>
          ) : (
            <>
              <Ridge {...plotProps} width={width} left={left} />
              {observation && (
                <g className="ins-needle">
                  <path strokeDasharray="3 4" d={`M${ridgeX(width, left, index, points.length)} 26V211`} />
                  {valid(value) && (
                    <circle cx={ridgeX(width, left, index, points.length)} cy={ridgeY(scale, value)} r="4" />
                  )}
                </g>
              )}
            </>
          )}
        </svg>
        {dial && points.length > 0 && (
          <div className="ins-register">
            <div className="ins-register-title">
              Window readings · {points.filter((p) => valid(p.values[0])).length}
            </div>
            {extrema.map((s, i) => (
              <div className="ins-extreme" key={i}>
                <small>
                  {i ? "High" : "Low"} · {s.label}
                </small>
                <b>{formatValue(s.values[0])}</b>
              </div>
            ))}
            <div className="ins-base">
              <small>Reference</small>
              <b>{format(scale.base)}</b>
            </div>
            <div className="ins-sign">
              <i />
              Above <i />
              Below
            </div>
          </div>
        )}
      </div>
      {state ? (
        <State {...state} />
      ) : (
        <div className="ins-foot">
          <div className="ins-readings" id={readingsId}>
            {!dial && (
              <div>
                <small>Selected session</small>
                <b>{observation?.label ?? "—"}</b>
              </div>
            )}
            {names.map((name, k) => (
              <div key={name}>
                <small>
                  <i data-series={k} />
                  {name}
                </small>
                <b>{formatValue(observation?.values[k])}</b>
              </div>
            ))}
          </div>
          {dial && (
            <div className="ins-mobile-key">
              <span>Clockwise by session</span>
              <span>Reference {format(scale.base)}</span>
            </div>
          )}
          {points.length > 1 && (
            <div className="ins-scrub">
              <span>{points[0].label}</span>
              <input
                type="range"
                aria-label={label}
                aria-describedby={readingsId}
                aria-valuetext={observation?.label}
                min="0"
                max={points.length - 1}
                value={index}
                onChange={(e) => onSelect(Number(e.target.value))}
              />
              <span>{points.at(-1)?.label}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RestInstrument({
  status,
  label = "Session history",
}: {
  status: InstrumentStatus;
  label?: string;
}) {
  return (
    <SeriesInstrument
      status={status}
      samples={NO_SAMPLES}
      names={[label]}
      format={String}
      selected={0}
      onSelect={() => {}}
      label={label}
    />
  );
}
