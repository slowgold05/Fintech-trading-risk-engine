import { useQuery } from "@tanstack/react-query";
import { fetchCachedSeries } from "../../api/history";

/** Prefer the original provider when stored, otherwise use an explicitly adjusted catalog series. */
export function useAdjustedProvider() {
  const catalog = useQuery({
    queryKey: ["market", "cachedseries"],
    queryFn: fetchCachedSeries,
    retry: false,
    staleTime: 300000,
  });
  const adjusted = catalog.data?.canonical_history?.series?.filter(
    (s) => s.adjustment_type === "split_adjusted" && s.provider,
  );
  const series = adjusted?.find((s) => s.provider === "massive") ?? adjusted?.[0];
  return {
    provider: series?.provider,
    rowCount: series?.row_count,
    pending: catalog.isPending,
  };
}
