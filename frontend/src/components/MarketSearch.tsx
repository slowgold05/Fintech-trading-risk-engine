import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MagnifyingGlass, ArrowRight, X } from "@phosphor-icons/react";
import { useAuth } from "../context/useAuth";
import { fetchMe } from "../api/auth";
import { features, destinations } from "../night/registry";
import { keys } from "../night/api";
import { fetchMarketUniverse } from "../api/market";

import { hasCompanyDetail } from "../night/features/discover/companyLookup";
import "./MarketSearch.css";

export function MarketSearch({ compact = false }: { compact?: boolean } = {}) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextLookup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const uniqueId = useId();
  const inputId = compact ? "market-symbol-search" : uniqueId;
  const term = submitted.trim();
  const { isAuthenticated } = useAuth();
  const identity = useQuery({
    queryKey: keys.me, queryFn: fetchMe, enabled: isAuthenticated && !!term, retry: false,
  });
  const viewer = isAuthenticated ? identity.data?.id : "public";
  const ready = viewer !== undefined;
  const watchlists = [...destinations, ...features].find((item) => item.id === "watchlists");
  const results = useQuery({
    queryKey: keys.universe(viewer ?? "public", term, 20),
    queryFn: () => fetchMarketUniverse(term),
    enabled: term.length > 0 && ready,
    retry: false,
  });
  useEffect(() => () => clearTimeout(nextLookup.current), []);
  function closeResults() {
    clearTimeout(nextLookup.current);
    setSubmitted("");
  }

  useEffect(() => {
    if (!term && !draft) return;
    function dismiss(e: PointerEvent) {
      if (e.target instanceof Node && !form.current?.contains(e.target)) closeResults();
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [term, draft]);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearTimeout(nextLookup.current);
    setSubmitted(draft);
  }
  return (
    <form
      ref={form}
      className="symbol-search market-search"
      role="search"
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && (draft || term)) {
          if (!form.current?.closest("dialog") && term) e.stopPropagation();
          closeResults();
          input.current?.focus();
        }
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        Search symbols
      </label>
      <MagnifyingGlass aria-hidden="true" size={17} />
      <input
        ref={input}
        id={inputId} data-testid="market-search"
        value={draft}
        maxLength={50}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          closeResults();
          if (value.trim()) nextLookup.current = setTimeout(() => setSubmitted(value), 220);
        }}
        placeholder={compact ? "Symbol / company" : "Search company or ticker"}
        autoComplete="off"
      />
      <button type="submit" aria-label="Search">
        <ArrowRight size={15} />
      </button>
      {term && (
        <div className="symbol-results">
          <div className="results-heading">
            <span>Symbol lookup</span>
            <button
              aria-label="Close results"
              type="button"
              onClick={() => {
                closeResults();
                input.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          {!(isAuthenticated && identity.isError) && (!ready || results.isPending) && <p role="status">Searching symbols…</p>}
          {((isAuthenticated && identity.isError) || results.isError) && <p role="alert">
            Symbol search is unavailable. <button type="button" onClick={() => void (identity.isError ? identity : results).refetch()}>Retry</button>
          </p>}
          {ready && results.data && (
            <ul aria-label="Search results">
              {results.data.items.length ? (
                results.data.items.map((item) => (
                  <li key={item.symbol}>
                    {hasCompanyDetail(item) ? (
                      <Link data-testid={`search-result-${item.symbol}`} to={`/market/${encodeURIComponent(item.symbol)}`}>
                        <strong>{item.symbol}</strong><span>{item.company_name}</span>
                        {!item.in_featured_universe && <small>{item.universe_label || "Outside S&P 500"}</small>}
                      </Link>
                    ) : (
                      <>
                        <span><strong>{item.symbol}</strong> {item.company_name} · {item.universe_label || "Outside S&P 500"} · Detail unavailable</span>
                        {isAuthenticated && watchlists ?
                          <Link to={`${watchlists.path}?symbol=${encodeURIComponent(item.symbol)}`}>Use in watchlist</Link> :
                          (!isAuthenticated || identity.data?.role === "trader") &&
                            <Link to={`/trades?symbol=${encodeURIComponent(item.symbol)}`}>Open Activity</Link>}
                      </>
                    )}
                  </li>
                ))
              ) : (
                <li>No symbols matched.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
