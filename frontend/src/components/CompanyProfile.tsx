import { useMemo, useState } from "react";
import { SeriesInstrument } from "../night/inner/SeriesInstrument";
import type { IndicatorOverlay } from "./historyData";
import type { LinePoint, PlottedBar, WhitespacePoint } from "./priceChartData";
import { formatCurrency, formatQuantity } from "../utils/format";

export function CompanyProfile({
  symbol,
  line,
  bars,
  sma20,
  sma50,
}: {
  symbol: string;
  line: readonly (LinePoint | WhitespacePoint)[];
  bars: ReadonlyMap<string, PlottedBar>;
  sma20?: IndicatorOverlay;
  sma50?: IndicatorOverlay;
}) {
  const [date, setDate] = useState("");
  const { samples, names } = useMemo(() => {
    const overlays = [
      { name: "SMA 20", data: sma20 },
      { name: "SMA 50", data: sma50 },
    ].filter((o) => o.data?.status === "partial");
    const byDate = overlays.map(
      (o) => new Map(o.data!.line.map((p) => [String(p.time), "value" in p ? p.value : null]))
    );
    return {
      names: [symbol + " close", ...overlays.map((o) => o.name)],
      samples: line.map((p) => ({
        label: p.time,
        values: ["value" in p ? p.value : null, ...byDate.map((m) => m.get(p.time) ?? null)],
      })),
    };
  }, [line, symbol, sma20, sma50]);
  const matched = samples.findIndex((s) => s.label === date);
  const index = matched < 0 ? samples.length - 1 : matched;
  const bar = bars.get(samples[index]?.label);
  return (
    <div className="company-profile">
      <SeriesInstrument
        samples={samples}
        names={names}
        label="Inspect daily price session"
        format={formatCurrency}
        selected={index}
        onSelect={(i) => setDate(samples[i].label)}
      />
      <dl className="profile-ohlc">
        {(["open", "high", "low", "close", "volume"] as const).map((k) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{bar ? (k === "volume" ? formatQuantity(bar[k]) : formatCurrency(bar[k])) : "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
