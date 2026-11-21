import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../../../api/auth";
import { Button, RestInstrument, State } from "../../inner";
import "./desks.css";

export function DeskAccount({ label = "Session history", children }: { label?: string; children: (owner: number) => ReactNode }) {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  if (me.isPending) return <RestInstrument label={label} status={{kind:"loading",title:"Loading your desk…"}}/>;
  if (me.isError) return <RestInstrument label={label} status={{kind:"error",title:"Your account could not be loaded.",action:<RefreshButton label="Retry" onClick={me.refetch}/>}}/>;
  return children(me.data.id);
}

export function RefreshButton({ onClick, label = "Refresh" }: { onClick: () => void; label?: string }) {
  return <Button onClick={onClick}>{label}</Button>;
}

export function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <State kind="error" title={message} action={<RefreshButton label="Retry" onClick={onRetry} />} />;
}

export function LoadingRows() {
  return <State kind="loading" title="Loading records…" />;
}

export function EmptyState({ message }: { message: string }) {
  return <State kind="empty" title={message} />;
}
