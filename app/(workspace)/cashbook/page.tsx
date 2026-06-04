'use client';

import { useMemo, useState } from 'react';
import { Upload, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { Button } from '@/components/Button';
import { BankUploadDialog } from '@/components/BankUploadDialog';
import { BankTxEditDialog } from '@/components/BankTxEditDialog';
import { PageHeader } from '@/components/list/PageHeader';
import { ListToolbar } from '@/components/list/ListToolbar';
import { DataCard, stdTheadCls, stdTrCls, thCls } from '@/components/list/DataCard';
import { StateBadge } from '@/components/list/StateBadge';
import { removeBankTx, updateBankTx } from '@/lib/data';
import { fmtMoney, addMonths } from '@/lib/utils';
import { ACCOUNT_CATEGORIES, suggestCategory } from '@/lib/categories';
import { toast } from 'sonner';

type CatFilter = 'all' | 'deposit_matched' | 'deposit_unmatched' | 'withdraw' | 'uncategorized';

const FILTERS: { value: CatFilter; label: string }[] = [
  { value: 'all',                label: '전체' },
  { value: 'deposit_matched',    label: '수납' },
  { value: 'deposit_unmatched',  label: '기타입금' },
  { value: 'withdraw',           label: '출금' },
  { value: 'uncategorized',      label: '미분류' },
];

function classifyTx(tx: { deposit?: number; withdraw?: number; matched_tenant_id?: string; category?: string }): Exclude<CatFilter, 'all'> {
  if ((tx.withdraw || 0) > 0) return 'withdraw';
  if ((tx.deposit || 0) > 0) {
    if (tx.matched_tenant_id) return 'deposit_matched';
    return 'deposit_unmatched';
  }
  return 'uncategorized';
}

export default function CashbookPage() {
  const { bankTx, tenants, billings, payments, accounts, today } = useData();
  const [openUpload, setOpenUpload] = useState(false);
  const [editTxId, setEditTxId] = useState<string | null>(null);
  const [month, setMonth] = useState(
    today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0')
  );
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<CatFilter>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');

  // 월별 필터 + 분류 추가
  const monthTx = useMemo(
    () =>
      bankTx
        .filter((t) => t.date.startsWith(month))
        .map((t) => ({ ...t, cat: classifyTx(t) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    [bankTx, month]
  );

  // payment → billing(들) → 청구월·회차 lookup
  // 회차 = 해당 lease의 청구를 period asc로 정렬했을 때 인덱스+1
  const paymentInfoById = useMemo(() => {
    // lease별 청구 list (period asc)
    const billsByLease = new Map<string, typeof billings>();
    for (const b of billings) {
      const arr = billsByLease.get(b.lease_id) || [];
      arr.push(b);
      billsByLease.set(b.lease_id, arr);
    }
    for (const [k, arr] of billsByLease) {
      arr.sort((a, c) => a.period.localeCompare(c.period));
      billsByLease.set(k, arr);
    }
    // payment ID → { period, round, count }
    const map = new Map<string, { period: string; round: number; count: number }>();
    for (const p of payments) {
      const allocs = p.allocations || [];
      if (allocs.length === 0) continue;
      // 가장 빠른 청구월에 배분된 billing 기준
      const billedItems = allocs
        .map((a) => billings.find((b) => b.id === a.billing_id))
        .filter((b): b is NonNullable<typeof b> => !!b);
      if (billedItems.length === 0) continue;
      const sorted = billedItems.slice().sort((a, b) => a.period.localeCompare(b.period));
      const first = sorted[0];
      const leaseBills = billsByLease.get(first.lease_id) || [];
      const round = leaseBills.findIndex((b) => b.id === first.id) + 1;
      map.set(p.id, { period: first.period, round, count: billedItems.length });
    }
    return map;
  }, [billings, payments]);

  const counts = useMemo(() => {
    const c = { all: monthTx.length, deposit_matched: 0, deposit_unmatched: 0, withdraw: 0, uncategorized: 0 };
    for (const t of monthTx) c[t.cat]++;
    return c;
  }, [monthTx]);

  const filtered = useMemo(() => {
    return monthTx.filter((t) => {
      if (filter !== 'all' && t.cat !== filter) return false;
      if (accountFilter !== 'all') {
        const a = accounts.find((x) => x.id === accountFilter);
        if (!a) return false;
        if (t.source !== a.bank_name || t.account_no !== a.account_no) return false;
      }
      if (q && !t.description.includes(q)) return false;
      return true;
    });
  }, [monthTx, filter, accountFilter, accounts, q]);

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

  const accountSelector = accounts.length > 0 ? (
    <select
      value={accountFilter}
      onChange={(e) => setAccountFilter(e.target.value)}
      className="h-[34px] px-2 border border-zinc-200 rounded-md text-[12.5px] bg-white focus:outline-none focus:border-zinc-500"
    >
      <option value="all">전체 통장</option>
      {accounts.filter((a) => a.active).map((a) => (
        <option key={a.id} value={a.id}>
          {a.bank_name} {a.account_no}
        </option>
      ))}
    </select>
  ) : null;

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
    <div className="flex flex-col h-full space-y-5">
      <PageHeader
        title="자금일보"
        subtitle={
          <>
            {month} · {monthTx.length}건 ·
            입금 <span className="text-green-700 font-semibold">{fmtMoney(totalDeposit)}</span> ·
            출금 <span className="text-red-700 font-semibold">{fmtMoney(totalWithdraw)}</span> ·
            순증감 <span className={net >= 0 ? 'text-blue-700 font-semibold' : 'text-red-700 font-semibold'}>
              {net >= 0 ? '+' : ''}{fmtMoney(net)}
            </span>
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setOpenUpload(true)}>
            <Upload className="w-3.5 h-3.5" /> 통장 거래내역 업로드
          </Button>
        }
      />

      <ListToolbar
        leftSlot={
          <div className="flex items-center gap-2">
            {accountSelector}
            {monthSelector}
          </div>
        }
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
              <th className={thCls.left}>적요 · 메모</th>
              <th className={thCls.left}>통장</th>
              <th className={thCls.center}>분류</th>
              <th className={thCls.center}>처리</th>
              <th className={thCls.right}>입금</th>
              <th className={thCls.right}>출금</th>
              <th className={thCls.center}>매칭 상사</th>
              <th className="py-2.5 px-4.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-10 text-[12.5px] text-zinc-400">
                  해당 월 거래내역 없음
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const tenant = t.matched_tenant_id ? tenants.find((x) => x.id === t.matched_tenant_id) : null;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setEditTxId(t.id)}
                    className={`${stdTrCls} cursor-pointer`}
                  >
                    <td className="py-2.5 px-4 tabular whitespace-nowrap text-zinc-700">{t.date}</td>
                    <td className="py-2.5 px-4">
                      <div className="leading-tight">{t.description}</div>
                      {t.memo && (
                        <div className="text-[10.5px] text-zinc-500 leading-tight mt-0.5">{t.memo}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {t.source || t.account_no ? (
                        <>
                          <div className="text-zinc-700 leading-tight">{t.source || '—'}</div>
                          {t.account_no && (
                            <div className="text-[10px] text-zinc-500 leading-tight tabular mt-0.5">{t.account_no}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <CategorySelect tx={t} />
                    </td>
                    <td className="py-2.5 px-4 text-center whitespace-nowrap">
                      <ProcessBadge tx={t} />
                    </td>
                    <td className="py-2.5 px-4 text-right tabular text-green-700 font-medium">
                      {t.deposit > 0 ? fmtMoney(t.deposit) : ''}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular text-red-700 font-medium">
                      {t.withdraw > 0 ? fmtMoney(t.withdraw) : ''}
                    </td>
                    <td className="py-2.5 px-4 text-center whitespace-nowrap">
                      {tenant ? (
                        <>
                          <div className="font-medium text-zinc-800 leading-tight">{tenant.name}</div>
                          {(() => {
                            const info = t.matched_payment_id ? paymentInfoById.get(t.matched_payment_id) : null;
                            if (!info) return null;
                            return (
                              <div className="text-[10px] text-zinc-500 leading-tight tabular mt-0.5">
                                {info.period} · {info.round}회차
                                {info.count > 1 && <span className="text-zinc-400"> 외 {info.count - 1}건</span>}
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemove(t.id, t.description); }}
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
      <BankTxEditDialog
        open={!!editTxId}
        onClose={() => setEditTxId(null)}
        txId={editTxId}
      />
    </div>
  );
}


/** 처리 상태 뱃지 — 자동매칭 / 직접입력 / 미매칭 / 미분류 */
function ProcessBadge({ tx }: { tx: any }) {
  if (tx.matched_payment_id) {
    return <StateBadge tone="green">자동매칭</StateBadge>;
  }
  if (tx.matched_tenant_id) {
    return <StateBadge tone="blue">매칭</StateBadge>;
  }
  if ((tx.deposit || 0) > 0) {
    return <StateBadge tone="yellow">미매칭</StateBadge>;
  }
  if (!tx.category) {
    return <StateBadge tone="zinc">미분류</StateBadge>;
  }
  return <StateBadge tone="zinc">정상</StateBadge>;
}

/** 인라인 계정과목 select — 매칭된 수납은 기본 '임대료' */
function CategorySelect({ tx }: { tx: any }) {
  const suggested = suggestCategory(tx);
  const value = tx.category || suggested;
  const isIncome = (tx.deposit || 0) > 0;
  const isExpense = (tx.withdraw || 0) > 0;
  const colorCls = isIncome ? 'text-green-700 border-green-200 bg-green-50'
                  : isExpense ? 'text-red-700 border-red-200 bg-red-50'
                  : 'text-zinc-700 border-zinc-200 bg-white';
  const placeholder = !tx.category && !suggested;

  async function onChange(v: string) {
    try {
      await updateBankTx(tx.id, { category: v });
      toast.success('계정과목 저장됨');
    } catch (e: any) {
      toast.error(e?.message || '실패');
    }
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-7 px-1.5 font-medium border rounded tabular focus:outline-none focus:border-zinc-500 ${colorCls} ${placeholder ? 'text-zinc-400' : ''}`}
    >
      {placeholder && <option value="">— 선택 —</option>}
      {isIncome && ACCOUNT_CATEGORIES.income.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
      {isExpense && ACCOUNT_CATEGORIES.expense.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
      {!isIncome && !isExpense && (
        <>
          <optgroup label="입금">
            {ACCOUNT_CATEGORIES.income.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </optgroup>
          <optgroup label="지출">
            {ACCOUNT_CATEGORIES.expense.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </optgroup>
        </>
      )}
    </select>
  );
}
