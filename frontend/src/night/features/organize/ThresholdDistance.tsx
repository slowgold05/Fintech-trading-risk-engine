import { useId, useState } from "react";
import { Panel, State, type InstrumentStatus } from "../../inner";
import { useLook } from "../../looks/preferences";
import type { CloseAlert } from "./alertsApi";

import { alertPrice } from "./alertPrice";

function DistanceScale({
  distance,
  limit,
  above,
  dial,
  target,
}: {
  distance: number | null;
  limit: number;
  above: boolean | undefined;
  dial: boolean;
  target: string | undefined;
}) {
  const hatch = useId();
  const f = distance === null ? null : 0.5 + distance / limit / 2;
  const x = (n: number) => 28 + n * 324;
  const radial = (n: number, radius: number) => {
    const angle = Math.PI * n;
    return [190 - radius * Math.cos(angle), 140 - radius * Math.sin(angle)];
  };
  const ticks = Array.from({ length: 41 }, (_, i) => {
    const f = i / 40;
    const long = i % 5 === 0;
    return (
      <path
        key={i}
        d={dial ? `M${radial(f, 125)}L${radial(f, long ? 112 : 119)}` : `M${x(f)} 97v-${long ? 16 : 7}`}
        stroke="var(--muted)"
        strokeWidth={long ? 1.4 : 0.8}
      />
    );
  });
  const from = above ? 0.5 : 0,
    to = above ? 1 : 0.5;
  const zone = dial
    ? `M${radial(from, 110)}A110 110 0 0 1 ${radial(to, 110)}L${radial(to, 94)}A94 94 0 0 0 ${radial(from, 94)}Z`
    : `M${x(from)} 72h162l12-13h-162Z M${x(from)} 72h162v9h-162Z`;
  const label = (n: number) => (n === 0 ? "Target" : `${n > 0 ? "+" : "−"}${Math.abs(n)}%`);
  return (
    <svg
      viewBox={dial ? "0 0 380 170" : "0 0 380 126"}
      role="img"
      aria-label={
        distance === null
          ? target
            ? `Saved target ${target}, raw close unavailable`
            : "Threshold distance awaiting a rule"
          : `Raw close ${distance.toFixed(2)}% from target`
      }
    >
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="5" height="5" fill="var(--raised)" />
          <path d="M0 0V5" stroke="var(--muted)" strokeWidth="1.5" />
        </pattern>
      </defs>
      {dial ? (
        <path d="M80 140a110 110 0 1 1 220 0h-16a94 94 0 1 0-188 0Z" fill="var(--raised)" />
      ) : (
        <g stroke="var(--line)" fill="var(--raised)">
          <path d="M28 72h324l12-13H40Z" />
          <path d="M28 72h324v9H28Z" />
        </g>
      )}
      {above !== undefined && <path d={zone} fill={`url(#${hatch})`} />}
      {ticks}
      {target &&
        (dial ? (
          <path d="M186 9h8l-4 8Z" fill="var(--accent)" />
        ) : (
          <>
            <path d="M190 40v38" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M186 37h8l-4 7Z" fill="var(--accent)" />
          </>
        ))}
      {[-1, 0, 1].map((n) => (
        <text
          key={n}
          x={dial ? 190 + n * 122 : x((n + 1) / 2)}
          y={dial && n === 0 ? 66 : dial ? 159 : 115}
          textAnchor="middle"
        >
          {n !== 0 && !target ? "" : label(n * limit)}
        </text>
      ))}
      {f !== null &&
        (dial ? (
          <g>
            <path d={`M190 140L${radial(f, 94)}`} stroke="var(--accent)" strokeWidth="2.5" />
            <circle cx="190" cy="140" r="5" fill="var(--accent)" />
          </g>
        ) : (
          <g stroke="var(--accent)">
            <path d={`M${x(f)} 37v60`} strokeDasharray="3 3" />
            <path d={`M${x(f) - 5} 32h10l-5 8Z`} fill="var(--accent)" />
            <circle cx={x(f)} cy="76" r="4" fill="var(--surface)" strokeWidth="2" />
          </g>
        ))}
    </svg>
  );
}

export function ThresholdDistance({ alerts, status }: { alerts: CloseAlert[]; status?: InstrumentStatus }) {
  const { prefs } = useLook();
  const [id, select] = useState<number | null>(null);
  const rule =
    alerts.find((row) => row.id === id) ??
    alerts.find((row) => row.last_date && row.last_close !== null) ??
    alerts[0];
  const observed = rule?.last_date != null && rule.last_close != null && Number(rule.target) > 0;
  const measured = observed
    ? (100 * (Number(rule.last_close) - Number(rule.target))) / Number(rule.target)
    : NaN;
  const distance = Number.isFinite(measured) && !status ? measured : null;
  const limit = distance === null ? 5 : Math.max(5, 5 * Math.ceil(Math.abs(distance) / 5));
  const delta =
    distance === null
      ? "Unavailable"
      : distance === 0
        ? "At target"
        : `${Math.abs(distance).toLocaleString("en-US", { maximumSignificantDigits: 4 })}% ${distance > 0 ? "above" : "below"}`;
  return (
    <Panel
      className="threshold-distance"
      title="Trigger threshold"
      actions={
        alerts.length > 0 && (
          <select
            className="field-control"
            aria-label="Inspect threshold"
            value={rule.id}
            onChange={(e) => select(Number(e.target.value))}
          >
            {alerts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.symbol} · {row.direction === "at_or_above" ? "≥" : "≤"} {alertPrice(row.target)}
              </option>
            ))}
          </select>
        )
      }
    >
      <div className="threshold-plate">
        <div className="threshold-value">
          <small>
            {rule
              ? `${rule.symbol} · trigger at or ${rule.direction === "at_or_above" ? "above" : "below"}`
              : "Target price"}
          </small>
          <strong>{rule ? alertPrice(rule.target) : "—"}</strong>
          {rule && (
            <span>{rule.last_date ? `Session ${rule.last_date}` : "No stored close on this rule"}</span>
          )}
        </div>
        <div data-centrepiece={!!rule}>
          <DistanceScale
            target={rule ? alertPrice(rule.target) : undefined}
            distance={distance}
            limit={limit}
            dial={prefs.look === "dial"}
            above={rule ? rule.direction === "at_or_above" : undefined}
          />
        </div>
      </div>
      {status ? (
        <State {...status} />
      ) : (
        rule && (
          <>
            <dl className="threshold-facts">
              <div>
                <dt>Distance from target</dt>
                <dd>{delta}</dd>
              </div>
              <div>
                <dt>Last raw close</dt>
                <dd>{observed ? alertPrice(rule.last_close!) : "Unavailable"}</dd>
              </div>
              <div>
                <dt>Rule status</dt>
                <dd>{rule.status}</dd>
              </div>
            </dl>
            <footer>
              <i aria-hidden="true" />
              Trigger zone · at or {rule.direction === "at_or_above" ? "above" : "below"} target ·{" "}
              {rule.source?.provider ?? "Source unavailable"}
            </footer>
          </>
        )
      )}
    </Panel>
  );
}
