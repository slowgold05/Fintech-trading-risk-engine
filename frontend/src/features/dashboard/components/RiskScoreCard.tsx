import { DashboardCard } from "./DashboardCard";
import { getRiskTone } from "../../../utils/riskTone";

type RiskScoreCardProps = {
  score: number;
  label: string;
};

export function RiskScoreCard({ score, label }: RiskScoreCardProps) {
  const circumference = 2 * Math.PI * 42;
  const progress = circumference * (score / 100);
  const tone = getRiskTone(score);
  const remaining = Math.max(100 - score, 0);

  return (
    <DashboardCard
      action={
        <span className={["risk-chip", tone.chip].join(" ")}>
          {label}
        </span>
      }
      title="Risk Score"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative h-28 w-28 shrink-0">
          <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              fill="none"
              r="42"
              stroke="#1e293b"
              strokeWidth="10"
            />
            <circle
              cx="50"
              cy="50"
              fill="none"
              r="42"
              stroke={tone.stroke}
              strokeDasharray={`${progress} ${circumference}`}
              strokeLinecap="round"
              strokeWidth="10"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-mono text-3xl font-semibold text-slate-100">
              {score}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-6 text-slate-400">
            Latest score from the backend risk engine. Review alerts before
            increasing position size.
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded bg-slate-900">
            <div
              className="h-full rounded bg-current"
              style={{ color: tone.stroke, width: `${score}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Status
              </div>
              <div className="mt-1 font-mono text-slate-100">{label}</div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Limit
              </div>
              <div className="mt-1 font-mono text-slate-100">100</div>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Buffer
              </div>
              <div className="mt-1 font-mono text-slate-100">{remaining}</div>
            </div>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
