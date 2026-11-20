import type { AllocationResponse } from "../../../types/schemas";
import { formatPercent } from "../../../utils/format";
import { Button, Panel, ShareInstrument, type InstrumentStatus } from "../../inner";
import { allocationParts, numeric } from "./valuation";

export function Allocation({
  data,
  incomplete,
  loading,
  retry,
}: {
  data?: AllocationResponse;
  incomplete: boolean;
  loading: boolean;
  retry?: () => void;
}) {
  const cash = numeric(data?.cash_weight_pct);
  const parts = incomplete ? [] : allocationParts(data);
  const top = data?.securities
    .filter((row) => row.price_status === "available" && numeric(row.weight_pct) !== null)
    .sort((a, b) => Number(b.weight_pct) - Number(a.weight_pct))[0];
  const ready = data && parts.length > 0;
  const status: InstrumentStatus | undefined = retry
    ? {
        kind: "error",
        title: "Weights could not be loaded",
        action: <Button onClick={retry}>Retry allocation</Button>,
      }
    : loading
      ? { kind: "loading", title: "Loading weights…" }
      : !ready
        ? {
            kind: "unavailable",
            title: incomplete
              ? "A holding has no usable mark."
              : "A positive, fully valued account fills the allocation.",
          }
        : undefined;
  return (
    <Panel className="exposure-panel" title="Account allocation" subtitle="Sector weights including cash">
      <ShareInstrument
        label="Account allocation by sector and cash"
        parts={parts}
        total={100}
        format={formatPercent}
        status={status}
      />
      {ready && (
        <>
          {top ? (
            <p className="concentration-note">
              <strong>{top.symbol}</strong> is the largest holding at {formatPercent(Number(top.weight_pct))}{" "}
              of the account. A 10% decline in this position alone would reduce account value by about{" "}
              {formatPercent(Number(top.weight_pct) / 10)}.{" "}
              <a href={`#holding-${top.symbol}`}>Review holding</a>
            </p>
          ) : data.securities.length === 0 && cash === 100 ? (
            <p className="concentration-note">All account value is in cash.</p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
