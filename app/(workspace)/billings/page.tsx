'use client';

import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/list/PageHeader';
import { ListToolbar } from '@/components/list/ListToolbar';
import { DataCard, stdTheadCls, thCls } from '@/components/list/DataCard';
import { StateBadge, type BadgeTone } from '@/components/list/StateBadge';
import { BillingDetailDialog } from '@/components/BillingDetailDialog';
import { NewBillingDialog } from '@/components/NewBillingDialog';
import { saveBilling, writeAudit } from '@/lib/data';
import { addMonths, fmtMoney, fmtPeriod, fmtDate, daysBetween } from '@/lib/utils';
import type { Billing, Tenant, BankTransaction } from '@/lib/types';

type BillState = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'chronic';

const FILTERS: { value: 'all' | BillState; label: string }[] = [
  { value: 'all',     label: '전체' },
  { value: 'chronic', label: '만성연체' },
  { value: 'overdue', label: '연체' },
  { value: 'partial', label: '부분납' },
  { value: 'unpaid',  label: '미납' },
  { value: 'paid',    label: '완납' },
];

const STATE_BADGE: Record<BillState, { tone: BadgeTone; label: string }> = {
  paid:    { tone: 'green',  label: '완납' },
  partial: { tone: 'blue',   label: '부분납' },
  unpaid:  { tone: 'yellow', label: '미납' },
  overdue: { tone: 'orange', label: '연체' },
  chronic: { tone: 'red',    label: '만성연체' },
};

interface Row {
  billing: Billing;
  tenant?: Tenant;
  owe: number;
  paidRate: number;       // 0~100
  daysOverdue: number;    // 0이면 마감 전
  daysUntilDue: number;   // 마감일까지 남은 일
  lastDeposit?: BankTransaction;
  state: BillState;
}

function MatrixView({
  tenants,
  periods,
  billings,
  onClickCell,
}: {
  tenants: Tenant[];
  periods: string[];
  billings: Billing[];
  onClickCell: (billingId: string) => void;
}) {
  return (
    <DataCard scrollX>
      <table className="w-full text-[12px]">
        <thead className={stdTheadCls}>
          <tr>
            <th className={`${thCls.left} sticky left-0 bg-zinc-50/95 z-20 whitespace-nowrap`}>상사</th>
            {periods.map((p) => (
              <th key={p} className="text-center py-2.5 px-3 font-semibold whitespace-nowrap tabular">{p}</th>
            ))}
            <th className={thCls.right}>누적 청구</th>
            <th className={thCls.right}>누적 수납</th>
            <th className={thCls.right}>누적 미수</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => {
            const tBills = billings.filter((b) => b.tenant_id === t.id);
            const totalCharged = tBills.reduce((s, b) => s + b.total, 0);
            const totalPaid = tBills.reduce((s, b) => s + (b.paid_amount || 0), 0);
            const totalOwe = totalCharged - totalPaid;
            return (
              <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50 align-middle">
                <td className="py-2.5 px-4 font-semibold sticky left-0 bg-white z-10 whitespace-nowrap">
                  <div>{t.name}</div>
                  <div className="text-[10.5px] text-zinc-500 tabular font-normal">{t.biz_no}</div>
                </td>
                {periods.map((p) => {
                  const b = billings.find((x) => x.tenant_id === t.id && x.period === p);
                  if (!b) {
                    return (
                      <td key={p} className="text-center text-zinc-300 py-2.5 px-3">—</td>
                    );
                  }
                  const paid = b.paid_amount || 0;
                  const owe = b.total - paid;
                  return (
                    <td
                      key={p}
                      onClick={() => onClickCell(b.id)}
                      className="text-center py-2 px-3 tabular cursor-pointer hover:bg-zinc-100/60 whitespace-nowrap"
                    >
                      <div className="text-zinc-800 font-semibold leading-tight">{fmtMoney(b.total)}</div>
                      <div className="text-[10.5px] text-green-700 leading-tight">+{fmtMoney(paid)}</div>
                      <div className={`text-[10.5px] leading-tight ${owe > 0 ? 'text-red-600 font-bold' : 'text-zinc-400'}`}>
                        {owe > 0 ? `-${fmtMoney(owe)}` : '완납'}
                      </div>
                    </td>
                  );
                })}
                <td className="py-2.5 px-4 text-right tabular font-semibold">{fmtMoney(totalCharged)}</td>
                <td className="py-2.5 px-4 text-right tabular text-green-700">{fmtMoney(totalPaid)}</td>
                <td className={`py-2.5 px-4 text-right tabular ${totalOwe > 0 ? 'text-red-600 font-bold' : 'text-zinc-400'}`}>
                  {totalOwe > 0 ? fmtMoney(totalOwe) : '—'}
                </td>
              </tr>
            );
          })}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={periods.length + 4} className="text-center py-10 text-zinc-400 text-[12px]">
                해당하는 상사가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </DataCard>
  );
}

