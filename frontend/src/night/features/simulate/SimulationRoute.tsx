import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Button, Field, Page, Panel, RestInstrument, Stat } from "../../inner";
import { SimulationResult } from "./SimulationResult";
import { defaults, exchangeToday, failureDetail, money, runSimulation, windowLimit, type Request, type Strategy } from "./simulation";
import "./simulate.css";

function RunWorkspace({ strategy }: { strategy: Strategy }) {
  const recurring = strategy.id === "recurring";
  const [draft, setDraft] = useState<Request>(() => recurring ? { ...defaults, monthly_usd: "250.00" } : { ...defaults });
  const run = useMutation({ mutationFn: (request: Request) => runSimulation(strategy.id, request), retry: false });
  const today = exchangeToday();
  function edit(field: keyof Request, value: string) {
    setDraft(previous => ({ ...previous, [field]: value }));
    run.reset();
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (run.isPending || !event.currentTarget.reportValidity()) return;
    const request = { ...draft, symbol: draft.symbol.toUpperCase(), initial_usd: Number(draft.initial_usd).toFixed(2) };
    if (recurring) request.monthly_usd = Number(draft.monthly_usd).toFixed(2);
    run.mutate(request);
  }
  const runButton = <Button data-testid="simulation-run" type="submit" form="simulation-parameters" variant="primary" busy={run.isPending}>{run.isPending ? "Running…" : "Run simulation"}</Button>;
  return <div className="sim-workspace">
    <div className="sim-output" aria-busy={run.isPending}>
      {run.isSuccess ? <SimulationResult result={run.data} request={run.variables} actions={runButton} /> :
        <Panel className="sim-awaiting" title="Simulation outcome" actions={runButton}>
          <div className="sim-draft-readings">
            <Stat label="Symbol" value={draft.symbol || null} />
            <Stat label="Initial capital" value={draft.initial_usd && Number(draft.initial_usd) > 0 ? money(draft.initial_usd) : null} />
            {recurring && <Stat label="Monthly" value={draft.monthly_usd && Number(draft.monthly_usd) > 0 ? money(draft.monthly_usd) : null}/>}
          </div>
          <RestInstrument label="Portfolio value" status={run.isPending ? {kind:"loading",title:"Reading stored closes…"} :
            run.isError ? {kind:"error",title:"Run could not complete"} : {kind:"empty",title:"Ready to run"}} />
          <p className="sim-limits">{run.isError ? failureDetail(run.error) : "Run the simulation to see the ending value, total contributions and the underlying price return."}</p>
          <div className="sim-window"><span>Requested window</span><strong>{draft.start || "—"} – {draft.end || "—"}</strong></div>
        </Panel>}
      <span className="sr-only" role="status">{run.isSuccess && (run.data.coverage === "missing" ?
        "Run complete. Insufficient stored closes." : "Run complete. Results for " + run.data.symbol + " are available.")}</span>
    </div>
    <Panel title="Run parameters" className="sim-parameters">
      <form id="simulation-parameters" onSubmit={submit}>
        <fieldset disabled={run.isPending}>
          <Field id="sim-symbol" label="Symbol"><input value={draft.symbol} required maxLength={20}
            pattern={'[A-Za-z0-9][A-Za-z0-9.\\-]*'} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            onChange={e => edit("symbol", e.target.value.toUpperCase())} /></Field>
          <Field id="sim-start" label="Start date"><input type="date" required min="1990-01-01" max={today}
            value={draft.start} onChange={e => edit("start", e.target.value)} /></Field>
          <Field id="sim-end" label="End date"><input type="date" required min={draft.start || "1990-01-01"} max={windowLimit(draft.start, today)}
            value={draft.end} onChange={e => edit("end", e.target.value)} /></Field>
          <Field id="sim-initial" label="Initial investment (USD)"><input type="number" inputMode="decimal" required min="0.01" max="1000000" step="0.01"
            value={draft.initial_usd} onChange={e => edit("initial_usd", e.target.value)} /></Field>
          {recurring && <Field id="sim-monthly" label="Monthly contribution (USD)"><input type="number" inputMode="decimal" required min="0.01" max="100000" step="0.01"
            value={draft.monthly_usd} onChange={e => edit("monthly_usd", e.target.value)} /></Field>}
        </fieldset>
        <p className="sim-limits">Up to 3 years · $1M initial{recurring && " · $100k monthly"}</p>

      </form>
    </Panel>
  </div>;
}

// The registry mounts one pathname and supplies only its admitted strategies.
export function SimulationRoute({ strategies }: { strategies: readonly [Strategy, ...Strategy[]] }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const active = strategies.find(strategy => strategy.id === params.get("mode")) ?? strategies[0];
  if (params.has("mode") && params.get("mode") !== active.id) {
    const next = new URLSearchParams(params);
    next.set("mode", active.id);
    return <Navigate replace to={{ pathname: location.pathname, search: next.toString(), hash: location.hash }} />;
  }
  return <Page className="sim-page" testId={"night-" + active.id} title={strategies.length > 1 ? "Investment simulator" : active.label + " simulator"} description={active.description}
    actions={strategies.length > 1 && <nav className="sim-modes" aria-label="Simulation strategy">{strategies.map(strategy => {
      const next = new URLSearchParams(params);
      next.set("mode", strategy.id);
      return <Link key={strategy.id} to={{ pathname: location.pathname, search: next.toString(), hash: location.hash }}
        aria-current={strategy.id === active.id ? "page" : undefined}>{strategy.label}</Link>;
    })}</nav>}>
    <RunWorkspace key={active.id} strategy={active} />
  </Page>;
}
