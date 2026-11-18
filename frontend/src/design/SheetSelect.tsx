import { useId, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { TouchSheet } from "./TouchSheet";

export function SheetSelect({
  options,
  value,
  onChange,
  label,
  id,
  disabled,
  invalid,
  className = "",
}: {
  options: { text: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        id={id}
        className={"sheet-trigger " + className}
        aria-haspopup="dialog"
        aria-expanded={title !== null}
        aria-label={label}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() =>
          setTitle(label ?? trigger.current?.labels?.[0]?.textContent?.trim() ?? "Choose an option")
        }
      >
        <span>{selected?.text ?? "Choose"}</span>
        <CaretDown size={13} />
      </button>
      {title && (
        <TouchSheet title={title} onClose={() => setTitle(null)}>
          <div id={listId} role="listbox" aria-label={title} className="sheet-options">
            {options.map((o) => (
              <button
                type="button"
                role="option"
                key={o.value}
                aria-selected={o.value === value}
                onKeyDown={(e) => {
                  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
                  e.preventDefault();
                  const buttons = Array.from(e.currentTarget.parentElement!.querySelectorAll("button"));
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? buttons.length - 1
                        : buttons.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1);
                  buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus();
                }}
                onClick={() => {
                  onChange(o.value);
                }}
              >
                {o.text}
                {o.value === value && <Check size={16} />}
              </button>
            ))}
          </div>
        </TouchSheet>
      )}
    </>
  );
}
