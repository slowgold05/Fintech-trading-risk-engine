import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMe } from "../../../api/auth";
import { fetchOrders, ORDER_ACTIVITY_LIMIT } from "../../../api/orders";
import { fetchPortfolio } from "../../../api/portfolio";
import { fetchWatchlists } from "../../../api/watchlists";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import type { Column } from "../../kit";
import { Button, Field, Page, Panel, RestInstrument, ShareInstrument, State, Stat, Table, type InstrumentStatus } from "../../inner";
import { features } from "../../registry";
import { importError, submitWatchlistImport, type ImportResult, type ImportRow } from "./api";
import { MAX_IMPORT_ROWS, WATCHLIST_CAP, readSymbolFile, type SymbolRecord } from "./csv";
import { exportHoldings, exportOrders } from "./exports";
import "./transfer.css";

type Row = ImportRow & { line: number };
type Review = { phase: "preview" | "import"; result: ImportResult; records: SymbolRecord[] };
const labels = {
  add: "Eligible to add",
  existing: "Already on list",
  duplicate: "Duplicate in file",
  invalid: "Invalid symbol",
};

const rowColumns: Column<Row>[] = [
  { key: "line", header: "File line", align: "right", cell: row => row.line },
  { key: "symbol", header: "Symbol", align: "left",
    cell: row => row.symbol.length > 32 ? row.symbol.slice(0, 32) + "…" : row.symbol || "Blank" },
  { key: "outcome", header: "Outcome", align: "left", cell: row => labels[row.status] },
];

function countText(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function ImportReview({ review, importing, onImport }: { review: Review; importing: boolean; onImport: () => void }) {
  const { phase, result, records } = review;
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, [phase, result]);
  const isPreview = phase === "preview";
  const additions = result.rows.filter(row => row.status === "add").length;
  const available = WATCHLIST_CAP - result.watchlist.symbols.length;
  const overCapacity = additions > available;
  const rows = result.rows.map(row => ({ ...row, line: records[row.row - 2].line }));
  const columns = isPreview ? rowColumns : [
    ...rowColumns.slice(0, 2),
    { ...rowColumns[2], cell: (row: Row) => row.status === "add" ? "Added" : labels[row.status] },
  ];

  return <div className="transfer-review" data-testid={isPreview ? "csv-preview-result" : "csv-result"}>
    <div className="transfer-summary">
      <h3 ref={title} tabIndex={-1}>{isPreview ? "Preview" : "Import result"} <span>· {result.watchlist.name}</span></h3>
      <p role="status">{isPreview
        ? `${countText(additions, "eligible symbol")} · ${countText(available, "space")} available`
        : `${countText(result.added, "symbol")} added · ${result.watchlist.symbols.length} of ${WATCHLIST_CAP} spaces used`}</p>
      {isPreview && overCapacity &&
        <p role="alert">The eligible symbols exceed this list’s capacity. Remove rows or choose another list.</p>}
    </div>
    {isPreview && <Button data-testid="csv-import" variant="primary" busy={importing}
      disabled={additions === 0 || overCapacity} onClick={onImport}>
      {importing ? "Importing…" : `Import ${countText(additions, "symbol")}`}
    </Button>}
    <Table rows={rows} rowKey={row => row.line} columns={columns} caption="CSV row outcomes" />
  </div>;
}

