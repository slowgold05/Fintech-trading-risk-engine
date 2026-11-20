import { isAxiosError } from "axios";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../api/client";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Field, Panel, RestInstrument, ValueGauge } from "../../inner";
import { HoldingDetails } from "./HoldingDetails";
import "./note.css";

type NoteRead = {symbol:string;note:{text:string;updated_at:string} | null};
type Change = {action:"save";text:string} | {action:"delete"};

export function HoldingNote({owner,symbol}: {owner:number;symbol:string}) {
  const client = useQueryClient();
  const queryKey = keys.account(owner,"holding-notes",symbol);
  const path = "/night/holdings/" + encodeURIComponent(symbol) + "/note";
  const query = useQuery({queryKey,retry:false,queryFn:async ({signal}) => (await apiClient.get<NoteRead>(path,{signal})).data});
  const [mode,setMode] = useState<"read"|"edit"|"delete">("read");
  const [draft,setDraft] = useState("");
  const [notice,setNotice] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  function finish(message:string) {
    setMode("read"); setDraft(""); setNotice(message);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  const change = useMutation({
    scope:{id:"holding-note-" + owner + "-" + symbol},
    mutationFn:async (operation:Change):Promise<NoteRead> => {
      if (operation.action === "save") return (await apiClient.put<NoteRead>(path,{text:operation.text})).data;
      await apiClient.delete(path); return {symbol,note:null};
    },
    onSuccess:async (result,operation) => {
      // A sign-out or identity switch may clear the private cache during the request.
      if (!client.getQueryState(queryKey)) return;
      await client.cancelQueries({queryKey,exact:true});
      if (!client.getQueryState(queryKey)) return;
      client.setQueryData(queryKey,result);
      finish(operation.action === "save" ? "Note saved." : "Note deleted.");
      await client.invalidateQueries({queryKey,exact:true});
    },
  });
  const note = query.data?.note;
  const text = draft.trim();
  const length = Array.from(text).length;
  const invalidUnicode = /[\uD800-\uDFFF]/u.test(text) || text.includes(String.fromCharCode(0));
  const fieldError = invalidUnicode ? "Remove invalid text characters." : length > 2000 ? "Shorten the note to 2,000 characters." : undefined;
  const invalid = length < 1 || !!fieldError;
  function edit() {
    change.reset(); setNotice(""); setDraft(note?.text ?? ""); setMode("edit");
  }
  if (isAxiosError(query.error) && query.error.response?.status === 404) return null;
  return <Panel title="Private holding note" subtitle={symbol} data-testid="night-holding-notes" className="holding-note">
    {query.isPending ? <RestInstrument label="Private note" status={{kind:"loading",title:"Loading note…"}} /> : query.isError && !query.data ?
      <RestInstrument label="Private note" status={{kind:"error",title:"Holding note could not be loaded",action:<Button onClick={() => void query.refetch()}>Retry note</Button>}} /> :
      <>
        <div className="holding-note-layout">
          <div className="note-meter"><ValueGauge label={mode === "edit" ? "Draft length" : "Saved length"}
            value={mode === "edit" ? length : Array.from(note?.text ?? "").length} min={0} max={2000} format={n => n.toLocaleString("en-US")} />
            <small>Characters · 2,000 per note</small></div>
          <div className="note-content">
            {mode === "read" && <>
              {note ? <><p className="holding-note-text">{note.text}</p><p>Updated {formatUtcDateTime(note.updated_at) ?? "date unavailable"}</p></> :
                <p>No note saved for {symbol}.</p>}
              <div className="holding-note-actions">
                <button ref={trigger} type="button" className="nk-button" onClick={edit}>{note ? "Edit note" : "Add note"}</button>
                {note && <Button onClick={() => {change.reset();setNotice("");setMode("delete");}}>Delete note</Button>}
              </div>
            </>}
            {mode === "edit" && <form onSubmit={e => {e.preventDefault(); if (!invalid && !change.isPending) change.mutate({action:"save",text});}}>
              <Field id="holding-note-text" label={"Note for " + symbol} hint={length + " of 2,000 characters"} error={fieldError}>
                <textarea autoFocus rows={5} value={draft} disabled={change.isPending} onChange={e => setDraft(e.target.value)} />
              </Field>
              <div className="holding-note-actions"><Button variant="primary" type="submit" data-testid="holding-note-save" busy={change.isPending} disabled={invalid}>Save note</Button>
                <Button disabled={change.isPending} onClick={() => {change.reset();finish("");}}>Cancel edit</Button></div>
            </form>}
            {mode === "delete" && <div><p>Delete the saved note for {symbol}?</p><div className="holding-note-actions">
              <button autoFocus type="button" className="nk-button" disabled={change.isPending} onClick={() => {change.reset();finish("");}}>Keep note</button>
              <Button variant="danger" busy={change.isPending} onClick={() => change.mutate({action:"delete"})}>Confirm delete</Button>
            </div></div>}
            {change.isError && <p role="alert">{mode === "edit" ? "The note could not be saved. Your edit is still here." : "The note could not be deleted. Try again."}</p>}
            <p role="status">{notice}</p>
          </div>
        </div>
      </>}
  </Panel>;
}

export function HoldingDetailsWithNote() {
  return <HoldingDetails Note={HoldingNote} />;
}
