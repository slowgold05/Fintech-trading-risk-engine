/**
 * The daily-history provider is chosen in one place. The hosted site keeps the default;
 * a local database loaded from another provider sets VITE_HISTORY_PROVIDER in .env.local.
 */
const configured = (import.meta.env.VITE_HISTORY_PROVIDER as string | undefined)?.trim();

export const HISTORY_PROVIDER = configured || "massive";
export const HISTORY_ADJUSTMENT = "split_adjusted";

const PROVIDER_NAMES: Record<string, string> = {
  massive: "Massive",
  yahoo: "Yahoo Finance",
};

export function historyProviderName(provider: string = HISTORY_PROVIDER) {
  return PROVIDER_NAMES[provider] ?? provider.replace(/[_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

/** Example: "Yahoo Finance split-adjusted daily closes". */
export function historySourceLabel(provider: string = HISTORY_PROVIDER, adjustment: string = HISTORY_ADJUSTMENT) {
  const basis = adjustment === "split_adjusted" ? "split-adjusted" : adjustment.replace(/_/g, " ");
  return `${historyProviderName(provider)} ${basis} daily closes`;
}
