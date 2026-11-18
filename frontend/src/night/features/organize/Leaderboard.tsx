import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "../../api";
import { Button, Field, Page, Panel, State, Table } from "../../kit";
import { errorMessage } from "./errors";
import { fetchRanking, setMembership, type Membership } from "./leaderboardApi";
import { Owner } from "./Owner";
import { ReadFailure } from "./ReadFailure";

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
  return <Page className="organize" title="Demo rankings" testId="night-leaderboard" description="Compare time-weighted paper returns over the same 20-session interval.">
    {ranking.isPending ? <Page.Full><State kind="loading" title="Loading demo rankings…" /></Page.Full> :
      ranking.isError || !board ? <Page.Full><ReadFailure title="Rankings unavailable" error={ranking.error} retry={ranking.refetch} /></Page.Full> :
      <>
        <Panel title="Your participation"><AliasForm key={board.my_entry.alias ?? ""} owner={owner} entry={board.my_entry} /></Panel>
        <Panel title="Period standings" subtitle={<><time>{board.start}</time> – <time>{board.end}</time></>} actions={<Button disabled={ranking.isFetching} onClick={() => void ranking.refetch()}>Refresh standings</Button>}>
          {measured ? <Table caption="Time-weighted return for eligible aliases" rows={board.items} rowKey={row => row.alias} columns={[
            { key: "rank", header: "Rank", align: "left", cell: row => <span className="figure">{row.rank}</span> },
            { key: "alias", header: "Alias", align: "left", cell: row => <>{row.alias}{row.alias === board.my_entry.alias && <small> (you)</small>}</> },
            { key: "return", header: "Return", align: "right", cell: row => <span className="figure" data-tone={Number(row.return_ratio) > 0 ? "up" : Number(row.return_ratio) < 0 ? "down" : undefined}>{percent.format(Number(row.return_ratio))}</span> },
          ]} /> : <State kind="unavailable" title="Waiting for eligible returns" detail="Standings need at least two opted-in demos with a priced time-weighted index at both ends of this period." />}
          <p className="feedback detail">{board.excluded_count} opted-in {board.excluded_count === 1 ? "demo lacks" : "demos lack"} a comparable return for this period.</p>
          {measured && board.coverage === "partial" && <p className="detail">Partial coverage across participants or intervening sessions.</p>}
        </Panel>
      </>}
  </Page>;
}

export function Leaderboard() { return <Owner screen={DemoRanks} demo />; }
