import { SkeletonBlock } from "../features/dashboard/components";

type SkeletonCardProps = {
  rows?: number;
  chart?: boolean;
};

export function SkeletonCard({ rows = 3, chart = false }: SkeletonCardProps) {
  return (
    <section className="dashboard-card">
      <div className="dashboard-card-header">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="h-4 w-16" />
      </div>
      <div className="dashboard-card-body space-y-3">
        {chart ? <SkeletonBlock className="h-56" /> : null}
        {Array.from({ length: rows }, (_, index) => (
          <SkeletonBlock className="h-10" key={index} />
        ))}
      </div>
    </section>
  );
}
