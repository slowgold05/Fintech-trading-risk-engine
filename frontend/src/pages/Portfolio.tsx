import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { fetchMe, setLegalName } from "../api/auth";
import { createCashMovement } from "../api/cash";
import { fetchPortfolio, fetchPortfolioPnl } from "../api/portfolio";
import { useToast } from "../context/useToast";
import { PageHeader } from "../components/PageHeader";
import {
  DashboardCard,
  EmptyState,
  PnlValue,
  SkeletonBlock,
} from "../features/dashboard/components";
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";
import type { PortfolioPositionResponse } from "../types/schemas";

function getExposurePercent(positionValue: number, totalValue: number) {
  if (totalValue <= 0) {
    return 0;
  }

  return (positionValue / totalValue) * 100;
}

function getAssetExposure(positions: PortfolioPositionResponse[]) {
  const exposure = positions.reduce<Record<string, number>>((acc, position) => {
    const key = position.asset_type.toUpperCase();
    acc[key] = (acc[key] ?? 0) + position.position_value;
    return acc;
  }, {});

  return Object.entries(exposure)
    .map(([assetType, value]) => ({ assetType, value }))
    .sort((a, b) => b.value - a.value);
}

function CashPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const nameMutation = useMutation({
    mutationFn: setLegalName,
    onSuccess: (result) => {
      setName(result.full_name);
      showToast("success", "Legal name saved.");
    },
    onError: (error) => showToast("error", isAxiosError(error) ? String(error.response?.data?.detail ?? "Legal name was not saved.") : "Legal name was not saved."),
  });
  const cashMutation = useMutation({
    mutationFn: createCashMovement,
    onSuccess: (result) => {
      setAmount("");
      setCode("");
      showToast("success", `${result.kind} recorded.`);
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (error) => showToast("error", isAxiosError(error) ? String(error.response?.data?.detail ?? "Cash movement was not recorded.") : "Cash movement was not recorded."),
  });

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    nameMutation.mutate(name.trim());
  }

  function move(kind: "deposit" | "withdrawal") {
    cashMutation.mutate({ kind, amount: amount.trim(), stepUpCode: code.trim() || undefined });
  }

  const trader = me.data?.role === "trader";

  return (
    <DashboardCard title="Paper cash">
      <form onSubmit={saveName} className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          aria-label="Legal name"
          value={name}
          minLength={3}
          maxLength={255}
          required
          placeholder="Legal name for screening"
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        />
        <button type="submit" disabled={nameMutation.isPending} className="rounded bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
          Save legal name
        </button>
      </form>
      {me.isLoading ? <SkeletonBlock className="h-16" /> : trader ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Cash amount"
            value={amount}
            inputMode="decimal"
            placeholder="25.00"
            onChange={(event) => setAmount(event.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <input
            aria-label="Authenticator code"
            value={code}
            inputMode="numeric"
            maxLength={6}
            placeholder="Code for a large withdrawal"
            onChange={(event) => setCode(event.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <button type="button" disabled={cashMutation.isPending || amount.trim().length === 0} onClick={() => move("deposit")} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
            Deposit
          </button>
          <button type="button" disabled={cashMutation.isPending || amount.trim().length === 0} onClick={() => move("withdrawal")} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
            Withdraw
          </button>
          <p className="text-xs text-slate-500 sm:col-span-2">
            A withdrawal needs a saved legal name. At or above $10,000 it also needs a current authenticator code.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Paper deposits and withdrawals are available to trader accounts.</p>
      )}
    </DashboardCard>
  );
}

export function Portfolio() {
  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });

  const portfolioPnlQuery = useQuery({
    queryKey: ["portfolio", "pnl"],
    queryFn: fetchPortfolioPnl,
    retry: false,
  });

  const portfolio = portfolioQuery.data;
  const summary = portfolio?.summary;
  const positions = portfolio?.positions ?? [];
  const positionsValue = summary?.total_portfolio_value ?? 0;
  const totalValue = summary?.total_account_value ?? positionsValue;
  const cashBalance = summary?.cash_balance ?? 0;
  const totalPnl = portfolioPnlQuery.data?.total_pnl ?? summary?.total_pnl ?? 0;
  const assetExposure = getAssetExposure(positions);

  return (
    <div className="space-y-6">
      <PageHeader
        badge="Portfolio"
        title="Holdings &amp; Valuation"
        description="Open positions, FIFO P&amp;L, cost basis, and exposure breakdown by asset class."
      />

      {portfolioQuery.isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-950/50 px-4 py-4 text-sm text-rose-200">
          Portfolio data could not be loaded. Check the API server and
          authentication state.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {portfolioQuery.isLoading ? (
          [0, 1, 2, 3].map((item) => (
            <div className="metric-tile" key={item}>
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="mt-3 h-5 w-32" />
            </div>
          ))
        ) : (
          <>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Portfolio value
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-50">
                {formatCurrency(totalValue, false)}
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Cash
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-50">
                {formatCurrency(cashBalance, false)}
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Total P&L
              </div>
              <div className="mt-1 text-sm">
                <PnlValue value={totalPnl} />
              </div>
            </div>
            <div className="metric-tile">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Holdings
              </div>
              <div className="mt-1 font-mono text-sm text-slate-200">
                {positions.length}
              </div>
            </div>
          </>
        )}
      </div>

      <CashPanel />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]">
        <DashboardCard
          action={
            <span className="font-mono text-xs text-slate-500">
              {portfolioQuery.isLoading ? "--" : `${positions.length} rows`}
            </span>
          }
          title="Holdings"
        >
          {portfolioQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((item) => (
                <SkeletonBlock className="h-10" key={item} />
              ))}
            </div>
          ) : positions.length === 0 ? (
            <EmptyState
              detail="Open holdings will appear after buy trades settle into the portfolio."
              message="No holdings to display."
            />
          ) : (
            <div className="table-shell max-h-[640px]">
              <table className="data-table min-w-[980px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="text-left">Symbol</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Average cost</th>
                    <th className="text-right">Current price</th>
                    <th className="text-right">Market value</th>
                    <th className="text-right">Realized P&L</th>
                    <th className="text-right">Unrealized P&L</th>
                    <th className="text-right">Exposure %</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => {
                    const exposurePercent = getExposurePercent(
                      position.position_value,
                      positionsValue,
                    );

                    return (
                      <tr
                        className={[
                          "border-l-2",
                          position.unrealized_pnl >= 0
                            ? "border-l-emerald-400/70"
                            : "border-l-rose-400/70",
                        ].join(" ")}
                        key={`${position.asset_type}-${position.symbol}`}
                      >
                        <td>
                          <div className="font-mono text-sm font-semibold text-slate-100">
                            {position.symbol}
                          </div>
                          <div className="font-mono text-[11px] uppercase text-slate-500">
                            {position.asset_type}
                          </div>
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatQuantity(position.quantity)}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatCurrency(position.avg_cost)}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatCurrency(position.current_price)}
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatCurrency(position.position_value)}
                        </td>
                        <td className="text-right font-mono tabular-nums text-slate-500">
                          --
                        </td>
                        <td className="text-right">
                          <PnlValue value={position.unrealized_pnl} />
                          <div
                            className={[
                              "mt-1 font-mono text-[11px]",
                              position.unrealized_pnl_pct >= 0
                                ? "text-emerald-300/80"
                                : "text-rose-300/80",
                            ].join(" ")}
                          >
                            {formatSignedPercent(position.unrealized_pnl_pct)}
                          </div>
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {formatPercent(exposurePercent)}
                          <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded bg-slate-800">
                            <div
                              className="h-full rounded bg-slate-500"
                              style={{
                                width: `${Math.min(exposurePercent, 100)}%`,
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>

        <div className="space-y-5">
          <DashboardCard title="FIFO P&L">
            {portfolioQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-12" key={item} />
                ))}
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Realized P&L
                  </div>
                  <div className="mt-1 text-sm">
                    <PnlValue value={summary?.total_realized_pnl ?? 0} />
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Unrealized P&L
                  </div>
                  <div className="mt-1 text-sm">
                    <PnlValue value={summary?.total_unrealized_pnl ?? 0} />
                  </div>
                  <div
                    className={[
                      "mt-1 font-mono text-[11px]",
                      (summary?.total_unrealized_pnl_pct ?? 0) >= 0
                        ? "text-emerald-300/80"
                        : "text-rose-300/80",
                    ].join(" ")}
                  >
                    {formatSignedPercent(summary?.total_unrealized_pnl_pct ?? 0)}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Cost basis
                  </div>
                  <div className="mt-1 font-mono text-sm text-slate-100">
                    {formatCurrency(summary?.total_cost_basis ?? 0, false)}
                  </div>
                </div>
                {portfolioPnlQuery.isError ? (
                  <p className="text-xs leading-5 text-slate-500">
                    Detailed `/portfolio/pnl` data is unavailable. Showing
                    portfolio summary P&L from `/portfolio`.
                  </p>
                ) : null}
              </div>
            )}
          </DashboardCard>

          <DashboardCard title="Exposure by asset">
            {portfolioQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <SkeletonBlock className="h-10" key={item} />
                ))}
              </div>
            ) : assetExposure.length === 0 ? (
              <EmptyState
                detail="Asset exposure will appear once holdings exist."
                message="No exposure to summarize."
              />
            ) : (
              <div className="space-y-3">
                {assetExposure.map((item) => {
                  const exposurePercent = getExposurePercent(
                    item.value,
                    positionsValue,
                  );

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
                            Exposure
                          </div>
                        </div>
                        <div className="text-right font-mono text-sm text-slate-200">
                          {formatCurrency(item.value, false)}
                          <div className="text-[11px] text-slate-500">
                            {formatPercent(exposurePercent)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div
                          className="h-full rounded bg-emerald-400/70"
                          style={{ width: `${Math.min(exposurePercent, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
