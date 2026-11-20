import { type ComponentType } from "react";
import { isAxiosError } from "axios";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { fetchMe } from "../../../api/auth";
import { formatUtcDateTime } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Page, Panel, RestInstrument, Stat, Table } from "../../inner";
import { DataStamp } from "../../kit";
import { BookComparison } from "./BookComparison";
import { HoldingDirectory } from "./HoldingDirectory";
import { safeReturnTo } from "../../registry";
import { money, pageSize, readLots, units, type HoldingLots } from "./lots";
import "./holdings.css";

function Pager({list,current,next,onPage}: {list:string;current:string|null;next:string|null;onPage:(cursor:string|null) => void}) {
  if (!current && !next) return null;
  return <nav className="holding-pager" aria-label={list + " pages"}>
    <Button disabled={!current} onClick={() => onPage(null)}>First {list}</Button>
    <Button disabled={!next} onClick={() => onPage(next)}>Next {list}</Button>
  </nav>;
}

function Book({data}: {data:HoldingLots}) {
  const location = useLocation();
  const [params,setParams] = useSearchParams();
  function paginate(key:string, cursor:string|null) {
    const updated = new URLSearchParams(params);
    if (cursor) updated.set(key,cursor);
    else updated.delete(key);
    setParams(updated,{preventScrollReset:true});
  }
  const here = location.pathname + location.search + location.hash;
  return <>
    <Page.Main><Panel className="holding-comparison-panel" title="Basis against market" subtitle={data.symbol + " · Open shares · USD"}>
      <BookComparison book={data} />
      <dl className="holding-pnl"><div><dt>Current unrealized P&amp;L (USD)</dt><dd>{money(data.unrealized_pnl_usd)}</dd></div>
        <div><dt>Posted realized P&amp;L in this book (USD)</dt><dd>{money(data.realized_pnl_usd)}</dd></div></dl>
    </Panel></Page.Main>
    <Page.Aside><Panel title="Current book" subtitle={"Paper FIFO · Started " + (data.book_started_on ?? "date unavailable")}>
      <div className="holding-totals"><Stat label="Open quantity" value={units(data.quantity)} unit="shares" /></div>
      <p>Read at {formatUtcDateTime(data.read_at) ?? "Unavailable"} · Coverage {data.coverage}</p>
      {data.mark ? <p>Mark {units(data.mark.price)} USD per share · <DataStamp source={data.mark.source} /></p> :
        <p>Current mark unavailable</p>}
      {data.reason && <p className="holding-reason">{data.reason}</p>}
    </Panel></Page.Aside>
    <Page.Full><Panel title="Open lots" subtitle="Remaining shares in FIFO order">
      <Table data-testid="holding-lots-table" caption="Remaining lot costs and P&L in USD" rows={data.lots.items} rowKey={r => r.id}
        empty="No open lots in this book." columns={[
          {key:"recorded",header:"Recorded (UTC)",cell:r => formatUtcDateTime(r.recorded_at) ?? "Unavailable"},
          {key:"remaining",header:"Shares left",align:"right",cell:r => units(r.quantity_remaining)},
          {key:"price",header:"Cost / share",align:"right",cell:r => units(r.cost_per_share)},
          {key:"basis",header:"Open basis",align:"right",cell:r => money(r.cost_basis_usd)},
          {key:"unrealized",header:"Unrealized P&L",align:"right",cell:r => money(r.unrealized_pnl_usd)}]} />
      <Pager list="lots" current={params.get("lot_cursor")} next={data.lots.next_cursor} onPage={cursor => paginate("lot_cursor",cursor)} />
    </Panel></Page.Full>
    <Page.Full><Panel title="Posted sales" subtitle="Newest fills first · Active book">
      <Table data-testid="holding-sales-table" caption="Sale proceeds and realized P&L in USD" rows={data.sales.items} rowKey={r => r.trade_id}
        empty="No posted sales in this book." columns={[
          {key:"date",header:"Executed (UTC)",cell:r => formatUtcDateTime(r.executed_at) ?? "Unavailable"},
          {key:"quantity",header:"Shares sold",align:"right",cell:r => units(r.quantity)},
          {key:"fill",header:"Fill / share",align:"right",cell:r => units(r.fill_price)},
          {key:"proceeds",header:"Proceeds",align:"right",cell:r => money(r.proceeds_usd)},
          {key:"realized",header:"Realized P&L",align:"right",cell:r => money(r.realized_pnl_usd)},
          {key:"receipt",header:"Receipt",cell:r => r.order_id ?
            <Link to={"/trades?" + new URLSearchParams({order:String(r.order_id),returnTo:here})}>Order {r.order_id}</Link> :
            r.demo_seed ? "Demo seed" : "Unavailable"}]} />
      <Pager list="sales" current={params.get("sale_cursor")} next={data.sales.next_cursor} onPage={cursor => paginate("sale_cursor",cursor)} />
    </Panel></Page.Full>
  </>;
}

type NoteSlot = ComponentType<{owner:number;symbol:string}>;
export function HoldingDetails({ Note }: { Note?: NoteSlot } = {}) {
  const [params,setParams] = useSearchParams();
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  const owner = useQuery({queryKey:keys.me,queryFn:fetchMe,retry:false});
  const lot = params.get("lot_cursor"), sale = params.get("sale_cursor");
  const read = useQuery({queryKey:keys.account(owner.data?.id ?? 0,"holding-lots",symbol,lot,sale,pageSize),
    queryFn:({signal}) => readLots(symbol,lot,sale,signal),enabled:!!owner.data?.id && !!symbol,retry:false});
  const status = isAxiosError(read.error) ? read.error.response?.status : undefined;
  function firstPage() {
    const next = new URLSearchParams(params); next.delete("lot_cursor"); next.delete("sale_cursor"); setParams(next);
  }
  const back = safeReturnTo(params.get("returnTo") ?? "/portfolio");
  return <Page title={symbol ? symbol + " holding" : "Holding details"} testId="night-holding-lots" className="holding-details"
    actions={<Link className="nk-button" to={back}>Back to portfolio</Link>}>
    {owner.isError || read.isError ? <Page.Full><RestInstrument label="Book valuation" status={
      status === 404 ? {kind:"unavailable",title:"Holding unavailable in this book",action:<p>Open a held symbol or a symbol with a posted sale in your current book.</p>} :
      status === 422 && !lot && !sale ? {kind:"unavailable",title:"Invalid holding symbol",action:<p>Choose a symbol from Portfolio.</p>} :
      {kind:"error",title:"Holding details could not be loaded",action:status === 422 && (lot || sale) ? <Button onClick={firstPage}>Return to first page</Button> :
        <Button onClick={() => void (owner.isError ? owner.refetch() : read.refetch())}>Retry holding</Button>}} /></Page.Full> :
      !symbol && owner.data?.id ? <HoldingDirectory owner={owner.data.id} back={back} /> :
      read.isPending ? <Page.Full><RestInstrument label="Book valuation" status={{kind:"loading",title:"Loading holding details…"}} /></Page.Full> : <Book data={read.data} />}
    {Note && owner.data?.role === "trader" && (read.isSuccess || status === 404) &&
      <Page.Full id="holding-note" className="holding-note-slot"><Note key={owner.data.id + ":" + symbol} owner={owner.data.id} symbol={symbol} /></Page.Full>}
  </Page>;
}
