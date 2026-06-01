'use client';

import Link from 'next/link';
import {
  Wallet,
  CheckCircle2,
  AlertCircle,
  Home,
  Calendar,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import { useData } from '@/lib/data-context';
import { getStallState } from '@/lib/state';
import { KPICard } from '@/components/KPICard';
import { Card, CardHeader, CardBody } from '@/components/Card';
import { StallChip } from '@/components/StallChip';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtMoney, fmtPeriod, daysBetween } from '@/lib/utils';
import type { Lease } from '@/lib/types';

export default function DashboardPage() {
  const { stalls, tenants, leases, billings, config, today } = useData();

  const curPeriod = fmtPeriod(today);
  const monthBills = billings.filter((b) => b.period === curPeriod);
  const billedSum = monthBills.reduce((s, b) => s + b.total, 0);
  const paidSum = monthBills.reduce((s, b) => s + (b.paid_amount || 0), 0);
  const arrearsAll = billings
    .filter((b) => b.total > (b.paid_amount || 0))
    .reduce((s, b) => s + (b.total - (b.paid_amount || 0)), 0);

  const states = stalls.map((s) => ({
    stall: s,
    ...getStallState(s.id, leases, billings, config, today),
  }));
  const vacantCount = states.filter((s) => s.state === 'vacant').length;
  const vacantRate = stalls.length
    ? ((vacantCount / stalls.length) * 100).toFixed(1)
    : '0.0';

  const dedupeLease = (arr: { lease: Lease | null }[]): Lease[] =>
    arr
      .map((x) => x.lease)
      .filter((l): l is Lease => !!l)
      .filter((l, i, ar) => ar.findIndex((x) => x.id === l.id) === i);

  const expiring = dedupeLease(states.filter((s) => s.state === 'expiring'));
  const reserved = dedupeLease(states.filter((s) => s.state === 'reserved'));

  const byTenant: Record<string, number> = {};
  for (const b of billings) {
    const owe = b.total - (b.paid_amount || 0);
    if (owe > 0) byTenant[b.tenant_id] = (byTenant[b.tenant_id] || 0) + owe;
  }
  const topArrears = Object.entries(byTenant)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const aOffice = stalls.filter((s) => s.building === 'A' && s.type === 'office');
  const aParking = stalls.filter((s) => s.building === 'A' && s.type === 'parking');
  const bOffice = stalls.filter((s) => s.building === 'B' && s.type === 'office');
  const bParking = stalls.filter((s) => s.building === 'B' && s.type === 'parking');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">대시보드</h1>
        <p className="text-[12.5px] text-zinc-500 mt-0.5">
          {config.complex_name} · 오늘 기준 단지 현황 한눈에
        </p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          icon={Wallet}
          label={`당월 청구 (${curPeriod})`}
          value={fmtMoney(billedSum)}
          sub={`${monthBills.length}건`}
        />
        <KPICard
          icon={CheckCircle2}
          tone="success"
          label="당월 수납"
          value={fmtMoney(paidSum)}
          sub={`${billedSum ? Math.round((paidSum / billedSum) * 100) : 0}% 완납률`}
        />
        <KPICard
          icon={AlertCircle}
          tone="warn"
          label="미수 잔액 (전체)"
          value={fmtMoney(arrearsAll)}
          sub={`${Object.keys(byTenant).length}건`}
        />
        <KPICard
          icon={Home}
          tone="info"
          label="공실률"
          value={`${vacantRate}%`}
          sub={`${stalls.length}곳 · 공실 ${vacantCount}`}
        />
      </div>

      {/* 3 column lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader
            title={`만료 예정 (${expiring.length})`}
            desc={`만료 ${config.expiring_threshold_days}일 이내 계약`}
            action={
              <Link
                href="/leases"
                className="text-[11.5px] text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1"
              >
                전체 보기 <ArrowRight className="w-3 h-3" />
              </Link>
            }
          />
          <CardBody>
            {expiring.length === 0 ? (
              <div className="text-[12px] text-zinc-400 py-6 text-center">해당 없음</div>
            ) : (
              <ul className="space-y-2.5">
                {expiring.map((l) => {
                  const t = tenants.find((x) => x.id === l.tenant_id);
                  return (
                    <li key={l.id} className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate">
                          {t?.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {l.stall_ids.length}개 공간 · {daysBetween(today, l.end)}일 남음
                        </div>
                      </div>
                      <span className="text-[11.5px] text-zinc-500 tabular shrink-0">
                        {l.end}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={`입점 예정 (${reserved.length})`}
            desc="미래 시작일 계약"
            action={<Calendar className="w-4 h-4 text-zinc-400" />}
          />
          <CardBody>
            {reserved.length === 0 ? (
              <div className="text-[12px] text-zinc-400 py-6 text-center">해당 없음</div>
            ) : (
              <ul className="space-y-2.5">
                {reserved.map((l) => {
                  const t = tenants.find((x) => x.id === l.tenant_id);
                  return (
                    <li key={l.id} className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate">
                          {t?.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {l.stall_ids.length}개 공간 · D-{daysBetween(today, l.start)}
                        </div>
                      </div>
                      <span className="text-[11.5px] text-orange-600 tabular shrink-0 font-medium">
                        {l.start}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="미수 TOP"
            desc="입주상사별 미수금"
            action={<TrendingUp className="w-4 h-4 text-zinc-400" />}
          />
          <CardBody>
            {topArrears.length === 0 ? (
              <div className="text-[12px] text-zinc-400 py-6 text-center">
                미수 없음
              </div>
            ) : (
              <ul className="space-y-2.5">
                {topArrears.map(([tid, amt]) => {
                  const t = tenants.find((x) => x.id === tid);
                  return (
                    <li key={tid} className="flex items-center justify-between">
                      <div className="text-[13px] font-medium">{t?.name || tid}</div>
                      <span className="text-[13px] text-red-600 tabular font-semibold">
                        {fmtMoney(amt)}원
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* 미니맵 */}
      <Card>
        <CardHeader title="단지 미니맵" desc="A동 · B동 공간 상태 (클릭 시 단지 맵)" />
        <CardBody>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-[12px] font-semibold text-zinc-700 mb-2">A동</div>
              <div className="text-[11px] text-zinc-500 mb-1">사무실 {aOffice.length}실</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {aOffice.map((s) => (
                  <StallChip key={s.id} stall={s} compact />
                ))}
              </div>
              <div className="text-[11px] text-zinc-500 mb-1">주차공간 (전시장) {aParking.length}칸</div>
              <div className="flex flex-wrap gap-1.5">
                {aParking.map((s) => (
                  <StallChip key={s.id} stall={s} compact />
                ))}
              </div>
            </div>
            <div>
              <div className="text-[12px] font-semibold text-zinc-700 mb-2">B동</div>
              <div className="text-[11px] text-zinc-500 mb-1">사무실 {bOffice.length}실</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {bOffice.map((s) => (
                  <StallChip key={s.id} stall={s} compact />
                ))}
              </div>
              <div className="text-[11px] text-zinc-500 mb-1">주차공간 (전시장) {bParking.length}칸</div>
              <div className="flex flex-wrap gap-1.5">
                {bParking.map((s) => (
                  <StallChip key={s.id} stall={s} compact />
                ))}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
