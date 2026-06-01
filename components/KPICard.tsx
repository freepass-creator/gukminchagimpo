import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

export function KPICard({
  label,
  value,
  sub,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'neutral' | 'success' | 'warn' | 'info';
  icon?: LucideIcon;
}) {
  const valueColor =
    tone === 'success'
      ? 'text-green-600'
      : tone === 'warn'
        ? 'text-red-600'
        : tone === 'info'
          ? 'text-blue-600'
          : 'text-zinc-900';

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-soft">
      <div className="flex items-start justify-between mb-1">
        <div className="text-[11.5px] text-zinc-500 tracking-wide uppercase font-medium">
          {label}
        </div>
        {Icon && <Icon className="w-4 h-4 text-zinc-400" />}
      </div>
      <div className={cn('text-[24px] font-bold tabular leading-none mt-1.5', valueColor)}>
        {value}
      </div>
      {sub && <div className="text-[11.5px] text-zinc-500 mt-1.5">{sub}</div>}
    </div>
  );
}
