'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { updateBankTx, writeAudit } from '@/lib/data';
import { fmtDate } from '@/lib/utils';
import { ACCOUNT_CATEGORIES } from '@/lib/categories';
import type { BankTransaction } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  txId: string | null;
}

// 계정과목은 lib/categories.ts에서 import

export function BankTxEditDialog({ open, onClose, txId }: Props) {
  const { bankTx, tenants, today } = useData();
  const { user } = useAuth();
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [matchedTenantId, setMatchedTenantId] = useState<string>('');
  const [deposit, setDeposit] = useState(0);
  const [withdraw, setWithdraw] = useState(0);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  const tx = txId ? bankTx.find((t) => t.id === txId) : null;

  useEffect(() => {
    if (tx) {
      setDate(tx.date);
      setDescription(tx.description);
      setCategory(tx.category || '');
      setMatchedTenantId(tx.matched_tenant_id || '');
      setDeposit(tx.deposit || 0);
      setWithdraw(tx.withdraw || 0);
      setMemo(tx.memo || '');
    }
  }, [tx?.id]);

  if (!open || !tx) return null;

  async function save() {
    if (!tx) return;
    setBusy(true);
    try {
      const patch: Partial<BankTransaction> = {
        date,
        description: description.trim(),
        category: category || undefined,
        matched_tenant_id: matchedTenantId || undefined,
        deposit: Math.max(0, Math.round(deposit)),
        withdraw: Math.max(0, Math.round(withdraw)),
        memo: memo || undefined,
      };
      await updateBankTx(tx.id, patch);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'bank_tx_edit',
        target: tx.id,
        memo: `${date} ${description.trim()} 수정 (분류 ${category || '미분류'})`,
        at: fmtDate(today),
      });
      toast.success('거래내역 저장됨');
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
      title="통장 거래내역 수정"
      desc={`${tx.id}`}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? '저장 중...' : '저장'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="거래일자">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
          />
        </Field>

        <Field label="적요">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="입금자명 또는 거래 내용"
            className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500"
          />
        </Field>

        <Field label={`분류 (계정과목) — ${deposit > 0 ? '입금' : withdraw > 0 ? '지출' : '미분류'}`}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500"
          >
            <option value="">— 미분류 —</option>
            {deposit > 0 && ACCOUNT_CATEGORIES.income.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            {withdraw > 0 && ACCOUNT_CATEGORIES.expense.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            {!deposit && !withdraw && (
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
        </Field>

        <Field label="매칭 상사">
          <select
            value={matchedTenantId}
            onChange={(e) => setMatchedTenantId(e.target.value)}
            className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500"
          >
            <option value="">— 매칭 없음 —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="입금 (원)">
            <input
              type="number"
              value={deposit}
              onChange={(e) => setDeposit(parseInt(e.target.value) || 0)}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] text-right tabular text-green-700 font-semibold focus:outline-none focus:border-zinc-500"
            />
          </Field>
          <Field label="출금 (원)">
            <input
              type="number"
              value={withdraw}
              onChange={(e) => setWithdraw(parseInt(e.target.value) || 0)}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] text-right tabular text-red-700 font-semibold focus:outline-none focus:border-zinc-500"
            />
          </Field>
        </div>

        <Field label="메모">
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            placeholder="비고 사항"
            className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500 resize-none"
          />
        </Field>

        <div className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded p-2">
          잔액 (업로드 시점): {tx.balance.toLocaleString()}원
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">{label}</label>
      {children}
    </div>
  );
}
