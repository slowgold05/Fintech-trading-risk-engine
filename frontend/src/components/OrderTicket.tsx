import { loadDraft, saveDraft } from "../night/shell/ticketDraft";
import { refreshExecution } from "../night/api";
import { previewTradeImpact } from "../api/tradeImpact";
import { fetchSymbolQuote } from "../api/market";
import type { TradeImpactResponse } from "../types/schemas";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Button, Field, State } from "../night/kit";
import { useSearchParams } from "react-router-dom";
import {
  normalizeOrderDecimal,
  previewOrder,
  type OrderPreviewPayload,
  type OrderPreviewResponse,
} from "../api/orderPreview";
import { createOrder } from "../api/orders";
import { useToast } from "../context/useToast";
import { formatUtcDateTime, simulatedLiquidityLabel } from "../utils/format";
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
  return `Order ${result.status}.`;
}

function capturedFromPreview(preview: OrderPreviewResponse): PersistedAttempt["payload"] {
  const payload: PersistedAttempt["payload"] = {
    symbol: preview.symbol,
    side: preview.side,
    order_type: preview.order_type,
    quantity: preview.quantity,
  };
  if (preview.order_type === "limit" && preview.limit_price !== null) {
    payload.limit_price = preview.limit_price;
  }
  if (preview.quote_observed_at !== null) {
    payload.expected_quote_observed_at = preview.quote_observed_at;
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

function isDefinitiveRejection(error: unknown, replay: boolean): boolean {
  if (!isAxiosError(error) || !error.response) return false;
  const { status, data } = error.response;
  if (status === 503) {
    return data?.detail === "Usable reference quote unavailable (SM-PT-02)"
      || data?.detail === "Trading is halted (SM-PT-01)";
  }
  if (replay) {
    // A replay can meet auth, throttling or conflict before reading a stored success.
    return status === 400 && typeof data?.detail === "string" && data.detail.trim() !== "";
  }
  return status >= 400 && status < 500;
}

function readableReason(reason: string, quoteObserved?: string | null): string {
  if (reason === "Usable reference quote unavailable (SM-PT-02)") {
    return quoteObserved === null
      ? "No usable cached quote is available for this symbol."
      : "The cached quote is stale or unavailable.";
  }
  if (reason === "Trading is halted (SM-PT-01)") return "Order entry is paused while trading is halted.";
  if (reason === "Idempotency key was used for a different request") {
    return "This submission conflicts with an existing order attempt. Check Activity for its outcome.";
  }
  return reason;
}

function readDetail(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() !== "" ? readableReason(detail) : fallback;
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

function PreviewFact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt>{label}{detail && <small>{detail}</small>}</dt>
      <dd className={isStatusWord(value) ? undefined : "execution-number"}>{value}</dd>
    </div>
  );
}

export function OrderTicket({ owner, onSubmitted }: {owner?: number; onSubmitted?: (id: number) => void} = {}) {
  const [searchParams] = useSearchParams();
  // Read once on mount. An unresolved attempt seeds the ticket and its idempotency key.
  const entrySymbol = initialSymbolFromSearch(searchParams);
  const [saved] = useState(() => {
    const draft = loadDraft(owner);
    if (!draft || !entrySymbol) return draft;
    const savedEntry = "entrySymbol" in draft ? draft.entrySymbol : draft.symbol;
    return entrySymbol === savedEntry ? draft : null;
  });
  const [impact,setImpact] = useState<TradeImpactResponse|null>(null);
  const [impactMessage,setImpactMessage] = useState("");
  const [persistedAttempt] = useState(() => readPersistedOrderAttempt(owner));
  const pendingPayload = persistedAttempt?.attempt.payload;
  const [side, setSide] = useState<TradeSide>(pendingPayload?.side ?? saved?.side ?? "buy");
  const [orderType, setOrderType] = useState<OrderType>(
    pendingPayload?.order_type ?? saved?.orderType ?? (owner ? "market" : "limit"),
  );
  const [symbol, setSymbol] = useState(
    pendingPayload?.symbol ?? saved?.symbol ?? entrySymbol,
  );
  const [quantity, setQuantity] = useState(pendingPayload?.quantity ?? saved?.quantity ?? (owner ? "1" : ""));
  const [limitPrice, setLimitPrice] = useState(
    pendingPayload?.limit_price ?? saved?.limitPrice ?? "",
  );
  const [stepUpCode, setStepUpCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<OrderPreviewResponse | null>(null);
  const [retryNeedsCode, setRetryNeedsCode] = useState(persistedAttempt?.stepUpRequired ?? false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewConfirmable, setPreviewConfirmable] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(persistedAttempt !== null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const symbolField = useRef<HTMLInputElement>(null);
  const stepUpField = useRef<HTMLInputElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!owner) return;
    if (persistedAttempt) {
      writePersistedOrderAttempt(persistedAttempt, owner);
      (persistedAttempt.stepUpRequired ? stepUpField.current : retryButton.current)?.focus();
    } else {
      symbolField.current?.focus();
    }
  }, [owner, persistedAttempt]);

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

  useEffect(() => {
    const draft = { symbol, quantity, side, orderType, limitPrice, entrySymbol };
    saveDraft(owner, draft);
  }, [owner, symbol, quantity, side, orderType, limitPrice, entrySymbol]);
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
    (preview?.step_up_required === true && (showConfirm || confirmPending)) ||
    (outcomeUnknown && retryNeedsCode);

  function invalidateFinancialDraft(patch: Partial<DraftValues>) {
    if (confirmLockRef.current || outcomeUnknownRef.current) return;
    previewRevisionRef.current += 1;
    previewRef.current = null;
    previewConfirmableRef.current = false;
    attemptRef.current = null;
    stepUpCodeRef.current = "";
    setPreview(null);
    setImpact(null);
    setImpactMessage("");
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
    if (confirmLockRef.current || outcomeUnknownRef.current) return;
    const payload = validateDraft(draftRef.current);
    if (payload === null) return;

    const requestRevision = ++previewRevisionRef.current;
    setImpact(null);
    setImpactMessage("Calculating estimated impact…");
    if (owner) void loadImpact(payload, requestRevision);
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

  async function loadImpact(payload: OrderPreviewPayload, revision: number) {
    try {
      const reference = payload.limit_price ?? (await fetchSymbolQuote(payload.symbol)).price;
      const price = reference === null ? null : normalizeOrderDecimal(String(reference));
      if (price === null) throw new Error("Missing reference price");
      const { symbol, side, order_type, quantity } = payload;
      const result = await previewTradeImpact({ symbol, side, order_type, quantity, reference_price: price });
      if (mountedRef.current && revision === previewRevisionRef.current) setImpact(result);
    } catch {
      if (mountedRef.current && revision === previewRevisionRef.current) {
        setImpactMessage("Estimated portfolio impact unavailable.");
      }
    }
  }

  async function submitConfirmation(retry: boolean) {
    if (confirmLockRef.current) return;
    const accepted = previewRef.current;
    const prior = attemptRef.current;
    if (retry) {
      if (!outcomeUnknownRef.current || prior === null) return;
    } else if (outcomeUnknownRef.current || !previewConfirmableRef.current ||
      accepted?.status !== "eligible" || !draftsMatch(accepted, draftRef.current) ||
      typeof accepted.step_up_required !== "boolean") {
      return;
    }

    const needsCode = retry ? retryNeedsCode : accepted?.step_up_required === true;
    const code = needsCode ? stepUpCodeRef.current.trim() : undefined;
    if (code !== undefined && !/^\d{6}$/.test(code)) {
      setFieldErrors((current) => ({ ...current, stepUp: "Enter the current six-digit authenticator code." }));
      return;
    }
    const attempt = retry ? prior : accepted && {
      payload: capturedFromPreview(accepted),
      key: crypto.randomUUID(),
    };
    if (attempt === null) return;

    const generation = ++confirmGenerationRef.current;
    const isActive = () => mountedRef.current && generation === confirmGenerationRef.current;
    attemptRef.current = attempt;
    confirmLockRef.current = true;
    setConfirmPending(true);
    setConfirmError(null);
    setSuccessMessage(null);
    // Record the request before sending it. A reload can occur while the server is committing.
    writePersistedOrderAttempt({ attempt, stepUpRequired: needsCode }, owner);

    let result: OrderResponse;
    try {
      result = await confirmMutation.mutateAsync({
        ...attempt.payload,
        idempotencyKey: attempt.key,
        ...(code === undefined ? {} : { stepUpCode: code }),
      });
    } catch (error) {
      if (!isActive()) return;
      previewConfirmableRef.current = false;
      setPreviewConfirmable(false);
      if (!isDefinitiveRejection(error, retry)) {
        outcomeUnknownRef.current = true;
        setOutcomeUnknown(true);
        setRetryNeedsCode(needsCode);
        if (retry && isAxiosError(error) && error.response?.status && error.response.status < 500) {
          setConfirmError(readDetail(error, "This retry did not resolve the order."));
        }
        return;
      }
      attemptRef.current = null;
      outcomeUnknownRef.current = false;
      clearPersistedOrderAttempt(owner);
      setOutcomeUnknown(false);
      previewRevisionRef.current += 1;
      previewRef.current = null;
      setPreview(null);
      setImpact(null);
      setImpactMessage("");
      updateStepUpCode("");
      setConfirmError(readDetail(error, "The order was rejected."));
      return;
    } finally {
      confirmLockRef.current = false;
      if (isActive()) setConfirmPending(false);
    }

    if (!isActive()) return;
    attemptRef.current = null;
    outcomeUnknownRef.current = false;
    previewConfirmableRef.current = false;
    clearPersistedOrderAttempt(owner);
    updateStepUpCode("");
    setOutcomeUnknown(false);
    setPreviewConfirmable(false);
    const message = orderStatusMessage(result);
    setSuccessMessage(message);
    if (onSubmitted) {
      saveDraft(owner, null);
      onSubmitted(result.id);
    } else {
      try {
        showToast("success", message);
      } catch {
        // The server acknowledgement already establishes the order outcome.
      }
    }
    const refresh = owner ? refreshExecution(queryClient, owner) : Promise.all(
      ["orders", "trades", "portfolio", "risk"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
    void refresh.catch(() => {
      // Receipt loading and list refresh have their own error states.
    });
  }

  return (
    <form data-testid="order-ticket" aria-label="Order ticket" aria-busy={previewPending || confirmPending}
      className="execution-ticket" noValidate onSubmit={(event) => { void handlePreview(event); }}>
      <fieldset className="execution-side" disabled={financialLocked}>
        <legend>Side</legend>
        <div>
          {(["buy", "sell"] as const).map((value) => (
            <Button key={value} aria-pressed={side === value} disabled={financialLocked}
              onClick={() => { if (side !== value) invalidateFinancialDraft({ side: value }); }}>
              {value === "buy" ? "Buy" : "Sell"}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="execution-ticket-inputs">
        <Field id="order-symbol" label="Symbol" error={fieldErrors.symbol}>
          <input ref={symbolField} aria-label="Trade symbol" autoCapitalize="characters" autoComplete="off" autoCorrect="off"
            className="execution-number" disabled={financialLocked} data-testid="order-symbol"
            maxLength={20} onChange={(event) => invalidateFinancialDraft({ symbol: event.target.value.toUpperCase() })}
            placeholder="AAPL" spellCheck={false} value={symbol} />
        </Field>
        <Field id="order-quantity" label="Quantity" error={fieldErrors.quantity}>
          <input aria-label="Trade quantity" autoComplete="off" className="execution-number"
            disabled={financialLocked} data-testid="order-quantity" inputMode="decimal"
            onChange={(event) => invalidateFinancialDraft({ quantity: event.target.value })}
            placeholder="1" spellCheck={false} value={quantity} />
        </Field>
        <Field id="order-type" label="Order type">
          <select aria-label="Order type" disabled={financialLocked} data-testid="order-type" value={orderType}
            onChange={(event) => invalidateFinancialDraft({ orderType: event.target.value === "market" ? "market" : "limit" })}>
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </Field>
        {orderType === "limit" && (
          <Field id="order-limit-price" label="Limit price" error={fieldErrors.limitPrice}>
            <input aria-label="Limit price" autoComplete="off" className="execution-number" disabled={financialLocked}
              data-testid="order-limit" inputMode="decimal"
              onChange={(event) => invalidateFinancialDraft({ limitPrice: event.target.value })}
              placeholder="150.00" spellCheck={false} value={limitPrice} />
          </Field>
        )}
      </div>
      <p className="execution-muted">
        {orderType === "market" ? "Unfilled market shares are canceled." : "Unfilled limit shares stay open."}
      </p>
      <Button data-testid="order-preview" aria-label="Preview order" type="submit"
        variant={showConfirm || outcomeUnknown ? "quiet" : "primary"}
        busy={previewPending} disabled={financialLocked}>
        {previewPending ? "Previewing…" : "Preview order"}
      </Button>
      {previewError && <State kind="error" title={previewError} role="alert" />}
      {outcomeUnknown && (
        <State kind="unavailable" title="The outcome of this order is unknown."
          detail="Retry the same order to check its outcome using the original submission." />
      )}
      {successMessage && <p role="status">{successMessage}</p>}
      {confirmError && (
        <p className="execution-error" role="alert">
          {confirmError} {!outcomeUnknown && "Preview the order again before confirming."}
        </p>
      )}
      {preview && !outcomeUnknown && !successMessage && (
        <section data-testid="order-preview-result" aria-label="Order preview" className="execution-preview">
          <h3>Order preview</h3>
          <p>{capturedIntentSummary(preview)}</p>
          {preview.status === "eligible" ? (
            !confirmError && <p role="status">{showConfirm ? "Preview ready" : "Preview the order again to confirm."}</p>
          ) : (
            <p className="execution-error" role="status">
              {readableReason(preview.reason ?? "Preview unavailable.", preview.quote_observed_at)}
            </p>
          )}
          <dl className="execution-facts">
            <PreviewFact label="Buying power" value={displayMoney(preview.buying_power)} />
            <PreviewFact label="Shares available to sell" value={displayDecimal(preview.sell_available)} />
            {preview.side === "buy" ? (
              <PreviewFact label="Initial reservation" value={displayMoney(preview.initial_reservation)} />
            ) : preview.order_type === "limit" && (
              <PreviewFact label="Estimated reserved shares" value={displayDecimal(preview.unfilled_quantity)}
                detail="For the portion estimated to remain open" />
            )}
            <PreviewFact label="Estimated fill quantity" value={displayDecimal(preview.estimated_fill_quantity)} />
            <PreviewFact label="Estimated fill notional" value={displayMoney(preview.estimated_fill_notional)} />
            <PreviewFact label="Unfilled quantity" value={displayDecimal(preview.unfilled_quantity)} />
            <PreviewFact label="Quote observed" value={formatUtcDateTime(preview.quote_observed_at) ?? "Unavailable"} />
          </dl>
          {!!preview.estimated_fills?.length && (
            <ul aria-label="Estimated executions">
              {preview.estimated_fills.map((fill, index) => (
                <li key={index}>
                  {formatExactDecimal(fill.quantity)} shares at {formatExactMoney(fill.execution_price)}{" "}
                  ({fill.counterparty === "simulated"
                    ? `${simulatedLiquidityLabel(fill.simulated_quote_date)} · ${fill.simulated_quote_source ?? "Provider unavailable"}`
                    : "Opposing paper order"})
                </li>
              ))}
            </ul>
          )}
          {preview.remainder_reason && <p>{preview.remainder_reason}</p>}
          {preview.status === "eligible" && <p className="execution-muted">Confirmation rechecks the order. Actual fills appear on the receipt.</p>}
        </section>
      )}
      {owner && impactMessage && !outcomeUnknown && !successMessage && (
        <section data-testid="order-impact" aria-label="Estimated portfolio impact" className="execution-preview">
          <h3>Estimated portfolio impact</h3>
          {impact ? (
            <>
              <dl className="execution-facts">
                <PreviewFact label="Cash (USD)" value={impactRange(impact.before.cash_balance, impact.after.cash_balance)} />
                <PreviewFact label="Position weight (%)" value={impactRange(impact.before.symbol_weight_pct, impact.after.symbol_weight_pct)} />
              </dl>
              <p className="execution-muted">
                Assumes all {formatExactDecimal(impact.quantity)} shares execute at {formatExactMoney(impact.reference_price)}.
                {impact.status === "incomplete" && " Some marks needed for position weights are unavailable."}
              </p>
              {impact.warnings.includes("insufficient_buying_power") && <p>Scenario exceeds available cash.</p>}
              {impact.warnings.includes("insufficient_shares") && <p>Scenario exceeds shares held.</p>}
            </>
          ) : <p role="status">{impactMessage}</p>}
        </section>
      )}
      {showStepUp && (
        <Field id="order-step-up" label="Authenticator code" error={fieldErrors.stepUp}
          hint={fieldErrors.stepUp ? undefined : "Enter the current six-digit code."}>
          <input ref={stepUpField} autoComplete="one-time-code" className="execution-number" disabled={confirmPending}
            inputMode="numeric" maxLength={6} onChange={(event) => updateStepUpCode(event.target.value)}
            spellCheck={false} type="text" value={stepUpCode} />
        </Field>
      )}
      {outcomeUnknown && (
        <button ref={retryButton} className="nk-button" data-variant="primary" type="button" disabled={confirmPending}
          aria-busy={confirmPending} aria-label="Retry same order" onClick={() => { void submitConfirmation(true); }}>
          {confirmPending ? "Retrying…" : "Retry same order"}
        </button>
      )}
      {showConfirm && (
        <Button variant="primary" data-testid="order-confirm" aria-label="Confirm paper order" busy={confirmPending}
          onClick={() => { void submitConfirmation(false); }}>
          {confirmPending ? "Confirming…" : "Confirm paper order"}
        </Button>
      )}
    </form>
  );
}

function impactRange(before: string | null, after: string | null) {
  return `${displayDecimal(before)} → ${displayDecimal(after)}`;
}
