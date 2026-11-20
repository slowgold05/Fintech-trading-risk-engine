import { useMemo, useState } from "react";
import { TRADE_ACTIVITY_LIMIT, type ActivityTrade } from "../../../api/trades";
import { formatCurrency } from "../../../utils/format";
import { Panel, SeriesInstrument, type InstrumentStatus } from "../../inner";

const names = ["Net bought"];
const shortUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function formatScale(value: number) {
  return shortUsd.format(value);
}

function byExecutionDate(trades: readonly ActivityTrade[]) {
  type Day = {
    date: string;
    boughtCents: number;
    soldCents: number;
    fills: number;
    seeds: number;
    priced: boolean;
  };
  const dates = new Map<string, Day>();
  for (const trade of trades) {
    // The legacy endpoint also returns zone-less UTC timestamps.
    const stamp = trade.executed_at;
    const utc = new Date(/(?:Z|[+-]\d\d:?\d\d)$/i.test(stamp) ? stamp : stamp + "Z");
    if (!Number.isFinite(utc.getTime())) continue;
    const date = utc.toISOString().slice(0, 10);
    const day = dates.get(date) ?? { date, boughtCents: 0, soldCents: 0, fills: 0, seeds: 0, priced: true };
    const value = trade.notional;
    day.fills++;
    if (trade.demo_seed) day.seeds++;
    if (!Number.isFinite(value) || value < 0) day.priced = false;
    else if (trade.side === "buy") day.boughtCents += Math.round(value * 100);
    else day.soldCents += Math.round(value * 100);
    dates.set(date, day);
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function ExecutionFlow({
  trades,
  status,
}: {
  trades: readonly ActivityTrade[];
  status?: InstrumentStatus;
}) {
  const [inspected, inspect] = useState("");
  const days = useMemo(() => byExecutionDate(trades), [trades]);
  const samples = useMemo(
    () =>
      days.map((day) => ({
        label: day.date,
        values: [day.priced ? (day.boughtCents - day.soldCents) / 100 : null],
      })),
    [days],
  );
  const matched = days.findIndex((day) => day.date === inspected);
  const index = matched >= 0 ? matched : days.reduce((last, day, i) => (day.priced ? i : last), -1);
  const day = days[index];
  return (
    <Panel
      className="execution-flow"
      title="Execution flow"
      subtitle="Buy value less sell value on each recorded trade date"
    >
      <SeriesInstrument
        samples={samples}
        names={names}
        reference={0}
        format={formatScale}
        selected={index}
        onSelect={(i) => inspect(days[i].date)}
        label="Inspect execution date"
        status={
          status ??
          (trades.length > 0 && !days.some((day) => day.priced)
            ? { kind: "unavailable", title: "No dated fills with recorded notionals." }
            : undefined)
        }
      />
      {day && !status && (
        <dl className="fill-readings">
          <div>
            <dt>Bought</dt>
            <dd>{day.priced ? formatCurrency(day.boughtCents / 100) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Sold</dt>
            <dd>{day.priced ? formatCurrency(day.soldCents / 100) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Fills on date</dt>
            <dd>{day.fills}</dd>
          </div>
        </dl>
      )}
      <footer>
        Up to {TRADE_ACTIVITY_LIMIT} recent fills · recorded USD notionals · UTC dates
        {day &&
          !status &&
          day.seeds > 0 &&
          ` · ${day.seeds} demo seed ${day.seeds === 1 ? "fill" : "fills"} on selected date`}
      </footer>
    </Panel>
  );
}
