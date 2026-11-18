import { reducedMotion } from "../night/looks/preferences";
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { dragSpring } from "./dragSpring";

// A top-layer dialog provides focus containment, backdrop isolation and focus return.
export default function TouchSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const motor = useRef<ReturnType<typeof dragSpring> | null>(null);
  const gesture = useRef<{
    start: number;
    base: number;
    last: number;
    time: number;
    velocity: number;
  } | null>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    const shell = dialog.current!,
      card = panel.current!;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    shell.showModal();
    document.body.style.overflow = "hidden";
    (card.querySelector<HTMLElement>('[aria-selected="true"]') ?? card.querySelector("button"))?.focus({
      preventScroll: true,
    });
    const height = card.offsetHeight;
    const spring = dragSpring((y) => {
      card.style.transform = `translate3d(0,${y}px,0)`;
      shade.current!.style.opacity = String(Math.min(1, Math.max(0, 1 - y / height)));
    });
    motor.current = spring;
    if (!reducedMotion()) spring.place(height);
    spring.settle(0);
    return () => {
      spring.stop();
      shell.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  function dismiss(velocity = 0) {
    motor.current?.settle(panel.current!.offsetHeight, velocity, () => close.current());
  }
  return (
    <dialog
      ref={dialog}
      className="touch-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <div ref={shade} className="sheet-shade" onClick={() => dismiss()} />
      <div ref={panel} className="sheet-panel">
        <header
          className="sheet-handle"
          onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0 || (e.target as Element).closest("button")) return;
            motor.current!.stop();
            if (e.isTrusted) e.currentTarget.setPointerCapture(e.pointerId);
            gesture.current = {
              start: e.clientY,
              base: motor.current!.position,
              last: e.clientY,
              time: e.timeStamp,
              velocity: 0,
            };
          }}
          onPointerMove={(e) => {
            const d = gesture.current;
            if (!d) return;
            d.velocity = (1000 * (e.clientY - d.last)) / Math.max(1, e.timeStamp - d.time);
            d.time = e.timeStamp;
            d.last = e.clientY;
            const y = d.base + e.clientY - d.start;
            motor.current!.place(y < 0 ? y * 0.15 : y);
          }}
          onPointerCancel={() => {
            gesture.current = null;
            motor.current?.settle(0);
          }}
          onPointerUp={(e) => {
            const d = gesture.current;
            gesture.current = null;
            if (!d) return;
            const velocity = e.timeStamp - d.time > 80 ? 0 : Math.max(-2200, Math.min(2200, d.velocity));
            if (
              velocity > 500 ||
              (velocity >= 0 && motor.current!.position > panel.current!.offsetHeight * 0.32)
            )
              dismiss(velocity);
            else motor.current!.settle(0, velocity);
          }}
        >
          <i aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label="Close sheet" onClick={() => dismiss()}>
            <X size={20} />
          </button>
        </header>
        <div
          className="sheet-body"
          onClick={(e) => {
            if ((e.target as Element).closest('[role="option"], a[href]')) dismiss();
          }}
        >
          {children}
        </div>
      </div>
    </dialog>
  );
}
