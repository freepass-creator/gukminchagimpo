'use client';

import { useMemo, useState } from 'react';
import { Upload, Trash2, ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle, Wallet, TrendingUp, AlertTriangle } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { Button } from '@/components/Button';
import { BankUploadDialog } from '@/components/BankUploadDialog';
import { BankTxEditDialog } from '@/components/BankTxEditDialog';
import { PageHeader } from '@/components/list/PageHeader';
import { ListToolbar } from '@/components/list/ListToolbar';
import { DataCard, stdTheadCls, thCls } from '@/components/list/DataCard';
import { StateBadge, type BadgeTone } from '@/components/list/StateBadge';
import { removeBankTx, updateBankTx } from '@/lib/data';
import { fmtMoney, addMonths } from '@/lib/utils';
import { ACCOUNT_CATEGORIES, suggestCategory } from '@/lib/categories';
import { Card, CardBody, CardHeader } from '@/components/Card';
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
  const [editTxId, setEditTxId] = useState<string | null>(null);
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

  // 액션 알림용 카운트
  const uncategorizedCount = monthTx.filter((t) => !t.category && (t.deposit > 0 || t.withdraw > 0)).length;
  const unmatchedDepositCount = monthTx.filter((t) => t.deposit > 0 && !t.matched_tenant_id).length;
  const hasAlert = uncategorizedCount > 0 || unmatchedDepositCount > 0;

  // 계정과목별 월 합계 (입금/지출 분리)
  const categoryTotals = useMemo(() => {
    const income = new Map<string, number>();
    const expense = new Map<string, number>();
    for (const t of monthTx) {
      // 자동 추천 카테고리 적용 (저장 안 됐어도 시각화에 반영)
      const cat = t.category || suggestCategory(t);
      if (!cat) continue;
      if (t.deposit > 0) income.set(cat, (income.get(cat) || 0) + t.deposit);
      else if (t.withdraw > 0) expense.set(cat, (expense.get(cat) || 0) + t.withdraw);
    }
    const sortDesc = (m: Map<string, number>) =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    return { income: sortDesc(income), expense: sortDesc(expense) };
  }, [monthTx]);

  // 이월 잔액 = 첫 거래의 (잔액 - 입금 + 출금) = 그 거래 직전 잔액
  const openingBalance = useMemo(() => {
    if (monthTx.length === 0) return 0;
    const first = monthTx[0];
    return first.balance - (first.deposit || 0) + (first.withdraw || 0);
  }, [monthTx]);

  // 일별 흐름 (해당 월의 days 길이 — D 차트용)
  const dailyFlow = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const arr: { day: number; deposit: number; withdraw: number; closing: number }[] = [];
    let running = openingBalance;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${month}-${String(d).padStart(2, '0')}`;
      const dayTx = monthTx.filter((t) => t.date === dateKey);
      const dep = dayTx.reduce((s, t) => s + (t.deposit || 0), 0);
      const wd = dayTx.reduce((s, t) => s + (t.withdraw || 0), 0);
      running = running + dep - wd;
      arr.push({ day: d, deposit: dep, withdraw: wd, closing: running });
    }
    return arr;
  }, [monthTx, month, openingBalance]);

  return (
    <div className="flex flex-col h-full space-y-5">
      <PageHeader
        title="자금일보"
        subtitle={`${month} · ${monthTx.length}건 거래`}
        actions={
          <Button variant="primary" onClick={() => setOpenUpload(true)}>
            <Upload className="w-3.5 h-3.5" /> 통장 거래내역 업로드
          </Button>
        }
      />

      {/* KPI 4개 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={ArrowDownCircle} label="입금" value={fmtMoney(totalDeposit)} tone="success" />
        <Kpi icon={ArrowUpCircle} label="출금" value={fmtMoney(totalWithdraw)} tone="danger" />
        <Kpi
          icon={TrendingUp}
          label="순증감"
          value={`${net >= 0 ? '+' : ''}${fmtMoney(net)}`}
          tone={net >= 0 ? 'info' : 'danger'}
        />
        <BalanceKpi opening={openingBalance} closing={lastBalance} />
      </div>

      {/* 일별 흐름 */}
      <DailyFlowChart flow={dailyFlow} />

      {/* 계정과목별 월 합계 (입금/지출 좌우) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CategoryTotalsCard
          title="입금 계정과목별"
          items={categoryTotals.income}
          total={totalDeposit}
          tone="income"
        />
        <CategoryTotalsCard
          title="지출 계정과목별"
          items={categoryTotals.expense}
          total={totalWithdraw}
          tone="expense"
        />
      </div>

      {/* 액션 알림 배너 */}
      {hasAlert && (
        <div className="bg-amber-50 border border-amber-200 rounded-md px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
          <div className="text-[12px] text-amber-900 flex items-center gap-3 flex-wrap">
            {uncategorizedCount > 0 && (
              <button
                onClick={() => setFilter('uncategorized')}
                className="font-semibold underline hover:text-amber-700"
              >
                미분류 {uncategorizedCount}건
              </button>
            )}
            {unmatchedDepositCount > 0 && (
              <button
                onClick={() => setFilter('deposit_unmatched')}
                className="font-semibold underline hover:text-amber-700"
              >
                매칭 안 된 입금 {unmatchedDepositCount}건
              </button>
            )}
            <span className="text-amber-700">— 클릭하면 해당 거래만 필터링</span>
          </div>
        </div>
      )}

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
                  <tr
                    key={t.id}
                    onClick={() => setEditTxId(t.id)}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/80 cursor-pointer"
                  >
                    <td className="py-2 px-4 tabular whitespace-nowrap text-zinc-700">{t.date}</td>
                    <td className="py-2 px-4">{t.description}</td>
                    <td className="py-2 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <CategorySelect
                        tx={t}
                      />
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

function DailyFlowChart({ flow }: { flow: { day: number; deposit: number; withdraw: number; closing: number }[] }) {
  const maxAmount = Math.max(1, ...flow.map((d) => Math.max(d.deposit, d.withdraw)));
  const hasAny = flow.some((d) => d.deposit > 0 || d.withdraw > 0);
  return (
    <Card>
      <CardHeader title="일별 흐름" desc={`${flow.length}일 · 막대=입출금 / 점=일 마감 잔액`} />
      <CardBody className="pt-2">
        {!hasAny ? (
          <div className="text-[12px] text-zinc-400 text-center py-6">거래 없음</div>
        ) : (
          <div>
            <div className="flex items-end gap-[2px] h-[88px] px-1">
              {flow.map((d) => {
                const depH = (d.deposit / maxAmount) * 100;
                const wdH = (d.withdraw / maxAmount) * 100;
                const hasTx = d.deposit > 0 || d.withdraw > 0;
                return (
                  <div
                    key={d.day}
                    className="flex-1 flex flex-col items-center justify-end gap-[1px] group relative"
                    title={`${d.day}일 — 입 ${fmtMoney(d.deposit)} / 출 ${fmtMoney(d.withdraw)} / 잔 ${fmtMoney(d.closing)}`}
                  >
                    <div className="flex items-end justify-center w-full h-full gap-[1px]">
                      <div
                        className="w-1/2 bg-green-500 rounded-t-[1px] opacity-80 group-hover:opacity-100 transition"
                        style={{ height: `${depH}%`, minHeight: d.deposit > 0 ? '2px' : '0' }}
                      />
                      <div
                        className="w-1/2 bg-red-500 rounded-t-[1px] opacity-80 group-hover:opacity-100 transition"
                        style={{ height: `${wdH}%`, minHeight: d.withdraw > 0 ? '2px' : '0' }}
                      />
                    </div>
                    {hasTx && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 hidden group-hover:block bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10 tabular">
                        {d.day}일
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[9.5px] text-zinc-400 mt-1 tabular px-1">
              <span>1일</span>
              <span>{Math.ceil(flow.length / 2)}일</span>
              <span>{flow.length}일</span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10.5px] text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-sm" /> 입금
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-sm" /> 출금
              </span>
              <span className="ml-auto text-zinc-400">한 칸=1일 · 호버 시 상세</span>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function BalanceKpi({ opening, closing }: { opening: number; closing: number }) {
  const delta = closing - opening;
  return (
    <div className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Wallet className="w-4 h-4 text-zinc-500" />
        <span className="text-[11.5px] text-zinc-500 uppercase tracking-wide font-medium">잔액 (이월 → 마감)</span>
      </div>
      <div className="text-[20px] font-bold tabular text-zinc-900">{fmtMoney(closing)}원</div>
      <div className="text-[10.5px] text-zinc-500 mt-0.5 tabular">
        이월 {fmtMoney(opening)} <span className="text-zinc-400">→</span>{' '}
        <span className={delta >= 0 ? 'text-blue-700 font-semibold' : 'text-red-700 font-semibold'}>
          {delta >= 0 ? '+' : ''}{fmtMoney(delta)}
        </span>
      </div>
    </div>
  );
}

function CategoryTotalsCard({
  title, items, total, tone,
}: {
  title: string;
  items: [string, number][];
  total: number;
  tone: 'income' | 'expense';
}) {
  const barColor = tone === 'income' ? 'bg-green-500' : 'bg-red-500';
  const textColor = tone === 'income' ? 'text-green-700' : 'text-red-700';
  const max = items.length > 0 ? items[0][1] : 0;
  return (
    <Card>
      <CardHeader
        title={title}
        desc={items.length === 0 ? '데이터 없음' : `${items.length}개 분류 · 합계 ${fmtMoney(total)}원`}
      />
      <CardBody className="pt-2">
        {items.length === 0 ? (
          <div className="text-[12px] text-zinc-400 text-center py-4">분류된 거래 없음</div>
        ) : (
          <div className="space-y-2">
            {items.map(([cat, amt]) => {
              const pct = max > 0 ? (amt / max) * 100 : 0;
              const sharePct = total > 0 ? (amt / total) * 100 : 0;
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between text-[11.5px] mb-0.5">
                    <span className="text-zinc-700 font-medium">{cat}</span>
                    <span className="tabular">
                      <span className={`font-semibold ${textColor}`}>{fmtMoney(amt)}</span>
                      <span className="text-zinc-400 ml-1 text-[10.5px]">{sharePct.toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Kpi({
  icon: Icon, label, value, tone,
}: {
  icon: any;
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'info' | 'muted';
}) {
  const color =
    tone === 'success' ? 'text-green-700'
    : tone === 'danger' ? 'text-red-700'
    : tone === 'info' ? 'text-blue-700'
    : 'text-zinc-900';
  const iconColor =
    tone === 'success' ? 'text-green-600'
    : tone === 'danger' ? 'text-red-600'
    : tone === 'info' ? 'text-blue-600'
    : 'text-zinc-500';
  return (
    <div className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-[11.5px] text-zinc-500 uppercase tracking-wide font-medium">{label}</span>
      </div>
      <div className={`text-[20px] font-bold tabular ${color}`}>{value}원</div>
    </div>
  );
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
      className={`h-7 px-1.5 text-[11px] font-medium border rounded tabular focus:outline-none focus:border-zinc-500 ${colorCls} ${placeholder ? 'text-zinc-400' : ''}`}
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
