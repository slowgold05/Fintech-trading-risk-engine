import { SheetSelect } from "./SheetSelect";
import { compactWidth, useMaxWidth } from "../components/market/compactLayout";
import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

type Props = {
  id?: string;
  label?: string;
  className?: string;
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  designed?: boolean;
  invalid?: boolean;
  disabled?: boolean;
};

/** A select-only combobox. DOM focus stays on the trigger while arrows preview and Enter commits. */
export function Select({
  children,
  value,
  onValueChange,
  label,
  id,
  className,
  invalid,
  disabled,
  designed = true,
}: Props) {
  const compact = useMaxWidth(compactWidth);
  const listId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [above, setAbove] = useState(false);
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; children: ReactNode }>(child)) return [];
    const text = Children.toArray(child.props.children).join("");
    return [{ text, value: String(child.props.value ?? text) }];
  });
  const index = options.findIndex((option) => option.value === String(value));
  useEffect(() => {
    if (cursor === null) return;
    const option = document.getElementById(listId + "-" + cursor);
    const list = option?.parentElement;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [cursor, listId]);
  const expanded = cursor !== null;
  useEffect(() => {
    if (!expanded) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) setCursor(null);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded]);
  if (!designed)
    return (
      <select
        id={id}
        disabled={disabled}
        className={className}
        aria-invalid={invalid}
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {children}
      </select>
    );

  if (compact)
    return (
      <SheetSelect
        id={id}
        label={label}
        options={options}
        value={String(value)}
        onChange={onValueChange}
        disabled={disabled}
        invalid={invalid}
      />
    );
  function open() {
    const bottom = anchor.current?.getBoundingClientRect().bottom ?? 0;
    setAbove(bottom > window.innerHeight * 0.55);
    setCursor(Math.max(0, index));
  }
  function commit(i: number) {
    if (options[i]) onValueChange(options[i].value);
    setCursor(null);
  }
  return (
    <div
      className="desk-select"
      ref={anchor}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setCursor(null);
      }}
    >
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        disabled={disabled}
        aria-expanded={cursor !== null}
        aria-controls={listId}
        aria-invalid={invalid}
        aria-activedescendant={cursor === null ? undefined : listId + "-" + cursor}
        onClick={() => (cursor === null ? open() : setCursor(null))}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            setCursor(null);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setCursor(null);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            if (cursor === null) open();
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? options.length - 1
                  : (cursor ?? index) + (e.key === "ArrowDown" ? 1 : -1);
            setCursor(Math.max(0, Math.min(options.length - 1, next)));
          } else if (cursor !== null && ["Enter", " "].includes(e.key)) {
            e.preventDefault();
            commit(cursor);
          } else if (e.key.length === 1 && /\S/.test(e.key)) {
            const match = options.findIndex((o) => o.text.toLowerCase().startsWith(e.key.toLowerCase()));
            if (match !== -1) {
              e.preventDefault();
              if (cursor === null) open();
              setCursor(match);
            }
          }
        }}
      >
        <span>{options[index]?.text ?? "Choose"}</span>
        <CaretDown size={13} />
      </button>
      {cursor !== null && (
        <ul id={listId} className={above ? "opens-up" : ""} role="listbox" aria-label={label ?? "Options"}>
          {options.map((option, i) => (
            <li
              id={listId + "-" + i}
              key={option.value}
              role="option"
              aria-selected={i === index}
              data-cursor={i === cursor}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => commit(i)}
            >
              {option.text}
              {i === index && <Check size={13} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
