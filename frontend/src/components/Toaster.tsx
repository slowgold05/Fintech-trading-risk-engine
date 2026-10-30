import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { useToast } from "../context/useToast";
import type { Toast } from "../context/toastState";

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const isSuccess = toast.type === "success";

  return (
    <div
      className={["toast-item", isSuccess ? "toast-item-success" : "toast-item-error"].join(" ")}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        {isSuccess ? (
          <CheckCircle className="size-5 shrink-0 text-emerald-400" weight="fill" />
        ) : (
          <WarningCircle className="size-5 shrink-0 text-rose-400" weight="fill" />
        )}
        <p className={["flex-1 text-sm font-medium leading-5", isSuccess ? "text-emerald-100" : "text-rose-100"].join(" ")}>
          {toast.message}
        </p>
        <button
          onClick={onDismiss}
          type="button"
          aria-label="Dismiss notification"
          className={["mt-0.5 transition-opacity", isSuccess ? "text-emerald-400" : "text-rose-400"].join(" ")}
        >
          <X className="size-4 shrink-0 text-current opacity-70 hover:opacity-100" weight="bold" />
        </button>
      </div>
      <div className="px-4 pb-3">
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-slate-800/60">
          <div
            className={[
              "toast-progress-bar",
              isSuccess ? "bg-emerald-400/60" : "bg-rose-400/60",
            ].join(" ")}
          />
        </div>
      </div>
    </div>
  );
}

export function Toaster() {
  const { toasts, dismissToast } = useToast();

  return (
    <div
      className="fixed right-4 top-4 z-50 flex w-[min(400px,calc(100vw-2rem))] flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}
