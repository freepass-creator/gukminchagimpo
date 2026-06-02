'use client';

import { ReactNode } from 'react';
import { Search } from 'lucide-react';

export interface FilterOption<V extends string = string> {
  value: V;
  label: string;
}

interface Props<V extends string = string> {
  /** 검색 입력 */
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    width?: string; // tailwind class, e.g. 'w-72'
  };
  /** 필터 칩 */
  filters?: FilterOption<V>[];
  filterValue?: V;
  onFilterChange?: (v: V) => void;
  /** 칩 옆 카운트 */
  counts?: Partial<Record<V, number>>;
  /** 우측 추가 슬롯 (토글, 액션 등) */
  rightSlot?: ReactNode;
  /** 검색 전 슬롯 (보기 토글 등) */
  leftSlot?: ReactNode;
}

export function ListToolbar<V extends string = string>({
  search,
  filters,
  filterValue,
  onFilterChange,
  counts,
  rightSlot,
  leftSlot,
}: Props<V>) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {leftSlot}
      {search && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder={search.placeholder || '검색'}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            className={`pl-7 pr-3 h-[34px] text-[12.5px] border border-zinc-200 rounded-md ${
              search.width || 'w-72'
            } focus:outline-none focus:border-zinc-500`}
          />
        </div>
      )}
      {filters && filters.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {filters.map((f) => {
            if (f.value === '__sep__') {
              return (
                <span key={`sep-${f.label}`} className="text-zinc-300 px-1 select-none">|</span>
              );
            }
            return (
              <button
                key={f.value}
                onClick={() => onFilterChange?.(f.value)}
                className={`px-2.5 h-[26px] text-[11.5px] rounded-full border transition ${
                  filterValue === f.value
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400'
                }`}
              >
                {f.label}
                {counts && counts[f.value] !== undefined && (
                  <span className={`ml-1 ${filterValue === f.value ? 'text-zinc-300' : 'text-zinc-400'}`}>
                    {counts[f.value]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {rightSlot && <div className="ml-auto flex items-center gap-2">{rightSlot}</div>}
    </div>
  );
}
