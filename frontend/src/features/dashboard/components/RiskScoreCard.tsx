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
          <svg
            aria-label={`Risk score ${score} of 100, ${label}`}
            className="h-28 w-28 -rotate-90"
            role="img"
            viewBox="0 0 100 100"
          >
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
            Latest scored trade. Score scale: 0–100.
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded bg-slate-900">
            <div
              className="h-full rounded bg-current"
              style={{ color: tone.stroke, width: `${score}%` }}
            />
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
