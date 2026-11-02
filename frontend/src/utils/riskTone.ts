import type { RiskLabel } from "../types/schemas";

export type RiskTone = {
  level: RiskLabel;
  border: string;
  bg: string;
  text: string;
  chip: string;
  bar: string;
  metric: string;
  stroke: string;
};

const tones: Record<RiskLabel, Omit<RiskTone, "level">> = {
  Low: {
    border: "border-emerald-400/30",
    bg: "bg-emerald-950/20",
    text: "text-emerald-100",
    chip: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
    bar: "bg-emerald-400/75",
    metric: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    stroke: "#34d399",
  },
  Medium: {
    border: "border-amber-400/30",
    bg: "bg-amber-950/25",
    text: "text-amber-100",
    chip: "border-amber-400/35 bg-amber-400/10 text-amber-300",
    bar: "bg-amber-400/75",
    metric: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    stroke: "#f59e0b",
  },
  High: {
    border: "border-rose-400/35",
    bg: "bg-rose-950/45",
    text: "text-rose-200",
    chip: "border-rose-400/35 bg-rose-400/10 text-rose-300",
    bar: "bg-rose-400/75",
    metric: "border-rose-400/40 bg-rose-400/10 text-rose-300",
    stroke: "#fb7185",
  },
};

export function getRiskLevel(score: number): RiskLabel {
  if (score >= 80) {
    return "High";
  }

  if (score >= 50) {
    return "Medium";
  }

  return "Low";
}

export function getRiskTone(levelOrScore: RiskLabel | number): RiskTone {
  const level =
    typeof levelOrScore === "number" ? getRiskLevel(levelOrScore) : levelOrScore;
  return { level, ...tones[level] };
}
