import type { ReactNode } from "react";

type DashboardCardProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
};

export function DashboardCard({ title, children, action }: DashboardCardProps) {
  return (
    <section className="dashboard-card">
      <div className="dashboard-card-header">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="dashboard-card-body">{children}</div>
    </section>
  );
}
