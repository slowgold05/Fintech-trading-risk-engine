import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMe } from "../../../api/auth";
import { fetchCachedSeries, type CanonicalHistorySeries } from "../../../api/history";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Field, Page, Panel, State } from "../../kit";
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

function DataStatus() {
  const result = useQuery({queryKey:keys.market("data-status"),queryFn:fetchCachedSeries,retry:false});
  const selected = useLook().prefs.historyProvider;
  const data = result.data;
  const series: (CanonicalHistorySeries & { stored_session_end?: string | null })[] = data?.canonical_history.series ?? [];
  return <Panel title="Stored market data" data-testid="account-data-status"
    actions={<Link className="nk-button" to="/market/data-coverage">Data coverage</Link>}>
    {result.isError ? <State kind="error" title="Data status could not be loaded" action={<Button onClick={() => void result.refetch()}>Retry data status</Button>} /> :
      result.isPending ? <State kind="loading" title="Reading the cache…" /> :
        <>
          <p>Cache read {formatUtcDateTime(data?.read_at) ?? "time unavailable"}.</p>
          <p>{data?.scheduled_history_provider ? 'Scheduled history source: ' + data.scheduled_history_provider + '.' : "No scheduled history source reported."}</p>
          {series.length ? <ul className="account-series">{series.map(row => <li key={row.provider + row.adjustment_type}>
            <strong>{row.provider}</strong><span>{row.adjustment_type.replace("_"," ")} · {row.row_count == null ? "Row count unavailable" : row.row_count.toLocaleString("en-US") + " stored bars"}</span>
            <small>{row.stored_session_end ? "Latest stored session " + row.stored_session_end : "Stored session date unavailable"}</small>
          </li>)}</ul> : <State kind="empty" title="No stored chart series" />}
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
  return <Page className="account-page" title="Account" testId="night-account" description="Workspace preferences and market data sources." layout="analysis">
    <Page.Main><Panel title="Workspace preferences" subtitle="Saved in this browser">
      <div className="account-fields">
        <Preference name="look" hint="Applies to public markets and your workspace." />
        <Preference name="density" hint="Adjust panel spacing and row height." />
        <Preference name="motion" hint="Use your device preference or settle transitions immediately." />
        <Preference name="historyProvider" hint="Choose a provider for daily chart history. Automatic uses a stored series." />
      </div>
    </Panel><DataStatus />{user?.role === "trader" && <Page.Full>
      <Link className="nk-button" to="/account/data">CSV transfer</Link>
    </Page.Full>}</Page.Main>
    <Page.Aside><Panel title="Signed-in account">{identity.isError ? <State kind="error" title="Account details unavailable" action={<Button onClick={() => void identity.refetch()}>Retry identity</Button>} /> :
      user ? <><strong>{user.is_demo ? user.display_name || "Demo trader" : user.email}</strong><p>{user.role.replace("_"," ")} · {user.is_demo ? "Demo account" : "Regular account"}</p></> :
      <State kind="loading" title="Reading account…" />}</Panel>
      {import.meta.env.VITE_DEMO_ENABLED !== "false" && identity.isSuccess && user?.is_demo && user.role === "trader" && <DemoControls key={user.id} owner={user.id} />}
    </Page.Aside>
  </Page>;
}
