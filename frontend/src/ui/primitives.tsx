import { useRef } from "react";
import type { ButtonHTMLAttributes, ElementType, HTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cx, type Direction, type Vars } from "./lib";

/* Panel ─ the framed surface every block on the wall sits in. */

type PanelProps = HTMLAttributes<HTMLElement> & { as?: ElementType };

export function Panel({ as, className, children, ...rest }: PanelProps) {
  const Tag = as ?? "section";
  return (
    <Tag {...rest} className={cx("panel", className)} data-panel="">
      {children}
    </Tag>
  );
}

type PanelHeadProps = {
  title: string;
  titleId?: string;
  /** Short coded index shown before the title, for example "02". */
  code?: string;
  sub?: ReactNode;
  children?: ReactNode;
};

export function PanelHead({ title, titleId, code, sub, children }: PanelHeadProps) {
  return (
    <header className="panel-head">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {code ? (
            <span aria-hidden="true" className="lbl text-fg-4">
              {code}
            </span>
          ) : null}
          <h2 className="panel-title" id={titleId}>
            {title}
          </h2>
        </div>
        {sub ? <p className="panel-sub">{sub}</p> : null}
      </div>
      {children ? <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function PanelBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("panel-body", className)}>
      {children}
    </div>
  );
}

/* Stat ─ a labelled figure. */

type StatProps = {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  /** The figure is missing: drawn quiet, never loud. */
  empty?: boolean;
  className?: string;
};

export function Stat({ label, value, caption, empty = false, className }: StatProps) {
  return (
    <div className={cx("stat", className)} data-stat="">
      <p className="lbl">{label}</p>
      <p className="stat-value" data-empty={empty ? "true" : undefined}>
        {value}
      </p>
      {caption ? <p className="note">{caption}</p> : null}
    </div>
  );
}

/* Pill ─ a coded status. */

type PillTone = "plain" | "solid" | "signal" | "quiet";
const pillTone: Record<PillTone, string> = { plain: "", solid: "pill-solid", signal: "pill-signal", quiet: "pill-quiet" };

export function Pill({ tone = "plain", dot = false, className, children }: { tone?: PillTone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cx("pill", pillTone[tone], className)}>
      {dot ? <span aria-hidden="true" className="pill-dot" /> : null}
      {children}
    </span>
  );
}

/* Button ─ explicit variants, one press response. */

type ButtonVariant = "solid" | "ghost" | "signal";
type ButtonSize = "md" | "sm";
const buttonVariant: Record<ButtonVariant, string> = { solid: "btn-solid", ghost: "btn-ghost", signal: "btn-signal" };

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cx("btn", buttonVariant[variant], size === "sm" && "btn-sm", className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant = "ghost", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button {...rest} className={buttonClass(variant, size, className)} type={type} />;
}

type ButtonLinkProps = LinkProps & { variant?: ButtonVariant; size?: ButtonSize };

export function ButtonLink({ variant = "ghost", size = "md", className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={buttonClass(variant, size, className)} />;
}

/* Segmented control ─ one indicator slides under the labels. */

type SegmentedOption<T extends string> = { value: T; label: string; ariaLabel?: string };

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  className?: string;
};

export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  const startX = useRef<number | null>(null);
  const swiped = useRef(false);
  return (
    <div aria-label={label} className={cx("seg", className)} role="group"
      onPointerDown={e => {if(e.pointerType==="touch"){ startX.current=e.clientX; swiped.current=false; }}}
      onPointerMove={e => {
        if(startX.current==null || Math.abs(e.clientX-startX.current)<8) return;
        const box=e.currentTarget.getBoundingClientRect();
        const next=Math.max(0,Math.min(options.length-1,Math.floor((e.clientX-box.left)/box.width*options.length)));
        if(next!==index) onChange(options[next].value);
        swiped.current=true;
      }}
      onPointerUp={() => {startX.current=null;}} onPointerCancel={() => {startX.current=null;}}
      onClickCapture={e => {if(swiped.current){swiped.current=false;e.stopPropagation();}}} style={{ "--n": options.length, "--i": index } as Vars}>
      <span aria-hidden="true" className="seg-ind" />
      {options.map((option) => (
        <button
          aria-label={option.ariaLabel}
          aria-pressed={option.value === value}
          className="seg-btn"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* Empty state ─ says what is missing, quietly, in the shape of the block. */

export function EmptyNote({ message, detail, className }: { message: string; detail?: ReactNode; className?: string }) {
  return (
    <div className={cx("empty", className)}>
      <span aria-hidden="true" className="empty-mark" />
      <p className="min-w-0">
        <span className="font-medium text-fg-2">{message}</span>
        {detail ? <span className="empty-detail">{detail}</span> : null}
      </p>
    </div>
  );
}

/* Skeleton ─ takes the size of what it stands for. */

export function Skeleton({ className, style }: { className?: string; style?: Vars }) {
  return <span aria-hidden="true" className={cx("sk", className)} style={style} />;
}

/* Delta ─ direction as a glyph, so it does not rest on colour. */

const deltaGlyph: Record<Direction, string> = { up: "▲", down: "▼", flat: "◆" };

export function Delta({ dir }: { dir: Direction }) {
  return (
    <span aria-hidden="true" className="delta" data-dir={dir}>
      {deltaGlyph[dir]}
    </span>
  );
}
