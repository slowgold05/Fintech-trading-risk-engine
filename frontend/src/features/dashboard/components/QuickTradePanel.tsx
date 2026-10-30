import { type FormEvent, useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { DashboardCard } from "./DashboardCard";
import type { QuickTradeFormValues } from "../types";
import { formatCurrency } from "../../../utils/format";

type QuickTradePanelProps = {
  buyingPower: number;
  isSubmitting: boolean;
  onSubmit: (values: QuickTradeFormValues) => void;
};

export function QuickTradePanel({
  buyingPower,
  isSubmitting,
  onSubmit,
}: QuickTradePanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState(25);
  const [estimatedPrice, setEstimatedPrice] = useState<number | undefined>();
  const estimatedNotional =
    quantity > 0 && estimatedPrice && estimatedPrice > 0
      ? quantity * estimatedPrice
      : undefined;
  const isKnownInsufficient =
    side === "buy" &&
    estimatedNotional !== undefined &&
    estimatedNotional > buyingPower;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isKnownInsufficient) {
      return;
    }

    const fd = new FormData(event.currentTarget);
    onSubmit({
      symbol:    String(fd.get("symbol") ?? "").trim().toUpperCase(),
      assetType: fd.get("assetType") as "stock" | "crypto",
      side,
      quantity:  Number(fd.get("quantity")),
      price:     Number(fd.get("price")) || undefined,
    });
  }

  return (
    <DashboardCard title="Quick Trade">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {/* BUY / SELL toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSide("buy")}
            aria-pressed={side === "buy"}
            aria-label="Buy"
            className={[
              "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold tracking-wide transition duration-200",
              side === "buy"
                ? "bg-emerald-400 text-slate-950 shadow-[0_0_20px_-4px_rgb(52_211_153_/_0.55)]"
                : "border border-slate-700/80 bg-slate-900/60 text-slate-500 hover:border-emerald-400/50 hover:text-emerald-400",
            ].join(" ")}
          >
            <ArrowUp className="size-4 shrink-0" weight="bold" />
            BUY
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            aria-pressed={side === "sell"}
            aria-label="Sell"
            className={[
              "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold tracking-wide transition duration-200",
              side === "sell"
                ? "bg-rose-500 text-white shadow-[0_0_20px_-4px_rgb(244_63_94_/_0.5)]"
                : "border border-slate-700/80 bg-slate-900/60 text-slate-500 hover:border-rose-400/50 hover:text-rose-400",
            ].join(" ")}
          >
            <ArrowDown className="size-4 shrink-0" weight="bold" />
            SELL
          </button>
        </div>

        {/* Symbol + Asset */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Symbol</span>
            <input
              aria-label="Quick trade symbol"
              className="field-control font-mono uppercase"
              defaultValue="AAPL"
              name="symbol"
              required
              type="text"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Asset</span>
            <select
              aria-label="Quick trade asset type"
              className="field-control"
              defaultValue="stock"
              name="assetType"
            >
              <option value="stock">Stock</option>
              <option value="crypto">Crypto</option>
            </select>
          </label>
        </div>

        {/* Quantity + estimated price */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Quantity</span>
            <input
              aria-label="Quick trade quantity"
              className="field-control text-right font-mono"
              defaultValue="25"
              min="0"
              name="quantity"
              onChange={(event) => setQuantity(Number(event.target.value))}
              required
              step="1"
              type="number"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Est. price</span>
            <input
              aria-label="Quick trade estimated price"
              className="field-control text-right font-mono"
              min="0"
              onChange={(event) => {
                const value = Number(event.target.value);
                setEstimatedPrice(value > 0 ? value : undefined);
              }}
              name="price"
              placeholder="Market"
              step="0.01"
              type="number"
            />
          </label>
        </div>

        {/* Execution info */}
        <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Buying power</span>
            <span className="font-mono text-slate-200">
              {formatCurrency(buyingPower, false)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-slate-500">Est. notional</span>
            <span
              className={[
                "font-mono",
                isKnownInsufficient ? "text-rose-300" : "text-slate-300",
              ].join(" ")}
            >
              {estimatedNotional
                ? formatCurrency(estimatedNotional, false)
                : "At execution"}
            </span>
          </div>
          {isKnownInsufficient && (
            <p className="mt-2 text-xs text-rose-300">
              Estimated buy exceeds available buying power.
            </p>
          )}
        </div>

        <button
          aria-label="Submit quick trade"
          className={[
            "primary-action",
            side === "buy"
              ? ""
              : "!bg-rose-500 hover:!bg-rose-400 !text-white focus:!ring-rose-400/60",
          ].join(" ")}
          disabled={isSubmitting || isKnownInsufficient}
          type="submit"
        >
          {isSubmitting
            ? "Submitting…"
            : side === "buy" ? "Submit Buy Order" : "Submit Sell Order"}
        </button>
      </form>
    </DashboardCard>
  );
}
