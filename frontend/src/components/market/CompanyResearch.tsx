import { sectorName } from "./sectorName";
import { inspectEvents } from "./inspectEvents";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, MagnifyingGlass } from "@phosphor-icons/react";
import { Fingerprint } from "./terrainIcons";
import { fetchMarketResearch, fetchSymbolQuote } from "../../api/market";
import { type MarketResearchResponse, type MarketHeatmapItemResponse } from "../../types/schemas";
import { formatCurrency, formatPercent, formatSignedPercent } from "../../utils/format";
import { Figure, Button, Card, Segmented, Skeleton, Stat } from "../../design/primitives";
import { changeView } from "../../design/changeView";
import { SymbolSparkline } from "./SymbolHistory";

const ranges = ["1m", "3m", "6m", "1y"] as const;
const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function endOfDayCaption(show: boolean, asOf?: string | null): string | null {
  if (!show || !asOf) {
    return null;
  }
  return `End of day ${asOf}`;
}

function formatMarginPeriod(period: MarketResearchResponse["profit_margin_period"]): string | null {
  if (period == null) {
    return null;
  }
  const start = period.start?.trim();
  const end = period.end?.trim();
  if (!start || !end) {
    return null;
  }
  const form = period.form?.trim();
  return form ? `${form} · ${start} to ${end}` : `${start} to ${end}`;
}

