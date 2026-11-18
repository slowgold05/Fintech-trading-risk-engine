import { lazy, type ComponentType } from "react";
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
const WatchlistsScreen = lazy(() => import("./features/discover/WatchlistsScreen").then(module => ({ default: module.WatchlistsScreen })));
const AccountScreen = lazy(() => import("./features/account/Account").then(module => ({ default: module.Account })));
const LearnScreen = lazy(() => import("./features/account/Learn").then(module => ({ default: module.Learn })));
export const features: readonly Feature[] = [
  {id:"watchlists", label:"Watchlists", path:"/watchlists", access:"authenticated", Screen:WatchlistsScreen},
  {id:"account", label:"Account", path:"/account", access:"authenticated", Screen:AccountScreen},
  {id:"learn", label:"Learn", path:"/learn", access:"public", Screen:LearnScreen},
  {id:"screener", label:"Stock screener", path:"/market/screener", access:"public",
    Screen: lazy(() => import("./features/explore/Screener").then(module => ({ default: module.Screener })))},
  {id:"compare", label:"Compare stocks", path:"/market/compare", access:"public",
    Screen: lazy(() => import("./features/explore/Compare").then(module => ({ default: module.Compare })))},
  {id:"sectors", label:"Sectors", path:"/market/sectors", access:"public",
    Screen: lazy(() => import("./features/explore/Sectors").then(module => ({ default: module.Sectors })))},
  {id:"breadth", label:"Market breadth", path:"/market/breadth", access:"public",
    Screen: lazy(() => import("./features/explore/Breadth").then(module => ({ default: module.Breadth })))},
  {id:"news", label:"Market news", path:"/market/news", access:"public",
    Screen: lazy(() => import("./features/explore/News").then(module => ({ default: module.News })))},
  {id:"events", label:"Company events", path:"/market/AAPL?tab=events", access:"public", slot: "companyEvents",
    Screen: lazy(() => import("./features/explore/Events").then(module => ({ default: module.Events })))},
  {id:"backtest", label:"Buy and hold simulator", path:"/research/simulate", access:"authenticated",
    Screen: lazy(() => import("./features/simulate/BacktestScreen").then(module => ({ default: module.BacktestScreen })))},
];
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
