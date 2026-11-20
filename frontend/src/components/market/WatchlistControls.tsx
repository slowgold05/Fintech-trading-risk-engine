import { cloneElement, isValidElement, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

type ElementProps = Omit<HTMLAttributes<HTMLElement>, "title">;

export function Panel({ headingId, title, subtitle, actions, children, footer, className = "", ...props }: ElementProps & {
  headingId?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; footer?: ReactNode;
}) {
  return <section className={`nk-panel ${className}`} {...props}>
    {(title || subtitle || actions) && <header><div>{title && <h2 id={headingId}>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{actions}</header>}
    {children}{footer && <footer>{footer}</footer>}
  </section>;
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
export function State({ kind, title, detail, action, ...props }: ElementProps & {
  kind: "loading"|"empty"|"error"|"unavailable"; title: string; detail?: ReactNode; action?: ReactNode;
}) {
  return <div className="nk-state" data-state={kind} aria-live="polite" role="status" {...props}><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}
