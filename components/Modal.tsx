'use client';

import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Modal({
  open,
  onClose,
  title,
  desc,
  width = 720,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  desc?: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'bg-white rounded-xl shadow-2xl max-h-[88vh] overflow-hidden animate-slide-up flex flex-col',
          'border border-zinc-200'
        )}
        style={{ width: '92vw', maxWidth: `${width}px` }}
      >
        <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center gap-3">
          <div className="flex-1">
            <h3 className="text-[14.5px] font-semibold leading-tight">{title}</h3>
            {desc && <p className="text-[12px] text-zinc-500 mt-0.5">{desc}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 transition p-1 rounded-md hover:bg-zinc-100"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-zinc-200 flex items-center justify-end gap-2 bg-zinc-50/50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
