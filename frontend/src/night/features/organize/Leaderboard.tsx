import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "../../api";
import { Button, Field, Page, Panel, Stat, Table, type InstrumentStatus } from "../../inner";
import { errorMessage } from "./errors";
import { fetchRanking, setMembership, type Membership } from "./leaderboardApi";
import { Owner } from "./Owner";
import { ReturnBreadth } from "./ReturnBreadth";
import "./leaderboard.css";

const percent = new Intl.NumberFormat("en-US", {
  style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 6, signDisplay: "exceptZero",
});

function AliasForm({ entry, owner }: { entry: Membership; owner: number }) {
  const client = useQueryClient();
  const [alias, setAlias] = useState(entry.alias ?? "");
  const [validation, setValidation] = useState("");
  const change = useMutation({
    mutationFn: setMembership, retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.account(owner, "leaderboard") }),
  });
  return <>
    <p className="detail" data-testid="leaderboard-me" role="status">{entry.enabled ? `Opted in as ${entry.alias}.` : "You are opted out."}</p>
    <form className="organize-form" onSubmit={event => {
      event.preventDefault();
      const value = alias.trim().replace(/ +/g, " ");
      if (value.length < 3 || value.length > 24 || !/^[a-zA-Z0-9]+(?:[ _-][a-zA-Z0-9]+)*$/.test(value)) {
        setValidation("Use 3–24 letters or digits with single spaces, hyphens or underscores between words."); return;
      }
      change.mutate({ enabled: true, alias: value });
    }}>
      <Field id="leaderboard-alias" label="Public alias" hint="Other demo traders can see your alias and measured return." error={validation}>
        <input required data-testid="leaderboard-alias" value={alias} disabled={change.isPending} maxLength={24} autoComplete="off" onChange={e => { setAlias(e.target.value); setValidation(""); }} /></Field>
      <div className="actions"><Button data-testid="leaderboard-opt-in" variant="primary" type="submit" disabled={change.isPending || (entry.enabled && alias.trim() === entry.alias)}>{entry.enabled ? "Update alias" : "Opt in"}</Button>
        {entry.enabled && <Button data-testid="leaderboard-opt-out" disabled={change.isPending} onClick={() => change.mutate({ enabled: false })}>Opt out</Button>}</div>
    </form>
    {change.isError && <p role="alert" className="feedback">{errorMessage(change.error)}</p>}
  </>;
}

function DemoRanks({ owner }: { owner: number }) {
  const ranking = useQuery({ queryKey: keys.account(owner, "leaderboard"), queryFn: fetchRanking, retry: false });
  const board = ranking.data;
  const measured = board && board.coverage !== "missing" && board.items.length >= 2;
  const status: InstrumentStatus | undefined = ranking.isPending ? {kind:"loading",title:"Loading demo rankings…"} :
    ranking.isError || !board ? {kind:"error",title:"Rankings unavailable",role:"alert",action:<><p>{errorMessage(ranking.error)}</p><Button onClick={() => void ranking.refetch()}>Retry</Button></>} :
    !measured ? {kind:"unavailable",title:"Waiting for eligible returns",action:<p>Standings need at least two opted-in demos with a priced time-weighted index at both ends of this period.</p>} : undefined;
  return <Page className="ranking-page" title="Demo rankings" testId="night-leaderboard" description="Time-weighted paper returns over a common 20-session interval."
    actions={board && <Button disabled={ranking.isFetching} onClick={() => void ranking.refetch()}>Refresh standings</Button>}>
    <Page.Main><Panel className="breadth-panel" title="Return breadth" subtitle="Direction of return across published aliases">
      <ReturnBreadth board={board} status={status} />
      {board && <div className="ranking-dates">
        <Stat label="Opening session" value={<time>{board.start}</time>} />
        <Stat label="Closing session" value={<time>{board.end}</time>} />
      </div>}
    </Panel></Page.Main>
    {board && !ranking.isError && <>
        <Page.Aside><Panel title="Your participation"><AliasForm key={board.my_entry.alias ?? ""} owner={owner} entry={board.my_entry} /></Panel></Page.Aside>
        <Page.Full className={measured ? undefined : "ranking-withheld"}><Panel title="Period standings" subtitle="Ranked by time-weighted paper return">
          {measured ? <Table caption="Time-weighted return for eligible aliases" rows={board.items} rowKey={row => row.alias} columns={[
            { key: "rank", header: "Rank", align: "right", cell: row => <span className="figure">{row.rank}</span> },
            { key: "alias", header: "Alias", align: "left", cell: row => <>{row.alias}{row.alias === board.my_entry.alias && <small> (you)</small>}</> },
            { key: "return", header: "Return", align: "right", cell: row => <span className="figure" data-tone={Number(row.return_ratio) > 0 ? "up" : Number(row.return_ratio) < 0 ? "down" : undefined}>{percent.format(Number(row.return_ratio))}</span> },
          ]} /> : <Stat label="Published ranks" value="Unavailable" />}
          <p className="feedback detail">{board.excluded_count} opted-in {board.excluded_count === 1 ? "demo lacks" : "demos lack"} a comparable return for this period.</p>
          {measured && board.coverage === "partial" && <p className="detail">Partial coverage across participants or intervening sessions.</p>}
        </Panel></Page.Full>
      </>}
  </Page>;
}

export function Leaderboard() { return <Owner screen={DemoRanks} demo />; }
