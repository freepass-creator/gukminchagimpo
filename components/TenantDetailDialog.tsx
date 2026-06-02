'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './Modal';
import { Button } from './Button';
import { BillingDetailDialog } from './BillingDetailDialog';
import { useData } from '@/lib/data-context';
import { fmtMoney, fmtDate, daysBetween } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string | null;
}

export function TenantDetailDialog({ open, onClose, tenantId }: Props) {
  const { tenants, leases, billings, payments, bankTx, byId, index, today } = useData();
  const router = useRouter();
  const [openBilling, setOpenBilling] = useState<string | null>(null);

  const tenant = tenantId ? tenants.find((t) => t.id === tenantId) : null;

  const tenantLeases = useMemo(
    () => (tenant ? leases.filter((l) => l.tenant_id === tenant.id) : []),
    [tenant?.id, leases]
  );

  const tenantBillings = useMemo(
    () =>
      tenant
        ? billings
            .filter((b) => b.tenant_id === tenant.id)
            .slice()
            .sort((a, b) => b.period.localeCompare(a.period))
        : [],
    [tenant?.id, billings]
  );

  const tenantPayments = useMemo(
    () =>
      tenant
        ? payments
            .filter((p) => p.tenant_id === tenant.id)
            .slice()
            .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
        : [],
    [tenant?.id, payments]
  );

  const tenantBankTx = useMemo(
    () =>
      tenant
        ? bankTx
            .filter((tx) => tx.matched_tenant_id === tenant.id)
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [tenant?.id, bankTx]
  );

  const totalCharged = tenantBillings.reduce((s, b) => s + b.total, 0);
  const totalPaid = tenantBillings.reduce((s, b) => s + (b.paid_amount || 0), 0);
  const owe = totalCharged - totalPaid;
  const oldestUnpaid = tenantBillings
    .filter((b) => b.total - (b.paid_amount || 0) > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const maxOverdueDays = oldestUnpaid && oldestUnpaid.due_date < fmtDate(today)
    ? daysBetween(oldestUnpaid.due_date, fmtDate(today))
    : 0;

  if (!open || !tenant) return null;

  function goToFloor(floorId: string | undefined) {
    if (!floorId) return;
    onClose();
    router.push(`/map?floor=${encodeURIComponent(floorId)}`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`상사 상세 — ${tenant.name}`}
      desc={`${tenant.biz_no} · ${tenant.ceo} · ${tenant.phone}`}
      width={880}
      footer={
        <Button variant="ghost" onClick={onClose}>닫기</Button>
      }
    >
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Info label="계약" value={`${tenantLeases.filter((l) => l.status === 'active').length}건`} />
        <Info label="누적 청구" value={`${fmtMoney(totalCharged)}원`} />
        <Info label="누적 수납" value={`${fmtMoney(totalPaid)}원`} tone="success" />
        <Info
          label="미수금"
          value={`${fmtMoney(Math.max(0, owe))}원`}
          tone={owe > 0 ? 'danger' : 'muted'}
        />
        <Info label="보증금" value={`${fmtMoney(tenant.deposit_paid || 0)}원`} />
      </div>

      {owe > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-red-700 font-semibold">미수 현황</div>
            <div className="text-[18px] font-bold text-red-700 tabular mt-0.5">{fmtMoney(owe)}원</div>
            <div className="text-[11px] text-red-700 mt-0.5">
              미납 {tenantBillings.filter((b) => b.total - (b.paid_amount || 0) > 0).length}건
              {maxOverdueDays > 0 && (
                <> · 최장 연체 <span className="font-bold">{maxOverdueDays}일</span></>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 계약 리스트 */}
      <section className="mb-5">
        <h4 className="text-[12.5px] font-semibold text-zinc-700 mb-2">
          계약 ({tenantLeases.length}건)
        </h4>
        <div className="border border-zinc-200 rounded-md overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
              <tr>
                <th className="text-left py-1.5 px-3 font-semibold whitespace-nowrap">계약 ID</th>
                <th className="text-left py-1.5 px-3 font-semibold">사무실</th>
                <th className="text-left py-1.5 px-3 font-semibold">전시장</th>
                <th className="text-center py-1.5 px-3 font-semibold whitespace-nowrap">기간</th>
                <th className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">월 합계</th>
                <th className="text-center py-1.5 px-3 font-semibold whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {tenantLeases.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-4 text-zinc-400">계약 없음</td></tr>
              ) : (
                tenantLeases.map((l) => {
                  const officeStalls = (l.office_stall_ids || l.stall_ids.filter((id) => byId.stall.get(id)?.type === 'office'))
                    .map((id) => byId.stall.get(id))
                    .filter((s): s is NonNullable<typeof s> => !!s);
                  const officeRent = officeStalls.reduce((s, x) => s + (x.rent || 0), 0);
                  const sectionInfos = (l.section_ids || []).map((sid) => {
                    const sec = byId.section.get(sid);
                    const secStalls = index.stallsBySection.get(sid) || [];
                    return { sec, count: secStalls.length, rent: secStalls.reduce((s, x) => s + (x.rent || 0), 0) };
                  }).filter((x) => !!x.sec);
                  const parkingRent = sectionInfos.reduce((s, x) => s + x.rent, 0);
                  const totalRent = officeRent + parkingRent;
                  return (
                    <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-1.5 px-3 font-mono text-[10.5px] text-zinc-600">{l.id}</td>
                      <td className="py-1.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {officeStalls.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => goToFloor(s.floor_id)}
                              className="px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100"
                            >
                              {s.code}호
                            </button>
                          ))}
                          {officeStalls.length === 0 && <span className="text-zinc-300 text-[11px]">—</span>}
                        </div>
                      </td>
                      <td className="py-1.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {sectionInfos.map(({ sec, count }) => (
                            <button
                              key={sec!.id}
                              onClick={() => goToFloor(sec!.floor_id)}
                              className="px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                            >
                              {sec!.name} {count}면
                            </button>
                          ))}
                          {sectionInfos.length === 0 && <span className="text-zinc-300 text-[11px]">—</span>}
                        </div>
                      </td>
                      <td className="py-1.5 px-3 text-center text-[11px] tabular text-zinc-700 whitespace-nowrap">
                        <div>{l.start}</div>
                        <div className="text-zinc-500">~ {l.end}</div>
                      </td>
                      <td className="py-1.5 px-3 text-right tabular font-semibold whitespace-nowrap">{fmtMoney(totalRent)}</td>
                      <td className="py-1.5 px-3 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          l.status === 'active' ? 'bg-green-100 text-green-700'
                          : l.status === 'terminated' ? 'bg-zinc-100 text-zinc-600'
                          : 'bg-orange-100 text-orange-700'
                        }`}>
                          {l.status === 'active' ? '활성' : l.status === 'terminated' ? '해지' : l.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 청구·수납 매트릭스 (간단) */}
      <section className="mb-5">
        <h4 className="text-[12.5px] font-semibold text-zinc-700 mb-2">
          청구·수납 이력 ({tenantBillings.length}건)
        </h4>
        <div className="border border-zinc-200 rounded-md overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
              <tr>
                <th className="text-center py-1.5 px-3 font-semibold whitespace-nowrap">청구월</th>
                <th className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">청구액</th>
                <th className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">수납</th>
                <th className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">미수</th>
                <th className="text-center py-1.5 px-3 font-semibold whitespace-nowrap">마감일</th>
                <th className="text-center py-1.5 px-3 font-semibold whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {tenantBillings.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-4 text-zinc-400">청구 없음</td></tr>
              ) : (
                tenantBillings.map((b) => {
                  const paid = b.paid_amount || 0;
                  const o = b.total - paid;
                  const overdue = o > 0 && b.due_date < fmtDate(today);
                  return (
                    <tr
                      key={b.id}
                      onClick={() => setOpenBilling(b.id)}
                      className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50/80 cursor-pointer ${overdue ? 'bg-red-50/30' : ''}`}
                    >
                      <td className="py-1.5 px-3 text-center font-semibold tabular whitespace-nowrap">{b.period}</td>
                      <td className="py-1.5 px-3 text-right tabular">{fmtMoney(b.total)}</td>
                      <td className="py-1.5 px-3 text-right tabular text-green-700">{paid > 0 ? fmtMoney(paid) : '—'}</td>
                      <td className={`py-1.5 px-3 text-right tabular ${o > 0 ? 'text-red-600 font-bold' : 'text-zinc-300'}`}>
                        {o > 0 ? fmtMoney(o) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-center tabular text-zinc-600 whitespace-nowrap">{b.due_date}</td>
                      <td className="py-1.5 px-3 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          o === 0 ? 'bg-green-100 text-green-700'
                          : overdue ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {o === 0 ? '완납' : overdue ? '연체' : '미납'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 통장 매칭 입금 */}
      <section>
        <h4 className="text-[12.5px] font-semibold text-zinc-700 mb-2">
          통장 매칭 입금 ({tenantBankTx.length}건)
        </h4>
        <div className="border border-zinc-200 rounded-md overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
              <tr>
                <th className="text-left py-1.5 px-3 font-semibold whitespace-nowrap">일자</th>
                <th className="text-left py-1.5 px-3 font-semibold">적요</th>
                <th className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">입금</th>
                <th className="text-left py-1.5 px-3 font-semibold whitespace-nowrap">분류</th>
              </tr>
            </thead>
            <tbody>
              {tenantBankTx.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-4 text-zinc-400">매칭 입금 없음</td></tr>
              ) : (
                tenantBankTx.slice(0, 12).map((tx) => (
                  <tr key={tx.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1.5 px-3 tabular whitespace-nowrap text-zinc-700">{tx.date}</td>
                    <td className="py-1.5 px-3 text-zinc-700">{tx.description}</td>
                    <td className="py-1.5 px-3 text-right tabular text-green-700 font-semibold whitespace-nowrap">
                      +{fmtMoney(tx.deposit || 0)}
                    </td>
                    <td className="py-1.5 px-3 text-zinc-600 text-[11px] whitespace-nowrap">{tx.category || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <BillingDetailDialog
        open={!!openBilling}
        onClose={() => setOpenBilling(null)}
        billingId={openBilling}
      />
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
