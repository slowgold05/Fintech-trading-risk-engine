import { useId } from "react";
import type { MarketSectorResponse } from "../types/schemas";
import { formatSignedPercent } from "../utils/format";

type SectorPerformanceGridProps = {
  sectors: MarketSectorResponse[];
};

function changeCue(changePercent: number) {
  if (!Number.isFinite(changePercent) || changePercent === 0) {
    return "flat";
  }

  return changePercent > 0 ? "up" : "down";
}

function sectorTone(changePercent: number) {
  if (!Number.isFinite(changePercent) || changePercent === 0) {
    return "border-slate-700 bg-slate-800 text-slate-100";
  }

  const magnitude = Math.abs(changePercent);
  const rise = changePercent > 0;
  if (magnitude >= 1.5) {
    return rise
      ? "border-emerald-500/40 bg-emerald-700 text-white"
      : "border-rose-500/40 bg-rose-700 text-white";
  }

  if (magnitude >= 0.75) {
    return rise
      ? "border-emerald-600/30 bg-emerald-800 text-emerald-50"
      : "border-rose-600/30 bg-rose-800 text-rose-50";
  }

  if (magnitude >= 0.25) {
    return rise
      ? "border-emerald-800/40 bg-emerald-900 text-emerald-50"
      : "border-rose-800/40 bg-rose-900 text-rose-50";
  }

  return rise
    ? "border-emerald-900/50 bg-emerald-950 text-emerald-100"
    : "border-rose-900/50 bg-rose-950 text-rose-100";
}

function signedChange(changePercent: number) {
  return Number.isFinite(changePercent) ? formatSignedPercent(changePercent) : "n/a";
}

function tileLabel(sector: MarketSectorResponse) {
  const basis = sector.price_basis === "end_of_day_previous_close"
    ? ", end-of-day previous close, not real-time"
    : "";
  return `${sector.sector}, ${sector.symbol}, ${changeCue(sector.change_percent)} ${signedChange(sector.change_percent)}${basis}`;
}

export function SectorPerformanceGrid({ sectors }: SectorPerformanceGridProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2 className="text-sm font-semibold text-slate-100" id={headingId}>
        Sector ETF performance
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        ETF proxy moves, not sector or index returns.
      </p>
      {sectors.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No sector ETF proxies.</p>
      ) : (
        <ul className="mt-2 grid min-w-0 list-none grid-cols-[repeat(auto-fit,minmax(min(100%,max(4.75rem,22%)),1fr))] gap-1 p-0">
          {sectors.map((sector) => (
            <li
              aria-label={tileLabel(sector)}
              className={[
                "flex min-h-12 min-w-0 flex-col items-center justify-center rounded-md border px-0.5 py-1 text-center",
                sectorTone(sector.change_percent),
              ].join(" ")}
              key={sector.symbol}
              title={sector.symbol}
            >
              <span className="w-full text-[11px] font-medium leading-tight tracking-tight">
                {sector.sector}
              </span>
              <span className="mt-0.5 font-mono text-[11px] font-semibold leading-none">
                {signedChange(sector.change_percent)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