function WatchlistImportPanel({ owner }: { owner: number }) {
  const queryClient = useQueryClient();
  const queryKey = keys.account(owner, "watchlists");
  const watchlists = useQuery({ queryKey, queryFn: ({ signal }) => fetchWatchlists(signal), retry: false });
  const [listId, setListId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [operation, setOperation] = useState<Review["phase"] | null>(null);
  const [fileError, setFileError] = useState("");
  const [requestError, setRequestError] = useState("");
  const lists = watchlists.data?.watchlists ?? [];
  const selected = lists.find(list => String(list.id) === listId);
  const watchlistsPath = features.find(feature => feature.id === "watchlists")?.path;

  function clearReview() {
    setReview(null);
    setFileError("");
    setRequestError("");
  }

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !file || operation) return;
    clearReview();
    setOperation("preview");
    try {
      let records: SymbolRecord[];
      try {
        records = await readSymbolFile(file);
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "The CSV file could not be read.");
        return;
      }
      const result = await submitWatchlistImport(selected.id, records.map(record => record.symbol), true);
      setReview({ phase: "preview", records, result });
    } catch (error) {
      setRequestError(importError(error, true));
    } finally {
      setOperation(null);
    }
  }

  async function apply() {
    if (!selected || review?.phase !== "preview" || operation) return;
    const { records } = review;
    setOperation("import");
    try {
      const result = await submitWatchlistImport(selected.id, records.map(record => record.symbol), false);
      setReview({ phase: "import", records, result });
      void queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      setReview(null);
      setRequestError(importError(error, false));
      void queryClient.invalidateQueries({ queryKey });
    } finally {
      setOperation(null);
    }
  }

  return <Panel title="Import watchlist" subtitle="Add symbols to an existing private list." className="transfer-import">
    {watchlists.isPending && <State kind="loading" title="Loading watchlists…" />}
    {watchlists.isError && <State kind="error" title="Watchlists could not be loaded."
      action={<Button busy={watchlists.isFetching} onClick={() => void watchlists.refetch()}>Retry watchlists</Button>} />}
    {watchlists.isSuccess && lists.length === 0 && <State kind="empty" title="No watchlists yet."
      detail="Create a watchlist before importing symbols."
      action={watchlistsPath && <Link to={watchlistsPath} className="nk-button">Open Watchlists</Link>} />}
    {watchlists.isSuccess && lists.length > 0 && <>
      <form onSubmit={event => void preview(event)}>
        <fieldset className="transfer-fields" disabled={operation !== null} aria-label="CSV source and destination">
          <Field id="csv-watchlist" label="Destination watchlist"
            hint={selected ? `${selected.symbols.length} of ${WATCHLIST_CAP} spaces used` : "Choose one of your saved lists."}>
            <select data-testid="csv-watchlist" value={selected ? listId : ""} onChange={event => {
              setListId(event.target.value);
              clearReview();
            }}>
              <option value="">Choose a watchlist</option>
              {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </Field>
          <Field id="csv-file" label="CSV file" error={fileError}
            hint={<>UTF-8, a single <strong>symbol</strong> column, up to {MAX_IMPORT_ROWS} data rows and 64 KiB.</>}>
            <input data-testid="csv-file" type="file" accept=".csv,text/csv" onChange={event => {
              setFile(event.target.files?.[0] ?? null);
              clearReview();
            }} />
          </Field>
          <Button data-testid="csv-preview" type="submit" variant={review?.phase === "preview" ? "quiet" : "primary"}
            busy={operation === "preview"} disabled={!selected || !file}>
            {operation === "preview" ? "Previewing…" : "Preview CSV"}
          </Button>
        </fieldset>
      </form>
      {requestError && <p className="transfer-error" role="alert">{requestError}</p>}
      {review && selected?.id === review.result.watchlist.id &&
        <ImportReview review={review} importing={operation === "import"} onImport={() => void apply()} />}
    </>}
  </Panel>;
}

const formatRows = (rows: number) => countText(rows, "row");

