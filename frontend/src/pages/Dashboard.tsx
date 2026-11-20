import { CloseInsights } from "../night/features/portfolio-review/CloseInsights";
import { useRef } from "react";
import { fetchMe } from "../api/auth";
import { keys } from "../night/api";
import { Button, Page, RestInstrument, Stat, State } from "../night/inner";
import { ClosingSessions } from "../features/dashboard/ClosingSessions";
import { ActivityBrief } from "../features/dashboard/ActivityBrief";
import type { UserResponse } from "../types/schemas";
import "../features/dashboard/today.css";
import { DemoGuide } from "../night/features/account/DemoGuide";
import { useGuide } from "../night/features/account/guideState";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketOverview } from "../api/market";
import { fetchOrders } from "../api/orders";
import { fetchPortfolio } from "../api/portfolio";
import { fetchRisk } from "../api/risk";
import { fetchTrades } from "../api/trades";
import {
  DashboardCard,
  EmptyState,
  PnlValue,
  PositionsTable,
  RecentOrdersTable,
  RecentTradesTable,
  RiskScoreCard,
  SkeletonBlock,
} from "../features/dashboard/components";
import {
  getTotalPnl,
  getUnrealizedPnlPercent,
  getBuyingPower,
  getCashBalance,
  getPortfolioValue,
  getRiskLabel,
  getRiskScore,
  mapPortfolioPositions,
  mapRecentTrades,
} from "../features/dashboard/adapters";
import {
  formatCurrency,
  formatSignedPercent,
  formatUtcDateTime,
} from "../utils/format";
export function Dashboard() {
  const identity = useQuery({queryKey: keys.me, queryFn: fetchMe, retry: false});
  if (identity.isPending) return <RestInstrument label="Closing sessions" status={{kind:"loading",title:"Loading account…"}} />;
  if (identity.isError || !identity.data) return <RestInstrument label="Closing sessions" status={{kind:"error",title:"Account unavailable",action:<Button onClick={() => void identity.refetch()}>Retry account</Button>}} />;
  return <Today key={identity.data.id} identity={identity.data} />;
}

