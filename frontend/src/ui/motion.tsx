import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx, useInView, useReducedMotion, type Vars } from "./lib";

type RevealProps = Omit<HTMLAttributes<HTMLElement>, "children" | "className"> & {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  /** Position in the opening sequence, in milliseconds. */
  delay?: number;
};

/** A block that rises into place the first time it is on screen. */
export function Reveal({ as, children, className, delay = 0, ...rest }: RevealProps) {
  const Tag = as ?? "div";
  const [ref, seen] = useInView<HTMLElement>();

  return (
    <Tag
      {...rest}
      className={cx("rv", className)}
      data-seen={seen ? "true" : "false"}
      ref={ref}
      style={{ "--d": `${delay}ms` } as Vars}
    >
      {children}
    </Tag>
  );
}

type RollingNumberProps = {
  value: string;
  className?: string;
  /** Delay of the first roll-up, in milliseconds. */
  delay?: number;
  /** Roll time for later changes; short for scrub read-outs. */
  duration?: number;
};

/**
 * A figure whose digits roll to their value, column by column.
 * The real text sits in a visually hidden node; the rolling glyphs are drawn by CSS
 * from `data-ch` and generated content, so the figure reads and copies as plain text.
 */
export function RollingNumber({ value, className, delay = 0, duration }: RollingNumberProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <span className={className}>{value}</span>;
  }

  const chars = Array.from(value);

  return (
    <span className={cx("roll", className)} style={duration ? ({ "--roll-dur": `${duration}ms` } as Vars) : undefined}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="roll-row">
        {chars.map((char, index) => {
          const place = chars.length - index;
          if (char >= "0" && char <= "9") {
            return (
              <span className="roll-col" key={`d${place}`}>
                <span
                  className="roll-strip"
                  style={{ transform: `translateY(-${Number(char) * 10}%)`, animationDelay: `${delay + place * 45}ms` }}
                />
              </span>
            );
          }
          return <span className="roll-sym" data-ch={char} key={`s${place}`} />;
        })}
      </span>
    </span>
  );
}