function ExportPanel({ owner }: { owner: number }) {
  const holdings = useQuery({ queryKey: keys.account(owner, "portfolio"), queryFn: fetchPortfolio, retry: false });
  const orders = useQuery({ queryKey: keys.account(owner, "orders", ORDER_ACTIVITY_LIMIT), queryFn: fetchOrders, retry: false });
  const snapshot = formatUtcDateTime(holdings.data?.snapshot_read_at);

  const ready = holdings.isSuccess && orders.isSuccess;
  const groups = new Map<string, number>();
  if (ready) {
    for (const row of holdings.data.positions) {
      const name = row.symbol;
      groups.set(name, (groups.get(name) ?? 0) + 1);
    }
    for (const row of orders.data.orders) {
      const name = row.symbol;
      groups.set(name, (groups.get(name) ?? 0) + 1);
    }
  }
  const ranked = [...groups].map(([name, value]) => ({name, value})).sort((a,b) => b.value - a.value || a.name.localeCompare(b.name));
  const parts = ranked.slice(0, 8);
  if (ranked.length > parts.length) parts.push({name:"Other symbols",value:ranked.slice(8).reduce((sum, row) => sum + row.value, 0)});
  const status: InstrumentStatus | undefined = holdings.isError || orders.isError ? {kind:"error",title:"Export inventory is incomplete. Retry the unavailable file below."} :
    !ready ? {kind:"loading",title:"Counting exportable records…"} : !parts.length ? {kind:"empty",title:"No holdings or orders to export."} : undefined;
  return <Panel title="Export CSV" className="transfer-export">
    <div className="transfer-counts">
      <Stat label="Exportable rows" value={ready ? holdings.data.positions.length + orders.data.orders.length : null} />
      <Stat label="Holdings" value={holdings.isSuccess ? holdings.data.positions.length : null}/>
      <Stat label="Orders" value={orders.isSuccess ? orders.data.orders.length : null}/>
    </div>
    <h3 className="transfer-dist-title">Rows by symbol</h3>
    <ShareInstrument label="Holdings and order rows by symbol" format={formatRows} parts={parts} status={status} centrepiece />
    <div className="transfer-files">
    <div className="transfer-export-block">
      <h3>Holdings</h3>
      <p>All current holdings in your portfolio.</p>
      {holdings.isPending && <p role="status">Loading holdings…</p>}
      {holdings.isError && <State kind="error" title="Holdings could not be loaded."
        action={<Button busy={holdings.isFetching} onClick={() => void holdings.refetch()}>Retry holdings</Button>} />}
      {holdings.isSuccess && <>
        <p className="transfer-meta">{countText(holdings.data.positions.length, "holding")}{snapshot && <><br />Snapshot {snapshot}</>}</p>
        <Button data-testid="csv-export" onClick={() => exportHoldings(holdings.data.positions)}>Download holdings CSV</Button>
      </>}
    </div>
    <div className="transfer-export-block">
      <h3>Orders</h3>
      <p>Up to {ORDER_ACTIVITY_LIMIT} of your most recent orders, across all statuses.</p>
      {orders.isPending && <p role="status">Loading orders…</p>}
      {orders.isError && <State kind="error" title="Orders could not be loaded."
        action={<Button busy={orders.isFetching} onClick={() => void orders.refetch()}>Retry orders</Button>} />}
      {orders.isSuccess && <>
        <p className="transfer-meta">{countText(orders.data.orders.length, "order")} loaded</p>
        <Button data-testid="csv-export-orders" onClick={() => exportOrders(orders.data.orders)}>Download orders CSV</Button>
      </>}
    </div>
    </div>
  </Panel>;
}

export function CsvTransfer() {
  const identity = useQuery({ queryKey: keys.me, queryFn: fetchMe, retry: false });
  const owner = identity.data?.id;
  return <Page title="CSV transfer" description="Import watchlist symbols and export your holdings or order records."
    testId="night-csv" layout="analysis" className="transfer-page">
    {identity.isError || (!identity.isPending && !owner) ?
      <Page.Full><RestInstrument label="Export inventory" status={{kind:"error", title:"Account unavailable",
        action:<Button onClick={() => void identity.refetch()}>Retry account</Button>}} /></Page.Full> :
      owner ? <>
        <Page.Main><ExportPanel key={owner} owner={owner} /></Page.Main>
        <Page.Aside><WatchlistImportPanel key={owner} owner={owner} /></Page.Aside>
      </> : <Page.Full><RestInstrument label="Export inventory" status={{kind:"loading",title:"Reading account…"}} /></Page.Full>}
  </Page>;
}
