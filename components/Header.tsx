'use client';

import { usePathname } from 'next/navigation';
import { useData } from '@/lib/data-context';
import { fmtDate } from '@/lib/utils';

const TITLES: Record<string, string> = {
  '/dashboard': '대시보드',
  '/map': '단지 맵',
  '/timeline': '가용성 캘린더',
  '/leases': '임대 계약',
  '/billings': '청구·수납',
  '/cashbook': '자금일보',
  '/tenants': '입주상사',
  '/settings': '단지 설정',
  '/seed': '데이터 시드',
  '/dev': '개발 도구',
  '/floor-editor': '도면 만들기',
};

export function Header() {
  const pathname = usePathname();
  const { today, loading, config } = useData();
  const title =
    Object.entries(TITLES).find(([k]) => pathname.startsWith(k))?.[1] ||
    '국민차매매단지';

  return (
    <header className="h-14 px-7 border-b border-zinc-200 flex items-center gap-4 bg-white sticky top-0 z-30">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-zinc-500">
          {config.complex_name}
        </span>
        <span className="text-zinc-300">›</span>
        <h1 className="text-[15px] font-bold tracking-tight">{title}</h1>
      </div>
      {loading && (
        <span className="text-[11px] text-zinc-400 animate-pulse">
          실시간 동기화 중...
        </span>
      )}
      <div className="ml-auto text-[12px] text-zinc-500 tabular">
        오늘 <span className="text-zinc-700 font-medium">{fmtDate(today)}</span>
      </div>
    </header>
  );
}
