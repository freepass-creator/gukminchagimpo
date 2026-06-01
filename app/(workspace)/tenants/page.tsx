'use client';

import { useState, useMemo } from 'react';
import { Upload } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { Button } from '@/components/Button';
import { TenantUploadDialog } from '@/components/TenantUploadDialog';
import { PageHeader } from '@/components/list/PageHeader';
import { ListToolbar } from '@/components/list/ListToolbar';
import { DataCard, stdTheadCls, thCls } from '@/components/list/DataCard';
import { StateBadge, type BadgeTone } from '@/components/list/StateBadge';
import { fmtMoney } from '@/lib/utils';

type TenantFilter = 'all' | 'active' | 'overdue' | 'reserved' | 'inactive';

const FILTERS: { value: TenantFilter; label: string }[] = [
  { value: 'all',      label: '전체' },
  { value: 'active',   label: '입주중' },
  { value: 'overdue',  label: '연체' },
  { value: 'reserved', label: '입점예정' },
  { value: 'inactive', label: '미계약' },
];

const STATE_BADGE: Record<Exclude<TenantFilter, 'all'>, { tone: BadgeTone; label: string }> = {
  active:   { tone: 'green',  label: '입주중' },
  overdue:  { tone: 'red',    label: '연체' },
  reserved: { tone: 'orange', label: '입점예정' },
  inactive: { tone: 'zinc',   label: '미계약' },
};

