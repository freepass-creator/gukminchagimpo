'use client';

import { ReactNode } from 'react';

export type BadgeTone =
  | 'green'   // 정상/완납/임대중
  | 'red'     // 연체/위험
  | 'yellow'  // 만료예정/주의
  | 'orange'  // 입점예정
  | 'blue'    // 정보
  | 'zinc';   // 중립/공실/미계약

const TONE_CLS: Record<BadgeTone, string> = {
  green:  'bg-green-100 text-green-700 border-green-200',
  red:    'bg-red-100 text-red-700 border-red-200',
  yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  orange: 'bg-orange-100 text-orange-700 border-orange-200',
  blue:   'bg-blue-100 text-blue-700 border-blue-200',
  zinc:   'bg-zinc-100 text-zinc-500 border-zinc-200',
};

interface Props {
  tone: BadgeTone;
  children: ReactNode;
  size?: 'sm' | 'md';
}

export function StateBadge({ tone, children, size = 'sm' }: Props) {
  const sizeCls = size === 'md' ? 'px-2.5 py-1 text-[11.5px]' : 'px-2 py-0.5 text-[10.5px]';
  return (
    <span className={`inline-block ${sizeCls} font-semibold rounded-full border ${TONE_CLS[tone]}`}>
      {children}
    </span>
  );
}
