import { useContext } from "react";
import { ToastContext } from "./toastState";

export function useToast() {
  return useContext(ToastContext);
}
