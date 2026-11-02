import { createContext } from "react";

export type ToastType = "success" | "error";

export type Toast = {
  id: number;
  type: ToastType;
  message: string;
};

export type ToastContextValue = {
  toasts: Toast[];
  showToast: (type: ToastType, message: string) => void;
  dismissToast: (id: number) => void;
};

export const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  showToast: () => undefined,
  dismissToast: () => undefined,
});
