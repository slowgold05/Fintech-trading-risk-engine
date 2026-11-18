import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchOrders } from "../../../api/orders";
import type { OrderResponse } from "../../../types/schemas";
import { keys } from "../../api";
import { Button, Field, Page, Panel, State } from "../../kit";
import { errorMessage } from "./errors";
import { createNote, deleteNote, fetchJournal, updateNote, type JournalEntry, type NoteBody } from "./journalApi";
import { Owner } from "./Owner";
import { ReadFailure } from "./ReadFailure";

type Change = { kind: "create" | "edit"; id: number; body: NoteBody } | { kind: "delete"; id: number };

function ReceiptLink({ id }: { id: number }) {
  return <Link className="receipt-link" to={`/trades?order=${id}`}>View receipt #{id}</Link>;
}

function NoteForm({ orders, editing, busy, save, cancel }: {
  orders: OrderResponse[]; editing: JournalEntry | null; busy: boolean;
  save: (change: Change) => void; cancel: () => void;
}) {
  const [order, setOrder] = useState("");
  const [note, setNote] = useState(editing?.note ?? "");
  const [tags, setTags] = useState<string[]>(editing?.tags.length ? editing.tags : [""]);
  return <form className="organize-form" onSubmit={event => {
    event.preventDefault();
    const body = { note, tags: tags.map(tag => tag.trim()).filter(Boolean) };
    save(editing ? { kind: "edit", id: editing.id, body } : { kind: "create", id: Number(order), body });
  }}>
    {editing ? <div><ReceiptLink id={editing.order_id} /></div> :
      <Field id="journal-order" label="Order receipt" hint="Choose from your 50 most recent orders."><select required data-testid="journal-order" value={order} disabled={busy} onChange={e => setOrder(e.target.value)}>
        <option value="">Choose a receipt</option>
        {orders.map(item => <option value={item.id} key={item.id}>#{item.id} · {item.symbol} · {item.side} {item.quantity} · {item.status}</option>)}
      </select></Field>}
    <Field id="journal-note" label="Trade note"><textarea data-testid="journal-note" autoFocus={!!editing} required maxLength={2000} rows={4} placeholder="What informed this trade?" value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></Field>
    <div className="tag-fields">
      {tags.map((tag, i) => <Field key={i} id={`journal-tag-${i}`} label={i ? `Tag ${i + 1}` : "Tag (optional)"}><input value={tag} disabled={busy} maxLength={24} onChange={e => setTags(tags.map((value, index) => index === i ? e.target.value : value))} /></Field>)}
      {tags.length < 5 && <div className="actions"><Button disabled={busy || !tags[tags.length - 1].trim()} onClick={() => setTags([...tags, ""])}>Add another tag</Button></div>}
    </div>
    <div className="actions"><Button type="submit" data-testid="journal-save" variant="primary" disabled={busy || (!editing && !order) || !note.trim()}>{editing ? "Save changes" : "Save note"}</Button>
      {editing && <Button disabled={busy} onClick={cancel}>Cancel edit</Button>}</div>
  </form>;
}

function TradeNotes({ owner }: { owner: number }) {
  const client = useQueryClient();
  const key = keys.account(owner, "journal");
  const journal = useInfiniteQuery({
    queryKey: key, queryFn: ({ pageParam }) => fetchJournal(pageParam),
    initialPageParam: null as string | null, getNextPageParam: page => page.next_cursor, retry: false,
  });
  const orders = useQuery({ queryKey: keys.account(owner, "orders", { limit: 50 }), queryFn: fetchOrders, retry: false });
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const change = useMutation({
    retry: false,
    mutationFn: async (action: Change) => {
      if (action.kind === "delete") await deleteNote(action.id);
      else if (action.kind === "edit") await updateNote(action.id, action.body);
      else await createNote(action.id, action.body);
    },
    onMutate: () => setNotice(""),
    onSuccess: async (_, action) => {
      if (action.kind !== "delete" || editing?.id === action.id) {
        setEditing(null); setVersion(v => v + 1);
      }
      setConfirmId(null);
      setNotice(action.kind === "delete" ? "Note deleted." : "Note saved.");
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const entries = journal.data?.pages.flatMap(page => page.items) ?? [];
  const annotated = new Set(entries.map(entry => entry.order_id));
  const available = (orders.data?.orders ?? []).filter(order => !annotated.has(order.id));
  const editor = <NoteForm key={editing?.id ?? `new-${version}`} orders={available} editing={editing} busy={change.isPending} save={change.mutate} cancel={() => { setEditing(null); change.reset(); }} />;
  return <Page className="organize" title="Trade journal" testId="night-journal" description="Keep a private note and tags with each paper order receipt.">
    <Panel title={editing ? "Edit note" : "New note"}>
      {editing ? editor : orders.isPending || journal.isPending ? <State kind="loading" title="Loading receipts…" /> :
        orders.isError ? <ReadFailure title="Receipts unavailable" error={orders.error} retry={orders.refetch} /> :
        journal.isError && !journal.data ? <p className="detail">Load your saved notes to select a receipt.</p> :
        available.length ? editor :
        <State kind="empty" title={orders.data?.orders.length ? "Recent receipts already have notes" : "No order receipts yet"}
          detail={orders.data?.orders.length ? "Choose Edit on a saved note to update it." : "Place a paper order in Activity to start your journal."} action={<Link className="receipt-link" to="/trades">Open Activity</Link>} />}
      {change.isError && change.variables.kind !== "delete" && <p role="alert" className="feedback">{errorMessage(change.error)}</p>}
    </Panel>
    <Panel title="Saved notes">
      {journal.isPending ? <State kind="loading" title="Loading notes…" /> :
        journal.isError && !journal.data ? <ReadFailure title="Notes unavailable" error={journal.error} retry={journal.refetch} /> :
        !entries.length ? <State kind="empty" title="No trade notes yet" detail="Saved notes appear here with a link to the original receipt." /> :
        <ul className="records">{entries.map(entry => <li className="record" key={entry.id} data-testid="journal-entry">
          <div className="record-head"><h3>Receipt #{entry.order_id}</h3><small>Updated <time dateTime={entry.updated_at}>{entry.updated_at.slice(0, 10)} UTC</time></small></div>
          <p className="note-text">{entry.note}</p>
          {entry.tags.length > 0 && <ul className="tag-list" aria-label="Tags">{entry.tags.map((tag, i) => <li key={i}>#{tag}</li>)}</ul>}
          <div className="actions"><ReceiptLink id={entry.order_id} />
            <Button disabled={change.isPending} onClick={() => { setEditing(entry); setConfirmId(null); change.reset(); setNotice(""); }}>Edit</Button>
            {confirmId === entry.id ? <><Button variant="danger" disabled={change.isPending} onClick={() => change.mutate({ kind: "delete", id: entry.id })}>Confirm delete</Button>
              <Button disabled={change.isPending} onClick={() => setConfirmId(null)}>Keep note</Button></> :
              <Button variant="danger" disabled={change.isPending} onClick={() => setConfirmId(entry.id)}>Delete</Button>}</div>
        </li>)}</ul>}
      {journal.isError && journal.data && <ReadFailure title="Could not refresh saved notes" error={journal.error} retry={journal.isFetchNextPageError ? journal.fetchNextPage : journal.refetch} />}
      {journal.hasNextPage && !journal.isFetchNextPageError && <Button disabled={journal.isFetching} onClick={() => void journal.fetchNextPage()}>Load older notes</Button>}
      {change.isError && change.variables.kind === "delete" && <p role="alert" className="feedback">{errorMessage(change.error)}</p>}
      <p className="feedback" role="status">{notice}</p>
    </Panel>
  </Page>;
}

export function Journal() { return <Owner screen={TradeNotes} />; }
