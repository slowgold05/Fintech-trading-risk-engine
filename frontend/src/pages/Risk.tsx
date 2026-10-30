import { useQuery } from "@tanstack/react-query";
import { fetchRisk } from "../api/risk";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  RiskScoreCard,
  SkeletonBlock,
} from "../features/dashboard/components";
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
} from "../utils/format";
import { getRiskLevel, getRiskTone } from "../utils/riskTone";
import type { RiskAlertResponse, RiskAssessmentResponse } from "../types/schemas";

function getRiskScore(assessments: RiskAssessmentResponse[]) {
  return assessments[0]?.risk_score ?? 0;
}

function getInterpretation(level: ReturnType<typeof getRiskLevel>, score: number) {
  if (level === "High") {
    return `Risk score ${score} indicates elevated exposure. Reduce order size, review concentration, and resolve active alerts before adding risk.`;
  }

  if (level === "Medium") {
    return `Risk score ${score} is in watch range. Continue trading with size discipline and monitor alerts before increasing exposure.`;
  }

  return `Risk score ${score} is within normal operating range. Maintain current controls and monitor new trade assessments.`;
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

function getExposureBreakdown(assessments: RiskAssessmentResponse[]) {
  const exposure = assessments.reduce<Record<string, number>>((acc, assessment) => {
    const trade = assessment.trade;
    if (!trade) {
      return acc;
    }

    const assetType = trade.asset_type.toUpperCase();
    const notional = trade.quantity * trade.price_at_execution;
    acc[assetType] = (acc[assetType] ?? 0) + notional;
    return acc;
  }, {});

  return Object.entries(exposure)
    .map(([assetType, value]) => ({ assetType, value }))
    .sort((a, b) => b.value - a.value);
}

export function Risk() {
  const riskQuery = useQuery({
    queryKey: ["risk"],
    queryFn: fetchRisk,
  });

  const assessments = riskQuery.data?.assessments ?? [];
  const score = getRiskScore(assessments);
  const level = getRiskLevel(score);
  const tone = getRiskTone(level);
  const alerts = getAllAlerts(assessments);
  const riskFactors = getRiskFactors(alerts);
  const exposure = getExposureBreakdown(assessments);
  const totalExposure = exposure.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        badge="Risk"
        title="Risk Engine"
        description="Current score, active alert factors, and exposure signals from the risk assessment engine."
      />

      {riskQuery.isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
          Risk data could not be loaded. Check the API server and
          authentication state.
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="space-y-5">
          {riskQuery.isLoading ? (
            <DashboardCard title="Current Risk Score">
              <div className="space-y-4">
                <SkeletonBlock className="h-28" />
                <SkeletonBlock className="h-20" />
              </div>
            </DashboardCard>
          ) : assessments.length === 0 ? (
            <DashboardCard title="Current Risk Score">
              <EmptyState
                detail="Risk assessments will appear after trades are submitted and scored."
                message="No risk activity yet."
              />
            </DashboardCard>
          ) : (
            <RiskScoreCard label={level} score={score} />
          )}

          {!riskQuery.isLoading && assessments.length > 0 ? (
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
                    Risk interpretation
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

          {(level === "Medium" || level === "High") && assessments.length > 0 ? (
            <DashboardCard title={level === "High" ? "Active Warning" : "Watch Panel"}>
              <div
                className={[
                  "rounded border px-4 py-3 text-sm",
                  level === "High"
                    ? "border-rose-400/35 bg-rose-950/45 text-rose-100"
                    : "border-amber-400/30 bg-amber-950/25 text-amber-100",
                ].join(" ")}
              >
                {level === "High"
                  ? "High risk is active. Review open alerts and avoid adding exposure until the score drops below the high threshold."
                  : "Medium risk is active. Keep order sizes controlled and monitor concentration before increasing positions."}
              </div>
            </DashboardCard>
          ) : null}

          <DashboardCard
            action={
              <span className="font-mono text-xs text-slate-500">
                {riskQuery.isLoading ? "--" : `${alerts.length} alerts`}
              </span>
            }
            title="Risk Factors"
          >
            {riskQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-10" key={item} />
                ))}
              </div>
            ) : riskFactors.length === 0 ? (
              <EmptyState
                detail="Rule triggers and alert counts will be listed here when the risk engine raises them."
                message="No active risk factors."
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

        <div className="space-y-5">
          <DashboardCard title="Exposure Breakdown">
            {riskQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-12" key={item} />
                ))}
              </div>
            ) : exposure.length === 0 ? (
              <EmptyState
                detail="Exposure by asset type will appear after assessed trades are available."
                message="No exposure signals yet."
              />
            ) : (
              <div className="space-y-3">
                {exposure.map((item) => {
                  const share = totalExposure > 0 ? (item.value / totalExposure) * 100 : 0;
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
                          className={["h-full rounded", tone.bar].join(" ")}
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
                {riskQuery.isLoading ? "--" : `${assessments.length} rows`}
              </span>
            }
            title="Assessment Feed"
          >
            {riskQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((item) => (
                  <SkeletonBlock className="h-12" key={item} />
                ))}
              </div>
            ) : assessments.length === 0 ? (
              <EmptyState
                detail="Every submitted trade will add an assessment row with score, symbol, notional, and alert count."
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
                      const notional = trade
                        ? trade.quantity * trade.price_at_execution
                        : 0;
                      const rowLevel = getRiskLevel(assessment.risk_score);
                      const rowTone = getRiskTone(rowLevel);

                      return (
                        <tr
                          className={[
                            "border-l-2",
                            rowLevel === "High"
                              ? "border-l-rose-400/70"
                              : rowLevel === "Medium"
                                ? "border-l-amber-400/70"
                                : "border-l-emerald-400/70",
                          ].join(" ")}
                          key={assessment.assessment_id}
                        >
                          <td>
                            <div className="font-mono text-sm font-semibold text-slate-100">
                              {trade?.symbol ?? "--"}
                            </div>
                            <div className="font-mono text-[11px] uppercase text-slate-500">
                              {trade?.side ?? "unknown"}
                            </div>
                          </td>
                          <td className="text-right">
                            <span className={["risk-chip", rowTone.chip].join(" ")}>
                              {assessment.risk_score}
                            </span>
                          </td>
                          <td className="text-right font-mono tabular-nums">
                            {formatCurrency(notional, false)}
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
