import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { X } from "@phosphor-icons/react";
import { useAuth } from "../context/useAuth";
import { fetchMe } from "../api/auth";
import { fetchMarketUniverse } from "../api/market";
import { features } from "../night/registry";
import { keys } from "../night/api";
import { hasCompanyDetail } from "../night/features/discover/companyLookup";

export function MarketSearchResults({ term, onClose }: { term: string; onClose: () => void }) {
  const { isAuthenticated } = useAuth();
  const identity = useQuery({
    queryKey: keys.me, queryFn: fetchMe, enabled: isAuthenticated && !!term, retry: false,
  });
  const viewer = isAuthenticated ? identity.data?.id : "public";
  const ready = viewer !== undefined;
  const watchlists = features.find((item) => item.id === "watchlists");
  const results = useQuery({
    queryKey: keys.universe(viewer ?? "public", term, 20),
    queryFn: () => fetchMarketUniverse(term),
    enabled: term.length > 0 && ready,
    retry: false,
  });
  return (
    <div className="symbol-results">
      <div className="results-heading">
        <span>Symbol lookup</span>
        <button
          aria-label="Close results"
          type="button"
          onClick={onClose}
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
  );
}
