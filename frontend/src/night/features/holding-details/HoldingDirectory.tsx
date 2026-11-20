import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { fetchPortfolio } from "../../../api/portfolio";
import { formatCurrency, formatPercent, formatQuantity } from "../../../utils/format";
import { keys } from "../../api";
import { Button, Panel, ShareInstrument, Stat, type InstrumentStatus } from "../../inner";
import { numeric } from "../portfolio/valuation";

export function HoldingDirectory({owner, back}: {owner:number; back:string}) {
  const [params, setParams] = useSearchParams();
  function holdingParams(symbol: string) {
    const next = new URLSearchParams(params);
    next.set("symbol", symbol); next.delete("lot_cursor"); next.delete("sale_cursor");
    return next;
  }
  const portfolio = useQuery({queryKey:keys.account(owner,"portfolio"),queryFn:fetchPortfolio,retry:false});
  const positions = portfolio.data?.positions ?? [];
  const symbols = [...new Set(positions.map(row => row.symbol))];
  const total = numeric(portfolio.data?.summary.total_cost_basis);
  const bySymbol = new Map<string,number>();
  let complete = true;
  for (const row of positions) {
    const basis = numeric(row.cost_basis);
    if (basis === null || basis < 0) complete = false;
    else bySymbol.set(row.symbol,(bySymbol.get(row.symbol) ?? 0) + basis);
  }
  const parts = total && total > 0 && complete ? [...bySymbol].map(([name,basis]) => ({name,value:100*basis/total})).sort((a,b)=>b.value-a.value) : [];
  const status: InstrumentStatus | undefined = portfolio.isError ? {kind:"error",title:"Holdings could not be loaded",action:<Button onClick={()=>void portfolio.refetch()}>Retry holdings</Button>} :
    portfolio.isPending ? {kind:"loading",title:"Loading open holdings…"} : !positions.length ? {kind:"empty",title:"Open holdings appear after a paper buy settles."} : undefined;
  return <>
    <Panel title="Open cost basis" subtitle="Share of invested cost by holding" className="holding-distribution"
      actions={positions.length > 0 && <select className="field-control" aria-label="Inspect holding" value=""
        onChange={event => setParams(holdingParams(event.target.value))}>
        <option value="" disabled>Inspect holding</option>
        {symbols.map(symbol => <option key={symbol}>{symbol}</option>)}
      </select>}>
      <ShareInstrument parts={parts} total={100} status={status} format={formatPercent} label="Open cost basis by symbol" centrepiece={!status}/>
      {total !== null && <Stat label="Total open cost basis" value={formatCurrency(total)} />}
    </Panel>
    <Panel title="Choose a holding on Portfolio" subtitle="Inspect the FIFO book and posted sales">
      <nav className="holding-index">{positions.map(row=>
        <Link key={row.asset_type + "-" + row.symbol} to={{search:holdingParams(row.symbol).toString()}}>
          <b>{row.symbol}</b><small>{formatQuantity(row.quantity)} shares</small><span aria-hidden="true">↗</span>
        </Link>)}</nav>
      <Link className="nk-button" to={back}>View holdings</Link>
    </Panel>
  </>;
}
