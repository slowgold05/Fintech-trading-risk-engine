import { useId, useState } from "react";
import { useRankMotion } from "./useRankMotion";
import type { MarketSectorResponse } from "../../types/schemas";
import { formatSignedPercent } from "../../utils/format";
import { useCompactWall, pinSector, usePinnedSector, focusHandlers, sectorKey, useDraw, type Vars } from "../../ui/lib";
import { EmptyNote } from "../../ui/primitives";

type SectorPerformanceGridProps = {
  sectors: MarketSectorResponse[];
};

function changeCue(changePercent: number) {
  if (!Number.isFinite(changePercent) || changePercent === 0) {
    return "flat";
  }

  return changePercent > 0 ? "up" : "down";
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

/**
 * Sector ETF proxies as diverging bars from one axis: gains are solid and run right,
 * losses are hatched and run left. The longest bar sets the scale.
 */
export function SectorPerformanceGrid({ sectors }: SectorPerformanceGridProps) {
  const compact=useCompactWall();
  const [all,setAll]=useState(false);
  const pinned=usePinnedSector();
  const shown=compact && !all ? sectors.filter((row,i) => i<4 || sectorKey(row.sector)===pinned) : sectors;
  const headingId = useId();
  const scale = Math.max(
    0.5,
    ...sectors.map((sector) => (Number.isFinite(sector.change_percent) ? Math.abs(sector.change_percent) : 0)),
  );
  const draw = useDraw<HTMLUListElement>(sectors.length > 0);

  useRankMotion(draw, sectors.map(row => row.symbol).join("|"));

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <header className="panel-head">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="panel-title" id={headingId}>
              Sector ETF performance
            </h2>
          </div>
          <p className="panel-sub">ETF proxy moves, not sector or index returns.</p>
        </div>
        {sectors.length > 0 ? <span className="pill">Axis to {signedChange(scale).replace("+", "±")}</span> : null}
      </header>
      {sectors.length === 0 ? (
        <div className="panel-body">
          <EmptyNote message="No sector ETF proxies." />
        </div>
      ) : (
        <ul className="list-none py-1.5" ref={draw} {...focusHandlers}>
          {shown.map((sector, order) => {
            const cue = changeCue(sector.change_percent);
            const key = sectorKey(sector.sector);
            return (
              <li
                aria-label={tileLabel(sector)}
                className="sec-row x-sec"
                data-rank={sector.symbol}
                data-dir={cue}
                data-sector={key}
                key={sector.symbol}
                onClick={compact ? () => pinSector(sector.sector) : undefined}
                title={sector.symbol}
              >
                <span className="text-[12px] font-medium leading-4 text-fg">{compact ? <button type="button" aria-pressed={key===pinned}>{sector.sector}</button> : sector.sector}</span>
                <span className="num text-[10px] text-fg-3">{sector.symbol}</span>
                <span aria-hidden="true" className="sec-track">
                  {cue === "flat" ? null : (
                    <span
                      className="sec-bar x-seclit"
                      data-dir={cue}
                      data-sector={key}
                      style={{ "--f": Math.min(1, Math.abs(sector.change_percent) / scale), "--k": order } as Vars}
                    />
                  )}
                </span>
                <span className="num flex items-baseline justify-end gap-1 text-[12px] font-semibold text-fg">
                  {signedChange(sector.change_percent)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {compact && sectors.length > 4 && <button className="more-rows" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show less" : `All ${sectors.length} sectors`}</button>}
    </section>
  );
}
