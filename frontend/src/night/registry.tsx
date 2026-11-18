import type { ComponentType } from "react";
import type { UserResponse } from "../types/schemas";

export type Role = UserResponse["role"];
export type Access = "public" | "authenticated" | "trader" | "privileged" | "demo";
export type Destination = { id: string; label: string; path: string; access: Access };
export const destinations: readonly Destination[] = [
  {id:"market", label:"Markets", path:"/market", access:"public"},
  {id:"today", label:"Today", path:"/dashboard", access:"authenticated"},
  {id:"portfolio", label:"Portfolio", path:"/portfolio", access:"authenticated"},
  {id:"activity", label:"Activity", path:"/trades", access:"authenticated"},
  {id:"risk", label:"Risk", path:"/risk", access:"authenticated"},
  {id:"research", label:"Research", path:"/research", access:"authenticated"},
  {id:"forecasts", label:"Forecast Lab", path:"/forecasts", access:"authenticated"},
  {id:"compliance", label:"Compliance", path:"/compliance", access:"privileged"},
];
export type Feature = Destination & { Screen: ComponentType; slot?: "companyEvents" };
export const features: readonly Feature[] = [];
export function allowed(access: Access, identity?: Pick<UserResponse,"role"|"is_demo">) {
  if (access === "public") return true;
  if (!identity) return false;
  if (access === "authenticated") return true;
  if (access === "privileged") return ["admin","compliance_officer","auditor"].includes(identity.role);
  return identity.role === "trader" && (access !== "demo" || identity.is_demo === true);
}
export function safeReturnTo(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || Array.from(value).some(c => c === "\\" || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return "/dashboard";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "/dashboard";
    const known = [...destinations,...features].some(route => route.path === url.pathname);
    return known || /^\/market\/[A-Za-z0-9.^_-]{1,20}$/.test(url.pathname) ? url.pathname + url.search + url.hash : "/dashboard";
  } catch { return "/dashboard"; }
}
