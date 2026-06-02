'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Map,
  Calendar,
  FileText,
  Receipt,
  Building2,
  Settings,
  Database,
  Pencil,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';

const NAV = [
  { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/map', label: '단지 맵', icon: Map },
  { href: '/timeline', label: '가용성', icon: Calendar },
  { href: '/leases', label: '임대 현황', icon: FileText },
  { href: '/billings', label: '청구·수납', icon: Receipt },
  { href: '/cashbook', label: '자금일보', icon: Wallet },
  { href: '/tenants', label: '입주상사', icon: Building2 },
];

/** 관리자 전용 메뉴 */
const MANAGER_NAV = [
  { href: '/floor-editor', label: '도면 만들기', icon: Pencil },
];

/** 항상 맨 아래 */
const BOTTOM_NAV = [
  { href: '/settings', label: '설정', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isAdmin, isManager } = useAuth();

  return (
    <aside className="w-[220px] shrink-0 bg-zinc-950 text-zinc-300 flex flex-col h-screen">
      <div className="h-14 px-4 flex flex-col justify-center border-b border-zinc-800/80 shrink-0">
        <div className="text-white text-[12.5px] font-bold leading-tight tracking-tight">
          국민차매매단지
        </div>
        <div className="text-zinc-500 text-[10.5px] mt-0.5 tracking-wide">
          공항점 · 임대관리
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto py-2 px-2 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors',
                active
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {isManager && (
          <>
            <div className="pt-2.5 pb-0.5 px-2.5 text-[9.5px] font-semibold text-blue-400/70 uppercase tracking-wider">
              관리자 전용
            </div>
            {MANAGER_NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors',
                    active
                      ? 'bg-zinc-800 text-white'
                      : 'text-blue-400/80 hover:bg-zinc-900 hover:text-blue-300'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </>
        )}

        {/* 마스터 전용 — 개발 도구 (한 메뉴로 통합) */}
        {isAdmin && (
          <>
            <div className="pt-2.5 pb-0.5 px-2.5 text-[9.5px] font-semibold text-amber-400/70 uppercase tracking-wider">
              마스터 전용
            </div>
            <Link
              href="/dev"
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors',
                pathname.startsWith('/dev') || pathname.startsWith('/seed')
                  ? 'bg-zinc-800 text-white'
                  : 'text-amber-400/80 hover:bg-zinc-900 hover:text-amber-300'
              )}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>개발 도구</span>
            </Link>
          </>
        )}

      </nav>

      {/* 설정 — 항상 사이드바 맨 아래 (스크롤 영향 X) */}
      <div className="px-2 py-2 border-t border-zinc-800/80 shrink-0">
        {BOTTOM_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors',
                active
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

    </aside>
  );
}
