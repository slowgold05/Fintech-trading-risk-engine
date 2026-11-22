import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import type { Provenance } from "../api";

type ElementProps = Omit<HTMLAttributes<HTMLElement>, "title">;
type Content = { children?: ReactNode };
function slot(name: string) {
  return function Region({ className = "", ...props }: ElementProps) {
    return <div className={`nk-slot nk-${name} ${className}`} {...props} />;
  };
}
export function Page({ title, eyebrow, description, actions, children, layout = "standard", testId, className = "", ...props }: ElementProps & {
  title: string; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode; layout?: "standard" | "analysis"; testId?: string;
}) {
  return <section className={`nk-page ${className}`} data-testid={testId} {...props}>
    <header className="nk-page-head"><div>{eyebrow && <small>{eyebrow}</small>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions}</header>
    <div className={`nk-layout nk-layout-${layout}`}>{children}</div>
  </section>;
}
Page.Main = slot("main");
Page.Aside = slot("aside");
Page.Full = slot("full");

export function Panel({ title, subtitle, actions, children, footer, className = "", ...props }: ElementProps & {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; footer?: ReactNode;
}) {
  return <section className={`nk-panel ${className}`} {...props}>
    {(title || subtitle || actions) && <header><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{actions}</header>}
    {children}{footer && <footer>{footer}</footer>}
  </section>;
}
export function Stat({ label, value, unit, delta, tone = "default", source, help, ...props }: ElementProps & {
  label: ReactNode; value: ReactNode; unit?: ReactNode; delta?: ReactNode; tone?: "default"|"up"|"down"; source?: ReactNode; help?: ReactNode;
}) {
  return <div className="nk-stat" {...props}><span>{label} {help}</span><strong>{value ?? "Unavailable"} {value != null && unit}</strong>
    {delta != null && <span data-tone={tone}>{delta}</span>}{source && <small>{source}</small>}</div>;
}
export function Button({ variant = "quiet", busy, disabled, type = "button", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary"|"quiet"|"danger"; busy?: boolean;
}) {
  return <button className={`nk-button ${className}`} data-variant={variant} type={type} aria-busy={busy || undefined} disabled={busy || disabled} {...props} />;
}
export function Field({ id, label, hint, error, children, ...props }: ElementProps & { id: string; label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const described = [hint && id+"-hint", error && id+"-error"].filter(Boolean).join(" ");
  return <div className="nk-field" {...props}><label htmlFor={id}>{label}</label>
    {isValidElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>(children) ?
      cloneElement(children, { id, "aria-describedby": [children.props["aria-describedby"], described].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined }) : children}
    {hint && <small id={id+"-hint"}>{hint}</small>}{error && <p id={id+"-error"} role="alert">{error}</p>}
  </div>;
}
export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: "left"|"right"|"center" };
export function Table<T>({ caption, rows, columns, rowKey, empty, ...props }: ElementProps & {
  caption: string; rows: readonly T[]; columns: readonly Column<T>[]; rowKey: (row: T) => string|number; empty?: ReactNode;
}) {
  return <div className="nk-scroll" {...props}><table><caption>{caption}</caption><thead><tr>{columns.map(c =>
    <th scope="col" key={c.key} style={{textAlign: c.align}}>{c.header}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={rowKey(row)}>{columns.map(c =>
      <td key={c.key} style={{textAlign: c.align}}>{c.cell(row)}</td>)}</tr>) :
      <tr><td colSpan={columns.length}>{empty ?? "No rows available."}</td></tr>}</tbody>
  </table></div>;
}
export function Sheet({ open, onOpenChange, title, children, footer, returnFocusRef, ...props }: ElementProps & {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; footer?: ReactNode; returnFocusRef?: RefObject<HTMLElement|null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = returnFocusRef?.current ?? document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll: true});
    };
  }, [open,returnFocusRef]);
  if (!open) return null;
  return <dialog className="nk-sheet" ref={ref} aria-labelledby={titleId} {...props}
    onCancel={event => { event.preventDefault(); onOpenChange(false); }}
    onClick={event => { if (event.target === ref.current) {
      const box = ref.current!.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onOpenChange(false);
    } }}>
    <header><h2 id={titleId}>{title}</h2><Button onClick={() => onOpenChange(false)}>Close</Button></header>
    {children}{footer && <footer>{footer}</footer>}
  </dialog>;
}
export function ChartFrame({ title, source, summary, controls, children, footer, ...props }: ElementProps & Content & {
  title: string; source?: ReactNode; summary: ReactNode; controls?: ReactNode; footer?: ReactNode;
}) {
  return <Panel title={title} subtitle={source} actions={controls} footer={footer} {...props}><figure>{children}<figcaption>{summary}</figcaption></figure></Panel>;
}
export function State({ kind, title, detail, action, ...props }: ElementProps & {
  kind: "loading"|"empty"|"error"|"unavailable"; title: string; detail?: ReactNode; action?: ReactNode;
}) {
  return <div className="nk-state" data-testid={`night-state-${kind}`} aria-live="polite" role="status" {...props}><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}
const metrics = {
  accountValue: "Cash plus the marked value of every position, in USD, at the latest priced session. Unavailable when a holding has no mark.",
  allocation: "Position value divided by total account value, as a percentage at the priced session. Unavailable when valuation is incomplete or the denominator is zero.",
  dailyReturn: "Change in close divided by the previous observed close, as a percentage across two sessions. Requires two compatible prices.",
  pnl: "Marked value less cost basis, in USD at the priced session. Requires a valid mark and basis.",
} as const;
export type MetricId = keyof typeof metrics;
export function MetricHelp({ metric, ...props }: ElementProps & { metric: MetricId }) {
  return <details className="nk-help" {...props}><summary>Metric definition</summary><p>{metrics[metric]}</p></details>;
}
export function DataStamp({ source, ...props }: ElementProps & { source: Provenance|null }) {
  return <small className="nk-stamp" data-testid="close-provenance" data-session-date={source?.session_date ?? ""}
    data-source={source?.provider ?? ""} data-basis={source?.basis ?? ""} {...props}>{source ?
    [source.provider, source.session_date ?? source.observed_at ?? "Date unavailable",source.basis.replace("_"," "),source.coverage].join(" · ") :
    "Source unavailable"}</small>;
}