export default function TenantsPage() {
  const { tenants, leases, billings, stalls, today } = useData();
  const [openUpload, setOpenUpload] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<TenantFilter>('all');

  const enriched = useMemo(() => {
    return tenants.map((t) => {
      const ts = leases.filter((l) => l.tenant_id === t.id);
      const active = ts.filter(
        (l) => l.status === 'active' && new Date(l.start) <= today && new Date(l.end) >= today
      );
      const reserved = ts.filter((l) => l.status === 'active' && new Date(l.start) > today);

      const moveIn = active.length > 0
        ? active.map((l) => l.start).sort()[0]
        : reserved.length > 0
          ? reserved.map((l) => l.start).sort()[0]
          : null;
      const moveOut = active.length > 0
        ? active.map((l) => l.end).sort().reverse()[0]
        : null;

      const arrears = ts.reduce(
        (s, l) =>
          s + billings.filter((b) => b.lease_id === l.id).reduce((s2, b) => s2 + (b.total - (b.paid_amount || 0)), 0),
        0
      );

      const allStalls = active.flatMap((l) => l.stall_ids);
      const officeCnt = allStalls.filter((id) => stalls.find((s) => s.id === id)?.type === 'office').length;
      const parkingCnt = allStalls.filter((id) => stalls.find((s) => s.id === id)?.type === 'parking').length;

      const monthlyTotal = active.reduce((s, l) => s + l.rent_total + l.maint_total, 0);

      let state: Exclude<TenantFilter, 'all'> = 'inactive';
      if (arrears > 0) state = 'overdue';
      else if (active.length > 0) state = 'active';
      else if (reserved.length > 0) state = 'reserved';

      return {
        tenant: t,
        moveIn, moveOut,
        activeCount: active.length,
        reservedCount: reserved.length,
        officeCnt, parkingCnt,
        monthlyTotal, arrears, state,
      };
    });
  }, [tenants, leases, billings, stalls, today]);

  const filtered = useMemo(() => {
    return enriched
      .filter((x) => {
        if (filter !== 'all' && x.state !== filter) return false;
        if (q) {
          const k = q.toLowerCase();
          return (
            x.tenant.name.toLowerCase().includes(k) ||
            x.tenant.biz_no.includes(q) ||
            x.tenant.ceo.includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => (a.moveIn || 'zzzz').localeCompare(b.moveIn || 'zzzz'));
  }, [enriched, filter, q]);

  const counts = useMemo(() => ({
    all: enriched.length,
    active: enriched.filter((x) => x.state === 'active').length,
    overdue: enriched.filter((x) => x.state === 'overdue').length,
    reserved: enriched.filter((x) => x.state === 'reserved').length,
    inactive: enriched.filter((x) => x.state === 'inactive').length,
  }), [enriched]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="입주상사"
        subtitle={`전체 ${tenants.length}곳 · 입주중 ${counts.active} · 연체 ${counts.overdue} · 입점예정 ${counts.reserved}`}
        actions={
          <Button variant="primary" onClick={() => setOpenUpload(true)}>
            <Upload className="w-3.5 h-3.5" /> 엑셀로 한번에 등록
          </Button>
        }
      />

      <ListToolbar
        search={{ value: q, onChange: setQ, placeholder: '상사명 · 사업자번호 · 대표 검색' }}
        filters={FILTERS}
        filterValue={filter}
        onFilterChange={setFilter}
        counts={counts}
      />

      <TenantUploadDialog open={openUpload} onClose={() => setOpenUpload(false)} />

      <DataCard>
        <table className="w-full text-[12.5px]">
          <thead className={stdTheadCls}>
            <tr>
              <th className={thCls.left}>상사</th>
              <th className={thCls.left}>대표·연락처</th>
              <th className={thCls.center}>입점일</th>
              <th className={thCls.center}>계약 종료</th>
              <th className={thCls.center}>임대 공간</th>
              <th className={thCls.right}>월 합계</th>
              <th className={thCls.right}>보증금</th>
              <th className={thCls.right}>미수금</th>
              <th className={thCls.center}>상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((x) => (
              <tr key={x.tenant.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/80">
                <td className="py-2.5 px-4">
                  <div className="font-semibold">{x.tenant.name}</div>
                  <div className="text-[10.5px] text-zinc-500 tabular">{x.tenant.biz_no}</div>
                </td>
                <td className="py-2.5 px-4 text-[11.5px] text-zinc-700">
                  <div>{x.tenant.ceo}</div>
                  <div className="text-zinc-500 tabular">{x.tenant.phone}</div>
                </td>
                <td className="py-2.5 px-4 text-center tabular text-[11.5px] text-zinc-700 whitespace-nowrap">
                  {x.moveIn || <span className="text-zinc-300">—</span>}
                </td>
                <td className="py-2.5 px-4 text-center tabular text-[11.5px] text-zinc-700 whitespace-nowrap">
                  {x.moveOut || <span className="text-zinc-300">—</span>}
                </td>
                <td className="py-2.5 px-4 text-center text-[11.5px] whitespace-nowrap">
                  {x.activeCount === 0 && x.reservedCount === 0 ? (
                    <span className="text-zinc-300">—</span>
                  ) : (
                    <>
                      <div className="font-medium">사무실 {x.officeCnt} · 주차 {x.parkingCnt}</div>
                      <div className="text-[10.5px] text-zinc-500">
                        계약 {x.activeCount}건
                        {x.reservedCount > 0 && (
                          <span className="text-orange-600"> · 예정 {x.reservedCount}</span>
                        )}
                      </div>
                    </>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right tabular">
                  {x.monthlyTotal > 0 ? fmtMoney(x.monthlyTotal) : <span className="text-zinc-300">—</span>}
                </td>
                <td className="py-2.5 px-4 text-right tabular text-zinc-700">
                  {fmtMoney(x.tenant.deposit_paid)}
                </td>
                <td className={`py-2.5 px-4 text-right tabular ${x.arrears > 0 ? 'text-red-600 font-bold' : 'text-zinc-400'}`}>
                  {fmtMoney(x.arrears)}
                </td>
                <td className="py-2.5 px-4 text-center">
                  <StateBadge tone={STATE_BADGE[x.state].tone}>{STATE_BADGE[x.state].label}</StateBadge>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-10 text-zinc-400 text-[12px]">
                  해당하는 입주상사가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataCard>
    </div>
  );
}
