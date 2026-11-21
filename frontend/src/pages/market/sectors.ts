import { sectorKey } from "../../ui/lib";

/** Reading order of the sectors, shared by the dial, the heat map and the breadth chart. */
export const SECTOR_ORDER = [
  "Technology",
  "Communication",
  "Consumer Discretionary",
  "Consumer Staples",
  "Financials",
  "Healthcare",
  "Industrials",
  "Energy",
  "Utilities",
  "Real Estate",
  "Materials",
];

const ORDER_KEYS = SECTOR_ORDER.map((name) => sectorKey(name));

const CODES: Record<string, string> = {
  technology: "TECH",
  communication: "COMM",
  "consumer-discretionary": "DISC",
  "consumer-staples": "STPL",
  financials: "FIN",
  healthcare: "HLTH",
  industrials: "INDU",
  energy: "ENGY",
  utilities: "UTIL",
  "real-estate": "REIT",
  materials: "MATL",
};

export function sectorRank(name: string) {
  const index = ORDER_KEYS.indexOf(sectorKey(name));
  return index === -1 ? ORDER_KEYS.length : index;
}

export function sectorCode(name: string) {
  return CODES[sectorKey(name)] ?? name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
}

export function companyName(name: string) {
  return name.replace(/ - (Common Stock|Class [A-Z] Common Stock|Ordinary Shares).*$/i, "");
}
