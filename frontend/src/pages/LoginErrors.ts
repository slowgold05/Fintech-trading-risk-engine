import { isAxiosError } from "axios";

type AuthField = "email" | "password" | "code";
export type AuthFailure = { message: string; fields: Partial<Record<AuthField, string>> };

export function authFailure(error: unknown, fallback: string): AuthFailure {
  const fields: AuthFailure["fields"] = {};
  if (!isAxiosError(error)) return { message: fallback, fields };
  const detail = error.response?.data?.detail;
  const extra: string[] = [];
  function add(field: unknown, message: unknown) {
    if (typeof message !== "string") return;
    const text = message.replace(/^Value error, /, "");
    if (field === "username") field = "email";
    if (field === "email" || field === "password" || field === "code") fields[field] = text;
    else if (/^password\b/i.test(text)) fields.password = text;
    else extra.push(text);
  }
  if (Array.isArray(detail)) for (const issue of detail) add(issue?.loc?.at(-1), issue?.msg);
  if (detail?.fields && typeof detail.fields === "object") {
    for (const [field, message] of Object.entries(detail.fields)) add(field, message);
  }
  if (typeof detail === "string" && error.response?.status === 400 && /email.*registered/i.test(detail)) fields.email = detail;
  const message = extra.join(" ") || (Object.keys(fields).length ? "Check the highlighted fields." :
    typeof detail === "string" ? detail : typeof detail?.message === "string" ? detail.message :
    error.response?.status === 429 ? "Too many attempts. Wait a moment and try again." : fallback);
  return { message, fields };
}
