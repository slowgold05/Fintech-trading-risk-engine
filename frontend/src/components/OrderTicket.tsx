import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useSearchParams } from "react-router-dom";
import {
  normalizeOrderDecimal,
  previewOrder,
  type OrderPreviewPayload,
  type OrderPreviewResponse,
} from "../api/orderPreview";
import { createOrder } from "../api/orders";
import { useToast } from "../context/useToast";
import { formatDateTime } from "../utils/format";
import type { OrderResponse, TradeSide } from "../types/schemas";
import {
  clearPersistedOrderAttempt,
  readPersistedOrderAttempt,
  writePersistedOrderAttempt,
  type PersistedAttempt,
} from "../utils/orderAttemptStorage";

type OrderType = OrderPreviewPayload["order_type"];

type FieldErrors = {
  symbol?: string;
  quantity?: string;
  limitPrice?: string;
  stepUp?: string;
};

type DraftValues = {
  symbol: string;
  quantity: string;
  limitPrice: string;
  side: TradeSide;
  orderType: OrderType;
};

const inputClass = "field-control min-h-11 w-full min-w-0 placeholder:text-slate-400";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-300";

function formatExactDecimal(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const dotIndex = unsigned.indexOf(".");
  const whole = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fraction = dotIndex === -1 ? "" : unsigned.slice(dotIndex);
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${groupedWhole}${fraction}`;
}

function formatExactMoney(value: string): string {
  const negative = value.startsWith("-");
  const grouped = formatExactDecimal(negative ? value.slice(1) : value);
  return negative ? `-$${grouped}` : `$${grouped}`;
}

function displayDecimal(value: string | null): string {
  if (value === null) return "Unavailable";
  return formatExactDecimal(value);
}

function displayMoney(value: string | null): string {
  if (value === null) return "Unavailable";
  return formatExactMoney(value);
}

function displayReservation(preview: OrderPreviewResponse): string {
  if (preview.side === "sell") return "Not applicable";
  return displayMoney(preview.initial_reservation);
}

function capturedIntentSummary(preview: OrderPreviewResponse): string {
  const sideLabel = preview.side === "buy" ? "Buy" : "Sell";
  const quantity = formatExactDecimal(preview.quantity);
  const typeLabel = preview.order_type === "limit" ? "limit" : "market";
  if (preview.order_type === "limit" && preview.limit_price !== null) {
    return `${sideLabel} ${quantity} ${preview.symbol} ${typeLabel} at ${formatExactMoney(preview.limit_price)}`;
  }
  return `${sideLabel} ${quantity} ${preview.symbol} ${typeLabel}`;
}

function isStatusWord(value: string): boolean {
  return value === "Unavailable" || value === "Not applicable";
}

function orderStatusMessage(result: OrderResponse): string {
  const matchCount = result.trade_ids?.length;
  if (matchCount) {
    return `Order ${result.status}; ${matchCount / 2} match(es).`;
  }
  return `Order ${result.status}.`;
}

function attemptFingerprint(payload: OrderPreviewPayload): string {
  return JSON.stringify({
    symbol: payload.symbol,
    side: payload.side,
    order_type: payload.order_type,
    quantity: payload.quantity,
    limit_price: payload.limit_price ?? null,
  });
}

function capturedFromPreview(preview: OrderPreviewResponse): OrderPreviewPayload {
  const payload: OrderPreviewPayload = {
    symbol: preview.symbol,
    side: preview.side,
    order_type: preview.order_type,
    quantity: preview.quantity,
  };
  if (preview.order_type === "limit" && preview.limit_price !== null) {
    payload.limit_price = preview.limit_price;
  }
  return payload;
}

function draftsMatch(preview: OrderPreviewResponse, draft: DraftValues): boolean {
  if (draft.symbol.trim().toUpperCase() !== preview.symbol) return false;
  if (draft.side !== preview.side || draft.orderType !== preview.order_type) return false;
  if (normalizeOrderDecimal(draft.quantity) !== preview.quantity) return false;
  if (preview.order_type === "market") return true;
  return normalizeOrderDecimal(draft.limitPrice) === preview.limit_price;
}

function isUnknownOutcome(error: unknown): boolean {
  if (!isAxiosError(error)) return true;
  const status = error.response?.status;
  if (status == null) return true;
  return status >= 500;
}

function isExplicitBusinessRejection(error: unknown): boolean {
  if (!isAxiosError(error) || error.response?.status !== 400) return false;
  const detail = error.response.data?.detail;
  return typeof detail === "string" && detail.trim() !== "";
}

function readDetail(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim() !== "") return detail;
  return fallback;
}

function initialSymbolFromSearch(search: URLSearchParams): string {
  const values = search.getAll("symbol");
  if (values.length !== 1) return "";
  const next = values[0].trim().toUpperCase();
  if (next.length < 1 || next.length > 20) return "";
  return next;
}

function readPreviewError(error: unknown): string {
  if (error instanceof Error && error.message === "Invalid order preview request") {
    return "The ticket could not be previewed. Check the symbol, quantity, and limit price.";
  }
  if (error instanceof Error && error.message === "Invalid order preview response") {
    return "The preview response could not be read. Earlier figures are hidden. Preview the order again.";
  }
  if (isAxiosError(error) && error.response && (error.response.status ?? 0) < 500) {
    return readDetail(error, "The preview was rejected. Check the ticket and preview again.");
  }
  return "The preview could not be refreshed. Earlier figures are hidden. Preview the order again.";
}

function PreviewFact({
  label,
  value,
  detail,
  mono = false,
}: {
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
}) {
  const useMono = mono && !isStatusWord(value);
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:items-baseline sm:gap-3">
      <dt className="text-sm text-slate-300">
        {label}
        {detail ? (
          <span className="mt-0.5 block text-sm leading-5 font-normal text-slate-300">
            {detail}
          </span>
        ) : null}
      </dt>
      <dd
        className={[
          "min-w-0 text-sm text-slate-100 sm:text-right",
          useMono ? "font-mono break-all tabular-nums" : "font-medium break-words",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

export function OrderTicket() {
  const [searchParams] = useSearchParams();
  // Read once on mount. An unresolved attempt seeds the ticket and its idempotency key.
  const [persistedAttempt] = useState(readPersistedOrderAttempt);
  const [side, setSide] = useState<TradeSide>(persistedAttempt?.preview.side ?? "buy");
  const [orderType, setOrderType] = useState<OrderType>(
    persistedAttempt?.preview.order_type ?? "limit",
  );
  const [symbol, setSymbol] = useState(
    persistedAttempt?.preview.symbol ?? initialSymbolFromSearch(searchParams),
  );
  const [quantity, setQuantity] = useState(persistedAttempt?.preview.quantity ?? "");
  const [limitPrice, setLimitPrice] = useState(
    persistedAttempt?.preview.limit_price ?? "",
  );
  const [stepUpCode, setStepUpCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<OrderPreviewResponse | null>(
    persistedAttempt?.preview ?? null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewConfirmable, setPreviewConfirmable] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(persistedAttempt !== null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirmMutation = useMutation({
    mutationFn: createOrder,
    retry: false,
  });

  const attemptRef = useRef<PersistedAttempt | null>(persistedAttempt?.attempt ?? null);
  const previewRevisionRef = useRef(0);
  const confirmGenerationRef = useRef(0);
  const confirmLockRef = useRef(false);
  const mountedRef = useRef(true);
  const previewRef = useRef<OrderPreviewResponse | null>(null);
  const previewConfirmableRef = useRef(false);
  const outcomeUnknownRef = useRef(false);
  const stepUpCodeRef = useRef("");
  const draftRef = useRef<DraftValues>({
    symbol: "",
    quantity: "",
    limitPrice: "",
    side: "buy",
    orderType: "limit",
  });

  const draft: DraftValues = { symbol, quantity, limitPrice, side, orderType };
  // Handlers read these refs to see the latest committed values. Sync them at commit,
  // before any handler can run, so a discarded render never leaks into a confirmation.
  useLayoutEffect(() => {
    draftRef.current = draft;
    previewRef.current = preview;
    previewConfirmableRef.current = previewConfirmable;
    outcomeUnknownRef.current = outcomeUnknown;
    stepUpCodeRef.current = stepUpCode;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewRevisionRef.current += 1;
      confirmGenerationRef.current += 1;
    };
  }, []);

  const financialLocked = confirmPending || outcomeUnknown;
  const draftIsCurrent = preview !== null && draftsMatch(preview, draft);
  const stepUpKnown = typeof preview?.step_up_required === "boolean";
  const showConfirm =
    preview?.status === "eligible" &&
    previewConfirmable &&
    draftIsCurrent &&
    stepUpKnown &&
    !outcomeUnknown;
  const showStepUp =
    preview?.step_up_required === true && (showConfirm || outcomeUnknown || confirmPending);

  function invalidateFinancialDraft(patch: Partial<DraftValues>) {
    if (confirmPending || outcomeUnknown) return;
    previewRevisionRef.current += 1;
    previewRef.current = null;
    previewConfirmableRef.current = false;
    attemptRef.current = null;
    stepUpCodeRef.current = "";
    setPreview(null);
    setPreviewError(null);
    setPreviewPending(false);
    setPreviewConfirmable(false);
    setConfirmError(null);
    setSuccessMessage(null);
    setFieldErrors({});
    setStepUpCode("");
    if (patch.symbol !== undefined) setSymbol(patch.symbol);
    if (patch.quantity !== undefined) setQuantity(patch.quantity);
    if (patch.limitPrice !== undefined) setLimitPrice(patch.limitPrice);
    if (patch.side !== undefined) setSide(patch.side);
    if (patch.orderType !== undefined) setOrderType(patch.orderType);
  }

  function updateStepUpCode(value: string) {
    const next = value.replace(/\D/g, "").slice(0, 6);
    stepUpCodeRef.current = next;
    setStepUpCode(next);
    setFieldErrors((current) => (current.stepUp ? { ...current, stepUp: undefined } : current));
  }

  function validateDraft(values: DraftValues): OrderPreviewPayload | null {
    const errors: FieldErrors = {};
    const nextSymbol = values.symbol.trim().toUpperCase();
    if (nextSymbol === "" || nextSymbol.length > 20) {
      errors.symbol = "Enter a symbol of up to 20 characters.";
    }
    const nextQuantity = normalizeOrderDecimal(values.quantity);
    if (nextQuantity === null) {
      errors.quantity = "Enter a quantity greater than zero, with up to 6 decimal places.";
    }
    let nextLimit: string | null = null;
    if (values.orderType === "limit") {
      nextLimit = normalizeOrderDecimal(values.limitPrice);
      if (nextLimit === null) {
        errors.limitPrice = "Enter a limit price greater than zero, with up to 6 decimal places.";
      }
    }
    setFieldErrors(errors);
    if (
      nextSymbol === "" ||
      nextSymbol.length > 20 ||
      nextQuantity === null ||
      (values.orderType === "limit" && nextLimit === null)
    ) {
      return null;
    }
    const payload: OrderPreviewPayload = {
      symbol: nextSymbol,
      side: values.side,
      order_type: values.orderType,
      quantity: nextQuantity,
    };
    if (values.orderType === "limit" && nextLimit !== null) {
      payload.limit_price = nextLimit;
    }
    return payload;
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmPending || outcomeUnknown) return;
    const payload = validateDraft(draftRef.current);
    if (payload === null) return;

    const requestRevision = ++previewRevisionRef.current;
    previewRef.current = null;
    setPreviewPending(true);
    setPreview(null);
    setPreviewConfirmable(false);
    setPreviewError(null);
    setConfirmError(null);
    setSuccessMessage(null);

    try {
      const result = await previewOrder(payload);
      if (!mountedRef.current || requestRevision !== previewRevisionRef.current) return;
      previewRef.current = result;
      setPreview(result);
      setPreviewConfirmable(
        result.status === "eligible" && typeof result.step_up_required === "boolean",
      );
    } catch (error) {
      if (!mountedRef.current || requestRevision !== previewRevisionRef.current) return;
      previewRef.current = null;
      setPreview(null);
      setPreviewConfirmable(false);
      setPreviewError(readPreviewError(error));
    } finally {
      if (mountedRef.current && requestRevision === previewRevisionRef.current) {
        setPreviewPending(false);
      }
    }
  }

  function ensureAttempt(payload: OrderPreviewPayload): PersistedAttempt {
    const fingerprint = attemptFingerprint(payload);
    const current = attemptRef.current;
    if (current && current.fingerprint === fingerprint) return current;
    const created: PersistedAttempt = {
      fingerprint,
      payload,
      key: crypto.randomUUID(),
    };
    attemptRef.current = created;
    return created;
  }

  async function submitConfirmation(retry: boolean) {
    if (confirmLockRef.current) return;
    confirmLockRef.current = true;
    let generation = 0;
    let requestStarted = false;
    let confirmed = false;

    try {
      const accepted = previewRef.current;
      if (accepted === null || accepted.status !== "eligible") return;
      if (typeof accepted.step_up_required !== "boolean") return;
      if (retry) {
        if (!outcomeUnknownRef.current || attemptRef.current === null) return;
      } else if (!previewConfirmableRef.current || !draftsMatch(accepted, draftRef.current)) {
        return;
      }

      let code: string | undefined;
      if (accepted.step_up_required) {
        const currentCode = stepUpCodeRef.current.trim();
        if (!/^\d{6}$/.test(currentCode)) {
          setFieldErrors((current) => ({
            ...current,
            stepUp: "Enter the current six-digit authenticator code.",
          }));
          return;
        }
        code = currentCode;
      }

      const attempt = retry ? attemptRef.current : ensureAttempt(capturedFromPreview(accepted));
      if (attempt === null) return;

      generation = ++confirmGenerationRef.current;
      requestStarted = true;
      setConfirmPending(true);
      setConfirmError(null);

      let result: OrderResponse;
      try {
        result = await confirmMutation.mutateAsync({
          symbol: attempt.payload.symbol,
          side: attempt.payload.side,
          order_type: attempt.payload.order_type,
          quantity: attempt.payload.quantity,
          ...(attempt.payload.limit_price !== undefined
            ? { limit_price: attempt.payload.limit_price }
            : {}),
          idempotencyKey: attempt.key,
          ...(code !== undefined ? { stepUpCode: code } : {}),
        });
      } catch (error) {
        if (!mountedRef.current || generation !== confirmGenerationRef.current) return;
        // A retry can fail before the server reads a stored success. Only an explicit
        // business 400 may release that attempt; other HTTP errors stay unresolved.
        const definitiveRejection = retry
          ? isExplicitBusinessRejection(error)
          : !isUnknownOutcome(error);
        if (!definitiveRejection) {
          outcomeUnknownRef.current = true;
          previewConfirmableRef.current = false;
          setOutcomeUnknown(true);
          setPreviewConfirmable(false);
          setSuccessMessage(null);
          writePersistedOrderAttempt({ attempt, preview: accepted });
          return;
        }
        attemptRef.current = null;
        outcomeUnknownRef.current = false;
        previewConfirmableRef.current = false;
        clearPersistedOrderAttempt();
        setOutcomeUnknown(false);
        setPreviewConfirmable(false);
        setSuccessMessage(null);
        setConfirmError(readDetail(error, "The order was rejected."));
        return;
      }

      if (!mountedRef.current || generation !== confirmGenerationRef.current) return;
      attemptRef.current = null;
      stepUpCodeRef.current = "";
      outcomeUnknownRef.current = false;
      previewConfirmableRef.current = false;
      clearPersistedOrderAttempt();
      setStepUpCode("");
      setOutcomeUnknown(false);
      setPreviewConfirmable(false);
      setFieldErrors((current) => (current.stepUp ? { ...current, stepUp: undefined } : current));
      const message = orderStatusMessage(result);
      confirmed = true;
      setSuccessMessage(message);
      try {
        showToast("success", message);
      } catch {
        // The server status is already on the ticket. A toast failure is not an order outcome.
      }
    } finally {
      confirmLockRef.current = false;
      if (requestStarted && mountedRef.current && generation === confirmGenerationRef.current) {
        setConfirmPending(false);
      }
    }

    if (!confirmed || !mountedRef.current || generation !== confirmGenerationRef.current) return;
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["risk"] }),
      ]);
    } catch {
      // The order response is already known. A later list refresh is not an unknown outcome.
    }
  }

  const sideButtonClass = (selected: boolean, tone: "buy" | "sell") =>
    [
      "flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold tracking-wide transition-colors duration-200",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      tone === "buy"
        ? "focus-visible:outline-emerald-300"
        : "focus-visible:outline-rose-300",
      selected
        ? tone === "buy"
          ? "bg-emerald-400 text-slate-950"
          : "bg-rose-400 text-slate-950 hover:bg-rose-300"
        : tone === "buy"
          ? "border border-slate-700 bg-slate-900/60 text-slate-300 hover:border-emerald-400/50 hover:text-emerald-300"
          : "border border-slate-700 bg-slate-900/60 text-slate-300 hover:border-rose-400/50 hover:text-rose-300",
    ].join(" ");

  const quoteObserved =
    preview === null
      ? "Unavailable"
      : preview.quote_observed_at === null
        ? "Unavailable"
        : formatDateTime(preview.quote_observed_at);

  return (
    <form
      aria-busy={previewPending || confirmPending}
      className="min-w-0 space-y-4"
      noValidate
      onSubmit={(event) => {
        void handlePreview(event);
      }}
    >
      <fieldset disabled={financialLocked}>
        <legend className={labelClass}>Side</legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            aria-label="Buy"
            aria-pressed={side === "buy"}
            className={sideButtonClass(side === "buy", "buy")}
            disabled={financialLocked}
            onClick={() => {
              if (side !== "buy") invalidateFinancialDraft({ side: "buy" });
            }}
            type="button"
          >
            <ArrowUp aria-hidden="true" className="size-4 shrink-0" weight="bold" />
            BUY
          </button>
          <button
            aria-label="Sell"
            aria-pressed={side === "sell"}
            className={sideButtonClass(side === "sell", "sell")}
            disabled={financialLocked}
            onClick={() => {
              if (side !== "sell") invalidateFinancialDraft({ side: "sell" });
            }}
            type="button"
          >
            <ArrowDown aria-hidden="true" className="size-4 shrink-0" weight="bold" />
            SELL
          </button>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className={labelClass}>Symbol</span>
          <input
            aria-describedby={fieldErrors.symbol ? "order-symbol-error" : undefined}
            aria-invalid={fieldErrors.symbol ? true : undefined}
            aria-label="Trade symbol"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            className={`${inputClass} font-mono uppercase`}
            disabled={financialLocked}
            id="order-symbol"
            maxLength={20}
            onChange={(event) =>
              invalidateFinancialDraft({
                symbol: event.target.value.toUpperCase().slice(0, 20),
              })
            }
            placeholder="AAPL"
            spellCheck={false}
            type="text"
            value={symbol}
          />
          {fieldErrors.symbol ? (
            <p className="mt-1.5 text-sm leading-6 text-rose-200" id="order-symbol-error" role="alert">
              {fieldErrors.symbol}
            </p>
          ) : null}
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>Quantity</span>
          <input
            aria-describedby={fieldErrors.quantity ? "order-quantity-error" : undefined}
            aria-invalid={fieldErrors.quantity ? true : undefined}
            aria-label="Trade quantity"
            autoComplete="off"
            className={`${inputClass} text-right font-mono`}
            disabled={financialLocked}
            id="order-quantity"
            inputMode="decimal"
            onChange={(event) => invalidateFinancialDraft({ quantity: event.target.value })}
            placeholder="100"
            spellCheck={false}
            type="text"
            value={quantity}
          />
          {fieldErrors.quantity ? (
            <p className="mt-1.5 text-sm leading-6 text-rose-200" id="order-quantity-error" role="alert">
              {fieldErrors.quantity}
            </p>
          ) : null}
        </label>
      </div>

      <label className="block min-w-0">
        <span className={labelClass}>Order type</span>
        <select
          aria-label="Order type"
          className={inputClass}
          disabled={financialLocked}
          id="order-type"
          onChange={(event) =>
            invalidateFinancialDraft({
              orderType: event.target.value === "market" ? "market" : "limit",
            })
          }
          value={orderType}
        >
          <option value="limit">Limit</option>
          <option value="market">Market</option>
        </select>
      </label>

      {orderType === "limit" ? (
        <label className="block min-w-0">
          <span className={labelClass}>Limit price</span>
          <input
            aria-describedby={fieldErrors.limitPrice ? "order-limit-error" : "order-limit-help"}
            aria-invalid={fieldErrors.limitPrice ? true : undefined}
            aria-label="Limit price"
            autoComplete="off"
            className={`${inputClass} text-right font-mono`}
            disabled={financialLocked}
            id="order-limit-price"
            inputMode="decimal"
            onChange={(event) => invalidateFinancialDraft({ limitPrice: event.target.value })}
            placeholder="150.00"
            spellCheck={false}
            type="text"
            value={limitPrice}
          />
          {fieldErrors.limitPrice ? (
            <p className="mt-1.5 text-sm leading-6 text-rose-200" id="order-limit-error" role="alert">
              {fieldErrors.limitPrice}
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-6 text-slate-300" id="order-limit-help">
              Required for a limit order.
            </p>
          )}
        </label>
      ) : (
        <p className="text-sm leading-6 text-slate-300">
          Market orders do not set a limit price.
        </p>
      )}

      <p className="text-sm leading-6 text-slate-300">
        Paper orders fill at matched order prices. Cached quotes can be delayed.{" "}
        {orderType === "market"
          ? "Unfilled market quantity is canceled."
          : "Unfilled limit quantity rests."}
      </p>

      {previewError ? (
        <p className="text-sm leading-6 text-rose-200" id="order-preview-error" role="alert">
          {previewError}
        </p>
      ) : null}

      {preview ? (
        <div className="border-t border-slate-800 pt-5">
          <h3 className="text-base font-semibold tracking-tight text-slate-100">Order preview</h3>
          <p className="mt-1 text-sm leading-6 text-slate-100">{capturedIntentSummary(preview)}</p>
          <div className="mt-1 space-y-2">
            {successMessage ? (
              <>
                <p className="text-sm leading-6 font-medium text-emerald-300" role="status">
                  {successMessage}
                </p>
                <p className="text-sm leading-6 text-slate-300">
                  The figures below are the earlier preview, not an execution report.
                </p>
              </>
            ) : null}
            {outcomeUnknown ? (
              <p className="text-sm leading-6 text-slate-100" id="order-unknown-outcome" role="status">
                The outcome of this order is unknown. It is not marked failed or filled. Retry the
                same order to reuse this attempt. The ticket stays locked until it resolves.
              </p>
            ) : null}
            {confirmError ? (
              <p className="text-sm leading-6 text-rose-200" id="order-confirm-error" role="alert">
                {confirmError} Adjust the ticket and preview the order again before confirming.
              </p>
            ) : null}
            {!successMessage && !outcomeUnknown && !confirmError && !confirmPending && preview.status === "eligible" && showConfirm ? (
              <p className="text-sm leading-6 font-medium text-emerald-300" role="status">
                Preview ready
              </p>
            ) : null}
            {!successMessage && !outcomeUnknown && preview.status !== "eligible" ? (
              <>
                <p className="text-sm leading-6 text-rose-200" role="status">
                  {preview.reason}
                </p>
                <p className="text-sm leading-6 text-slate-300">
                  This preview cannot be confirmed. Adjust the ticket and preview again.
                </p>
              </>
            ) : null}
            {!successMessage &&
            !outcomeUnknown &&
            !confirmError &&
            preview.status === "eligible" &&
            !showConfirm ? (
              <p className="text-sm leading-6 text-slate-300" role="status">
                This preview can no longer be confirmed. Preview the order again.
              </p>
            ) : null}
          </div>

          <dl className="mt-3 divide-y divide-slate-800 border-t border-slate-800">
            <PreviewFact label="Buying power" mono value={displayMoney(preview.buying_power)} />
            <PreviewFact
              label="Shares available to sell"
              mono
              value={displayDecimal(preview.sell_available)}
            />
            <PreviewFact
              detail="Cash set aside for this order. This is not the estimated fill spend."
              label="Initial reservation"
              mono
              value={displayReservation(preview)}
            />
            <PreviewFact
              label="Estimated fill quantity"
              mono
              value={displayDecimal(preview.estimated_fill_quantity)}
            />
            <PreviewFact
              label="Estimated fill notional"
              mono
              value={displayMoney(preview.estimated_fill_notional)}
            />
            <PreviewFact
              label="Unfilled quantity"
              mono
              value={displayDecimal(preview.unfilled_quantity)}
            />
            <PreviewFact label="Account snapshot" value={formatDateTime(preview.read_at)} />
            <PreviewFact label="Quote observed" value={quoteObserved} />
          </dl>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            These estimates are not binding. The server rechecks the order when you confirm. Quote
            observed is not a live execution price.
          </p>
        </div>
      ) : null}

      {showStepUp ? (
        <label className="block min-w-0">
          <span className={labelClass}>Authenticator code</span>
          <input
            aria-describedby={
              fieldErrors.stepUp ? "order-step-up-error" : "order-step-up-help"
            }
            aria-invalid={fieldErrors.stepUp ? true : undefined}
            aria-label="Authenticator code"
            autoComplete="one-time-code"
            className={`${inputClass} font-mono`}
            disabled={confirmPending}
            id="order-step-up"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => updateStepUpCode(event.target.value)}
            spellCheck={false}
            type="text"
            value={stepUpCode}
          />
          {fieldErrors.stepUp ? (
            <p className="mt-1.5 text-sm leading-6 text-rose-200" id="order-step-up-error" role="alert">
              {fieldErrors.stepUp}
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-6 text-slate-300" id="order-step-up-help">
              Enter the current six-digit code. It is sent only when you confirm. The server decides
              whether that code is accepted.
            </p>
          )}
        </label>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          aria-label="Preview order"
          className={
            showConfirm || outcomeUnknown
              ? "min-h-11 w-full rounded-xl border border-slate-400 bg-slate-900 text-sm font-semibold text-slate-100 hover:border-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              : "primary-action min-h-11 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          }
          disabled={previewPending || confirmPending || outcomeUnknown}
          type="submit"
        >
          {previewPending ? "Previewing…" : "Preview order"}
        </button>
        {outcomeUnknown ? (
          <button
            aria-label="Retry same order"
            className={[
              "primary-action min-h-11 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50",
              side === "sell"
                ? "!bg-rose-400 !text-slate-950 hover:!bg-rose-300 focus-visible:!outline-rose-300"
                : "",
            ].join(" ")}
            disabled={confirmPending}
            onClick={() => {
              void submitConfirmation(true);
            }}
            type="button"
          >
            {confirmPending ? "Retrying…" : "Retry same order"}
          </button>
        ) : null}
        {showConfirm ? (
          <button
            aria-label="Confirm paper order"
            className={[
              "primary-action min-h-11 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50",
              side === "sell"
                ? "!bg-rose-400 !text-slate-950 hover:!bg-rose-300 focus-visible:!outline-rose-300"
                : "",
            ].join(" ")}
            disabled={confirmPending}
            onClick={() => {
              void submitConfirmation(false);
            }}
            type="button"
          >
            {confirmPending ? "Confirming…" : "Confirm paper order"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
