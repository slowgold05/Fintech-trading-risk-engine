import type { UseQueryResult } from "@tanstack/react-query";
import { Button, type InstrumentStatus } from "../../inner";
import { errorDetail } from "./marketRead";

export function readStatus<T>(query: UseQueryResult<T>, label: string): InstrumentStatus | undefined {
  if (query.isError) return {
    kind: "error", role: "alert", title: `Could not load ${label}`,
    action: <div className="market-retry"><p>{errorDetail(query.error)}</p><Button onClick={() => void query.refetch()}>Retry</Button></div>,
  };
  if (query.isPending) return { kind: "loading", title: `Loading ${label}…` };
}

export const stockCount = (value: number) => value.toLocaleString("en-US");
