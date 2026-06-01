'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-950 border-zinc-900',
  secondary:
    'bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100',
  ghost:
    'bg-transparent text-zinc-700 border-transparent hover:bg-zinc-100 active:bg-zinc-200',
  danger:
    'bg-red-600 text-white border-red-600 hover:bg-red-500 active:bg-red-700',
  outline:
    'bg-white text-zinc-900 border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] rounded-md',
  md: 'h-[34px] px-3.5 text-[12.5px] rounded-md',
  lg: 'h-10 px-5 text-[13.5px] rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium border transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
