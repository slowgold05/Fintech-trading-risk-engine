import { lazy, Suspense, type FormEvent, useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlass, ArrowRight } from "@phosphor-icons/react";
import "./MarketSearch.css";

const MarketSearchResults = lazy(() => import("./MarketSearchResults").then(module => ({ default: module.MarketSearchResults })));

export function MarketSearch({ compact = false }: { compact?: boolean } = {}) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextLookup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const uniqueId = useId();
  const inputId = compact ? "market-symbol-search" : uniqueId;
  const term = submitted.trim();
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
        <Suspense fallback={<div className="symbol-results"><p role="status">Searching symbols…</p></div>}>
          <MarketSearchResults term={term} onClose={() => { closeResults(); input.current?.focus(); }} />
        </Suspense>
      )}
    </form>
  );
}
