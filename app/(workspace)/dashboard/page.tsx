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
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data-context';
import { getStallState } from '@/lib/state';
import { KPICard } from '@/components/KPICard';
import { Card, CardHeader, CardBody } from '@/components/Card';
import { fmtMoney, fmtPeriod, fmtDate, daysBetween, fmtFloorLabel } from '@/lib/utils';
import type { Lease, Floor } from '@/lib/types';

export default function DashboardPage() {
  const { stalls, tenants, leases, billings, floors, config, today } = useData();
  const router = useRouter();

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

  // 단지 미니맵용 — 동별 + 층별 점유 요약
  const todayStr = fmtDate(today);
  const occupiedStallIds = new Set<string>();
  for (const l of leases) {
    if (l.status !== 'active') continue;
    if (l.start > todayStr || l.end < todayStr) continue;
    l.stall_ids.forEach((id) => occupiedStallIds.add(id));
  }
  const buildings = Array.from(new Set(floors.map((f) => f.building))).sort();
  const grouped: Record<string, Floor[]> = {};
  for (const b of buildings) {
    grouped[b] = floors
      .filter((f) => f.building === b)
      .sort((a, c) => (a.order ?? 0) - (c.order ?? 0));
  }
  function floorSummary(floorId: string) {
    const fStalls = stalls.filter((s) => s.floor_id === floorId);
    const offices = fStalls.filter((s) => s.type === 'office');
    const parkings = fStalls.filter((s) => s.type === 'parking');
    return {
      officeTotal: offices.length,
      officeOccupied: offices.filter((s) => occupiedStallIds.has(s.id)).length,
      parkingTotal: parkings.length,
      parkingOccupied: parkings.filter((s) => occupiedStallIds.has(s.id)).length,
    };
  }

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

      {/* 미니맵 — 건물별 빌딩 stack */}
      <Card>
        <CardHeader title="단지 미니맵" desc="건물 · 층별 점유 (클릭 시 단지 맵)" />
        <CardBody>
          {buildings.length === 0 ? (
            <div className="text-[12px] text-zinc-400 py-6 text-center">동·층 데이터 없음</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {buildings.map((b) => (
                <div key={b}>
                  <div className="text-[12.5px] font-bold text-zinc-800 mb-2 text-center">
                    {b}동
                  </div>
                  <div className="border border-zinc-300 rounded-md overflow-hidden shadow-sm">
                    {grouped[b].map((f, idx) => {
                      const isFirst = idx === 0;
                      const label = fmtFloorLabel(f, { withBuilding: false });
                      const s = floorSummary(f.id);
                      return (
                        <button
                          key={f.id}
                          onClick={() => router.push(`/map?floor=${encodeURIComponent(f.id)}`)}
                          className={`w-full px-3 py-2.5 flex flex-col items-center justify-center bg-white hover:bg-zinc-50 transition ${
                            isFirst ? '' : 'border-t border-zinc-300'
                          }`}
                        >
                          <div className="text-[13px] font-bold leading-tight text-zinc-800">
                            {label}
                          </div>
                          <div className="text-[10.5px] mt-1 tabular leading-tight text-zinc-500">
                            {s.officeTotal > 0 && (
                              <span>사무실 {s.officeOccupied}/{s.officeTotal}</span>
                            )}
                            {s.officeTotal > 0 && s.parkingTotal > 0 && (
                              <span className="opacity-60"> · </span>
                            )}
                            {s.parkingTotal > 0 && (
                              <span>주차 {s.parkingOccupied}/{s.parkingTotal}</span>
                            )}
                            {s.officeTotal === 0 && s.parkingTotal === 0 && (
                              <span className="opacity-60">공간 없음</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
