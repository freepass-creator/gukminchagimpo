import { cn } from '@/lib/utils';
import { STATE_LABEL, STATE_TONE } from '@/lib/state';
import type { StallState } from '@/lib/types';

export function StatusBadge({
  state,
  className,
}: {
  state: StallState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium tabular',
        STATE_TONE[state],
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {STATE_LABEL[state]}
    </span>
  );
}
