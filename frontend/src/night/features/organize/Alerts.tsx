import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "../../api";
import { Button, Field, Page, Panel, State } from "../../kit";
import { createAlert, deleteAlert, evaluateAlerts, fetchAlerts, type AlertRule, type CloseAlert } from "./alertsApi";
import { errorMessage } from "./errors";
import { Owner } from "./Owner";
import { ReadFailure } from "./ReadFailure";

type Change = { kind: "create"; rule: AlertRule } | { kind: "evaluate" } | { kind: "delete"; id: number };

function price(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return "$" + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction.replace(/0+$/, "").padEnd(2, "0");
}

function Observation({ alert, checked }: { alert: CloseAlert; checked: boolean }) {
  if (alert.last_date === null || alert.last_close === null) {
    return <p className="detail">{checked ? "No valid raw daily close was available for this symbol." : "No close recorded. Choose Evaluate closes to check."}</p>;
  }
  return <p>{alert.status === "triggered" ? "Triggered on" : "Last checked session"} <time>{alert.last_date}</time>
    {" · "}<strong className="figure">{price(alert.last_close)}</strong> raw close
    {" · "}<span className="detail">{alert.source?.provider ?? "Source unavailable"}</span></p>;
}

function AlertBook({ owner }: { owner: number }) {
  const client = useQueryClient();
  const key = keys.account(owner, "alerts");
  const alerts = useQuery({ queryKey: key, queryFn: fetchAlerts, retry: false });
  const [symbol, setSymbol] = useState("");
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<AlertRule["direction"]>("at_or_above");
  const [checked, setChecked] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState("");
  const change = useMutation({
    retry: false,
    mutationFn: async (action: Change) => {
      if (action.kind === "evaluate") return evaluateAlerts();
      if (action.kind === "create") await createAlert(action.rule);
      else await deleteAlert(action.id);
    },
    onMutate: () => { setNotice(""); setValidation(""); },
    onSuccess: async (result, action) => {
      if (result) {
        setChecked(result.map(item => item.id));
        client.setQueryData(key, result);
        setNotice("Close check complete.");
      } else if (action.kind === "create") {
        setTarget("");
        setNotice(`Threshold saved for ${action.rule.symbol}.`);
      } else {
        setNotice("Threshold deleted.");
      }
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const rows = alerts.data ?? [];
  const busy = change.isPending;
  return <Page className="organize" title="Close alerts" testId="night-alerts" description="Evaluate saved thresholds against the latest stored raw daily close. Each threshold can trigger once.">
    <Panel title="New threshold">
      <form className="organize-form" onSubmit={event => {
        event.preventDefault();
        if (!Number(target) || !/^\d{1,12}(\.\d{1,6})?$/.test(target)) {
          setValidation("Enter a positive USD price with up to six decimal places."); return;
        }
        change.mutate({ kind: "create", rule: { symbol: symbol.trim().toUpperCase(), direction, target } });
      }}>
        <Field id="alert-symbol" label="Symbol"><input required maxLength={20} data-testid="alert-symbol" placeholder="AAPL" autoCapitalize="characters" value={symbol} disabled={busy} onChange={e => setSymbol(e.target.value.toUpperCase())} /></Field>
        <Field id="alert-direction" label="Trigger when close is"><select value={direction} disabled={busy} onChange={e => setDirection(e.target.value as AlertRule["direction"])}>
          <option value="at_or_above">At or above</option><option value="at_or_below">At or below</option>
        </select></Field>
        <Field id="alert-target" label="Target (USD)" error={validation}><input required inputMode="decimal" placeholder="0.00" data-testid="alert-target" value={target} disabled={busy} onChange={e => { setTarget(e.target.value); setValidation(""); }} /></Field>
        <div className="actions"><Button data-testid="alert-create" type="submit" variant="primary" disabled={busy || !alerts.isSuccess}>Save threshold</Button></div>
      </form>
    </Panel>
    <Panel title="Saved thresholds" actions={<Button data-testid="alert-evaluate" disabled={busy || !alerts.isSuccess || !rows.some(row => row.status === "armed")} onClick={() => change.mutate({ kind: "evaluate" })}>Evaluate closes</Button>}>
      {alerts.isPending ? <State kind="loading" title="Loading thresholds…" /> :
        alerts.isError ? <ReadFailure title="Thresholds unavailable" error={alerts.error} retry={alerts.refetch} /> :
        !rows.length ? <State kind="empty" title="No saved thresholds" detail="Add a symbol and price to make your first close check." /> :
        <ul className="records" data-testid="alert-result">{rows.map(alert => <li className="record" key={alert.id}>
          <div className="record-head"><h3>{alert.symbol}</h3><strong data-tone={alert.status === "triggered" ? "up" : undefined}>{alert.status === "triggered" ? "Triggered" : "Armed"}</strong></div>
          <p>{alert.direction === "at_or_above" ? "At or above" : "At or below"} <span className="figure">{price(alert.target)}</span></p>
          <Observation alert={alert} checked={checked.includes(alert.id)} />
          <div className="actions"><Button variant="danger" disabled={busy} aria-label={`Delete ${alert.symbol} threshold at ${price(alert.target)}`} onClick={() => change.mutate({ kind: "delete", id: alert.id })}>Delete</Button></div>
        </li>)}</ul>}
      <p className="feedback" role="status">{notice}</p>
      {change.isError && <p className="feedback" role="alert">{errorMessage(change.error)}</p>}
    </Panel>
  </Page>;
}

export function Alerts() { return <Owner screen={AlertBook} />; }
