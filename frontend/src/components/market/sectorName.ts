/** The stock cache spells out the discretionary sector; the ETF feed abbreviates it. */
export function sectorName(name?: string | null) {
  return name === "Consumer Disc." ? "Consumer Discretionary" : (name ?? null);
}
