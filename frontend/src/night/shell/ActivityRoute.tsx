import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../../api/auth";
import { Trades } from "../../pages/Trades";
import { saveDraft } from "./ticketDraft";
import { State } from "../kit";

export default function ActivityRoute() {
  const [params,setParams] = useSearchParams();
  const identity = useQuery({queryKey:["me"],queryFn:fetchMe,retry:false});
  if (identity.isPending) return <State kind="loading" title="Loading account…" />;
  if (!identity.data) return <State kind="error" title="Account unavailable" action={<button onClick={() => void identity.refetch()}>Retry</button>} />;
  const id = Number(params.get("order"));
  function selectOrder(next: number|null) {
    const updated = new URLSearchParams(params);
    updated.delete("ticket");
    if (next === null) updated.delete("order");
    else updated.set("order",String(next));
    setParams(updated);
  }
  return <Trades owner={identity.data.id} canTrade={identity.data.role === "trader"} open={params.get("ticket") === "1"}
    onOpen={() => {
      if (params.get("symbol")) saveDraft(identity.data.id, null);
      const next = new URLSearchParams(params);
      next.set("ticket", "1");
      next.delete("order");
      setParams(next);
    }}
    receiptId={Number.isSafeInteger(id) && id > 0 ? id : null} onSelectOrder={selectOrder} />;
}
