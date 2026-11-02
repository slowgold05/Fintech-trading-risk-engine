import type { MarketDataStatus } from "../types/schemas";

type FreshnessBadgeProps = {
  status?: MarketDataStatus | null;
  ageSeconds?: number | null;
  source?: string | null;
  asOf?: string | null;
  compact?: boolean;
};

const statusTone: Record<MarketDataStatus, string> = {
  "live-ish": "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  delayed: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  cached: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  stale: "border-rose-400/35 bg-rose-400/10 text-rose-300",
};

function formatAge(ageSeconds?: number | null) {
  if (ageSeconds === null || ageSeconds === undefined) {
    return null;
  }

  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }

  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}

function formatSource(source?: string | null) {
  if (!source) {
    return "reference";
  }

  return source.replace(/_/g, " ");
}

export function FreshnessBadge({
  status,
  ageSeconds,
  source,
  asOf,
  compact = false,
}: FreshnessBadgeProps) {
  if (!status) {
    return (
      <span className="risk-chip border-slate-700 bg-slate-900 text-slate-400">
        Reference
      </span>
    );
  }

  const age = formatAge(ageSeconds);
  const label = compact ? status : [status, age].filter(Boolean).join(" / ");
  const title = [
    `Status: ${status}`,
    age ? `Age: ${age}` : null,
    `Source: ${formatSource(source)}`,
    asOf ? `As of: ${asOf}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span className={["risk-chip", statusTone[status]].join(" ")} title={title}>
      {label}
    </span>
  );
}
