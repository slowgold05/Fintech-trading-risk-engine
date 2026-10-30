import type { RiskLabel } from "../types/schemas";
import { getRiskTone } from "../utils/riskTone";

type RiskBadgeProps = {
  label: RiskLabel;
};

export function RiskBadge({ label }: RiskBadgeProps) {
  return <span className={["risk-chip", getRiskTone(label).chip].join(" ")}>{label}</span>;
}
