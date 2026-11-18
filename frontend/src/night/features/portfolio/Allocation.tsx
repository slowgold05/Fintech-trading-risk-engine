import type { AllocationResponse } from "../../../types/schemas";
import { formatPercent } from "../../../utils/format";
import { Button, Panel, State } from "../../kit";
import { numeric } from "./valuation";

export function Allocation({ data, incomplete, loading, retry }: {
  data?: AllocationResponse; incomplete: boolean; loading: boolean; retry?: () => void;
}) {
  const cash = numeric(data?.cash_weight_pct);
  const total = numeric(data?.total_account_value);
  const rows = data?.sectors?.map(row => ({ name: row.sector, weight: numeric(row.weight_pct) }));
  const top = data?.securities.filter(row => row.price_status === "available" && numeric(row.weight_pct) !== null)
    .sort((a, b) => Number(b.weight_pct) - Number(a.weight_pct))[0];
  const ready = data?.status === "complete" && !incomplete && total !== null && total > 0 && cash !== null &&
    rows && rows.every(row => row.weight !== null);
  return <Panel className="exposure-panel" title="Account allocation" subtitle="Sector weights including cash">
    {retry ? <State kind="error" title="Weights could not be loaded" action={<Button onClick={retry}>Retry allocation</Button>} /> :
      loading ? <State kind="loading" title="Loading weights…" /> :
      !ready ? <State kind="unavailable" title="Account weights unavailable" detail={incomplete ? "A holding has no usable mark." : "A positive, fully valued account is required."} /> :
      <><ol>{[{ name: "Cash", weight: cash }, ...rows].sort((a, b) => b.weight! - a.weight!).map(row =>
        <li key={row.name}><div><span>{row.name}</span><b>{formatPercent(row.weight!)}</b></div>
          <div aria-hidden="true" className="exposure-track"><i style={{ width: Math.min(100, Math.max(0, row.weight!)) + "%" }} /></div>
        </li>)}</ol>
        {top ? <p className="concentration-note"><strong>{top.symbol}</strong> is the largest holding at {formatPercent(Number(top.weight_pct))} of the account.
          A 10% decline in this position alone would reduce account value by about {formatPercent(Number(top.weight_pct) / 10)}. <a href={`#holding-${top.symbol}`}>Review holding</a></p> :
          data.securities.length === 0 && cash === 100 ? <p className="concentration-note">All account value is in cash.</p> : null}
      </>}
  </Panel>;
}
