import { useState } from "react";
import type { OrderResponse } from "../../../types/schemas";
import { formatQuantity } from "../../../utils/format";
import { Panel, State, type InstrumentStatus } from "../../inner";
import { useLook } from "../../looks/preferences";
import type { JournalEntry } from "./journalApi";

function arcPoint(angle: number, radius: number) {
  return [125 + radius * Math.sin(angle), 125 - radius * Math.cos(angle)];
}

function ReceiptMarks({
  orders,
  noted,
  index,
  dial,
  choose,
}: {
  orders: readonly OrderResponse[];
  noted: ReadonlySet<number>;
  index: number;
  dial: boolean;
  choose: (i: number) => void;
}) {
  const current = orders[index];
  const width = 410;
  const count = orders.length;
  const step = Math.min(44, (width - 54) / Math.max(count, 1));
  const left = (width - step * count) / 2;
  const full = 2 * Math.PI;
  return (
    <svg
      viewBox={dial ? "0 0 250 250" : `0 0 ${width} 154`}
      role="img"
      aria-label={count ? `Receipt index, ${count} recent orders` : "Receipt index awaiting orders"}
    >
      {dial ? (
        <>
          <circle cx="125" cy="125" r="115" fill="none" stroke="var(--line)" />
          <circle cx="125" cy="125" r="88" fill="var(--surface)" stroke="var(--line)" />
          {Array.from({ length: 50 }, (_, i) => (
            <path
              key={i}
              d={`M${arcPoint((full * i) / 50, 114)}L${arcPoint((full * i) / 50, i % 5 ? 111 : 108)}`}
              stroke="var(--muted)"
            />
          ))}
        </>
      ) : (
        <>
          <path d="M16 119h355l19-13H35Z" fill="var(--raised)" stroke="var(--line)" />
          <path d="M16 119h355v6H16Z M371 119l19-13v6l-19 13Z" fill="var(--surface)" stroke="var(--line)" />
          <path d="M16 141h374" stroke="var(--line)" strokeDasharray="1 5" />
        </>
      )}
      {orders.map((order, i) => {
        const active = i === index,
          linked = noted.has(order.id);
        const ink = active ? "var(--accent)" : linked ? "var(--ink)" : "var(--muted)";
        const start = (full * i) / count,
          end = (full * (i + 1)) / count - Math.min(0.04, full / count / 5);
        const x = left + i * step,
          w = Math.max(2, step - 1);
        const y = active ? 39 : 53;
        return (
          <g key={order.id} onClick={() => choose(i)} className="receipt-mark">
            <title>{`#${order.id} · ${order.symbol}`}</title>
            {dial ? (
              <path
                d={`M${arcPoint(start, 103)}A103 103 0 ${end - start > Math.PI ? 1 : 0} 1 ${arcPoint(end, 103)}L${arcPoint(end, 93)}A93 93 0 ${end - start > Math.PI ? 1 : 0} 0 ${arcPoint(start, 93)}Z`}
                fill={linked ? ink : "var(--raised)"}
                stroke={ink}
                strokeWidth={active ? 2 : 1}
              />
            ) : (
              <>
                <path
                  d={`M${x} ${y}l15-10h${w}l-15 10Z M${x + w} ${y}l15-10v${115 - y}l-15 10Z`}
                  fill="var(--raised)"
                  stroke={ink}
                  strokeWidth=".9"
                />
                <path
                  d={`M${x} ${y}h${w}V115H${x}Z`}
                  fill={linked ? ink : "var(--surface)"}
                  stroke={ink}
                  strokeWidth="1.2"
                />
                {w > 12 && (
                  <path
                    d={`M${x + 3} ${y + 9}h${w - 6} M${x + 3} ${y + 14}h${w / 2}`}
                    stroke={linked ? "var(--surface)" : ink}
                  />
                )}
              </>
            )}
          </g>
        );
      })}
      {dial && (
        <>
          <text className="receipt-dial-symbol" x="125" y="124" textAnchor="middle">
            {current?.symbol ?? "—"}
          </text>
          <text x="125" y="147" textAnchor="middle">
            {current ? `Receipt #${current.id}` : "Receipt index"}
          </text>
        </>
      )}
    </svg>
  );
}

export function ReceiptIndex({
  orders,
  entries,
  partial,
  status,
}: {
  orders: OrderResponse[];
  entries: JournalEntry[];
  partial: boolean;
  status?: InstrumentStatus;
}) {
  const { prefs } = useLook();
  const [chosen, choose] = useState<number | null>(null);
  const receipts = status ? [] : [...orders].reverse();
  const found = receipts.findIndex((row) => row.id === chosen);
  const index = found >= 0 ? found : receipts.length - 1;
  const order = receipts[index];
  const noted = new Set(entries.map((entry) => entry.order_id));
  const selectedNote = entries.find((entry) => entry.order_id === order?.id);
  const linked = receipts.filter((row) => noted.has(row.id)).length;
  function inspect(i: number) {
    choose(receipts[i].id);
  }
  return (
    <Panel
      className="journal-index"
      title="Receipt coverage"
      subtitle="Notes linked to your 50 most recent orders"
    >
      <div className="journal-plate">
        <div className="journal-index-total">
          <small>{partial ? "With a loaded note" : "With a saved note"}</small>
          <strong>
            {status && status.kind !== "empty" ? "—" : linked}
            <span> / {status && status.kind !== "empty" ? "—" : receipts.length}</span>
          </strong>
          {order && (
            <p>
              {selectedNote ? (
                <a href={`#journal-entry-${selectedNote.id}`}>Read selected note</a>
              ) : partial ? (
                "No loaded note on selected receipt"
              ) : (
                "Selected receipt has no note"
              )}
            </p>
          )}
        </div>
        <div data-centrepiece={!!order}>
          <ReceiptMarks
            orders={receipts}
            noted={noted}
            index={index}
            choose={inspect}
            dial={prefs.look === "dial"}
          />
        </div>
      </div>
      {status ? (
        <State {...status} />
      ) : (
        order && (
          <>
            <dl className="receipt-index-facts">
              <div>
                <dt>Selected receipt</dt>
                <dd>
                  #{order.id} · {order.symbol}
                </dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>
                  {order.side} {formatQuantity(order.quantity)}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{order.status}</dd>
              </div>
            </dl>
            <label className="receipt-scrub">
              <span>Oldest</span>
              <input
                type="range"
                min={0}
                max={receipts.length - 1}
                value={index}
                aria-label="Inspect order receipt"
                aria-valuetext={`Receipt #${order.id}, ${order.symbol}`}
                onChange={(e) => inspect(Number(e.target.value))}
              />
              <span>Newest</span>
            </label>
            <footer>
              <span>■ With note</span>
              <span>□ {partial ? "No loaded note" : "Without note"}</span>
            </footer>
          </>
        )
      )}
    </Panel>
  );
}
