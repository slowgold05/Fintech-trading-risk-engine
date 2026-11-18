import { type FormEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MagnifyingGlass, ArrowRight, X } from "@phosphor-icons/react";
import { fetchMarketUniverse } from "../api/market";

export function MarketSearch() {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = submitted.trim();
  const results = useQuery({
    queryKey: ["market", "universe", term],
    queryFn: () => fetchMarketUniverse(term),
    enabled: term.length > 0,
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
      className="symbol-search"
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
        id="market-symbol-search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Search company or ticker"
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
                    <Link to={`/market/${encodeURIComponent(item.symbol)}`}>
                      <strong>{item.symbol}</strong>
                      <span>{item.company_name}</span>
                      {!item.in_featured_universe && (
                        <small>{item.universe_label || "Outside S&P 500"}</small>
                      )}
                    </Link>
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
