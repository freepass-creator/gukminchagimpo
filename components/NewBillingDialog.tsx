'use client';

import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveBilling, writeAudit } from '@/lib/data';
import { fmtMoney, fmtDate, fmtPeriod } from '@/lib/utils';
import type { Billing } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PRESET_TYPES = ['사무실 임대료', '전시장 사용료', '관리비', '수도', '전기', '가스', '추가 청구', '할인'];

interface ItemDraft {
  type: string;
  amount: number;
}

export function NewBillingDialog({ open, onClose }: Props) {
  const { leases, billings, byId, today } = useData();
  const { user } = useAuth();
  const [leaseId, setLeaseId] = useState('');
  const [period, setPeriod] = useState(fmtPeriod(today));
  const [dueDate, setDueDate] = useState(`${fmtPeriod(today)}-25`);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setLeaseId('');
      setPeriod(fmtPeriod(today));
      setDueDate(`${fmtPeriod(today)}-25`);
      setItems([]);
      setMemo('');
    }
  }, [open, today]);

  // 활성 계약만 (시작일 지나고 종료일 미도래)
  const activeLeases = useMemo(() => {
    const todayStr = fmtDate(today);
    return leases
      .filter((l) => l.status === 'active' && l.start <= todayStr && l.end >= todayStr)
      .map((l) => ({
        lease: l,
        tenant: byId.tenant.get(l.tenant_id),
      }));
  }, [leases, byId, today]);

  // period 변경 시 마감일 자동
  useEffect(() => {
    if (period) setDueDate(`${period}-25`);
  }, [period]);

  // lease 선택 시 기본 항목 채우기 (사무실 + 관리비)
  useEffect(() => {
    if (!leaseId) return;
    const l = leases.find((x) => x.id === leaseId);
    if (!l) return;
    setItems([
      { type: '사무실 임대료', amount: l.rent_total },
      { type: '관리비', amount: l.maint_total },
    ]);
  }, [leaseId, leases]);

  const total = useMemo(() => items.reduce((s, it) => s + (it.amount || 0), 0), [items]);

  // 중복 확인
  const duplicate = useMemo(() => {
    if (!leaseId || !period) return false;
    return billings.some((b) => b.lease_id === leaseId && b.period === period);
  }, [leaseId, period, billings]);

  function addItem(t?: string) {
    setItems((arr) => [...arr, { type: t || '', amount: 0 }]);
  }
  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((arr) => arr.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!leaseId) { toast.error('계약을 선택하세요'); return; }
    if (!period) { toast.error('청구월을 입력하세요'); return; }
    if (items.length === 0) { toast.error('청구 항목을 추가하세요'); return; }
    if (items.some((it) => !it.type.trim())) { toast.error('항목 종류를 모두 입력하세요'); return; }
    if (duplicate) {
      if (!confirm(`${period} 청구가 이미 존재합니다. 덮어쓸까요?`)) return;
    }
    setBusy(true);
    try {
      const lease = leases.find((l) => l.id === leaseId)!;
      const cleanItems = items.map((it) => ({ type: it.type.trim(), amount: Math.round(it.amount) }));
      const newTotal = cleanItems.reduce((s, it) => s + it.amount, 0);
      const b: Billing = {
        id: `BL_${lease.id}_${period.replace('-', '')}`,
        lease_id: lease.id,
        tenant_id: lease.tenant_id,
        period,
        items: cleanItems,
        total: newTotal,
        due_date: dueDate,
        paid_amount: 0,
        ...(memo ? { memo } : {}),
      } as Billing;
      await saveBilling(b);
      const tenant = byId.tenant.get(lease.tenant_id);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'billing_create',
        target: b.id,
        memo: `${tenant?.name} ${period} 청구 수동 생성 (총 ${fmtMoney(newTotal)})`,
        at: fmtDate(today),
      });
      toast.success(`${period} 청구 생성됨 (총 ${fmtMoney(newTotal)}원)`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally { setBusy(false); }
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="청구 추가"
      desc="특정 계약·월에 대해 수동으로 청구서 생성"
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !leaseId}>
            {busy ? '생성 중...' : '청구 생성'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* 계약 선택 */}
        <div>
          <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">계약</label>
          <select
            value={leaseId}
            onChange={(e) => setLeaseId(e.target.value)}
            className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500"
          >
            <option value="">— 활성 계약 선택 —</option>
            {activeLeases.map(({ lease: l, tenant }) => (
              <option key={l.id} value={l.id}>
                {tenant?.name || '?'} ({l.start} ~ {l.end}) · {l.id}
              </option>
            ))}
          </select>
        </div>

        {/* 청구월 + 마감일 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">청구월</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
            />
            {duplicate && (
              <div className="text-[10.5px] text-orange-600 mt-1">⚠ 이 계약의 {period} 청구가 이미 있습니다</div>
            )}
          </div>
          <div>
            <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">마감일</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>

        {/* 항목 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11.5px] text-zinc-600 font-medium">청구 항목</label>
            <span className="text-[10.5px] text-zinc-500">할인은 음수(-)로 입력</span>
          </div>
          <div className="border border-zinc-200 rounded-md overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                <tr>
                  <th className="text-left py-1.5 px-3 font-semibold">종류</th>
                  <th className="text-right py-1.5 px-3 font-semibold w-[170px]">금액 (원)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1 px-2">
                      <input
                        list="new-billing-types"
                        value={it.type}
                        onChange={(e) => updateItem(idx, { type: e.target.value })}
                        className="w-full h-7 px-2 border border-zinc-200 rounded text-[12px] focus:outline-none focus:border-zinc-500"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        value={Number.isFinite(it.amount) ? it.amount : 0}
                        onChange={(e) => updateItem(idx, { amount: parseInt(e.target.value) || 0 })}
                        className={`w-full h-7 px-2 border border-zinc-200 rounded text-[12px] text-right tabular focus:outline-none focus:border-zinc-500 ${
                          it.amount < 0 ? 'text-red-600' : ''
                        }`}
                      />
                    </td>
                    <td className="text-center">
                      <button onClick={() => removeItem(idx)} className="text-zinc-300 hover:text-red-600 p-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center py-4 text-zinc-400 text-[11.5px]">
                      계약 선택 시 기본 항목이 자동 채워지거나, 아래 빠른 추가
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-zinc-50/60 border-t border-zinc-200">
                <tr>
                  <td className="py-1.5 px-3 text-right text-[12px] font-bold text-zinc-700">총 청구액</td>
                  <td className="py-1.5 px-3 text-right text-[14px] font-bold tabular">{fmtMoney(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <datalist id="new-billing-types">
            {PRESET_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
          <div className="flex items-center gap-1 mt-2 flex-wrap">
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

        {/* 메모 */}
        <div>
          <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">메모 (선택)</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            placeholder="예: 6월 추가 청구"
            className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500 resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}