export function CompanyResearch({
  symbol,
  setSymbol,
  draft,
  setDraft,
  stocks,
  linked,
  sector,
  onInspect,
}: {
  stocks: MarketHeatmapItemResponse[];
  linked: string | null;
  sector: string | null;
  onInspect: (symbol: string | null) => void;
  symbol: string;
  setSymbol: (v: string) => void;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const [range, setRange] = useState<(typeof ranges)[number]>("1m");
  const researchQuery = useQuery({
    queryKey: ["market", "research", symbol],
    queryFn: () => fetchMarketResearch(symbol),
    retry: false,
  });
  const research: MarketResearchResponse =
    researchQuery.data?.symbol === symbol ? researchQuery.data : { symbol, errors: [] };
  const cached = stocks.find((s) => s.symbol === symbol);
  const quoteQuery = useQuery({
    queryKey: ["stock-detail", "quote", symbol],
    queryFn: () => fetchSymbolQuote(symbol),
    enabled: !(Number(cached?.price) > 0) && researchQuery.isFetched && !(Number(research.price) > 0),
    staleTime: 300000,
    retry: false,
  });
  const directQuote = quoteQuery.data?.symbol === symbol ? quoteQuery.data : null;
  const quote = cached && cached.price > 0 ? cached : directQuote;
  const ownPrice = research.price != null && research.price > 0;
  const price = ownPrice ? research.price : quote?.price;
  const change = ownPrice
    ? research.change_percent
    : quote === cached && cached?.data_status === "stale"
      ? null
      : quote?.change_percent;
  const filing = research.fundamentals;
  const balances =
    filing?.assets != null && filing.assets > 0 && filing.liabilities != null && filing.equity != null;
  const earnings = [
    ["Revenue", filing?.revenue],
    ["Net income", filing?.net_income],
  ] as const;
  const hasEarnings = earnings.some(([, v]) => v != null);
  const earningsMax = Math.max(1, ...earnings.map(([, v]) => Math.abs(v ?? 0)));
  const cacheCaption = [
    quote === cached ? cached?.data_status : "Cached quote",
    quote?.source,
    quote?.as_of?.slice(0, 10),
    quote === cached && cached?.price_basis === "end_of_day_previous_close" && "End-of-day previous close",
  ]
    .filter(Boolean)
    .join(" · ");
  const marginPeriod =
    research.profit_margin != null ? formatMarginPeriod(research.profit_margin_period) : null;
  const priceAsOf = research.price_basis === "end_of_day_previous_close" ? research.price_as_of : null;
  const priceCaption = endOfDayCaption(research.price != null && research.price > 0, priceAsOf);
  const marketCapCaption = endOfDayCaption(
    research.market_cap != null && research.market_cap_basis === "end_of_day_price_times_shares",
    research.price_as_of,
  );
  const peCaption = endOfDayCaption(
    research.pe_ratio != null &&
      research.pe_basis === "sec_ttm_diluted_eps" &&
      research.price_basis === "end_of_day_previous_close",
    research.price_as_of,
  );
  const hasResearchInputs =
    (research.pe_ratio != null && research.pe_ratio > 0) ||
    research.profit_margin != null ||
    research.beta != null ||
    (research.analyst_target_price != null &&
      research.analyst_target_price > 0 &&
      research.price != null &&
      research.price > 0);
  const researchRiskLabel = hasResearchInputs ? research.research_risk_label : null;
  const researchRiskScore = hasResearchInputs ? research.research_risk_score : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = draft.trim().toUpperCase();
    if (next) setSymbol(next);
  }
  return (
    <Card className="research-panel">
      <div className="paper-head">
        <div>
          <div className="eyebrow">
            <Fingerprint size={15} /> Fundamentals
          </div>
          <h2 id="company-research">Company research</h2>
        </div>
        <form onSubmit={submit} className="research-search">
          <label htmlFor="research-symbol" className="sr-only">
            Research symbol
          </label>
          <MagnifyingGlass size={16} />
          <input
            id="research-symbol"
            placeholder="Ticker"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit">Research</Button>
        </form>
      </div>
      {researchQuery.isLoading ? (
        <Skeleton label="Loading company research" className="research-skeleton" />
      ) : (
        <div className="research-data">
          <div
            className="research-identity"
            data-linked={
              linked === symbol ||
              (!!sector &&
                sectorName(stocks.find((s) => s.symbol === symbol)?.sector) === sectorName(sector))
            }
            {...inspectEvents(
              () => onInspect(symbol),
              () => onInspect(null),
            )}
          >
            <div className="research-ticker">
              {research.symbol}
              {research.detail_available === true && (
                <Link
                  aria-label={`View ${research.symbol}`}
                  to={`/market/${encodeURIComponent(research.symbol)}`}
                >
                  <ArrowUpRight size={17} />
                </Link>
              )}
            </div>
            <h3>
              {research.name ?? cached?.company ?? directQuote?.name ?? "Company overview unavailable"}
            </h3>
            <p>
              {[research.exchange ?? quote?.exchange, research.sector ?? quote?.sector]
                .filter(Boolean)
                .join(" / ")}
            </p>
            {price != null && price > 0 && (
              <div className="company-close">
                <Stat
                  label="Price"
                  value={formatCurrency(price)}
                  caption={ownPrice ? priceCaption : cacheCaption}
                />
                {change != null && (
                  <span className={change < 0 ? "down" : change > 0 ? "up" : ""}>
                    {formatSignedPercent(change)}
                  </span>
                )}
                {cached && (
                  <div className="company-trend">
                    <SymbolSparkline className="company-mini" symbol={symbol} range="1m" empty="compact" />
                  </div>
                )}
              </div>
            )}
          </div>
          {(balances || hasEarnings || research.market_cap != null || research.pe_ratio != null) && (
            <div className="research-stats">
              {balances && filing && (
                <div className="filing-composition">
                  <div>
                    <span>Balance sheet</span>
                    <b>{filing.source ?? "Company filing"}</b>
                  </div>
                  <strong>
                    {compactUsd.format(filing.assets!)} <small>assets</small>
                  </strong>
                  <div className="capital-bar">
                    <i
                      style={{
                        width:
                          Math.max(0, Math.min(100, (100 * filing.liabilities!) / filing.assets!)) + "%",
                      }}
                    />
                  </div>
                  <div className="capital-key">
                    <span>Liabilities {formatCurrency(filing.liabilities!, false)}</span>
                    <span>Equity {formatCurrency(filing.equity!, false)}</span>
                  </div>
                </div>
              )}
              {hasEarnings && (
                <div
                  className="filing-income"
                  aria-label={`Reported earnings from ${filing?.source ?? "company filing"}`}
                >
                  {earnings.map(
                    ([label, value]) =>
                      value != null && (
                        <div key={label}>
                          <span>{label}</span>
                          <i>
                            <b style={{ width: (100 * Math.abs(value)) / earningsMax + "%" }} />
                          </i>
                          <strong>{compactUsd.format(value)}</strong>
                        </div>
                      ),
                  )}
                </div>
              )}
              {(research.market_cap != null || research.pe_ratio != null) && (
                <div className="valuation-strip">
                  {research.market_cap != null && (
                    <Stat
                      label="Market cap"
                      value={formatCurrency(research.market_cap, false)}
                      caption={marketCapCaption}
                    />
                  )}
                  {research.pe_ratio != null && (
                    <Stat label="P/E" value={research.pe_ratio.toFixed(2)} caption={peCaption} />
                  )}
                </div>
              )}
            </div>
          )}
          <div className="research-risk">
            {research.profit_margin != null && (
              <Stat
                label="Margin"
                value={formatPercent(research.profit_margin * 100)}
                caption={marginPeriod}
              />
            )}
            <div className="risk-reading">
              <div>
                <span className="label">Research risk</span>
                {researchRiskLabel && researchRiskScore != null ? (
                  <strong>
                    <Figure value={String(researchRiskScore)} /> <small>{researchRiskLabel}</small>
                  </strong>
                ) : (
                  <p>Research assessment unavailable</p>
                )}
              </div>
              {researchRiskLabel && researchRiskScore != null && (
                <svg viewBox="0 0 52 52" aria-hidden="true">
                  <circle cx="26" cy="26" r="20" fill="none" stroke="#333639" strokeWidth="5" />
                  <circle
                    cx="26"
                    cy="26"
                    r="20"
                    fill="none"
                    stroke="#bdc0ba"
                    strokeWidth="5"
                    pathLength="100"
                    strokeDasharray={`${Math.max(0, Math.min(100, researchRiskScore))} 100`}
                    transform="rotate(-90 26 26)"
                  />
                </svg>
              )}
            </div>
            {(research.risk_factors?.length ? research.risk_factors : ["Research factors unavailable"]).map(
              (f) => (
                <small key={f}>{f}</small>
              ),
            )}
          </div>
        </div>
      )}
      {researchQuery.isError && (
        <p className="data-note" role="alert">
          Could not load the company research snapshot.
        </p>
      )}
      {research.valuation_notice && <p className="data-note">{research.valuation_notice}</p>}
      <details className="research-details">
        <summary>Company profile &amp; price history</summary>
        <p>{research.description ?? "No company description available."}</p>
        {(hasResearchInputs || (price != null && price > 0)) && (
          <div>
            <div className="research-range">
              <span>Price history</span>
              <Segmented
                label="Company research range"
                options={ranges}
                value={range}
                format={(v) => v.toUpperCase()}
                accessibleLabel={(v) => `Company research range ${v.toUpperCase()}`}
                onChange={(v) => changeView(() => setRange(v), "research")}
              />
            </div>
            <SymbolSparkline className="research-spark" range={range} symbol={research.symbol} />
          </div>
        )}
      </details>
    </Card>
  );
}
