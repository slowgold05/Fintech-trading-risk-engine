import { useEffect, useRef, type RefObject } from "react";

export function useMarketFieldFocus(root: RefObject<HTMLElement | null>) {
  const pending = useRef<MutationObserver | null>(null);
  useEffect(() => () => pending.current?.disconnect(), []);

  return (fieldId: string, sectionId: string) => {
    pending.current?.disconnect();
    function reveal(target: HTMLElement) {
      const disclosure = target.closest("details");
      if (disclosure) disclosure.open = true;
      target.scrollIntoView({ block: "center" });
    }
    function focusField() {
      const field = document.getElementById(fieldId);
      if (!field) return false;
      reveal(field);
      field.focus({ preventScroll: true });
      return true;
    }
    if (focusField()) return;
    const section = document.getElementById(sectionId);
    if (section) reveal(section);
    if (!root.current) return;
    const observer = new MutationObserver(() => {
      if (focusField()) observer.disconnect();
    });
    observer.observe(root.current, { subtree: true, childList: true });
    pending.current = observer;
  };
}