function Today({ identity }: { identity: UserResponse }) {
  const entry = useRef<HTMLAnchorElement>(null);
  const guide = useGuide(identity.id);
  const demo = import.meta.env.VITE_DEMO_ENABLED !== "false" && identity.is_demo && identity.role === "trader";
  const portfolioQuery = useQuery({
    queryKey: keys.account(identity.id, "portfolio"),
    retry: false,
    queryFn: fetchPortfolio,
  });

  const tradesQuery = useQuery({
    queryKey: keys.account(identity.id, "trades"),
    retry: false,
    queryFn: fetchTrades,
  });

  const riskQuery = useQuery({
    queryKey: keys.account(identity.id, "risk"),
    retry: false,
    queryFn: fetchRisk,
  });

  const ordersQuery = useQuery({
    queryKey: keys.account(identity.id, "orders"),
    retry: false,
    queryFn: fetchOrders,
  });

  // Same key as Home so a visit to /market and /dashboard share one cache entry.
  const marketQuery = useQuery({
    queryKey: ["market", "overview"],
    queryFn: fetchMarketOverview,
    refetchInterval: 300000,
    retry: false,
  });

  const portfolio = portfolioQuery.data;
  const trades = tradesQuery.data;
  const risk = riskQuery.data;
  const valuationIncomplete = portfolio?.valuation_status === "incomplete";
  const portfolioValue = getPortfolioValue(portfolio);
  const cashBalance = getCashBalance(portfolio);
  const buyingPower = getBuyingPower(portfolio);
  const totalPnl = getTotalPnl(portfolio);
  const unrealizedPnlPercent = getUnrealizedPnlPercent(portfolio);
  const recentTrades = mapRecentTrades(trades);
  const recentOrders = ordersQuery.data?.orders.slice(0, 5) ?? null;
  const positions = mapPortfolioPositions(portfolio);
  const marketTrends = marketQuery.data?.trends ?? [];
  const valuationRead =
    formatUtcDateTime(portfolio?.snapshot_read_at) ?? "Unavailable";
  const riskFailed = riskQuery.isError;
  const riskScore = riskFailed ? null : getRiskScore(risk);
  const riskLabel = riskScore == null ? null : getRiskLabel(riskScore);
  const isPortfolioLoading = portfolioQuery.isLoading;
  const isTradesLoading = tradesQuery.isLoading;
  const isRiskLoading = riskQuery.isLoading;
  const hasDashboardError =
    portfolioQuery.isError || tradesQuery.isError || riskQuery.isError;

  return (
    <Page className="today" title="Today" description="Closing values, recent activity and current holdings."
      actions={identity.role === "trader" && portfolio && !(demo && guide === "active") && <Link ref={entry} className="nk-button" data-variant="primary" data-testid="order-open"
        to="/trades?ticket=1">Open order preview</Link>}>
      <div className="today-band">
        <Stat label="Total P&L" data-testid="today-total-pnl" value={isPortfolioLoading ? "Loading" : totalPnl == null ? null : <PnlValue value={totalPnl} />} />
        <Stat label="Unrealized P&L %" value={isPortfolioLoading ? "Loading" : unrealizedPnlPercent == null ? null : formatSignedPercent(unrealizedPnlPercent)} />
        <Stat label="Cash" value={isPortfolioLoading ? "Loading" : portfolio ? formatCurrency(cashBalance, false) : null} />
        <Stat label="Latest assessment" value={isRiskLoading ? "Loading" : riskFailed ? null : riskLabel ?? "No assessments"} source={riskScore == null ? "--" : String(riskScore)} />
      </div>
      <div className="today-brief">
        <ClosingSessions owner={identity.id} />
        <div className="today-rail">
          <DashboardCard title="Portfolio Value">
            {isPortfolioLoading ? (
              <div className="space-y-4">
                <SkeletonBlock className="h-10 w-56" />
                <SkeletonBlock className="h-28" />
              </div>
            ) : portfolioValue == null ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="font-mono text-4xl font-semibold text-slate-400">Unavailable</div>
                  <p className="mt-2 text-sm text-slate-300">
                    {valuationIncomplete ? "Valuation incomplete" : "Portfolio valuation could not be loaded."}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    Valuation read{" "}
                    <span className="font-mono text-slate-300">{valuationRead}</span>
                  </p>
                </div>
                {portfolio ? (
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Buying power</div>
                    <div className="font-mono text-sm text-slate-100">{formatCurrency(buyingPower, false)}</div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="font-mono text-4xl font-semibold text-slate-50">
                    {formatCurrency(portfolioValue, false)}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Buying power</div>
                    <div className="font-mono text-sm text-slate-100">{formatCurrency(buyingPower, false)}</div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Valuation read{" "}
                  <span className="font-mono text-slate-300">{valuationRead}</span>
                </p>
              </>
            )}
          </DashboardCard>
          <ActivityBrief loadingFills={tradesQuery.isPending} loadingOrders={ordersQuery.isPending} fills={tradesQuery.isSuccess ? trades?.trades : undefined} orders={ordersQuery.isSuccess ? ordersQuery.data?.orders : undefined} />
          <CloseInsights owner={identity.id} surface="today" />
        </div>
      </div>
      {demo && portfolio && <DemoGuide owner={identity.id} state={guide} onDismiss={() => requestAnimationFrame(() => entry.current?.focus())} orders={ordersQuery.isSuccess ? ordersQuery.data.orders : undefined} />}
      {portfolio?.user?.is_demo && (
        <p className="rounded-xl border border-emerald-400/25 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
          <strong>Demo account.</strong>{" "}
          {portfolio.user.demo_seed_mode === "cached_quotes"
            ? "The demo was seeded from stored quotes because daily history was unavailable."
            : portfolio.user.demo_seed_mode === "cash_only"
              ? "The account starts with paper cash because seed prices were unavailable."
              : "The simulated trading history uses stored daily closing prices."}
        </p>
      )}

      {hasDashboardError && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Some dashboard data could not be loaded. Check the API server and authentication state.
        </p>
      )}

      {marketQuery.isLoading ? (
        <div
          aria-busy="true"
          aria-label="Market pulse"
          className="flex flex-wrap items-center gap-2"
          role="region"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Market pulse
          </span>
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-6 w-32" />
        </div>
      ) : marketTrends.length > 0 ? (
        <div
          aria-label="Market pulse"
          className="flex flex-wrap items-center gap-2"
          role="region"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Market pulse
          </span>
          {marketTrends.map((trend) => (
            <div
              className="status-badge inline-flex items-center gap-1.5 border-slate-700 bg-slate-900 font-mono text-slate-300"
              key={trend.source_symbol}
            >
              <span className="text-slate-100">{trend.source_symbol}</span>
              <span className="font-sans text-slate-400">{trend.name}</span>
              <span>{formatCurrency(trend.value)}</span>
              <span className={trend.change_percent >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {formatSignedPercent(trend.change_percent)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.75fr)]">
        <div className="min-w-0 space-y-5">
          <DashboardCard title="Recent Trades">
            <RecentTradesTable
              isError={tradesQuery.isError}
              isLoading={isTradesLoading}
              onRetry={() => {
                void tradesQuery.refetch();
              }}
              trades={recentTrades}
            />
          </DashboardCard>

          <DashboardCard
            action={
              <Link
                className="text-xs font-semibold text-emerald-300 transition duration-200 hover:text-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                to="/trades"
              >
                View orders
              </Link>
            }
            title="Recent Orders"
          >
            <RecentOrdersTable
              isError={ordersQuery.isError}
              isLoading={ordersQuery.isLoading}
              onRetry={() => {
                void ordersQuery.refetch();
              }}
              orders={recentOrders}
            />
          </DashboardCard>
        </div>

        <div className="min-w-0 space-y-5">
          {isRiskLoading ? (
            <DashboardCard title="Risk Score">
              <SkeletonBlock className="h-28" />
            </DashboardCard>
          ) : riskFailed ? (
            <DashboardCard title="Risk Score">
              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
                <p>Risk assessment unavailable.</p>
                <p className="mt-1 text-xs leading-5 text-rose-200/80">
                  The latest post-trade assessment could not be loaded. Portfolio-wide risk is not estimated here.
                  {risk ? " A previously loaded result is not shown as current." : ""}
                </p>
                <button
                  className="mt-3 rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition duration-200 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                  onClick={() => {
                    void riskQuery.refetch();
                  }}
                  type="button"
                >
                  Retry risk assessment
                </button>
              </div>
            </DashboardCard>
          ) : riskScore != null && riskLabel != null ? (
            <RiskScoreCard
              label={riskLabel}
              score={riskScore}
            />
          ) : (
            <DashboardCard title="Risk Score">
              <EmptyState
                detail="No post-trade assessment has been recorded. Portfolio-wide risk is not estimated here."
                message="No assessments"
              />
            </DashboardCard>
          )}
          <DashboardCard title="Positions">
            <p className="mb-3">Concentration is the share of account value held in one security. Larger weights make that security’s price changes matter more.</p>
            {portfolioQuery.isError ? <State kind="error" title="Positions could not be loaded" /> : <PositionsTable
              isLoading={isPortfolioLoading}
              positions={positions}
            />}
          </DashboardCard>
          {portfolioQuery.isError && <State kind="error" title="Account data unavailable" action={<Button onClick={() => void portfolioQuery.refetch()}>Retry portfolio</Button>} />}
        </div>
      </div>
    </Page>
  );
}
