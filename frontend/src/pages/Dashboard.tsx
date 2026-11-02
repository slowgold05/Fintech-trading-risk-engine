import { useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchPortfolio, fetchPortfolioPnl } from "../api/portfolio";
import { fetchRisk } from "../api/risk";
import { createTrade, fetchTrades } from "../api/trades";
import {
  DashboardCard,
  EmptyState,
  PnlValue,
  PortfolioChart,
  PositionsTable,
  QuickTradePanel,
  RecentTradesTable,
  RiskScoreCard,
  SkeletonBlock,
} from "../features/dashboard/components";
import {
  getDayPnl,
  getDayPnlPercent,
  getBuyingPower,
  getCashBalance,
  getPortfolioChartPoints,
  getPortfolioValue,
  getRiskLabel,
  getRiskScore,
  mapPortfolioPositions,
  mapRecentTrades,
} from "../features/dashboard/adapters";
import type { QuickTradeFormValues } from "../features/dashboard/types";
import { useToast } from "../context/useToast";
import {
  formatCurrency,
  formatSignedPercent,
} from "../utils/format";
import { getRiskTone } from "../utils/riskTone";

export function Dashboard() {
  const pendingTrade = useRef<{ payload: string; key: string } | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });

  const portfolioPnlQuery = useQuery({
    queryKey: ["portfolio", "pnl"],
    queryFn: fetchPortfolioPnl,
    retry: false,
  });

  const tradesQuery = useQuery({
    queryKey: ["trades"],
    queryFn: fetchTrades,
  });

  const riskQuery = useQuery({
    queryKey: ["risk"],
    queryFn: fetchRisk,
  });

  const tradeMutation = useMutation({
    mutationFn: createTrade,
    onSuccess: async (result) => {
      pendingTrade.current = null;
      showToast(
        "success",
        `Trade submitted. New risk score: ${result.risk_score}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio", "pnl"] }),
        queryClient.invalidateQueries({ queryKey: ["risk"] }),
      ]);
    },
    onError: (error) => {
      const detail =
        isAxiosError(error) && typeof error.response?.data?.detail === "string"
          ? error.response.data.detail
          : "Trade submission failed.";
      showToast("error", detail);
    },
  });

  const portfolio = portfolioQuery.data;
  const portfolioPnl = portfolioPnlQuery.data;
  const trades = tradesQuery.data;
  const risk = riskQuery.data;
  const portfolioValue = getPortfolioValue(portfolio);
  const cashBalance = getCashBalance(portfolio);
  const buyingPower = getBuyingPower(portfolio);
  const dayPnl = portfolioPnl?.daily_pnl ?? getDayPnl(portfolio);
  const dayPnlPercent =
    portfolioPnl?.daily_pnl_pct ?? getDayPnlPercent(portfolio);
  const baseChartPoints = useMemo(
    () => getPortfolioChartPoints(portfolio, portfolioPnl),
    [portfolio, portfolioPnl],
  );
  const chartPoints = useMemo(
    () => baseChartPoints,
    [baseChartPoints],
  );
  const recentTrades = mapRecentTrades(trades);
  const positions = mapPortfolioPositions(portfolio);
  const riskScore = getRiskScore(risk);
  const riskLabel = getRiskLabel(riskScore);
  const isPortfolioLoading = portfolioQuery.isLoading;
  const isTradesLoading = tradesQuery.isLoading;
  const isRiskLoading = riskQuery.isLoading;
  const hasDashboardError =
    portfolioQuery.isError || tradesQuery.isError || riskQuery.isError;
  const riskTone = getRiskTone(riskScore);

  function handleQuickTradeSubmit(values: QuickTradeFormValues) {
    if (!values.symbol || values.quantity <= 0) {
      showToast("error", "Enter a symbol and quantity greater than zero.");
      return;
    }

    const payload = {
      symbol: values.symbol,
      asset_type: values.assetType,
      side: values.side,
      quantity: values.quantity,
    };
    const fingerprint = JSON.stringify(payload);
    if (pendingTrade.current?.payload !== fingerprint) {
      pendingTrade.current = { payload: fingerprint, key: crypto.randomUUID() };
    }
    tradeMutation.mutate({ ...payload, idempotencyKey: pendingTrade.current.key });
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="border-b border-slate-800/60 pb-6">
        <span className="inline-flex items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
          Dashboard
        </span>
        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
              Trading &amp; Risk Overview
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">
              Portfolio value, recent executions, open positions, and order entry in one view.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasDashboardError ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-950/40 px-2.5 py-1 text-xs font-medium text-rose-300">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                Degraded
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
            )}
          </div>
        </div>
      </div>

      {hasDashboardError && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Some dashboard data could not be loaded. Check the API server and authentication state.
        </p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={["metric-tile border-l-2", riskTone.metric].join(" ")}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Risk level
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-base font-semibold">
              {isRiskLoading ? <span className="text-slate-500">—</span> : riskLabel}
            </span>
            <span className="font-mono text-xs text-slate-500">
              {isRiskLoading ? "--" : riskScore}
            </span>
          </div>
        </div>

        <div className="metric-tile">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Day P&amp;L
          </div>
          <div className="mt-2 text-base font-semibold">
            {isPortfolioLoading
              ? <span className="font-mono text-slate-500">—</span>
              : <PnlValue value={dayPnl} />}
          </div>
        </div>

        <div className="metric-tile">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Day change
          </div>
          <div className={["mt-2 font-mono text-base font-semibold", dayPnlPercent >= 0 ? "text-emerald-300" : "text-rose-300"].join(" ")}>
            {isPortfolioLoading
              ? <span className="text-slate-500">—</span>
              : formatSignedPercent(dayPnlPercent)}
          </div>
        </div>

        <div className="metric-tile">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Cash
          </div>
          <div className="mt-2 font-mono text-base font-semibold text-slate-200">
            {isPortfolioLoading
              ? <span className="text-slate-500">—</span>
              : formatCurrency(cashBalance, false)}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.75fr)]">
        <div className="space-y-5">
          <DashboardCard
            action={
              <span className="risk-chip border-sky-400/30 bg-sky-400/10 text-sky-300">
                Real 1D
              </span>
            }
            title="Portfolio Value"
          >
            {isPortfolioLoading ? (
              <div className="space-y-4">
                <SkeletonBlock className="h-10 w-56" />
                <SkeletonBlock className="h-72" />
              </div>
            ) : chartPoints.length === 0 ? (
              <EmptyState
                detail="Portfolio valuation will appear after positions are loaded."
                message="No portfolio data is available yet."
              />
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="font-mono text-4xl font-semibold text-slate-50">
                      {formatCurrency(portfolioValue, false)}
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      <PnlValue value={dayPnl} /> /{" "}
                      <span
                        className={[
                          "font-mono",
                          dayPnlPercent >= 0
                            ? "text-emerald-300"
                            : "text-rose-300",
                        ].join(" ")}
                      >
                        {formatSignedPercent(dayPnlPercent)}
                      </span>{" "}
                      daily change
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/70 px-3 py-2 text-right">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                      Buying power
                    </div>
                    <div className="font-mono text-sm text-slate-100">
                      {formatCurrency(buyingPower, false)}
                    </div>
                  </div>
                </div>
                <PortfolioChart points={chartPoints} />
              </>
            )}
          </DashboardCard>

          <DashboardCard title="Recent Trades">
            <RecentTradesTable
              isLoading={isTradesLoading}
              trades={recentTrades}
            />
          </DashboardCard>
        </div>

        <div className="space-y-5">
          {isRiskLoading ? (
            <DashboardCard title="Risk Score">
              <SkeletonBlock className="h-28" />
            </DashboardCard>
          ) : (
            <RiskScoreCard
              label={riskLabel}
              score={riskScore}
            />
          )}
          <DashboardCard title="Positions">
            <PositionsTable
              isLoading={isPortfolioLoading}
              positions={positions}
            />
          </DashboardCard>
          <QuickTradePanel
            buyingPower={buyingPower}
            isSubmitting={tradeMutation.isPending}
            onSubmit={handleQuickTradeSubmit}
          />
        </div>
      </div>
    </div>
  );
}
