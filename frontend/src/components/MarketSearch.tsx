import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MagnifyingGlass, ArrowRight, X } from "@phosphor-icons/react";
import { useAuth } from "../context/useAuth";
import { fetchMe } from "../api/auth";
import { keys } from "../night/api";
import { fetchMarketUniverse } from "../api/market";

export function MarketSearch({ compact = false }: { compact?: boolean } = {}) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = submitted.trim();
  const { isAuthenticated } = useAuth();
  const identity = useQuery({queryKey:keys.me,queryFn:() => fetchMe(),enabled:isAuthenticated && !!term,retry:false});
  const results = useQuery({
    queryKey: keys.universe(identity.data?.id ?? "public",term,20),
    queryFn: () => fetchMarketUniverse(term),
    enabled: term.length > 0 && (!isAuthenticated || identity.isSuccess),
    retry: false,
  });
  useEffect(() => {
    if (!term) return;
    function dismiss(e: PointerEvent) {
      if (e.target instanceof Node && !form.current?.contains(e.target)) setSubmitted("");
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [term]);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(draft);
  }
  return (
    <form
      ref={form}
      className="symbol-search market-search"
      role="search"
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && term) {
          e.stopPropagation();
          setSubmitted("");
          input.current?.focus();
        }
      }}
    >
      <label className="sr-only" htmlFor="market-symbol-search">
        Search symbols
      </label>
      <MagnifyingGlass aria-hidden="true" size={17} />
      <input
        ref={input}
        id="market-symbol-search" data-testid="market-search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
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
                setSubmitted("");
                input.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          {results.isPending && <p role="status">Searching symbols…</p>}
          {results.isError && <p role="alert">Symbol search is unavailable.</p>}
          {results.data && (
            <ul aria-label="Search results">
              {results.data.items.length ? (
                results.data.items.map((item) => (
                  <li key={item.symbol}>
                    {("detail_available" in item ? item.detail_available === false : !item.in_featured_universe && !["SPY","QQQ","DIA","IWM"].includes(item.symbol)) ? <span><strong>{item.symbol}</strong> {item.company_name} · {item.universe_label || "Outside S&P 500"} · Detail unavailable</span> : <Link data-testid={`search-result-${item.symbol}`} to={`/market/${encodeURIComponent(item.symbol)}`}>
                      <strong>{item.symbol}</strong>
                      <span>{item.company_name}</span>
                      {!item.in_featured_universe && (
                        <small>{item.universe_label || "Outside S&P 500"}</small>
                      )}
                    </Link>}
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
