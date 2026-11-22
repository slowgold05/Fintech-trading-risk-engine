import { reducedMotion } from "../night/looks/preferences";
import { useArrival } from "../components/market/wallMotion";
import {
  useLayoutEffect,
  useState,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Tray } from "@phosphor-icons/react";

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLElement>) {
  const ref = useArrival<HTMLElement>();
  return (
    <section ref={ref} {...props} className={`desk-card ${className}`}>
      {children}
    </section>
  );
}

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`desk-badge ${className}`}>{children}</span>;
}

export function Button({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`desk-button ${className}`} {...props} />;
}

export function Stat({ label, value, caption }: { label: string; value: string; caption?: string | null }) {
  return (
    <div className="desk-stat">
      <span>{label}</span>
      <strong>
        <Figure value={value} />
      </strong>
      {caption && <small>{caption}</small>}
    </div>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`desk-input ${className}`} />;
}

export function Tooltip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div role="tooltip" className="desk-tooltip" style={style}>
      {children}
    </div>
  );
}

export function TableRow({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className="desk-table-row">
      {children}
    </tr>
  );
}

export function EmptyState({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="desk-empty">
      <Tray size={21} aria-hidden="true" />
      <div>
        <strong>{message}</strong>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  );
}

export function Skeleton({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div role="status" className={`desk-skeleton ${className}`}>
      <span className="sr-only">{label}</span>
      <i />
      <i />
      <i />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  accessibleLabel,
  format = (v) => v,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  accessibleLabel?: (option: T) => string;
  format?: (option: T) => string;
}) {
  const start = useRef<number | null>(null);
  const dragged = useRef(false);
  return (
    <div
      onPointerDown={(e) => {
        if (e.pointerType === "touch") {
          start.current = e.clientX;
          dragged.current = false;
        }
      }}
      onPointerMove={(e) => {
        if (start.current === null || Math.abs(e.clientX - start.current) < 6) return;
        dragged.current = true;
        const el = e.currentTarget,
          pill = el.firstElementChild as HTMLElement;
        if (el.hasPointerCapture(e.pointerId) === false && e.isTrusted) el.setPointerCapture(e.pointerId);
        const x = ((e.clientX - el.getBoundingClientRect().left) / el.clientWidth) * options.length - 0.5;
        pill.style.transition = "none";
        pill.style.transform = `translateX(${Math.max(0, Math.min(options.length - 1, x)) * 100}%)`;
      }}
      onPointerUp={(e) => {
        if (start.current === null) return;
        start.current = null;
        if (!dragged.current) return;
        const el = e.currentTarget,
          rect = el.getBoundingClientRect();
        const index = Math.max(
          0,
          Math.min(options.length - 1, Math.floor(((e.clientX - rect.left) / rect.width) * options.length)),
        );
        (el.firstElementChild as HTMLElement).style.cssText = "";
        onChange(options[index]);
      }}
      onPointerCancel={(e) => {
        start.current = null;
        dragged.current = false;
        (e.currentTarget.firstElementChild as HTMLElement).style.cssText = "";
      }}
      onClickCapture={(e) => {
        if (dragged.current) {
          e.stopPropagation();
          dragged.current = false;
        }
      }}
      className="desk-segmented"
      aria-label={label}
      role="group"
      style={{ "--segments": options.length, "--selected": options.indexOf(value) } as CSSProperties}
    >
      <span className="desk-selection" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          aria-label={accessibleLabel?.(option)}
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}

function Digit({ digit, initial, delay }: { digit: string; initial?: string; delay: number }) {
  const track = useRef<HTMLSpanElement>(null);
  const old = useRef<HTMLSpanElement>(null);
  const previous = useRef(initial ?? digit);
  const numeric = /^\d$/.test(digit);
  useLayoutEffect(() => {
    const strip = track.current;
    const outgoing = old.current;
    const last = previous.current;
    previous.current = digit;
    if (
      last === digit ||
      !numeric ||
      !strip?.animate ||
      !outgoing ||
      reducedMotion()
    )
      return;
    outgoing.textContent = /^\d$/.test(last) ? last : digit;
    const rect = strip.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
    const animation = strip.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], {
      duration: 460,
      delay,
      fill: "backwards",
      easing: "cubic-bezier(.23,1,.32,1)",
    });
    return () => animation.cancel();
  }, [digit, delay, numeric]);
  return (
    <span className="desk-digit" data-numeric={numeric}>
      <span ref={track} className="digit-track" style={{ "--digit-delay": delay + "ms" } as CSSProperties}>
        {numeric && (
          <span ref={old} className="digit-previous">
            {digit}
          </span>
        )}
        {digit}
      </span>
    </span>
  );
}

export function Figure({ value }: { value: string }) {
  // A cold quote is a single text run. Install the rolling tracks only when a
  // real value changes, carrying its old digits into the first transition.
  const [reading, setReading] = useState<{ value: string; previous?: string }>({ value });
  if (reading.value !== value) setReading({ value, previous: reading.value });
  if (reading.previous === undefined) {
    return (
      <span className="desk-figure">
        <span className="figure-value">{value}</span>
      </span>
    );
  }
  return (
    <span className="desk-figure">
      <span className="sr-only">{value}</span>
      <span aria-hidden="true">
        {Array.from(value).map((digit, i) => (
          <Digit
            key={value.length - i}
            digit={digit}
            initial={reading.previous?.at(i - value.length)}
            delay={Math.min(7, i) * 24}
          />
        ))}
      </span>
    </span>
  );
}
