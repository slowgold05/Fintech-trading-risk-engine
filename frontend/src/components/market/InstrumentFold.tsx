import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";

// The anchor lives on the closed summary until the deferred instrument owns it.
export function InstrumentFold({
  compact,
  id,
  title,
  caption,
  preview,
  children,
}: {
  compact: boolean;
  id: string;
  title: string;
  caption: string;
  preview?: ReactNode;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(location.hash === "#" + id);
  const [visited, setVisited] = useState(!compact || opened);
  const fold = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!compact) return;
    function navigate() {
      if (location.hash === "#" + id && fold.current) fold.current.open = true;
    }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, [compact, id]);
  return (
    <details
      ref={fold}
      className={compact ? "instrument-fold" : undefined}
      style={compact ? undefined : { display: "contents" }}
      open={!compact || opened}
      onToggle={(event) => {
        if (compact) setOpened(event.currentTarget.open);
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary hidden={!compact} id={visited ? undefined : id}>
        <span>
          <b>{title}</b>
          <small>{caption}</small>
        </span>
        {preview}
        <CaretDown size={18} />
      </summary>
      {(!compact || visited) && children}
    </details>
  );
}
