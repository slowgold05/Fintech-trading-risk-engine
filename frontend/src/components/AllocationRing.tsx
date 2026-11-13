import { formatCurrency, formatPercent } from "../utils/format";

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Tailwind tokens already used in this app (emerald, sky, violet, amber, rose, slate).
const PALETTE = [
  { stroke: "stroke-emerald-400", swatch: "bg-emerald-400" },
  { stroke: "stroke-sky-400", swatch: "bg-sky-400" },
  { stroke: "stroke-violet-300", swatch: "bg-violet-300" },
  { stroke: "stroke-amber-400", swatch: "bg-amber-400" },
  { stroke: "stroke-rose-400", swatch: "bg-rose-400" },
  { stroke: "stroke-slate-300", swatch: "bg-slate-300" },
  { stroke: "stroke-emerald-300", swatch: "bg-emerald-300" },
  { stroke: "stroke-sky-300", swatch: "bg-sky-300" },
] as const;

export type AllocationRingProps = {
  sectors: readonly { sector: string; weight_pct: string }[];
  cashWeightPct: string | null;
  cashBalance: string;
  totalAccountValue: string | null;
};

type Slice = {
  key: string;
  label: string;
  weight: number;
  length: number;
  offset: number;
  colorIndex: number;
};

function buildSlices(
  sectors: AllocationRingProps["sectors"],
  cashWeightPct: string | null,
): Slice[] {
  const raw: { key: string; label: string; weight: number }[] = [];
  const cashWeight = Number(cashWeightPct);
  if (Number.isFinite(cashWeight) && cashWeight > 0) {
    raw.push({ key: "cash", label: "Cash", weight: cashWeight });
  }

  sectors.forEach((sector, index) => {
    const weight = Number(sector.weight_pct);
    if (Number.isFinite(weight) && weight > 0) {
      raw.push({ key: `${sector.sector}-${index}`, label: sector.sector, weight });
    }
  });

  let drawn = 0;
  return raw.map((slice, index) => {
    const length = (slice.weight / 100) * CIRCUMFERENCE;
    const offset = drawn;
    drawn += length;
    return {
      ...slice,
      length,
      offset,
      colorIndex: index % PALETTE.length,
    };
  });
}

function centerLabel(totalAccountValue: string | null, hasSlices: boolean): string | null {
  if (totalAccountValue != null) {
    const amount = Number(totalAccountValue);
    if (Number.isFinite(amount)) {
      return formatCurrency(amount, false);
    }
  }
  return hasSlices ? "100%" : null;
}

export function AllocationRing({
  sectors,
  cashWeightPct,
  cashBalance,
  totalAccountValue,
}: AllocationRingProps) {
  const slices = buildSlices(sectors, cashWeightPct);
  const empty = slices.length === 0;
  const label = centerLabel(totalAccountValue, !empty);
  const ariaLabel = empty
    ? "Sector allocation ring. No allocation data."
    : `Sector allocation ring. ${slices
        .map((slice) => `${slice.label} ${formatPercent(slice.weight)}`)
        .join(", ")}.`;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-28 w-28 shrink-0">
        <svg
          aria-label={ariaLabel}
          className="h-28 w-28 -rotate-90"
          role="img"
          viewBox="0 0 100 100"
        >
          {empty ? (
            <circle
              className="stroke-slate-600"
              cx="50"
              cy="50"
              data-testid="allocation-ring-empty"
              fill="none"
              r={RADIUS}
              strokeWidth="10"
            />
          ) : (
            <>
              <circle
                className="stroke-slate-800"
                cx="50"
                cy="50"
                fill="none"
                r={RADIUS}
                strokeWidth="10"
              />
              {slices.map((slice) => (
                <circle
                  className={PALETTE[slice.colorIndex].stroke}
                  cx="50"
                  cy="50"
                  data-segment={slice.label}
                  fill="none"
                  key={slice.key}
                  r={RADIUS}
                  strokeDasharray={`${slice.length} ${CIRCUMFERENCE}`}
                  strokeDashoffset={-slice.offset}
                  strokeWidth="10"
                />
              ))}
            </>
          )}
        </svg>
        {label == null ? null : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className="max-w-[4.5rem] text-center font-mono text-[11px] font-semibold leading-tight text-slate-100"
              title={label === "100%" ? "Allocated weight" : "Total account value"}
            >
              {label}
            </span>
          </div>
        )}
      </div>
      {empty ? (
        <p className="text-sm text-slate-300">No allocation data</p>
      ) : (
        <ul aria-label="Allocation legend" className="w-full min-w-0 flex-1 space-y-1.5">
          {slices.map((slice) => (
            <li className="flex items-center gap-2" key={slice.key}>
              <span
                aria-hidden="true"
                className={["h-2.5 w-2.5 shrink-0 rounded-sm", PALETTE[slice.colorIndex].swatch].join(" ")}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-slate-100">
                {slice.label}
              </span>
              {slice.key === "cash" ? (
                <span className="font-mono text-[11px] tabular-nums text-slate-500">
                  {formatCurrency(Number(cashBalance), false)}
                </span>
              ) : null}
              <span className="font-mono text-xs tabular-nums text-slate-300">
                {formatPercent(slice.weight)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
