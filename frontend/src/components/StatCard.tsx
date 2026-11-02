import type { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning";
};

const toneClasses = {
  neutral: "border-slate-800/80 text-slate-100",
  positive: "border-emerald-400/35 text-emerald-300",
  negative: "border-rose-400/35 text-rose-300",
  warning: "border-amber-400/35 text-amber-300",
};

export function StatCard({
  label,
  value,
  detail,
  tone = "neutral",
}: StatCardProps) {
  return (
    <section
      className={[
        "metric-tile border-l-2",
        toneClasses[tone],
      ].join(" ")}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs leading-5 text-slate-500">{detail}</div>
      ) : null}
    </section>
  );
}