export default function BillingsPage() {
  const { tenants, leases, billings, bankTx, byId, today } = useData();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | BillState>('all');
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [openNewBilling, setOpenNewBilling] = useState(false);

  const todayStr = fmtDate(today);
  const curPeriod = fmtPeriod(today);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(curPeriod);

  function changeMonth(delta: number) {
    const [y, m] = selectedPeriod.split('-').map(Number);
    const d = addMonths(new Date(y, m - 1, 1), delta);
    setSelectedPeriod(fmtPeriod(d));
  }

  const rows: Row[] = useMemo(() => {
    return billings.map((b) => {
      const tenant = byId.tenant.get(b.tenant_id);
      const paid = b.paid_amount || 0;
      const owe = b.total - paid;
      const paidRate = b.total > 0 ? Math.round((paid / b.total) * 100) : 0;
      const isAfterDue = b.due_date < todayStr;
      const daysOverdue = owe > 0 && isAfterDue ? daysBetween(b.due_date, todayStr) : 0;
      const daysUntilDue = !isAfterDue ? daysBetween(todayStr, b.due_date) : 0;

      let state: BillState = 'unpaid';
      if (owe === 0) state = 'paid';
      else if (daysOverdue >= 31) state = 'chronic';
      else if (daysOverdue > 0) state = 'overdue';
      else if (paid > 0) state = 'partial';
      else state = 'unpaid';

      // 해당 상사의 마지막 입금 (이 청구 발행 이후)
      const deposits = bankTx
        .filter((tx) => tx.matched_tenant_id === b.tenant_id && tx.deposit > 0)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date));
      const lastDeposit = deposits[0];

      return { billing: b, tenant, owe, paidRate, daysOverdue, daysUntilDue, lastDeposit, state };
    });
  }, [billings, bankTx, byId, todayStr]);

  const counts = useMemo(() => {
    const c = { all: rows.length, paid: 0, partial: 0, unpaid: 0, overdue: 0, chronic: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => {
        if (r.billing.period !== selectedPeriod) return false;
        if (filter !== 'all' && r.state !== filter) return false;
        if (q && !(r.tenant?.name.includes(q)) && !(r.tenant?.biz_no.includes(q)) && !r.billing.period.includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        // 우선순위: 연체 → 미납 → 부분납 → 완납
        const order: Record<BillState, number> = { chronic: 0, overdue: 1, unpaid: 2, partial: 3, paid: 4 };
        if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
        // 연체일 긴 순, 미수 큰 순, 청구월 최신 순
        if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
        if (a.owe !== b.owe) return b.owe - a.owe;
        return b.billing.period.localeCompare(a.billing.period);
      });
  }, [rows, filter, q, selectedPeriod]);

  const totals = useMemo(() => {
    const totalOwe = rows.reduce((s, r) => s + r.owe, 0);
    const chronicOwe = rows.filter((r) => r.state === 'chronic').reduce((s, r) => s + r.owe, 0);
    const overdueOwe = rows.filter((r) => r.state === 'overdue').reduce((s, r) => s + r.owe, 0);
    return { totalOwe, chronicOwe, overdueOwe };
  }, [rows]);

  // 월이 바뀌면 자동 정기 청구 생성 — 페이지 진입 시 1회만 시도 (중복 방지: localStorage)
  useEffect(() => {
    if (leases.length === 0) return; // 데이터 로딩 전 skip
    const guardKey = `billing-auto-${curPeriod}`;
    if (typeof window !== 'undefined' && localStorage.getItem(guardKey) === '1') return;

    (async () => {
      let created = 0;
      try {
        for (const l of leases) {
          if (l.status !== 'active') continue;
          if (new Date(l.start) > today) continue;
          const exists = billings.find((b) => b.lease_id === l.id && b.period === curPeriod);
          if (exists) continue;
          const total = l.rent_total + l.maint_total;
          const b: Billing = {
            id: `BL_${l.id}_${curPeriod.replace('-', '')}`,
            lease_id: l.id,
            tenant_id: l.tenant_id,
            period: curPeriod,
            items: [
              { type: '사무실 임대료', amount: l.rent_total },
              { type: '관리비', amount: l.maint_total },
            ],
            total,
            due_date: `${curPeriod}-25`,
            paid_amount: 0,
          };
          await saveBilling(b);
          created++;
        }
        if (created > 0) {
          await writeAudit({
            actor: user?.email || 'system-auto',
            type: 'billing_auto_generate',
            target: curPeriod,
            memo: `${curPeriod} 정기 청구 ${created}건 자동 생성`,
            at: fmtDate(today),
          });
          toast.success(`${curPeriod} 정기 청구 ${created}건 자동 생성`);
        }
        if (typeof window !== 'undefined') localStorage.setItem(guardKey, '1');
      } catch (e: any) {
        toast.error(e?.message || '자동 청구 생성 실패');
      }
    })();
    // leases 데이터가 들어오는 첫 시점에 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leases.length > 0, curPeriod]);

  return (
    <div className="flex flex-col h-full space-y-5">
      <PageHeader
        title="청구·수납"
        subtitle={
          <>
            전체 청구 {rows.length}건 · 미수 <span className="font-bold text-red-600">{fmtMoney(totals.totalOwe)}원</span>
            {' · '}만성연체 {counts.chronic} · 연체 {counts.overdue}
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setOpenNewBilling(true)}>
            <Plus className="w-3.5 h-3.5" /> 청구 추가
          </Button>
        }
      />

      <ListToolbar
        search={{ value: q, onChange: setQ, placeholder: '상사명 · 사업자번호 검색', width: 'w-60' }}
        rightSlot={
          <div className="inline-flex items-center gap-1">
            <button
              onClick={() => changeMonth(-1)}
              className="w-8 h-[34px] border border-zinc-200 rounded-md hover:bg-zinc-50 flex items-center justify-center"
              title="이전 월"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <input
              type="month"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="h-[34px] border border-zinc-200 rounded-md px-2 text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={() => changeMonth(1)}
              className="w-8 h-[34px] border border-zinc-200 rounded-md hover:bg-zinc-50 flex items-center justify-center"
              title="다음 월"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setSelectedPeriod(curPeriod)}
              disabled={selectedPeriod === curPeriod}
              className={`px-2.5 h-[34px] text-[11.5px] rounded-md border ml-1 ${
                selectedPeriod === curPeriod ? 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-default' : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400'
              }`}
              title="이번 달로 이동"
            >
              당월
            </button>
          </div>
        }
        filters={FILTERS}
        filterValue={filter}
        onFilterChange={setFilter}
        counts={counts as Record<string, number>}
      />

      <DataCard>
        <table className="w-full text-[12.5px]">
          <thead className={stdTheadCls}>
            <tr>
              <th className={thCls.center}>청구월</th>
              <th className={thCls.left}>상사</th>
              <th className={thCls.left}>청구 항목</th>
              <th className={thCls.right}>청구액</th>
              <th className={thCls.right}>수납</th>
              <th className={thCls.right}>미수</th>
              <th className={thCls.center}>마감일</th>
              <th className={thCls.center}>연체일</th>
              <th className={thCls.center}>마지막 입금</th>
              <th className={thCls.center}>상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.billing.id}
                onClick={() => setOpenDetail(r.billing.id)}
                className={`border-b border-zinc-100 last:border-0 align-middle hover:bg-zinc-50/80 cursor-pointer ${
                  r.state === 'chronic' ? 'bg-red-50/30' : r.state === 'overdue' ? 'bg-orange-50/20' : ''
                }`}
              >
                <td className="py-2 px-4 text-center tabular text-[12px] font-semibold whitespace-nowrap">
                  {r.billing.period}
                </td>
                <td className="py-2 px-4 whitespace-nowrap">
                  <div className="font-semibold leading-tight">{r.tenant?.name || '?'}</div>
                  <div className="text-[10.5px] text-zinc-500 leading-tight mt-0.5">
                    <span className="tabular">{r.tenant?.biz_no}</span>
                    {r.tenant?.ceo && (<><span className="text-zinc-300"> · </span>{r.tenant.ceo}</>)}
                  </div>
                </td>
                <td className="py-2 px-4 text-[11px] text-zinc-600 whitespace-nowrap">
                  {r.billing.items.length > 0
                    ? r.billing.items.map((it, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-zinc-300"> · </span>}
                          {it.type}{' '}
                          <span className={`tabular ${it.amount < 0 ? 'text-red-600 font-semibold' : 'text-zinc-700 font-medium'}`}>
                            {fmtMoney(it.amount)}
                          </span>
                        </span>
                      ))
                    : '—'}
                </td>
                <td className="py-2 px-4 text-right tabular font-semibold whitespace-nowrap">
                  {fmtMoney(r.billing.total)}
                </td>
                <td className="py-2 px-4 text-right tabular text-green-700 whitespace-nowrap">
                  {(r.billing.paid_amount || 0) > 0 ? (
                    <span>
                      {fmtMoney(r.billing.paid_amount || 0)}
                      <span className="text-[10px] text-green-600 ml-1">({r.paidRate}%)</span>
                    </span>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
                <td className={`py-2 px-4 text-right tabular whitespace-nowrap ${
                  r.owe > 0 ? 'text-red-600 font-bold text-[13.5px]' : 'text-zinc-300'
                }`}>
                  {r.owe > 0 ? fmtMoney(r.owe) : '—'}
                </td>
                <td className="py-2 px-4 text-center tabular text-[11.5px] whitespace-nowrap">
                  <span className={r.daysOverdue > 0 ? 'text-red-600 font-semibold' : 'text-zinc-600'}>
                    {r.billing.due_date}
                  </span>
                  {r.daysUntilDue > 0 && r.owe > 0 && (
                    <span className="text-[10px] text-zinc-500 ml-1">D-{r.daysUntilDue}</span>
                  )}
                </td>
                <td className="py-2 px-4 text-center tabular whitespace-nowrap">
                  {r.daysOverdue > 0 ? (
                    <span className={`text-[12.5px] font-bold ${r.daysOverdue >= 31 ? 'text-red-600' : 'text-orange-600'}`}>
                      {r.daysOverdue}일
                    </span>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
                <td className="py-2 px-4 text-center tabular text-[11px] whitespace-nowrap">
                  {r.lastDeposit ? (
                    <span>
                      <span className="text-zinc-700">{r.lastDeposit.date}</span>
                      <span className="text-[10px] text-green-700 font-medium ml-1">+{fmtMoney(r.lastDeposit.deposit || 0)}</span>
                    </span>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
                <td className="py-2 px-4 text-center">
                  <StateBadge tone={STATE_BADGE[r.state].tone}>{STATE_BADGE[r.state].label}</StateBadge>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-10 text-zinc-400 text-[12px]">
                  해당하는 청구건이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataCard>

      <BillingDetailDialog
        open={!!openDetail}
        onClose={() => setOpenDetail(null)}
        billingId={openDetail}
      />
      <NewBillingDialog
        open={openNewBilling}
        onClose={() => setOpenNewBilling(false)}
      />
    </div>
  );
}
