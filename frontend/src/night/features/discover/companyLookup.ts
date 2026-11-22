import type { MarketUniverseItem } from "../../../types/schemas";

export function hasCompanyDetail(item: MarketUniverseItem & { detail_available?: boolean }) {
  // Wave 1's featured set contains the constituents and four supported index ETFs.
  return item.detail_available ?? (item.in_featured_universe || ["SPY", "QQQ", "DIA", "IWM"].includes(item.symbol));
}
