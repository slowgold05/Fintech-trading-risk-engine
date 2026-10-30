import type { ReactNode } from "react";
import { Tray } from "@phosphor-icons/react";

type EmptyStateProps = {
  message: string;
  detail?: string;
  action?: ReactNode;
};

export function EmptyState({ message, detail, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/25 px-6 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/80">
        <Tray className="size-7 text-slate-500" weight="light" />
      </div>
      <div className="max-w-xs">
        <p className="text-sm font-medium text-slate-300">{message}</p>
        {detail && (
          <p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
