'use client';

import { useMemo, useState } from 'react';
import { Upload, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { Button } from '@/components/Button';
import { BankUploadDialog } from '@/components/BankUploadDialog';
import { PageHeader } from '@/components/list/PageHeader';
import { ListToolbar } from '@/components/list/ListToolbar';
import { DataCard, stdTheadCls, thCls } from '@/components/list/DataCard';
import { StateBadge, type BadgeTone } from '@/components/list/StateBadge';
import { removeBankTx } from '@/lib/data';
import { fmtMoney, addMonths } from '@/lib/utils';
import { toast } from 'sonner';

type CatFilter = 'all' | 'deposit_matched' | 'deposit_unmatched' | 'withdraw' | 'uncategorized';

const FILTERS: { value: CatFilter; label: string }[] = [
  { value: 'all',                label: '전체' },
  { value: 'deposit_matched',    label: '수납' },
  { value: 'deposit_unmatched',  label: '기타입금' },
  { value: 'withdraw',           label: '출금' },
  { value: 'uncategorized',      label: '미분류' },
];

const CAT_BADGE: Record<Exclude<CatFilter, 'all'>, { tone: BadgeTone; label: string }> = {
  deposit_matched:   { tone: 'green',  label: '수납' },
  deposit_unmatched: { tone: 'blue',   label: '기타입금' },
  withdraw:          { tone: 'red',    label: '출금' },
  uncategorized:     { tone: 'zinc',   label: '미분류' },
};

function classifyTx(tx: { deposit?: number; withdraw?: number; matched_tenant_id?: string; category?: string }): Exclude<CatFilter, 'all'> {
  if ((tx.withdraw || 0) > 0) return 'withdraw';
  if ((tx.deposit || 0) > 0) {
    if (tx.matched_tenant_id) return 'deposit_matched';
    return 'deposit_unmatched';
  }
  return 'uncategorized';
}

export default function CashbookPage() {
  const { bankTx, tenants, today } = useData();
  const [openUpload, setOpenUpload] = useState(false);
  const [month, setMonth] = useState(
    today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0')
  );
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<CatFilter>('all');

  // 월별 필터 + 분류 추가
  const monthTx = useMemo(
    () =>
      bankTx
        .filter((t) => t.date.startsWith(month))
        .map((t) => ({ ...t, cat: classifyTx(t) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    [bankTx, month]
  );

  const counts = useMemo(() => {
    const c = { all: monthTx.length, deposit_matched: 0, deposit_unmatched: 0, withdraw: 0, uncategorized: 0 };
    for (const t of monthTx) c[t.cat]++;
    return c;
  }, [monthTx]);

  const filtered = useMemo(() => {
    return monthTx.filter((t) => {
      if (filter !== 'all' && t.cat !== filter) return false;
      if (q && !t.description.includes(q)) return false;
      return true;
    });
  }, [monthTx, filter, q]);

  const totalDeposit = monthTx.reduce((s, t) => s + (t.deposit || 0), 0);
  const totalWithdraw = monthTx.reduce((s, t) => s + (t.withdraw || 0), 0);
  const net = totalDeposit - totalWithdraw;
  const lastBalance = monthTx.length > 0 ? monthTx[monthTx.length - 1].balance : 0;

  function changeMonth(delta: number) {
    const [y, m] = month.split('-').map(Number);
    const d = addMonths(new Date(y, m - 1, 1), delta);
    setMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }

  async function handleRemove(id: string, desc: string) {
    if (!confirm(`거래 "${desc}" 삭제할까요? (수납 처리된 경우 별도로 환불 필요)`)) return;
    try {
      await removeBankTx(id);
      toast.success('거래 삭제됨');
    } catch (e: any) {
      toast.error(e?.message || '실패');
    }
  }

  const monthSelector = (
    <div className="inline-flex items-center gap-1 mr-1">
      <button
        onClick={() => changeMonth(-1)}
        className="w-8 h-[34px] border border-zinc-200 rounded-md hover:bg-zinc-50 flex items-center justify-center"
        title="이전 월"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="h-[34px] border border-zinc-200 rounded-md px-2 text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
      />
      <button
        onClick={() => changeMonth(1)}
        className="w-8 h-[34px] border border-zinc-200 rounded-md hover:bg-zinc-50 flex items-center justify-center"
        title="다음 월"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="자금일보"
        subtitle={`${month} · 입금 ${fmtMoney(totalDeposit)} · 출금 ${fmtMoney(totalWithdraw)} · 순증감 ${net >= 0 ? '+' : ''}${fmtMoney(net)} · 잔액 ${fmtMoney(lastBalance)}`}
        actions={
          <Button variant="primary" onClick={() => setOpenUpload(true)}>
            <Upload className="w-3.5 h-3.5" /> 통장 거래내역 업로드
          </Button>
        }
      />

      <ListToolbar
        leftSlot={monthSelector}
        search={{ value: q, onChange: setQ, placeholder: '적요 검색', width: 'w-56' }}
        filters={FILTERS}
        filterValue={filter}
        onFilterChange={setFilter}
        counts={counts as Record<string, number>}
      />

      <DataCard>
        <table className="w-full text-[12.5px]">
          <thead className={stdTheadCls}>
            <tr>
              <th className={thCls.left}>일자</th>
              <th className={thCls.left}>적요</th>
              <th className={thCls.center}>분류</th>
              <th className={thCls.right}>입금</th>
              <th className={thCls.right}>출금</th>
              <th className={thCls.right}>잔액</th>
              <th className={thCls.center}>매칭 상사</th>
              <th className="px-2 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-10 text-[12.5px] text-zinc-400">
                  해당 월 거래내역 없음
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const tenant = t.matched_tenant_id ? tenants.find((x) => x.id === t.matched_tenant_id) : null;
                const badge = CAT_BADGE[t.cat];
                return (
                  <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50">
                    <td className="py-2 px-4 tabular whitespace-nowrap text-zinc-700">{t.date}</td>
                    <td className="py-2 px-4">{t.description}</td>
                    <td className="py-2 px-4 text-center">
                      <StateBadge tone={badge.tone}>{badge.label}</StateBadge>
                    </td>
                    <td className="py-2 px-4 text-right tabular text-green-700 font-medium">
                      {t.deposit > 0 ? fmtMoney(t.deposit) : ''}
                    </td>
                    <td className="py-2 px-4 text-right tabular text-red-700 font-medium">
                      {t.withdraw > 0 ? fmtMoney(t.withdraw) : ''}
                    </td>
                    <td className="py-2 px-4 text-right tabular text-zinc-600">{fmtMoney(t.balance)}</td>
                    <td className="py-2 px-4 text-center text-[11.5px]">
                      {tenant ? tenant.name : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => handleRemove(t.id, t.description)}
                        className="text-zinc-300 hover:text-red-600 p-0.5"
                        title="삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </DataCard>

      <BankUploadDialog open={openUpload} onClose={() => setOpenUpload(false)} />
    </div>
  );
}
