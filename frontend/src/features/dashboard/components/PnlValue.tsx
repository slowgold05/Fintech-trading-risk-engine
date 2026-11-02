import { formatCurrency } from "../../../utils/format";

type PnlValueProps = {
  value: number;
};

export function PnlValue({ value }: PnlValueProps) {
  const isPositive = value >= 0;
  const direction = isPositive ? "gain" : "loss";

  return (
    <span
      aria-label={`${direction}: ${formatCurrency(Math.abs(value))}`}
      className={[
        "inline-flex items-center justify-end gap-1 font-mono tabular-nums",
        isPositive ? "text-emerald-300" : "text-rose-300",
      ].join(" ")}
    >
      <span aria-hidden="true">{isPositive ? "▲" : "▼"}</span>
      {formatCurrency(Math.abs(value))}
    </span>
  );
}
