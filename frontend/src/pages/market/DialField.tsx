import type { ComponentProps } from "react";
import type { Select } from "../../design/Select";
import { WallSelect } from "./TouchControls";

export function DialField({ onValueChange, invalid, id, value, disabled, className, children, label }: ComponentProps<typeof Select>) {
  return <WallSelect compact id={id} className={className} value={value} disabled={disabled}
    aria-label={label} aria-invalid={invalid} onChange={event => onValueChange(event.target.value)}>
    {children}
  </WallSelect>;
}
