import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMe } from "../../../api/auth";
import { fetchCachedSeries, type CanonicalHistorySeries } from "../../../api/history";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Field, Page, Panel, RestInstrument, State, Stat, ValueGauge, type InstrumentStatus } from "../../inner";
import { choices, useLook, type Preferences } from "../../looks/preferences";
import { DemoReset } from "./DemoReset";
import { setGuide, useGuide } from "./guideState";
import "./account.css";

const controlNames = { look: "Workspace look", density: "Density", motion: "Motion", historyProvider: "Chart history source" };
const ids = {look:"account-look",density:"density-setting",motion:"motion-setting",historyProvider:"history-provider"};
const optionNames: Record<string, string> = {terrain:"Terrain",dial:"Dial",comfortable:"Comfortable",compact:"Compact",
  system:"Use device setting",reduced:"Reduce motion",auto:"Automatic",yahoo:"Yahoo",massive:"Massive"};

function Preference<K extends keyof Preferences>({ name, hint }: { name: K; hint: string }) {
  const { prefs, update } = useLook();
  return <Field id={ids[name]} label={controlNames[name]} hint={hint}>
    <select data-testid={ids[name]} value={prefs[name]} onChange={event => update(name, event.target.value as Preferences[K])}>
      {choices[name].map(value => <option key={value} value={value}>{optionNames[value]}</option>)}
    </select>
  </Field>;
}

const formatBars = (count: number) => count.toLocaleString("en-US");

const formatSession = (value: number) => new Date(value).toISOString().slice(0,10);

function DataStatus() {
  const result = useQuery({queryKey:keys.market("data-status"),queryFn:fetchCachedSeries,retry:false});
  const selected = useLook().prefs.historyProvider;
  const data = result.data;
  type CatalogSeries = CanonicalHistorySeries & {stored_session_start?: string; stored_session_end?: string; symbol_count?: number; coverage_status?: string};
  const series: CatalogSeries[] = data?.canonical_history.series ?? [];
  const [inspected, setInspected] = useState("");
  const chartSeries = selected === "auto" ? series : series.filter(row => row.provider === selected && row.adjustment_type === "split_adjusted");
  const seriesKey = (row: CatalogSeries) => row.provider + "/" + row.adjustment_type;
  const focused = chartSeries.find(row => seriesKey(row) === inspected) ?? chartSeries[0];
  const start = Date.parse(focused?.stored_session_start ?? "");
  const end = Date.parse(focused?.stored_session_end ?? "");
  const read = Date.parse(data?.read_at?.slice(0,10) ?? "");
  const status: InstrumentStatus | undefined = result.isError ? {kind:"error", title:"Data status could not be loaded", action:<Button onClick={() => void result.refetch()}>Retry data status</Button>} :
    result.isPending ? {kind:"loading",title:"Reading the cache…"} : !series.length ? {kind:"empty",title:"No stored chart series"} :
    !focused ? {kind:"unavailable",title:"No stored split-adjusted series for the selected chart source."} :
    !(start <= end && end <= read && read > start) ? {kind:"unavailable",title:"The catalog has no measurable session interval for this series."} : undefined;
  return <Panel title="Stored market data" data-testid="account-data-status" className="account-cache"
    actions={<Link className="nk-button" to="/market/data-coverage">Data coverage</Link>}>
    <div className="account-cache-readings">
      <Stat label="Daily bars" value={result.isSuccess && focused?.row_count != null ? formatBars(focused.row_count) : null}/>
      <Stat label="Symbols" value={result.isSuccess && focused?.symbol_count != null ? formatBars(focused.symbol_count) : null}/>
      <Stat label="Chart source" value={optionNames[selected]}/>
    </div>
    {chartSeries.length > 1 && <Field id="account-cache-series" label="Inspect stored series">
      <select value={focused ? seriesKey(focused) : ""} onChange={event => setInspected(event.target.value)}>
        {chartSeries.map(row => <option key={seriesKey(row)} value={seriesKey(row)}>{row.provider} · {row.adjustment_type.replaceAll("_"," ")}</option>)}
      </select></Field>}
    {status ? <RestInstrument label="Stored session span" status={status}/> :
      <div className="account-interval">
        <p className="account-interval-label">{focused.provider} · {focused.adjustment_type.replaceAll("_"," ")} · Daily history</p>
        <ValueGauge centrepiece label="Latest stored session" value={end} min={start} max={read} format={formatSession}/>
        <div className="account-scale-key"><span>First stored session</span><span>Catalog read date</span></div>
        <div className="account-coverage"><span>Session coverage</span><strong>{focused.coverage_status?.replaceAll("_"," ") ?? "Unavailable"}</strong></div>
      </div>}
    {result.isSuccess && <>
      <p className="account-cache-stamp">Cache read {formatUtcDateTime(data?.read_at) ?? "time unavailable"}.
        {" "}{data?.scheduled_history_provider ? 'Scheduled history source: ' + data.scheduled_history_provider + '.' : "No scheduled history source reported."}</p>
      {series.length > 0 && <ul className="account-series">{series.map(row => <li key={row.provider + row.adjustment_type}>
        <strong>{row.provider}</strong><span>{row.adjustment_type.replace("_"," ")} · {row.row_count == null ? "Row count unavailable" : formatBars(row.row_count) + " stored bars"}</span>
        <small>{row.stored_session_end ? "Latest stored session " + row.stored_session_end : "Stored session date unavailable"}</small>
      </li>)}</ul>}
      {selected !== "auto" && !series.some(row => row.provider === selected && row.adjustment_type === "split_adjusted") &&
        <p role="status">{optionNames[selected]} has no stored split-adjusted series in this catalog. Select another source to inspect charts.</p>}
    </>}
  </Panel>;
}

