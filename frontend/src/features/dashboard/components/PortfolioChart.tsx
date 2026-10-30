import { useId, useMemo, useState, type PointerEvent } from "react";
import { formatCurrency } from "../../../utils/format";
import type { PortfolioPoint } from "../types";

type PortfolioChartProps = {
  points: PortfolioPoint[];
};

function smoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M ${coords[0].x},${coords[0].y}`;

  const tension = 0.3;
  let d = `M ${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;

  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(i - 1, 0)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(i + 2, coords.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }

  return d;
}

function formatPriceTick(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function PortfolioChart({ points }: PortfolioChartProps) {
  const gradientPrefix = useId().replace(/:/g, "");
  const [activeIndex, setActiveIndex] = useState(points.length - 1);

  const chart = useMemo(() => {
    const svgWidth = 720;
    const svgHeight = 220;
    const padLeft = 56;
    const padRight = 20;
    const padTop = 16;
    const padBottom = 24;

    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const spread = rawMax - rawMin || rawMax * 0.01 || 1;
    const padding = spread * 0.08;
    const min = rawMin - padding;
    const max = rawMax + padding;
    const range = max - min;

    const toX = (i: number) =>
      padLeft + (i / Math.max(points.length - 1, 1)) * (svgWidth - padLeft - padRight);
    const toY = (v: number) =>
      padTop + (1 - (v - min) / range) * (svgHeight - padTop - padBottom);

    const coords = points.map((p, i) => ({ x: toX(i), y: toY(p.value) }));
    const linePath = smoothPath(coords);
    const last = coords[coords.length - 1];
    const firstX = coords[0].x;
    const bottomY = svgHeight - padBottom;
    const areaPath = `${linePath} L ${last.x.toFixed(2)},${bottomY} L ${firstX.toFixed(2)},${bottomY} Z`;

    const yTicks = Array.from({ length: 4 }, (_, i) => {
      const fraction = i / 3;
      return { value: min + fraction * range, y: toY(min + fraction * range) };
    }).reverse();

    const labelStep = Math.max(1, Math.floor(points.length / 5));
    const xLabels = points
      .map((p, i) => ({ label: p.label, x: toX(i), i }))
      .filter(({ i }) => i % labelStep === 0 || i === points.length - 1);

    return {
      areaPath,
      coords,
      linePath,
      padLeft,
      padRight,
      padBottom,
      rawMax,
      rawMin,
      svgHeight,
      svgWidth,
      xLabels,
      yTicks,
    };
  }, [points]);

  if (points.length === 0) return null;

  const open = points[0].value;
  const current = points[points.length - 1].value;
  const isPos = current >= open;
  const stroke = isPos ? "#34d399" : "#fb7185";
  const gradId = `${gradientPrefix}-${isPos ? "chartAreaGreen" : "chartAreaRed"}`;
  const activePoint = points[activeIndex] ?? points[points.length - 1];
  const activeCoord = chart.coords[activeIndex] ?? chart.coords[chart.coords.length - 1];
  const tooltipLeft = `${(activeCoord.x / chart.svgWidth) * 100}%`;
  const tooltipTop = `${(activeCoord.y / chart.svgHeight) * 100}%`;

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const plotRatio = Math.max(
      0,
      Math.min(1, (ratio * chart.svgWidth - chart.padLeft) / (chart.svgWidth - chart.padLeft - chart.padRight)),
    );
    setActiveIndex(Math.round(plotRatio * (points.length - 1)));
  }

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/30">
      <div className="grid grid-cols-2 gap-x-4 border-b border-slate-800/60 bg-slate-900/35 px-4 py-3 sm:grid-cols-4">
        {[
          { label: "Curve", value: "Intraday portfolio", mono: false },
          { label: "Open", value: formatCurrency(open, false), mono: true },
          { label: "Current", value: formatCurrency(current, false), mono: true },
          { label: "Range", value: `${formatPriceTick(chart.rawMin)} to ${formatPriceTick(chart.rawMax)}`, mono: true },
        ].map(({ label, value, mono }) => (
          <div key={label}>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {label}
            </span>
            <span className={["mt-1 block text-xs text-slate-200", mono ? "font-mono" : ""].join(" ")}>
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="relative">
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded border border-slate-700 bg-slate-950/95 px-2.5 py-2 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.8)]"
          style={{
            left: tooltipLeft,
            top: tooltipTop,
            transform: `translate(-50%, ${activeCoord.y < 70 ? "14px" : "calc(-100% - 14px)"})`,
          }}
        >
          <div className="font-mono text-[11px] text-slate-400">{activePoint.label}</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-slate-100">
            {formatCurrency(activePoint.value, false)}
          </div>
        </div>

        <svg
          aria-label="Intraday portfolio value chart"
          className="h-64 w-full touch-none"
          onPointerLeave={() => setActiveIndex(points.length - 1)}
          onPointerMove={handlePointerMove}
          role="img"
          viewBox={`0 0 ${chart.svgWidth} ${chart.svgHeight}`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="75%" stopColor={stroke} stopOpacity="0.04" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {chart.yTicks.map(({ value, y }) => (
            <g key={value}>
              <line
                x1={chart.padLeft}
                x2={chart.svgWidth - chart.padRight}
                y1={y.toFixed(2)}
                y2={y.toFixed(2)}
                stroke="#1e293b"
                strokeWidth="0.8"
                strokeDasharray="3,5"
              />
              <text
                x={(chart.padLeft - 6).toFixed(2)}
                y={y.toFixed(2)}
                dy="0.35em"
                textAnchor="end"
                fill="#64748b"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
              >
                {formatPriceTick(value)}
              </text>
            </g>
          ))}

          <path d={chart.areaPath} fill={`url(#${gradId})`} />
          <path
            d={chart.linePath}
            fill="none"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <line
            x1={activeCoord.x.toFixed(2)}
            x2={activeCoord.x.toFixed(2)}
            y1="12"
            y2={(chart.svgHeight - chart.padBottom).toFixed(2)}
            stroke="#64748b"
            strokeDasharray="3,4"
            strokeOpacity="0.85"
            strokeWidth="1"
          />
          <circle cx={activeCoord.x} cy={activeCoord.y} r="7" fill={stroke} fillOpacity="0.15" />
          <circle cx={activeCoord.x} cy={activeCoord.y} r="4" fill="#020617" stroke={stroke} strokeWidth="2.5" />

          {chart.coords.map((coord, index) => (
            <circle
              aria-label={`${points[index].label}: ${formatCurrency(points[index].value, false)}`}
              className="cursor-crosshair opacity-0 focus:opacity-100"
              cx={coord.x}
              cy={coord.y}
              fill={stroke}
              key={`${points[index].label}-${index}`}
              onFocus={() => setActiveIndex(index)}
              r="8"
              role="button"
              tabIndex={0}
            />
          ))}

          {chart.xLabels.map(({ label, x }) => (
            <text
              key={label}
              x={x.toFixed(2)}
              y={(chart.svgHeight - 5).toFixed(2)}
              textAnchor="middle"
              fill="#64748b"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              {label}
            </text>
          ))}
        </svg>
      </div>

      <table className="sr-only">
        <caption>Intraday portfolio values</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <td>{point.label}</td>
              <td>{formatCurrency(point.value, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
