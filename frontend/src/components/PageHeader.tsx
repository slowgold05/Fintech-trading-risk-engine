type PageHeaderProps = {
  title: string;
  description: string;
  badge?: string;
};

export function PageHeader({ title, description, badge }: PageHeaderProps) {
  return (
    <div className="mb-6 border-b border-slate-800/60 pb-6">
      {badge && (
        <span className="mb-2 inline-flex items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
          {badge}
        </span>
      )}
      <h2 className="text-2xl font-semibold tracking-tight text-slate-50">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        {description}
      </p>
    </div>
  );
}