function DemoControls({ owner }: { owner: number }) {
  const state = useGuide(owner);
  return <Panel title="Demo portfolio"><p>Walk through a one-share order or restore the starting portfolio.</p>
    <p>Walkthrough: {state === "done" ? "finished" : state === "active" ? "in progress" : state === "skipped" ? "skipped" : "ready"}.</p>
    <div className="account-actions">
      <Link className="nk-button" to="/dashboard" onClick={() => setGuide(owner,"active")}>{state === "active" ? "Continue walkthrough" : "Start walkthrough"}</Link>
      <DemoReset owner={owner} />
    </div>
  </Panel>;
}

export function Account() {
  const identity = useQuery({queryKey:keys.me,queryFn:fetchMe,retry:false});
  const user = identity.data;
  return <Page className="account-page" title="Account" testId="night-account" description="Workspace preferences and market data sources." layout="analysis"
    actions={user?.role === "trader" && <Link className="nk-button" to="/account/data">CSV transfer</Link>}>
    <Page.Main><DataStatus /></Page.Main>
    <Page.Aside><Panel title="Workspace preferences" subtitle="Saved in this browser">
      <div className="account-fields">
        <Preference name="look" hint="Applies to public markets and your workspace." />
        <Preference name="density" hint="Adjust panel spacing and row height." />
        <Preference name="motion" hint="Use your device preference or settle transitions immediately." />
        <Preference name="historyProvider" hint="Choose a provider for daily chart history. Automatic uses a stored series." />
      </div>
    </Panel><Panel title="Signed-in account">{identity.isError ? <State kind="error" title="Account details unavailable" action={<Button onClick={() => void identity.refetch()}>Retry identity</Button>} /> :
      user ? <><strong>{user.is_demo ? user.display_name || "Demo trader" : user.email}</strong><p>{user.role.replace("_"," ")} · {user.is_demo ? "Demo account" : "Regular account"}</p></> :
      <State kind="loading" title="Reading account…" />}</Panel>
      {import.meta.env.VITE_DEMO_ENABLED !== "false" && identity.isSuccess && user?.is_demo && user.role === "trader" && <DemoControls key={user.id} owner={user.id} />}
    </Page.Aside>
  </Page>;
}
