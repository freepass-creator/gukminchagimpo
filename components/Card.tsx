import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-white border border-zinc-200 rounded-xl shadow-soft',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between px-5 pt-4 pb-3">
      <div>
        <h3 className="text-[13.5px] font-semibold leading-tight">{title}</h3>
        {desc && <p className="text-[11.5px] text-zinc-500 mt-0.5">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('px-5 pb-5', className)}>{children}</div>;
}
