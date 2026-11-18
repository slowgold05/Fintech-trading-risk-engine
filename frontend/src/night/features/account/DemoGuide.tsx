import "./account.css";
import { readPersistedOrderAttempt } from "../../../utils/orderAttemptStorage";
import { useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Panel } from "../../kit";
import { saveDraft } from "../../shell/ticketDraft";
import { setGuide, type GuideState } from "./guideState";
import type { OrderResponse } from "../../../types/schemas";

export function DemoGuide({ owner, state, orders, onDismiss }: { owner: number; state: GuideState; orders?: OrderResponse[]; onDismiss: () => void }) {
  const preview = useRef<HTMLAnchorElement>(null);
  function dismiss(next: "skipped" | "done") { setGuide(owner, next); onDismiss(); }
  if (state === "skipped" || state === "done") return null;
  const receipt = orders?.find(order => order.symbol === "AAPL" && order.side === "buy" && order.quantity === 1 && order.status === "filled");
  const active = state === "active";
  return <Panel className="account-guide" title="One-share walkthrough" data-testid="demo-guide"
    actions={<Button data-testid="guide-skip" onClick={() => dismiss("skipped")}>Skip guide</Button>}>
    {active ? <>
      <ol>
        <li>Open the AAPL ticket with one editable share. This starts a new draft. A pending submission must be resolved first.</li>
        <li>Preview the buy. Compare estimated cash and position weight. Confirm only if you want to place the paper order.</li>
        <li>Read the receipt for actual fills, then open the holding to see the change.</li>
      </ol>
      <div className="account-actions"><Link ref={preview} className="nk-button" data-variant="primary" data-testid="order-open" to="/trades?ticket=1&symbol=AAPL"
        onClick={() => { if (!readPersistedOrderAttempt()) saveDraft(owner, {symbol:"AAPL",side:"buy",quantity:"1",orderType:"market",limitPrice:""}); }}>Preview one AAPL share</Link>
        {receipt && <Link className="nk-button" to={'/trades?order=' + receipt.id}>Read AAPL receipt #{receipt.id}</Link>}
        <Button onClick={() => dismiss("done")}>Finish guide</Button></div>
    </> : <div className="account-actions"><p>Practice reading an order estimate and the receipt for one paper share.</p>
        <Button onClick={() => { setGuide(owner, "active"); requestAnimationFrame(() => preview.current?.focus()); }}>Start walkthrough</Button></div>}
  </Panel>;
}
