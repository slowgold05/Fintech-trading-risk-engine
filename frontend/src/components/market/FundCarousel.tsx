import { useLayoutEffect, useRef } from "react";
import { dragSpring } from "../../design/dragSpring";
import type { Ridge } from "./terrainData";

export function FundCarousel({
  ridges,
  active,
  choose,
}: {
  ridges: Ridge[];
  active: number;
  choose: (i: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const spring = useRef<ReturnType<typeof dragSpring> | null>(null);
  const drag = useRef<{
    start: number;
    base: number;
    last: number;
    stamp: number;
    velocity: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const landing = useRef<number | null>(null);
  // Each tile takes one third of the instrument width. The inset centers the active tile.
  const step = () => (rail.current?.parentElement?.clientWidth ?? 0) / 3;
  useLayoutEffect(() => {
    const node = rail.current!;
    const motor = dragSpring((x) => {
      node.style.transform = `translate3d(${x}px,0,0)`;
    });
    spring.current = motor;
    const resize = () => motor.place(-Number(node.dataset.active) * step());
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node.parentElement!);
    return () => {
      motor.stop();
      observer.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    if (!drag.current && landing.current !== active) spring.current?.settle(-active * step());
    landing.current = null;
  }, [active]);
  return (
    <div className="fund-carousel" role="group" aria-label="Choose a sector fund">
      <div
        ref={rail}
        className="fund-track"
        data-active={active}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          const motor = spring.current!;
          motor.stop();
          suppressClick.current = false;
          drag.current = {
            start: e.clientX,
            base: motor.position,
            last: e.clientX,
            stamp: e.timeStamp,
            velocity: 0,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.start;
          if (!d.moved && Math.abs(dx) < 5) return;
          d.moved = true;
          if (e.isTrusted) e.currentTarget.setPointerCapture(e.pointerId);
          d.velocity = (1000 * (e.clientX - d.last)) / Math.max(1, e.timeStamp - d.stamp);
          d.last = e.clientX;
          d.stamp = e.timeStamp;
          const next = d.base + dx,
            lower = -(ridges.length - 1) * step();
          spring.current!.place(next > 0 ? next * 0.2 : next < lower ? lower + (next - lower) * 0.2 : next);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved) {
            spring.current?.settle(-active * step());
            return;
          }
          suppressClick.current = true;
          const velocity = e.timeStamp - d.stamp > 80 ? 0 : Math.max(-1800, Math.min(1800, d.velocity));
          const next = Math.max(
            0,
            Math.min(ridges.length - 1, Math.round(-(spring.current!.position + velocity * 0.09) / step())),
          );
          landing.current = next;
          choose(next);
          spring.current!.settle(-next * step(), velocity);
        }}
        onPointerCancel={() => {
          drag.current = null;
          spring.current?.settle(-active * step());
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        {ridges.map((ridge, i) => (
          <button
            key={ridge.symbol}
            type="button"
            aria-pressed={i === active}
            tabIndex={i === active ? 0 : -1}
            onClick={() => choose(i)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
              e.preventDefault();
              const next = Math.max(0, Math.min(ridges.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)));
              choose(next);
              rail.current?.querySelectorAll("button")[next]?.focus({ preventScroll: true });
            }}
          >
            <b>{ridge.symbol}</b>
            <span>{ridge.sector}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
