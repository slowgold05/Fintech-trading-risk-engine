import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { resetDemoPortfolio, fetchPortfolio } from "../../../api/portfolio";
import { clearPersistedOrderAttempt } from "../../../utils/orderAttemptSlot";
import { formatCurrency } from "../../../utils/format";
import { keys, refreshExecution } from "../../api";
import { Button, Sheet } from "../../kit";
import { saveDraft } from "../../shell/ticketDraft";
import { setGuide } from "./guideState";

export function DemoReset({ owner }: { owner: number }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reset = useMutation({
    mutationFn: resetDemoPortfolio, retry: false,
    onSuccess: async () => {
      attempt.current = null;
      saveDraft(owner, null);
      clearPersistedOrderAttempt(owner);
      setGuide(owner, "new");
      setOpen(false);
      setMessage("Demo restored. Refreshing balances…");
      await refreshExecution(client, owner, true);
      try {
        const result = await client.fetchQuery({queryKey:keys.account(owner,"portfolio"),queryFn:fetchPortfolio,staleTime:0});
        setMessage("Demo restored. Cash " + formatCurrency(result.summary.cash_balance) + " · Buying power " + formatCurrency(result.summary.buying_power) + ".");
      } catch { setMessage("Demo restored. The updated balances could not be loaded."); }
    },
    onError: err => {
      const detail = isAxiosError(err) ? err.response?.data?.detail : null;
      if (isAxiosError(err) && err.response && err.response.status < 500) attempt.current = null;
      setError(typeof detail === "string" ? detail : "Reset could not be confirmed. Try again to check the same request.");
    },
  });
  function confirm() {
    if (reset.isPending) return;
    setError("");
    attempt.current ??= crypto.randomUUID();
    reset.mutate(attempt.current);
  }
  return <>
    <Button data-testid="demo-reset" busy={reset.isPending} onClick={event => {
      opener.current = event.currentTarget;
      setError("");
      setMessage("");
      setOpen(true);
    }}>Reset demo portfolio…</Button>
    {message && <p role="status">{message}</p>}
    <Sheet open={open} returnFocusRef={opener} onOpenChange={value => {if (!reset.isPending) setOpen(value);}} title="Restore starting portfolio">
      <p>This restores the demo’s seed cash, holdings and trading history and restarts the guide. Cancel open orders in Activity before resetting.</p>
      {error && <p className="account-error" role="alert">{error}</p>}
      <div className="account-actions"><Button variant="danger" data-testid="demo-reset-confirm" busy={reset.isPending} onClick={confirm}>Confirm reset</Button>
        {!reset.isPending && <Link className="nk-button" to="/trades">Review orders in Activity</Link>}</div>
    </Sheet>
  </>;
}
