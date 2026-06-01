'use client';

import { cn } from '@/lib/utils';
import { useData } from '@/lib/data-context';
import { getStallState, STATE_TONE } from '@/lib/state';
import type { Stall } from '@/lib/types';

export function StallChip({
  stall,
  onClick,
  compact = false,
}: {
  stall: Stall;
  onClick?: (s: Stall) => void;
  compact?: boolean;
}) {
  const { leases, billings, config, tenants, today } = useData();
  const result = getStallState(stall.id, leases, billings, config, today);
  const tenant = result.lease
    ? tenants.find((t) => t.id === result.lease!.tenant_id)
    : null;

  const sizing =
    stall.type === 'parking'
      ? compact
        ? 'w-12 h-9 text-[10px]'
        : 'w-14 h-11 text-[10.5px]'
      : compact
        ? 'w-14 h-11 text-[11px]'
        : 'w-16 h-12 text-xs';

  return (
    <button
      onClick={() => onClick?.(stall)}
      className={cn(
        'flex flex-col items-center justify-center rounded-md border-[1.5px] font-medium leading-tight transition',
        'hover:-translate-y-0.5 hover:shadow-md active:translate-y-0',
        STATE_TONE[result.state],
        sizing
      )}
      title={`${stall.building}동 ${stall.code} · ${tenant?.name || '공실'}`}
    >
      <span className="font-semibold">{stall.code}</span>
      {!compact && tenant && (
        <span className="text-[9.5px] opacity-80 truncate max-w-[56px] px-0.5">
          {tenant.name}
        </span>
      )}
    </button>
  );
}
