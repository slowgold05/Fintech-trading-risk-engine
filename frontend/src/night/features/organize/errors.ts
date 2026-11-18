import axios from "axios";
import type { NightError } from "../../api";

export function errorMessage(error: unknown) {
  if (axios.isAxiosError<NightError>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail?.message === "string") return detail.message;
    if (error.response?.status === 403) return "Your account does not have access.";
    if (error.response?.status === 404) return "This item is unavailable for your account.";
  }
  return "The request could not be completed. Please try again.";
}
