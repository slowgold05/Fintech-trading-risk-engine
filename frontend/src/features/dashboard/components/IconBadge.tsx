import type { Icon } from "@phosphor-icons/react";

const tones = {
  emerald: "border border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  rose: "border border-rose-400/35 bg-rose-400/10 text-rose-300",
  amber: "border border-amber-400/35 bg-amber-400/10 text-amber-300",
  sky: "border border-sky-400/30 bg-sky-400/10 text-sky-300",
  slate: "border border-slate-600 bg-slate-800 text-slate-300",
} as const;

export type IconBadgeTone = keyof typeof tones;

type IconBadgeProps = {
  Icon: Icon;
  tone: IconBadgeTone;
};

export function IconBadge({ Icon, tone }: IconBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={[
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        tones[tone],
      ].join(" ")}
    >
      <Icon className="size-4" weight="bold" />
    </span>
  );
}
