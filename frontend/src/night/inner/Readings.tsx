import { useState, type ReactNode } from "react";
import { useLook } from "../looks/preferences";
import { State } from "../kit";
import { fixed, polar, sector, valid } from "./geometry";
import type { InstrumentStatus } from "./SeriesInstrument";
import "./instruments.css";

export type Share = { name: string; value: number };
export function RankedRow({
  name,
  value,
  max,
  display,
  selected = false,
  onSelect,
}: {
  name: string;
  value: number | null;
  max: number;
  display: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const size = valid(value) && max > 0 ? Math.min(100, (Math.abs(value) * 100) / max) : 0;
  const content = (
    <>
      <span>{name}</span>
      <i className="ins-inline-mark" aria-hidden="true" data-loss={valid(value) && value < 0}>
        <i style={{ width: size + "%" }} />
      </i>
      <b>{display}</b>
    </>
  );
  return onSelect ? (
    <button type="button" className="ins-rank" aria-pressed={selected} onClick={onSelect}>
      {content}
    </button>
  ) : (
    <div className="ins-rank">{content}</div>
  );
}

export function ShareInstrument({
  parts,
  label,
  format,
  total: denominator,
  status,
  centrepiece = false,
}: {
  parts: readonly Share[];
  total?: number;
  centrepiece?: boolean;
  label: string;
  format: (value: number) => string;
  status?: InstrumentStatus;
}) {
  const { prefs } = useLook();
  const [chosen, setChosen] = useState<string>();
  const sum = parts.reduce((sum, p) => sum + p.value, 0);
  const total = denominator ?? sum;
  const ready =
    sum > 0 &&
    sum <= total * 1.001 &&
    !status &&
    parts.every((p) => valid(p.value) && p.value >= 0) &&
    valid(total) &&
    total > 0;
  const focus = parts.find((p) => p.name === chosen) ?? parts[0];
  const dial = prefs.look === "dial";
  let start = 0;
  return (
    <div className="share-instrument" data-centrepiece={centrepiece}>
      <svg
        className="share-graphic"
        role="img"
        aria-label={label}
        viewBox={dial ? "0 0 320 320" : "0 0 270 136"}
      >
        {dial ? (
          <>
            <circle cx="160" cy="160" r="146" fill="#1e211d" stroke="#52574e" />
            {Array.from({ length: 80 }, (_, i) => (
              <path
                key={i}
                stroke="#9ca193"
                d={`M${polar((i * Math.PI) / 40, 143)}L${polar((i * Math.PI) / 40, i % 5 === 0 ? 132 : 137)}`}
              />
            ))}
            <circle cx="160" cy="160" r="96" stroke="#454941" fill="#111311" />
          </>
        ) : (
          <path d="M12 115h204l38-23H50Z" fill="#242728" stroke="#5d6260" />
        )}
        {ready &&
          parts.map((p, i) => {
            const from = start;
            start = Math.min(1, start + p.value / total);
            if (!p.value) return null;
            const fill = p.name === focus?.name ? "var(--accent)" : `hsl(70 3% ${34 + (i % 5) * 9}%)`;
            const y = 112 - 80 * from,
              h = (80 * p.value) / total,
              top = y - h;
            return (
              <g
                key={p.name}
                onClick={() => setChosen(p.name)}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setChosen(p.name);
                }}
              >
                {dial ? (
                  <path
                    d={sector(
                      from * 2 * Math.PI,
                      Math.max(from * 2 * Math.PI, start * 2 * Math.PI - 0.008),
                      96,
                      130
                    )}
                    fill={fill}
                  />
                ) : (
                  <>
                    <path d={`M13 ${y}h200v${-h}H13Z`} fill={fill} stroke="#242626" strokeWidth=".8" />
                    <path
                      d={`M213 ${y}l38,-23v${-h}l-38,23Z`}
                      fill={fill}
                      style={{ filter: "brightness(.65)" }}
                    />
                    {start >= Math.min(1, sum / total) - 1e-9 && (
                      <path d={`M13 ${top}h200l38,-23H51Z`} fill="#777b77" />
                    )}
                  </>
                )}
              </g>
            );
          })}
        {dial && ready && (
          <>
            <text x="160" y="168" textAnchor="middle" className="share-value">
              {format(focus.value)}
            </text>
            <text x="160" y="193" textAnchor="middle">
              {focus.name}
            </text>
          </>
        )}
      </svg>
      {ready ? (
        <ol>
          {parts.map((p) => (
            <li
              key={p.name}
              onFocus={() => setChosen(p.name)}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") setChosen(p.name);
              }}
            >
              <RankedRow
                {...p}
                max={total}
                display={format(p.value)}
                selected={p.name === focus.name}
                onSelect={() => setChosen(p.name)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <State
          {...(status ?? {
            kind: "unavailable",
            title: "A positive, fully valued total fills this instrument.",
          })}
        />
      )}
    </div>
  );
}

export function ValueGauge({
  label,
  value,
  min,
  max,
  format,
  centrepiece = false,
}: {
  centrepiece?: boolean;
  label: string;
  value: number | null;
  min: number;
  max: number;
  format: (v: number) => string;
}) {
  const { prefs } = useLook();
  const ready = valid(value) && valid(min) && valid(max) && max > min;
  const f = ready ? Math.max(0, Math.min(1, (value - min) / (max - min))) : null;
  const dial = prefs.look === "dial";
  return (
    <div className="ins-gauge" data-centrepiece={centrepiece} tabIndex={ready ? 0 : undefined}>
      <div>
        <small>{label}</small>
        <strong>{ready ? format(value) : "Unavailable"}</strong>
      </div>
      <svg role="img" aria-label={label} viewBox={dial ? "12 42 296 158" : "0 0 320 38"}>
        {dial && <path d={sector(-Math.PI / 2, Math.PI / 2, 88, 108)} fill="#373a35" />}
        {Array.from({ length: 49 }, (_, i) => {
          const x = 4 + i * 6.5,
            a = -Math.PI / 2 + (Math.PI * i) / 48;
          return (
            <path
              key={i}
              stroke="#979c93"
              strokeWidth={i % 6 === 0 ? 2 : 1}
              d={
                dial
                  ? `M${polar(a, 114)}L${polar(a, i % 6 === 0 ? 99 : 108)}`
                  : `M${x} 28v-${i % 6 === 0 ? 19 : 10}`
              }
            />
          );
        })}
        {f !== null &&
          (dial ? (
            <path d={`M160 160L${polar((f - 0.5) * Math.PI, 105)}`} stroke="var(--accent)" strokeWidth="3" />
          ) : (
            <path d={`M${fixed(4 + 312 * f)} 3v30`} stroke="var(--accent)" strokeWidth="4" />
          ))}
      </svg>
      {ready && (
        <span className="ins-gauge-position">
          {(((value - min) * 100) / (max - min)).toFixed(1)}% from low
        </span>
      )}
      <div className="ins-gauge-scale">
        <small>{valid(min) ? format(min) : "—"}</small>
        <small>{valid(max) ? format(max) : "—"}</small>
      </div>
    </div>
  );
}
