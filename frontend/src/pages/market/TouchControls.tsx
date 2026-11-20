import { Children, isValidElement, type OptionHTMLAttributes, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent, type RefObject, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "../../ui/lib";

/** Critically damped release, in pixels and pixels/second. Grabbing cancels at the presentation value. */
function useSpringPosition(paint: (value: number) => void) {
  const frame = useRef(0);
  const value = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  function stop() { cancelAnimationFrame(frame.current); }
  function place(next: number) { value.current = next; paint(next); }
  function settle(target: number, velocity = 0, done?: () => void) {
    stop();
    const distance = value.current - target;
    const start = performance.now();
    function tick(now: number) {
      const t = (now - start) / 1000;
      const offset = (distance + (velocity + 23 * distance) * t) * Math.exp(-23 * t);
      if (t > .6 || (t > .08 && Math.abs(offset) < .4)) { place(target); done?.(); return; }
      place(target + offset);
      frame.current = requestAnimationFrame(tick);
    }
    if (prefersReducedMotion() || Math.abs(distance) < .4) { place(target); done?.(); }
    else frame.current = requestAnimationFrame(tick);
  }
  return { stop, place, settle, value };
}

type Drag = { id: number; start: number; origin: number; last: number; time: number; velocity: number };

export function BottomSheet({ title, children, close, returnFocusRef }: {
  title: string; children: ReactNode; close: () => void; returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const spring = useSpringPosition(y => {
    if (plate.current) plate.current.style.transform = `translate3d(0,${y}px,0)`;
  });
  useLayoutEffect(() => {
    const node = dialog.current!;
    const old = document.body.style.overflow;
    const opener = returnFocusRef.current;
    node.showModal();
    document.body.style.overflow = "hidden";
    if (!prefersReducedMotion()) spring.place(plate.current!.offsetHeight);
    spring.settle(0);
    return () => { node.close(); document.body.style.overflow = old; if (opener?.isConnected) opener.focus({preventScroll:true}); };
    // The spring belongs to this particular opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnFocusRef]);
  function dismiss(velocity = 0) { spring.settle(plate.current!.offsetHeight + 4, velocity, close); }
  return createPortal(<dialog ref={dialog} className="wall-sheet" aria-label={title}
    onCancel={e => { e.preventDefault(); dismiss(); }} onClick={e => { if (e.target === dialog.current) dismiss(); }}>
    <div className="sheet-plate" ref={plate}>
      <header className="sheet-grip" onPointerDown={e => {
        spring.stop(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {id:e.pointerId, start:e.clientY, origin:spring.value.current, last:e.clientY, time:e.timeStamp, velocity:0};
      }} onPointerMove={e => {
        const d = drag.current;
        if (d?.id !== e.pointerId) return;
        spring.place(Math.max(0, d.origin + e.clientY - d.start));
        d.velocity = (e.clientY-d.last)*1000/Math.max(1,e.timeStamp-d.time); d.last=e.clientY; d.time=e.timeStamp;
      }} onPointerUp={() => {
        const d=drag.current; drag.current=null;
        if (!d) return;
        if (spring.value.current > plate.current!.offsetHeight*.32 || d.velocity > 550) dismiss(d.velocity);
        else spring.settle(0,d.velocity);
      }} onPointerCancel={() => {drag.current=null; spring.settle(0);}}>
        <i aria-hidden="true" /><h2>{title}</h2>
      </header>
      <button className="sheet-close btn" type="button" onClick={() => dismiss()} aria-label="Close sheet">×</button>
      <div className="sheet-options">{children}</div>
    </div>
  </dialog>, document.querySelector(".wall") ?? document.body);
}

/** Use the native form value and change event for existing consumers. */
export function WallSelect({ compact, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { compact: boolean }) {
  const select = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened,setOpened] = useState(false);
  const options = Children.toArray(props.children).flatMap(child => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return [];
    return [{value: String(child.props.value ?? ""), text:child.props.children, disabled:child.props.disabled}];
  });
  const current = options.find(o => o.value === String(props.value));
  return <>
    <select {...props} ref={select} hidden={compact} id={compact ? undefined : props.id} />
    {compact && <button ref={trigger} className="field-control select-trigger" id={props.id} type="button" disabled={props.disabled}
      aria-haspopup="dialog" aria-invalid={props["aria-invalid"]} onClick={() => setOpened(true)}>
      {current?.text ?? options[0]?.text ?? String(props.value)} <span>⌄</span>
    </button>}
    {compact && opened && <BottomSheet title={document.querySelector(`label[for="${props.id}"]`)?.textContent?.trim() || "Choose an option"} close={() => setOpened(false)} returnFocusRef={trigger}>
      {options.map(o => <button type="button" aria-pressed={o.value === String(props.value)} disabled={o.disabled} key={o.value} onClick={() => {
        const node=select.current!;
        node.value=o.value; node.dispatchEvent(new Event("change",{bubbles:true})); setOpened(false);
      }}>{o.text}</button>)}
    </BottomSheet>}
  </>;
}

export function SectorCarousel({ pages, index, onSelect }: { pages: ReactNode[]; index: number; onSelect: (index: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const width = useRef(1);
  const drag = useRef<Drag | null>(null);
  const consumed = useRef(false);
  const velocity = useRef(0);
  const spring = useSpringPosition(x => { if(track.current) track.current.style.transform=`translate3d(${x}px,0,0)`; });
  useLayoutEffect(() => {
    const node=viewport.current!;
    width.current=node.clientWidth;
    spring.settle(-index*width.current, velocity.current);
    velocity.current=0;
    const resize = new ResizeObserver(() => {
      if(width.current===node.clientWidth) return;
      width.current=node.clientWidth; spring.stop(); spring.place(-index*width.current);
    });
    resize.observe(node); return () => resize.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  function finish(e: PointerEvent, cancelled: boolean) {
    const d=drag.current;
    drag.current=null;
    if (!d) return;
    if (!consumed.current) { spring.settle(-index * width.current); return; }
    const v=e.timeStamp-d.time > 100 ? 0 : d.velocity;
    const next=cancelled ? index : Math.max(0,Math.min(pages.length-1,Math.round(-(spring.value.current+v*.12)/width.current)));
    velocity.current=v;
    if(next===index) spring.settle(-index*width.current,v);
    else onSelect(next);
  }
  return <div className="sector-carousel" ref={viewport} aria-label="Stocks by sector" aria-roledescription="carousel"
    onPointerDown={e => {
      consumed.current=false; spring.stop();
      drag.current={id:e.pointerId,start:e.clientX,last:e.clientX,time:e.timeStamp,origin:spring.value.current,velocity:0};
    }} onPointerMove={e => {
      const d=drag.current; if(d?.id!==e.pointerId) return;
      const dx=e.clientX-d.start;
      if(!consumed.current && Math.abs(dx)<6) return;
      consumed.current=true; e.currentTarget.setPointerCapture(e.pointerId);
      spring.place(Math.min(0,Math.max(-(pages.length-1)*width.current,d.origin+dx)));
      d.velocity=(e.clientX-d.last)*1000/Math.max(1,e.timeStamp-d.time);d.last=e.clientX;d.time=e.timeStamp;
    }} onPointerUp={e => finish(e,false)} onPointerCancel={e => finish(e,true)}
    onClickCapture={e => {if(consumed.current){e.stopPropagation();e.preventDefault();consumed.current=false;}}}>
    <div className="sector-track" ref={track}>{pages.map((page,i) => <div className="sector-slide" inert={i!==index} key={i}>{page}</div>)}</div>
  </div>;
}
