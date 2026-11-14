export const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const preciseCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
});

export const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number, precise = true) {
  return (precise ? preciseCurrencyFormatter : compactCurrencyFormatter).format(
    value,
  );
}

export function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

export function formatQuantity(value: number) {
  return quantityFormatter.format(value);
}

export function formatDateTime(value: string | number | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const ISO_WITH_EXPLICIT_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i;

const utcDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

export function formatUtcDateTime(value: string | null | undefined): string | null {
  if (value == null || !ISO_WITH_EXPLICIT_ZONE.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return utcDateTimeFormatter.format(new Date(parsed));
}

export function formatSignedPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatPercent(value)}`;
}
