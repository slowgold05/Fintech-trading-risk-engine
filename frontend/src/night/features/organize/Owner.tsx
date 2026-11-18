import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { fetchMe } from "../../../api/auth";
import { keys } from "../../api";
import { State } from "../../kit";
import { ReadFailure } from "./ReadFailure";
import "./organize.css";

export function Owner({ screen: Screen, demo = false }: { screen: ComponentType<{ owner: number }>; demo?: boolean }) {
  const identity = useQuery({ queryKey: keys.me, queryFn: fetchMe, retry: false });
  if (identity.isPending) return <State kind="loading" title="Checking account access…" />;
  if (identity.isError) return <ReadFailure title="Account unavailable" error={identity.error} retry={identity.refetch} />;
  const { id, is_demo, role } = identity.data;
  if (role !== "trader" || (demo && !is_demo)) {
    return <State data-testid="night-forbidden" kind="unavailable" title="Access restricted" detail={demo ? "Sign in with a demo trader account to view rankings." : "Sign in with a trader account to open this page."} />;
  }
  return <Screen key={id} owner={id} />;
}
