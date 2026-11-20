import { Button, EmptyState } from "../../design/primitives";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// When several instruments enter together, let the browser paint between mounts.
const waiting = new Set<() => void>();
let frame = 0;
function mountNext() {
  frame = 0;
  const mount = waiting.values().next().value;
  if (mount) {
    waiting.delete(mount);
    mount();
  }
  if (waiting.size) frame = requestAnimationFrame(mountNext);
}

// Fetch code just ahead of the viewport. Instantiating charts and starting
// their history queries waits until the reserved instrument is actually visible.
export function DeferredInstrument<T>({
  id,
  label,
  load,
  children,
}: {
  id: string;
  label: string;
  load: () => Promise<T>;
  children: (component: T) => ReactNode;
}) {
  const placeholder = useRef<HTMLElement>(null);
  const transferFocus = useRef(false);
  const [component, setComponent] = useState<T | null>(null);
  const [attempt, retry] = useState(0);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const node = placeholder.current;
    if (!node) return;
    let cancelled = false;
    let module: Promise<T> | undefined;
    const prepare = () => (module ??= load());
    const reportError = (reason: unknown) => {
      if (!cancelled) setError(reason);
    };
    let mount: (() => void) | undefined;
    const direct = !window.IntersectionObserver || location.hash === "#" + id;
    function reveal() {
      void prepare().then((result) => {
        if (cancelled) return;
        mount = () => {
          transferFocus.current = document.activeElement === node;
          setComponent(() => result);
        };
        if (direct || document.activeElement === node) mount();
        else {
          waiting.add(mount);
          if (!frame) frame = requestAnimationFrame(mountNext);
        }
      }, reportError);
    }
    let ahead: IntersectionObserver | undefined;
    let viewport: IntersectionObserver | undefined;
    if (direct) reveal();
    else {
      ahead = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          void prepare().catch(reportError);
          ahead?.disconnect();
        }
      }, { rootMargin: "190px 0px" });
      viewport = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          reveal();
          viewport?.disconnect();
        }
      });
      ahead.observe(node);
      viewport.observe(node);
    }
    return () => {
      cancelled = true;
      ahead?.disconnect();
      viewport?.disconnect();
      if (mount) waiting.delete(mount);
    };
  }, [id, load, attempt]);
  useLayoutEffect(() => {
    if (!component || !transferFocus.current) return;
    transferFocus.current = false;
    if (document.activeElement !== document.body) return;
    const target = document.getElementById(id);
    target?.setAttribute("tabindex", "-1");
    target?.focus({ preventScroll: true });
  }, [component, id]);
  if (component) return children(component);
  return (
    <section
      ref={placeholder}
      className="desk-card pending-instrument"
      id={id}
      tabIndex={-1}
      aria-busy={!error}
    >
      {error ? (
        <>
          <h2>{label}</h2>
          <EmptyState message="Instrument unavailable" detail="The display could not be loaded." />
          <Button
            onClick={() => {
              setError(null);
              retry((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <p role="status">{label}</p>
      )}
    </section>
  );
}
