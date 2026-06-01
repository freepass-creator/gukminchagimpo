'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/list/PageHeader';
import { ListToolbar } from '@/components/list/ListToolbar';
import { DataCard, stdTheadCls, thCls } from '@/components/list/DataCard';
import { StateBadge, type BadgeTone } from '@/components/list/StateBadge';
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

export default function BillingsPage() {
  const { tenants, leases, billings, bankTx, byId, today } = useData();
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | BillState>('all');

  const todayStr = fmtDate(today);
  const curPeriod = fmtPeriod(today);

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
  }, [rows, filter, q]);

  const totals = useMemo(() => {
    const totalOwe = rows.reduce((s, r) => s + r.owe, 0);
    const chronicOwe = rows.filter((r) => r.state === 'chronic').reduce((s, r) => s + r.owe, 0);
    const overdueOwe = rows.filter((r) => r.state === 'overdue').reduce((s, r) => s + r.owe, 0);
    return { totalOwe, chronicOwe, overdueOwe };
  }, [rows]);

  async function runMonthlyBatch() {
    setRunning(true);
    try {
      let created = 0;
      for (const l of leases) {
        if (l.status !== 'active') continue;
        if (new Date(l.start) > today) continue;
        const exists = billings.find((b) => b.lease_id === l.id && b.period === curPeriod);
        if (exists) continue;
        const total = l.rent_total + l.maint_total + 38000;
        const b: Billing = {
          id: `BL_${l.id}_${curPeriod.replace('-', '')}`,
          lease_id: l.id,
          tenant_id: l.tenant_id,
          period: curPeriod,
          items: [
            { type: '월세', amount: l.rent_total },
            { type: '관리비', amount: l.maint_total },
            { type: '공과금 안분', amount: 38000 },
          ],
          total,
          due_date: `${curPeriod}-25`,
          paid_amount: 0,
        };
        await saveBilling(b);
        created++;
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'batch_billing',
        target: curPeriod,
        memo: `${created}건 자동 생성`,
        at: fmtDate(today),
      });
      toast.success(`${curPeriod} 정기 청구 ${created}건 생성`);
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="미수 관리"
        subtitle={
          <>
            전체 청구 {rows.length}건 · 미수 <span className="font-bold text-red-600">{fmtMoney(totals.totalOwe)}원</span>
            {' · '}만성연체 {counts.chronic} · 연체 {counts.overdue}
          </>
        }
        actions={
          <Button variant="primary" onClick={runMonthlyBatch} disabled={running}>
            <Play className="w-3.5 h-3.5" /> 정기 청구 일괄 생성 ({curPeriod})
          </Button>
        }
      />

      <ListToolbar
        search={{ value: q, onChange: setQ, placeholder: '상사명 · 사업자번호 · 청구월 검색' }}
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
                className={`border-b border-zinc-100 last:border-0 align-top hover:bg-zinc-50/80 ${
                  r.state === 'chronic' ? 'bg-red-50/30' : r.state === 'overdue' ? 'bg-orange-50/20' : ''
                }`}
              >
                <td className="py-2.5 px-4 text-center tabular text-[12px] font-semibold whitespace-nowrap">
                  {r.billing.period}
                </td>
                <td className="py-2.5 px-4 whitespace-nowrap">
                  <div className="font-semibold">{r.tenant?.name || '?'}</div>
                  <div className="text-[10.5px] text-zinc-500 tabular">{r.tenant?.biz_no}</div>
                </td>
                <td className="py-2.5 px-4 text-[11px] text-zinc-700">
                  {r.billing.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="text-zinc-600">{it.type}</span>
                      <span className="tabular text-zinc-700">{fmtMoney(it.amount)}</span>
                    </div>
                  ))}
                </td>
                <td className="py-2.5 px-4 text-right tabular font-semibold whitespace-nowrap">
                  {fmtMoney(r.billing.total)}
                </td>
                <td className="py-2.5 px-4 text-right tabular text-green-700 whitespace-nowrap">
                  {(r.billing.paid_amount || 0) > 0 ? (
                    <>
                      <div>{fmtMoney(r.billing.paid_amount || 0)}</div>
                      <div className="text-[10px] text-green-600">{r.paidRate}%</div>
                    </>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
                <td className={`py-2.5 px-4 text-right tabular whitespace-nowrap ${
                  r.owe > 0 ? 'text-red-600 font-bold text-[13.5px]' : 'text-zinc-300'
                }`}>
                  {r.owe > 0 ? fmtMoney(r.owe) : '—'}
                </td>
                <td className="py-2.5 px-4 text-center tabular text-[11.5px] whitespace-nowrap">
                  <div className={r.daysOverdue > 0 ? 'text-red-600 font-semibold' : 'text-zinc-600'}>
                    {r.billing.due_date}
                  </div>
                  {r.daysUntilDue > 0 && r.owe > 0 && (
                    <div className="text-[10px] text-zinc-500">D-{r.daysUntilDue}</div>
                  )}
                </td>
                <td className="py-2.5 px-4 text-center tabular whitespace-nowrap">
                  {r.daysOverdue > 0 ? (
                    <span className={`text-[12.5px] font-bold ${r.daysOverdue >= 31 ? 'text-red-600' : 'text-orange-600'}`}>
                      {r.daysOverdue}일
                    </span>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-center tabular text-[11px] whitespace-nowrap">
                  {r.lastDeposit ? (
                    <>
                      <div className="text-zinc-700">{r.lastDeposit.date}</div>
                      <div className="text-[10px] text-green-700 font-medium">+{fmtMoney(r.lastDeposit.deposit || 0)}</div>
                    </>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-center">
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
    </div>
  );
}
