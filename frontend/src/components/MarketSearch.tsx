import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMarketUniverse } from "../api/market";
import type { MarketUniverseItem } from "../types/schemas";

const OUTSIDE_LABEL = "Outside S&P 500";

function outsideLabel(item: MarketUniverseItem): string | null {
  if (item.in_featured_universe) return null;
  return item.universe_label || OUTSIDE_LABEL;
}

export function MarketSearch() {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const term = submitted.trim();
  const results = useQuery({
    queryKey: ["market", "universe", term],
    queryFn: () => fetchMarketUniverse(term),
    enabled: term.length > 0,
    retry: false,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(draft);
  }

  return (
    <form className="mt-6 max-w-xl" onSubmit={handleSubmit}>
      <label className="text-xs font-semibold text-slate-300" htmlFor="market-symbol-search">
        Search symbols
      </label>
      <div className="mt-2 flex min-w-0 gap-2">
        <input
          className="field-control mt-0 min-w-0 flex-1"
          id="market-symbol-search"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ticker"
          value={draft}
        />
        <button
          className="min-h-11 shrink-0 rounded-md bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/70 active:translate-y-px"
          type="submit"
        >
          Search
        </button>
      </div>
      {term.length > 0 && results.data ? (
        <ul aria-label="Search results" className="mt-3 space-y-2">
          {results.data.items.length === 0 ? (
            <li className="text-sm text-slate-400">No symbols matched.</li>
          ) : results.data.items.map((item) => {
            const label = outsideLabel(item);
            return (
              <li className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-200" key={item.symbol}>
                <Link
                  className="font-mono font-semibold text-slate-50 underline decoration-slate-600 underline-offset-4 hover:text-emerald-200 hover:decoration-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/70"
                  to={`/market/${encodeURIComponent(item.symbol)}`}
                >
                  {item.symbol}
                </Link>
                <span className="min-w-0 truncate text-slate-400">{item.company_name}</span>
                {label ? (
                  <span className="status-badge border-amber-400/40 bg-amber-400/10 text-amber-200">
                    {label}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {term.length > 0 && results.isError ? (
        <p className="mt-3 text-sm text-rose-200" role="alert">Symbol search is unavailable.</p>
      ) : null}
    </form>
  );
}
