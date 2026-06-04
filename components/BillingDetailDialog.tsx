'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus, X, ArrowDownCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { updateBilling, savePayment, writeAudit, deleteBillingWithCleanup } from '@/lib/data';
import { fmtMoney, fmtDate, daysBetween, newId } from '@/lib/utils';
import type { Billing, Payment } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  billingId: string | null;
}

/** 청구 항목 종류 — 양수=청구, 음수=할인 */
const PRESET_TYPES = ['사무실 임대료', '전시장 사용료', '관리비', '수도', '전기', '가스', '추가 청구', '할인'];

interface ItemDraft {
  type: string;
  amount: number;
}

export function BillingDetailDialog({ open, onClose, billingId }: Props) {
  const { billings, payments, bankTx, byId, today } = useData();
  const { user } = useAuth();
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [memo, setMemo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  const billing = billingId ? billings.find((b) => b.id === billingId) : null;
  const tenant = billing ? byId.tenant.get(billing.tenant_id) : null;

  /** 이 청구서에 매칭된 수납 내역 (Payment.allocations + 통장 매칭) */
  const receivedItems = useMemo(() => {
    if (!billing) return [];
    const out: Array<{
      id: string;
      date: string;
      amount: number;
      method: string;
      source: 'payment' | 'bank';
      memo?: string;
    }> = [];
    // 1) Payment.allocations 중 이 billing.id에 배분된 것
    for (const p of payments) {
      for (const a of (p.allocations || [])) {
        if (a.billing_id === billing.id) {
          // 해당 payment가 통장 매칭에서 왔는지 확인
          const bank = bankTx.find((b) => b.matched_payment_id === p.id);
          out.push({
            id: `${p.id}-${a.billing_id}`,
            date: p.paid_at,
            amount: a.amount,
            method: p.method || '계좌이체',
            source: bank ? 'bank' : 'payment',
            memo: bank?.description,
          });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [billing?.id, payments, bankTx]);

  useEffect(() => {
    if (billing) {
      setItems(billing.items.map((it) => ({ type: it.type, amount: it.amount })));
      setMemo((billing as any).memo || '');
      setDueDate(billing.due_date);
    }
  }, [billing?.id]);

  const total = useMemo(() => items.reduce((s, it) => s + (it.amount || 0), 0), [items]);
  const paid = billing?.paid_amount || 0;
  const owe = total - paid;
  const isOverdue = owe > 0 && dueDate < fmtDate(today);
  const overdueDays = isOverdue ? daysBetween(dueDate, fmtDate(today)) : 0;

  if (!open || !billing) return null;

  function addItem(presetType?: string) {
    setItems((arr) => [...arr, { type: presetType || '', amount: 0 }]);
  }

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((arr) => arr.filter((_, i) => i !== idx));
  }

  async function addPayment() {
    if (!billing || !tenant) return;
    const remain = total - paid;
    const amtStr = prompt(`수납 금액을 입력하세요 (미수 ${fmtMoney(Math.max(0, remain))}원)`, String(Math.max(0, remain)));
    const amt = parseInt(amtStr || '0');
    if (!amt || amt <= 0) return;
    const dateStr = prompt('수납 일자 (YYYY-MM-DD)', fmtDate(today));
    if (!dateStr) return;
    const method = prompt('수납 방식 (계좌이체 / 현금 / 카드 등)', '계좌이체') || '계좌이체';
    setBusy(true);
    try {
      const p: Payment = {
        id: newId('PM'),
        tenant_id: tenant.id,
        amount: amt,
        paid_at: dateStr,
        method,
        allocations: [{ billing_id: billing.id, amount: amt }],
      };
      await savePayment(p);
      await updateBilling(billing.id, { paid_amount: (billing.paid_amount || 0) + amt });
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'payment_received',
        target: billing.id,
        memo: `${dateStr} 수납 ${fmtMoney(amt)}원 (${method})`,
        at: fmtDate(today),
      });
      toast.success(`수납 ${fmtMoney(amt)}원 추가됨`);
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally { setBusy(false); }
  }

  async function deleteBilling() {
    if (!billing) return;
    if (!confirm(`${billing.period} 청구를 삭제할까요?\n수납 ${fmtMoney(paid)}원이 있다면 payment.allocations에서 함께 제거됩니다 (환불은 별도 처리).`)) return;
    setBusy(true);
    try {
      await deleteBillingWithCleanup(billing.id);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'billing_delete',
        target: billing.id,
        memo: `${billing.period} 청구 삭제 (총 ${fmtMoney(billing.total)})`,
        at: fmtDate(today),
      });
      toast.success('청구 삭제됨');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally { setBusy(false); }
  }

  async function save() {
    if (!billing) return;
    if (items.length === 0) {
      toast.error('청구 항목이 비어 있습니다');
      return;
    }
    if (items.some((it) => !it.type.trim())) {
      toast.error('항목 종류를 모두 입력하세요');
      return;
    }
    setBusy(true);
    try {
      const cleanItems = items.map((it) => ({ type: it.type.trim(), amount: Math.round(it.amount) }));
      const newTotal = cleanItems.reduce((s, it) => s + it.amount, 0);
      await updateBilling(billing.id, {
        items: cleanItems,
        total: newTotal,
        due_date: dueDate,
        ...(memo ? { memo } : {}),
      } as Partial<Billing>);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'billing_edit',
        target: billing.id,
        memo: `${billing.period} 청구 항목 ${cleanItems.length}건 수정 (총 ${fmtMoney(newTotal)})`,
        at: fmtDate(today),
      });
      toast.success('청구서 저장됨');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`청구·수납 명세서 — ${tenant?.name} · ${billing.period}`}
      desc={`${billing.id}`}
      width={680}
      footer={
        <>
          <Button variant="danger" onClick={deleteBilling} disabled={busy}>
            청구 삭제
          </Button>
          <Button variant="primary" onClick={async () => { await save(); }} disabled={busy}>
            {busy ? '저장 중...' : '닫기'}
          </Button>
        </>
      }
    >
      {/* 청구 헤더 정보 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Info label="상사" value={tenant?.name || '—'} />
        <Info label="청구월" value={billing.period} />
        <Info label="수납액" value={`${fmtMoney(paid)}원`} tone="success" />
        <Info
          label="미수액"
          value={`${fmtMoney(Math.max(0, owe))}원`}
          tone={owe > 0 ? 'danger' : 'muted'}
        />
      </div>

      {/* 마감일 */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-[12px] text-zinc-600 w-16 shrink-0">마감일</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
        />
        {isOverdue && (
          <span className="text-[11.5px] text-red-600 font-bold">연체 {overdueDays}일</span>
        )}
      </div>

      {/* 항목 리스트 */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12.5px] font-semibold text-zinc-700">청구 항목</h4>
          <span className="text-[10.5px] text-zinc-500">할인은 음수(-)로 입력</span>
        </div>
        <div className="border border-zinc-200 rounded-md overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
              <tr>
                <th className="text-left py-1.5 px-3 font-semibold">종류</th>
                <th className="text-right py-1.5 px-3 font-semibold w-[180px]">금액 (원)</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const isDiscount = it.amount < 0;
                return (
                  <tr key={idx} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1.5 px-3">
                      <input
                        list="billing-types"
                        value={it.type}
                        onChange={(e) => updateItem(idx, { type: e.target.value })}
                        placeholder="예: 사무실 임대료, 관리비, 수도..."
                        className="w-full h-7 px-2 border border-zinc-200 rounded text-[12px] focus:outline-none focus:border-zinc-500"
                      />
                    </td>
                    <td className="py-1.5 px-3">
                      <input
                        type="number"
                        value={Number.isFinite(it.amount) ? it.amount : 0}
                        onChange={(e) => updateItem(idx, { amount: parseInt(e.target.value) || 0 })}
                        className={`w-full h-7 px-2 border border-zinc-200 rounded text-[12px] text-right tabular focus:outline-none focus:border-zinc-500 ${
                          isDiscount ? 'text-red-600' : ''
                        }`}
                      />
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => removeItem(idx)}
                        className="text-zinc-300 hover:text-red-600 p-1"
                        title="항목 삭제"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center py-4 text-zinc-400 text-[12px]">
                    항목을 추가하세요
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-zinc-50/60 border-t border-zinc-200">
              <tr>
                <td className="py-2 px-3 text-right text-[12px] font-bold text-zinc-700">총 청구액</td>
                <td className="py-2 px-3 text-right text-[14px] font-bold tabular">
                  {fmtMoney(total)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <datalist id="billing-types">
          {PRESET_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        {/* 빠른 추가 버튼 */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className="text-[10.5px] text-zinc-500 mr-1">빠른 추가:</span>
          {PRESET_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => addItem(t)}
              className="px-2 h-6 text-[11px] border border-zinc-200 rounded-full bg-white hover:bg-zinc-50 text-zinc-700"
            >
              + {t}
            </button>
          ))}
          <button
            onClick={() => addItem()}
            className="px-2 h-6 text-[11px] border border-zinc-300 rounded-full bg-zinc-50 hover:bg-zinc-100 text-zinc-700 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 직접 입력
          </button>
        </div>
      </div>

      {/* 수납 내역 */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12.5px] font-semibold text-zinc-700">
            수납 내역 ({receivedItems.length}건 · 합계 {fmtMoney(receivedItems.reduce((s, x) => s + x.amount, 0))}원)
          </h4>
          <Button variant="outline" size="sm" onClick={addPayment} disabled={busy}>
            <Plus className="w-3 h-3" /> 수납 추가
          </Button>
        </div>
        <div className="border border-zinc-200 rounded-md overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
              <tr>
                <th className="text-left py-1.5 px-3 font-semibold whitespace-nowrap">수납일</th>
                <th className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">금액</th>
                <th className="text-center py-1.5 px-3 font-semibold whitespace-nowrap">방식</th>
                <th className="text-center py-1.5 px-3 font-semibold whitespace-nowrap">출처</th>
                <th className="text-left py-1.5 px-3 font-semibold">비고</th>
              </tr>
            </thead>
            <tbody>
              {receivedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-4 text-zinc-400 text-[11.5px]">
                    수납 내역 없음 — 통장 매칭 또는 직접 입력
                  </td>
                </tr>
              ) : (
                receivedItems.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1.5 px-3 tabular whitespace-nowrap text-zinc-700">{r.date}</td>
                    <td className="py-1.5 px-3 text-right tabular text-green-700 font-semibold whitespace-nowrap">
                      +{fmtMoney(r.amount)}
                    </td>
                    <td className="py-1.5 px-3 text-center text-zinc-600 text-[11.5px] whitespace-nowrap">{r.method}</td>
                    <td className="py-1.5 px-3 text-center whitespace-nowrap">
                      {r.source === 'bank' ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">통장 매칭</span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-700">직접 입력</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-[11px] text-zinc-500 truncate max-w-[180px]">{r.memo || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 메모 */}
      <div className="mt-4">
        <label className="text-[12px] text-zinc-600 block mb-1">메모 (선택)</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          placeholder="예: 6월 임시 할인 / 7월부터 정상 청구"
          className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500 resize-none"
        />
      </div>
    </Modal>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' | 'muted' }) {
  const color =
    tone === 'success' ? 'text-green-700'
    : tone === 'danger' ? 'text-red-600'
    : tone === 'muted' ? 'text-zinc-500'
    : 'text-zinc-900';
  return (
    <div className="bg-zinc-50 rounded-md border border-zinc-200 px-2.5 py-1.5">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[13px] font-bold mt-0.5 tabular ${color}`}>{value}</div>
    </div>
  );
}
