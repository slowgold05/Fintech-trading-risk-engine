import { useLook } from "../../night/looks/preferences";
import { useQuery } from "@tanstack/react-query";
import { fetchCachedSeries } from "../../api/history";

/** Prefer the original provider when stored, otherwise use an explicitly adjusted catalog series. */
export function useAdjustedProvider() {
  const { prefs } = useLook();
  const catalog = useQuery({
    queryKey: ["market", "data-status"],
    queryFn: fetchCachedSeries,
    retry: false,
    staleTime: 300000,
  });
  const adjusted = catalog.data?.canonical_history?.series?.filter(
    (s) => s.adjustment_type === "split_adjusted" && s.provider,
  );
  const series = prefs.historyProvider === "auto"
    ? adjusted?.find(s => s.provider === (catalog.data?.scheduled_history_provider ?? "massive")) ?? adjusted?.[0]
    : adjusted?.find(s => s.provider === prefs.historyProvider);
  return {
    provider: series?.provider,
    rowCount: series?.row_count,
    pending: catalog.isPending,
  };
}
