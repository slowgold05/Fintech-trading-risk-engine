import { inspectEvents } from "./market/inspectEvents";
import { Figure } from "../design/primitives";
import { useId, type CSSProperties } from "react";
import type { MarketSectorResponse } from "../types/schemas";
import { formatSignedPercent } from "../utils/format";

type SectorPerformanceGridProps = {
  sectors: MarketSectorResponse[];
  selected?: string;
  onInspect?: (sector: string | null) => void;
  onSelect?: (symbol: string) => void;
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
  const basis =
    sector.price_basis === "end_of_day_previous_close" ? ", end-of-day previous close, not real-time" : "";
  return `${sector.sector}, ${sector.symbol}, ${changeCue(sector.change_percent)} ${signedChange(sector.change_percent)}${basis}`;
}

export function SectorPerformanceGrid({
  sectors,
  selected,
  onInspect,
  onSelect,
}: SectorPerformanceGridProps) {
  const headingId = useId();

  const max = Math.max(
    ...sectors.map((s) => (Number.isFinite(s.change_percent) ? Math.abs(s.change_percent) : 0)),
    0,
  );
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Sector ETF performance</h2>
      <p className="section-note">ETF proxy moves, not sector or index returns.</p>
      {sectors.length === 0 ? (
        <p className="desk-empty">No sector ETF proxies.</p>
      ) : (
        <ul className="sector-ledger">
          {[...sectors]
            .sort((a, b) => b.change_percent - a.change_percent)
            .map((s, index) => (
              <li
                style={{ "--row": index } as CSSProperties}
                key={s.symbol}
                aria-label={tileLabel(s)}
                data-active={selected === s.sector}
                {...inspectEvents(
                  () => onInspect?.(s.sector),
                  () => onInspect?.(null),
                )}
                title={s.symbol}
                className={changeCue(s.change_percent)}
              >
                <b>
                  {onSelect ? (
                    <button
                      type="button"
                      aria-label={`Inspect ${s.sector} fund`}
                      onClick={() => onSelect(s.symbol)}
                    >
                      {s.symbol}
                    </button>
                  ) : (
                    s.symbol
                  )}
                </b>
                <span>{s.sector}</span>
                <i aria-hidden="true">
                  <em
                    style={{
                      transform: `scaleX(${max && Number.isFinite(s.change_percent) ? Math.abs(s.change_percent) / max : 0})`,
                    }}
                  />
                </i>
                <strong>
                  <Figure value={signedChange(s.change_percent)} />
                </strong>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
