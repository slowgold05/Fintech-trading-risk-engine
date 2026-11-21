import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, State } from "../../kit";
import { errorDetail } from "./marketRead";
import "./explore.css";

export function Results<T>({ query, label, children }: {
  query: UseQueryResult<T>; label: string; children: (data: T) => ReactNode;
}) {
  if (query.isError) return <State kind="error" title={`Could not load ${label}`} detail={errorDetail(query.error)}
    action={<Button onClick={() => void query.refetch()}>Retry</Button>} />;
  if (query.isPending) return <State kind="loading" title={`Loading ${label}…`} />;
  return children(query.data);
}
