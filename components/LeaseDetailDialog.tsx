'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { getStallState } from '@/lib/state';
import {
  saveLease,
  saveBilling,
  savePayment,
  updateBilling,
  updateLease,
  writeAudit,
} from '@/lib/data';
import { addDays, addMonths, fmtDate, newId, fmtMoney, daysBetween } from '@/lib/utils';
import type { Lease, Payment } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  leaseId: string | null;
}

export function LeaseDetailDialog({ open, onClose, leaseId }: Props) {
  const { leases, tenants, stalls, billings, payments, config, today, byId, index } = useData();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!leaseId) return null;
  const lease = leases.find((l) => l.id === leaseId);
  if (!lease) return null;

  const tenant = tenants.find((t) => t.id === lease.tenant_id);

  // 사무실 / 주차 블럭 디테일
  const officeStalls = (lease.office_stall_ids || lease.stall_ids.filter(
    (id) => stalls.find((s) => s.id === id)?.type === 'office'
  )).map((id) => byId.stall.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const sectionsUsed = (lease.section_ids || []).map((sid) => {
    const sec = byId.section.get(sid);
    if (!sec) return null;
    const secStalls = index.stallsBySection.get(sid) || [];
    return { section: sec, count: secStalls.length };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const looseParking = lease.stall_ids
    .map((id) => byId.stall.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s && s.type === 'parking');

  const bills = billings
    .filter((b) => b.lease_id === lease.id)
    .sort((a, b) => a.period.localeCompare(b.period));
  const arrears = bills.reduce((s, b) => s + (b.total - (b.paid_amount || 0)), 0);
  const unpaidBills = bills.filter((b) => b.total - (b.paid_amount || 0) > 0);
  const oldestUnpaid = unpaidBills.length > 0
    ? unpaidBills.slice().sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
    : null;
  const maxOverdueDays = oldestUnpaid && oldestUnpaid.due_date < fmtDate(today)
    ? daysBetween(oldestUnpaid.due_date, fmtDate(today))
    : 0;

  const totalDays = daysBetween(lease.start, lease.end);
  const remainingDays = lease.end >= fmtDate(today) ? daysBetween(fmtDate(today), lease.end) : -1;

  const result = getStallState(
    lease.stall_ids[0],
    leases,
    billings,
    config,
    today
  );

  async function recordPayment() {
    const total = bills.reduce(
      (s, b) => s + (b.total - (b.paid_amount || 0)),
      0
    );
    if (total === 0) {
      toast.info('미수금 없음');
      return;
    }
    const amtStr = prompt(`수납 금액 (전체 미수 ${fmtMoney(total)}원)`, String(total));
    const amt = parseInt(amtStr || '0');
    if (!amt || amt <= 0) return;
    setBusy(true);
    try {
      let remain = amt;
      const allocs: { billing_id: string; amount: number }[] = [];
      for (const b of bills.filter((x) => x.total > (x.paid_amount || 0))) {
        if (remain <= 0) break;
        const owe = b.total - (b.paid_amount || 0);
        const use = Math.min(owe, remain);
        await updateBilling(b.id, { paid_amount: (b.paid_amount || 0) + use });
        allocs.push({ billing_id: b.id, amount: use });
        remain -= use;
      }
      const p: Payment = {
        id: newId('PM'),
        tenant_id: lease!.tenant_id,
        amount: amt,
        paid_at: fmtDate(today),
        method: '계좌이체',
        allocations: allocs,
      };
      await savePayment(p);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'payment_received',
        target: lease!.id,
        memo: `${fmtMoney(amt)}원 수납 (${allocs.length}건 배분)`,
        at: fmtDate(today),
      });
      toast.success(`수납 완료 (${fmtMoney(amt)}원)`);
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setBusy(false);
    }
  }

  async function renew() {
    const newEnd = addMonths(lease!.end, 12);
    const rate = config.renewal_increase_rate;
    const newRent = Math.round(lease!.rent_total * (1 + rate));
    if (
      !confirm(
        `갱신 — 새 종료일 ${fmtDate(newEnd)}\n월세 ${fmtMoney(lease!.rent_total)} → ${fmtMoney(newRent)} (${(rate * 100).toFixed(1)}% 인상)\n진행할까요?`
      )
    )
      return;
    setBusy(true);
    try {
      const newId_ = newId('L');
      await saveLease({
        id: newId_,
        tenant_id: lease!.tenant_id,
        stall_ids: lease!.stall_ids,
        start: fmtDate(addDays(lease!.end, 1)),
        end: fmtDate(newEnd),
        rent_total: newRent,
        maint_total: lease!.maint_total,
        deposit: lease!.deposit,
        status: 'active',
        signed_at: fmtDate(today),
        renewed_from: lease!.id,
      });
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'lease_renew',
        target: lease!.id,
        memo: `갱신 → ${newId_}, ${(rate * 100).toFixed(1)}% 인상`,
        at: fmtDate(today),
      });
      toast.success(`갱신 완료 — 새 계약 ${newId_}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setBusy(false);
    }
  }

  async function terminate() {
    const date = prompt('중도 해지일 (YYYY-MM-DD)', fmtDate(today));
    if (!date) return;
    const settle = lease!.deposit - arrears;
    if (
      !confirm(
        `${tenant?.name} 중도 해지 (${date})\n보증금 ${fmtMoney(lease!.deposit)} − 미수 ${fmtMoney(arrears)} = 반환 ${fmtMoney(settle)}원\n진행할까요?`
      )
    )
      return;
    setBusy(true);
    try {
      await updateLease(lease!.id, {
        end: date,
        status: 'terminated',
        terminated_at: date,
      });
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'lease_terminate',
        target: lease!.id,
        memo: `${date} 중도 해지, 정산 ${fmtMoney(settle)}원`,
        at: fmtDate(today),
      });
      toast.success(`해지 완료. 정산 ${fmtMoney(settle)}원`);
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
      title={`계약 상세 — ${tenant?.name}`}
      desc={`${lease.id} · ${lease.start} ~ ${lease.end}`}
      width={760}
      footer={
        <>
          {arrears > 0 && (
            <Button variant="primary" onClick={recordPayment} disabled={busy}>
              수납 등록
            </Button>
          )}
          {result.state === 'expiring' && (
            <Button variant="outline" onClick={renew} disabled={busy}>
              갱신 처리
            </Button>
          )}
          <Button variant="danger" onClick={terminate} disabled={busy}>
            중도 해지
          </Button>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </>
      }
    >
      {/* 계약 핵심 정보 */}
      <div className="space-y-1">
        <Row k="상사" v={`${tenant?.name} (${tenant?.biz_no})`} />
        <Row k="대표·연락" v={`${tenant?.ceo} · ${tenant?.phone}`} />
        <Row
          k="계약 기간"
          v={
            <span>
              {lease.start} ~ {lease.end}{' '}
              <span className="text-zinc-500 text-[11.5px] ml-1">
                ({totalDays}일 / 잔여 {remainingDays >= 0 ? `${remainingDays}일` : '만료'})
              </span>
            </span>
          }
        />
        <Row
          k="사무실"
          v={
            officeStalls.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {officeStalls.map((s) => {
                  const f = s.floor_id ? byId.floor.get(s.floor_id) : undefined;
                  return (
                    <span key={s.id} className="inline-block px-2 py-0.5 rounded border bg-blue-50 border-blue-300 text-blue-800 text-[11.5px] font-medium">
                      {f?.building}동 {s.code}호
                    </span>
                  );
                })}
              </div>
            ) : <span className="text-zinc-400">없음</span>
          }
        />
        <Row
          k="주차 블럭"
          v={
            sectionsUsed.length > 0 || looseParking.filter((s) => !s.section_id).length > 0 ? (
              <div className="flex flex-wrap gap-1.5 items-center">
                {sectionsUsed.map(({ section, count }) => {
                  const f = byId.floor.get(section.floor_id);
                  return (
                    <span key={section.id} className="inline-block px-2 py-0.5 rounded border bg-amber-50 border-amber-300 text-amber-800 text-[11.5px] font-medium">
                      {f?.building}동 {section.name} <span className="tabular font-semibold">{count}면</span>
                    </span>
                  );
                })}
                <span className="text-[11.5px] text-zinc-600 ml-1">
                  총 {sectionsUsed.reduce((s, x) => s + x.count, 0)}면
                </span>
              </div>
            ) : <span className="text-zinc-400">없음</span>
          }
        />
        <Row k="월세 합계" v={`${fmtMoney(lease.rent_total)}원`} />
        <Row k="관리비" v={`${fmtMoney(lease.maint_total)}원`} />
        <Row k="보증금" v={`${fmtMoney(lease.deposit)}원`} />
        <Row k="상태" v={<StatusBadge state={result.state} />} />
      </div>

      {/* 미수 강조 박스 */}
      {arrears > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3.5 flex items-center justify-between gap-4">
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-red-700 font-semibold">미수 현황</div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-[22px] font-bold text-red-700 tabular">{fmtMoney(arrears)}</span>
              <span className="text-[12px] text-red-600">원</span>
            </div>
            <div className="text-[11px] text-red-700 mt-1">
              {unpaidBills.length}건 미납
              {maxOverdueDays > 0 && (
                <> · 최장 연체 <span className="font-bold">{maxOverdueDays}일</span></>
              )}
              {oldestUnpaid && (
                <> · 가장 오래된 마감일 <span className="tabular">{oldestUnpaid.due_date}</span></>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10.5px] text-red-700 font-semibold">보증금</div>
            <div className="text-[14px] font-semibold text-red-900 tabular">{fmtMoney(lease.deposit)}원</div>
            <div className="text-[10.5px] text-red-600 mt-0.5">
              해지 시 정산 {fmtMoney(lease.deposit - arrears)}원
            </div>
          </div>
        </div>
      )}

      {/* 청구 이력 */}
      <h4 className="text-[12.5px] font-semibold mt-5 mb-2 text-zinc-700">
        청구·수납 이력 ({bills.length}건)
      </h4>
      <div className="border border-zinc-200 rounded-md overflow-hidden">
        <table className="w-full text-[11.5px] border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <th className="text-left py-1.5 px-2 font-semibold whitespace-nowrap">청구월</th>
              <th className="text-left py-1.5 px-2 font-semibold">항목</th>
              <th className="text-right py-1.5 px-2 font-semibold whitespace-nowrap">청구</th>
              <th className="text-right py-1.5 px-2 font-semibold whitespace-nowrap">수납</th>
              <th className="text-right py-1.5 px-2 font-semibold whitespace-nowrap">미수</th>
              <th className="text-center py-1.5 px-2 font-semibold whitespace-nowrap">마감일</th>
              <th className="text-center py-1.5 px-2 font-semibold whitespace-nowrap">연체</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const owe = b.total - (b.paid_amount || 0);
              const isOverdue = owe > 0 && b.due_date < fmtDate(today);
              const overdueDays = isOverdue ? daysBetween(b.due_date, fmtDate(today)) : 0;
              return (
                <tr key={b.id} className={`border-b border-zinc-100 last:border-0 ${isOverdue ? 'bg-red-50/40' : ''}`}>
                  <td className="py-1.5 px-2 font-semibold tabular whitespace-nowrap">{b.period}</td>
                  <td className="py-1.5 px-2 text-[10.5px] text-zinc-600">
                    {b.items.map((it, i) => (
                      <span key={i}>
                        {i > 0 && <span className="text-zinc-300"> · </span>}
                        {it.type}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular font-medium">{fmtMoney(b.total)}</td>
                  <td className="py-1.5 px-2 text-right tabular text-green-700">
                    {(b.paid_amount || 0) > 0 ? fmtMoney(b.paid_amount || 0) : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className={`py-1.5 px-2 text-right tabular ${owe > 0 ? 'text-red-600 font-bold' : 'text-zinc-300'}`}>
                    {owe > 0 ? fmtMoney(owe) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-center text-zinc-600 tabular whitespace-nowrap">{b.due_date}</td>
                  <td className="py-1.5 px-2 text-center whitespace-nowrap">
                    {overdueDays > 0 ? (
                      <span className={`text-[11.5px] font-bold tabular ${overdueDays >= 31 ? 'text-red-600' : 'text-orange-600'}`}>
                        {overdueDays}일
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {bills.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-4 text-zinc-400">
                  청구 내역 없음
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1 border-b border-zinc-100 last:border-0 text-[12.5px]">
      <div className="text-zinc-500 w-24 shrink-0">{k}</div>
      <div className="text-zinc-900 font-medium flex-1">{v}</div>
    </div>
  );
}
