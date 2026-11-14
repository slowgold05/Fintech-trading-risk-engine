import { useQuery } from "@tanstack/react-query";
import { fetchRisk } from "../api/risk";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  RiskScoreCard,
  SkeletonBlock,
} from "../features/dashboard/components";
import { getRiskScore } from "../features/dashboard/adapters";
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
} from "../utils/format";
import { getRiskLevel, getRiskTone } from "../utils/riskTone";
import type { RiskAlertResponse, RiskAssessmentResponse } from "../types/schemas";

const pageDescription =
  "Latest trade assessment, historical rule factors, and assessed trade notionals.";

function finiteScore(score: unknown): number | null {
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function tradeNotional(trade: RiskAssessmentResponse["trade"]): number | null {
  if (!trade) {
    return null;
  }

  const notional = trade.quantity * trade.price_at_execution;
  return Number.isFinite(notional) ? notional : null;
}

function getInterpretation(level: ReturnType<typeof getRiskLevel>, score: number) {
  return `Latest trade assessment score ${score} is ${level}. It describes the newest scored trade.`;
}

function getAllAlerts(assessments: RiskAssessmentResponse[]) {
  return assessments.flatMap((assessment) =>
    assessment.alerts.map((alert) => ({
      ...alert,
      assessmentId: assessment.assessment_id,
      symbol: assessment.trade?.symbol ?? "--",
    })),
  );
}

function getRiskFactors(alerts: Array<RiskAlertResponse & { symbol: string }>) {
  const counts = alerts.reduce<Record<string, number>>((acc, alert) => {
    acc[alert.rule_code] = (acc[alert.rule_code] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .map(([ruleCode, count]) => ({ ruleCode, count }))
    .sort((a, b) => b.count - a.count);
}

function getAssessedNotional(assessments: RiskAssessmentResponse[]) {
  const notionals = assessments.reduce<Record<string, number>>((acc, assessment) => {
    const trade = assessment.trade;
    const notional = tradeNotional(trade);
    if (!trade || notional == null) {
      return acc;
    }

    const assetType = trade.asset_type.toUpperCase();
    acc[assetType] = (acc[assetType] ?? 0) + notional;
    return acc;
  }, {});

  return Object.entries(notionals)
    .map(([assetType, value]) => ({ assetType, value }))
    .sort((a, b) => b.value - a.value);
}

export function Risk() {
  const riskQuery = useQuery({
    queryKey: ["risk"],
    queryFn: fetchRisk,
  });

  if (riskQuery.isError) {
    return (
      <div className="min-w-0 space-y-6">
        <PageHeader
          title="Risk Engine"
          description={pageDescription}
        />
        <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
          <p>
            Risk assessments could not be loaded. Check the API server and
            authentication state. A previously loaded result is not shown.
          </p>
          <button
            className="mt-3 rounded-md border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-100"
            onClick={() => {
              void riskQuery.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isLoading = riskQuery.isLoading;
  const assessments = riskQuery.data?.assessments ?? [];
  const score = isLoading ? null : getRiskScore(riskQuery.data);
  const level = score == null ? null : getRiskLevel(score);
  const tone = level == null ? null : getRiskTone(level);
  const alerts = getAllAlerts(assessments);
  const riskFactors = getRiskFactors(alerts);
  const notionals = getAssessedNotional(assessments);
  const totalNotional = notionals.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Risk Engine"
        description={pageDescription}
      />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-5">
          {isLoading ? (
            <DashboardCard title="Latest Trade Risk Score">
              <div className="space-y-4">
                <SkeletonBlock className="h-28" />
                <SkeletonBlock className="h-20" />
              </div>
            </DashboardCard>
          ) : assessments.length === 0 ? (
            <DashboardCard title="Latest Trade Risk Score">
              <EmptyState
                detail="Scores appear after a trade is assessed. This is not a current portfolio risk score."
                message="No trade assessments yet."
              />
            </DashboardCard>
          ) : score != null && level != null ? (
            <RiskScoreCard label={level} score={score} />
          ) : (
            <DashboardCard title="Latest Trade Risk Score">
              <p className="text-sm text-slate-300">Latest trade score unavailable.</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                The newest assessment has no usable score. Older assessed trades stay listed. This is not current account risk.
              </p>
            </DashboardCard>
          )}

          {tone != null && level != null && score != null ? (
            <div
              className={[
                "rounded-md border px-4 py-4",
                tone.border,
                tone.bg,
              ].join(" ")}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Latest trade assessment
                  </div>
                  <p className={["mt-2 max-w-3xl text-sm leading-6", tone.text].join(" ")}>
                    {getInterpretation(level, score)}
                  </p>
                </div>
                <span className={["risk-chip shrink-0", tone.chip].join(" ")}>
                  {level}
                </span>
              </div>
            </div>
          ) : null}

          {level === "Medium" || level === "High" ? (
            <DashboardCard title={level === "High" ? "High assessment" : "Medium assessment"}>
              <div
                className={[
                  "rounded border px-4 py-3 text-sm",
                  level === "High"
                    ? "border-rose-400/35 bg-rose-950/45 text-rose-100"
                    : "border-amber-400/30 bg-amber-950/25 text-amber-100",
                ].join(" ")}
              >
                {level === "High"
                  ? "Latest trade assessment is High. Listed alerts are historical rule factors from assessed trades."
                  : "Latest trade assessment is Medium. Listed alerts are historical rule factors from assessed trades."}
              </div>
            </DashboardCard>
          ) : null}

          <DashboardCard
            action={
              <span className="font-mono text-xs text-slate-500">
                {isLoading ? "--" : `${alerts.length} assessment alerts`}
              </span>
            }
            title="Rule factors"
          >
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-10" key={item} />
                ))}
              </div>
            ) : riskFactors.length === 0 ? (
              <EmptyState
                detail="Rule factors appear when an assessed trade records an alert."
                message="No assessment alerts."
              />
            ) : (
              <div className="table-shell">
                <table className="data-table min-w-[520px]">
                  <thead>
                    <tr>
                      <th className="text-left">Rule</th>
                      <th className="text-right">Count</th>
                      <th className="text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskFactors.map((factor) => {
                      const share = alerts.length
                        ? (factor.count / alerts.length) * 100
                        : 0;
                      return (
                        <tr key={factor.ruleCode}>
                          <td className="font-mono text-slate-100">
                            {factor.ruleCode}
                          </td>
                          <td className="text-right font-mono tabular-nums">
                            {factor.count}
                          </td>
                          <td className="text-right font-mono tabular-nums">
                            {formatPercent(share)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardCard>
        </div>

        <div className="min-w-0 space-y-5">
          <DashboardCard title="Assessed Trade Notional">
            <p className="mb-3 text-xs leading-5 text-slate-400">
              Historical assessed trade value. Includes buys and sells, not current holdings.
            </p>
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-12" key={item} />
                ))}
              </div>
            ) : notionals.length === 0 ? (
              <EmptyState
                detail="Sums appear when assessed trades include quantity and price."
                message="No assessed trade notionals."
              />
            ) : (
              <div className="space-y-3">
                {notionals.map((item) => {
                  const share = totalNotional > 0 ? (item.value / totalNotional) * 100 : 0;
                  return (
                    <div
                      className="rounded border border-slate-800 bg-slate-900/60 p-3"
                      key={item.assetType}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm font-semibold text-slate-100">
                            {item.assetType}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            Assessed notional
                          </div>
                        </div>
                        <div className="text-right font-mono text-sm text-slate-200">
                          {formatCurrency(item.value, false)}
                          <div className="text-[11px] text-slate-500">
                            {formatPercent(share)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div
                          className={["h-full rounded", tone?.bar ?? "bg-slate-400/75"].join(" ")}
                          style={{ width: `${Math.min(share, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DashboardCard>

          <DashboardCard
            action={
              <span className="font-mono text-xs text-slate-500">
                {isLoading ? "--" : `${assessments.length} rows`}
              </span>
            }
            title="Assessment Feed"
          >
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((item) => (
                  <SkeletonBlock className="h-12" key={item} />
                ))}
              </div>
            ) : assessments.length === 0 ? (
              <EmptyState
                detail="Each scored trade adds a row with score, symbol, notional, and assessment alerts."
                message="No assessments yet."
              />
            ) : (
              <div className="table-shell max-h-[520px]">
                <table className="data-table min-w-[640px]">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="text-left">Trade</th>
                      <th className="text-right">Score</th>
                      <th className="text-right">Notional</th>
                      <th className="text-right">Alerts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assessments.map((assessment) => {
                      const trade = assessment.trade;
                      const notional = tradeNotional(trade);
                      const rowScore = finiteScore(assessment.risk_score);
                      const rowLevel = rowScore == null ? null : getRiskLevel(rowScore);
                      const rowTone = rowLevel == null ? null : getRiskTone(rowLevel);

                      return (
                        <tr key={assessment.assessment_id}>
                          <td>
                            <div className="font-mono text-sm font-semibold text-slate-100">
                              {trade?.symbol ?? "--"}
                            </div>
                            <div className="font-mono text-[11px] uppercase text-slate-500">
                              {trade?.side ?? "unknown"}
                            </div>
                          </td>
                          <td className="text-right">
                            {rowScore == null || rowTone == null ? (
                              <span className="text-slate-400">Unavailable</span>
                            ) : (
                              <span className={["risk-chip", rowTone.chip].join(" ")}>
                                {rowScore}
                              </span>
                            )}
                          </td>
                          <td className="text-right font-mono tabular-nums">
                            {notional == null ? "Unavailable" : formatCurrency(notional, false)}
                          </td>
                          <td className="text-right font-mono tabular-nums">
                            {formatQuantity(assessment.alerts.length)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
