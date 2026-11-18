import type { FocusEvent, PointerEvent } from "react";

export function inspectEvents(enter: () => void, leave: () => void) {
  return {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== "touch") enter();
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType !== "touch") leave();
    },
    onFocus: (e: FocusEvent) => {
      if (e.target.matches(":focus-visible")) enter();
    },
    onBlur: leave,
  };
}
