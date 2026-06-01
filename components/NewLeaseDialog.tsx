'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Building, Car, Calendar } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { findConflicts } from '@/lib/state';
import { saveLease, saveTenant, updateLease, writeAudit } from '@/lib/data';
import { addMonths, addDays, fmtDate, newId, cn, fmtMoney } from '@/lib/utils';
import type { Lease, Tenant } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type ConflictChoice = 'shift' | 'terminate' | 'force';

export function NewLeaseDialog({ open, onClose }: Props) {
  const { stalls, tenants, leases, sections, config, today } = useData();
  const { user } = useAuth();

  const [tenantId, setTenantId] = useState('');
  const [newTenant, setNewTenant] = useState<Partial<Tenant>>({});
  const [pickedOfficeIds, setPickedOfficeIds] = useState<string[]>([]);
  const [pickedSectionIds, setPickedSectionIds] = useState<string[]>([]);
  const [start, setStart] = useState(fmtDate(today));
  const [end, setEnd] = useState(fmtDate(addMonths(today, 12)));
  const [rent, setRent] = useState(0);
  const [maint, setMaint] = useState(0);
  const [deposit, setDeposit] = useState(0);
  const [memo, setMemo] = useState('');
  const [choice, setChoice] = useState<ConflictChoice>('shift');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTenantId('');
      setNewTenant({});
      setPickedOfficeIds([]);
      setPickedSectionIds([]);
      setStart(fmtDate(today));
      setEnd(fmtDate(addMonths(today, 12)));
      setRent(0);
      setMaint(0);
      setDeposit(0);
      setMemo('');
      setChoice('shift');
    }
  }, [open, today]);

  // 선택된 블럭들에 속한 주차 stall_id 모음
  const sectionStallIds = useMemo(() => {
    const ids: string[] = [];
    for (const secId of pickedSectionIds) {
      const stallsInSection = stalls.filter((s) => s.section_id === secId);
      ids.push(...stallsInSection.map((s) => s.id));
    }
    return ids;
  }, [pickedSectionIds, stalls]);

  // 전체 stall_id (충돌 검사용)
  const allStallIds = useMemo(
    () => [...pickedOfficeIds, ...sectionStallIds],
    [pickedOfficeIds, sectionStallIds]
  );

  // 가격 자동 계산
  useEffect(() => {
    const officeStalls = stalls.filter((s) => pickedOfficeIds.includes(s.id));
    const pickedSections = sections.filter((sec) => pickedSectionIds.includes(sec.id));
    const r = officeStalls.reduce((acc, x) => acc + x.rent, 0)
            + pickedSections.reduce((acc, x) => acc + x.rent, 0);
    const m = officeStalls.reduce((acc, x) => acc + x.maint, 0)
            + pickedSections.reduce((acc, x) => acc + x.maint, 0);
    setRent(r);
    setMaint(m);
    setDeposit(r * config.deposit_multiplier);
  }, [pickedOfficeIds, pickedSectionIds, stalls, sections, config.deposit_multiplier]);

  // 충돌 감지
  const conflicts = useMemo(() => {
    if (!start || !end || allStallIds.length === 0) return [];
    return findConflicts(allStallIds, start, end, leases);
  }, [allStallIds, start, end, leases]);

  // 계약 스케줄 미리보기 — 매월 청구 회차
  const billingSchedule = useMemo(() => {
    if (!start || !end || end <= start) return [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    const items: { period: string; dueDate: string; amount: number }[] = [];
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    let safety = 60;
    while (cursor <= endDate && safety-- > 0) {
      const period = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0');
      const dueDay = String(config.due_day).padStart(2, '0');
      items.push({
        period,
        dueDate: `${period}-${dueDay}`,
        amount: rent + maint,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return items;
  }, [start, end, rent, maint, config.due_day]);

  const toggleOffice = (id: string) =>
    setPickedOfficeIds((arr) =>
      arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
    );
  const toggleSection = (id: string) =>
    setPickedSectionIds((arr) =>
      arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
    );

  async function submit() {
    if (!tenantId) { toast.error('입주 상사를 선택하세요'); return; }
    if (pickedOfficeIds.length === 0 && pickedSectionIds.length === 0) {
      toast.error('사무실 또는 주차 블럭 1개 이상 선택');
      return;
    }
    if (!start || !end || end <= start) {
      toast.error('계약 시작·종료일을 확인하세요');
      return;
    }

    setSubmitting(true);
    try {
      let tid = tenantId;
      if (tid === '__new__') {
        if (!newTenant.name) {
          toast.error('새 상사명을 입력하세요');
          setSubmitting(false);
          return;
        }
        tid = newId('T');
        const t: Tenant = {
          id: tid,
          name: newTenant.name!,
          biz_no: newTenant.biz_no || '',
          ceo: newTenant.ceo || '',
          phone: newTenant.phone || '',
          deposit_paid: 0,
        };
        await saveTenant(t);
      }

      let actualStart = start;

      // 충돌 처리
      if (conflicts.length > 0) {
        if (choice === 'shift') {
          const latestEnd = conflicts.map((c) => c.lease.end).sort().at(-1)!;
          actualStart = fmtDate(addDays(latestEnd, 1));
        } else if (choice === 'terminate') {
          const seen = new Set<string>();
          for (const c of conflicts) {
            if (seen.has(c.lease.id)) continue;
            seen.add(c.lease.id);
            const newEnd = fmtDate(addDays(start, -1));
            await updateLease(c.lease.id, { end: newEnd });
            await writeAudit({
              actor: user?.email || 'unknown',
              type: 'lease_terminate_for_new',
              target: c.lease.id,
              memo: `신규 계약 위해 ${newEnd}로 중도 해지`,
              at: fmtDate(today),
            });
          }
        } else if (choice === 'force') {
          await writeAudit({
            actor: user?.email || 'unknown',
            type: 'lease_force_register',
            target: allStallIds.join(','),
            memo: `기간 중복 강제 등록: ${memo || '(메모 없음)'}`,
            at: fmtDate(today),
          });
        }
      }

      const lid = newId('L');
      const lease: Lease = {
        id: lid,
        tenant_id: tid,
        stall_ids: allStallIds,
        office_stall_ids: pickedOfficeIds,
        section_ids: pickedSectionIds.length > 0 ? pickedSectionIds : undefined,
        start: actualStart,
        end,
        rent_total: rent,
        maint_total: maint,
        deposit,
        status: 'active',
        signed_at: fmtDate(today),
        memo: memo || undefined,
      };
      await saveLease(lease);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'lease_create',
        target: lid,
        memo: `${tenants.find((t) => t.id === tid)?.name || newTenant.name} 신규 계약 (사무실 ${pickedOfficeIds.length} + 블럭 ${pickedSectionIds.length})`,
        at: fmtDate(today),
      });
      toast.success('신규 계약 등록 완료');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '저장 실패');
    } finally {
      setSubmitting(false);
    }
  }

  // 동별로 정리
  const buildings = Array.from(new Set(stalls.map((s) => s.building))).sort();
  const officesByBuilding: Record<string, typeof stalls> = {};
  const sectionsByBuilding: Record<string, typeof sections> = {};
  for (const b of buildings) {
    officesByBuilding[b] = stalls.filter((s) => s.building === b && s.type === 'office');
    sectionsByBuilding[b] = sections.filter((sec) => sec.building === b);
  }
  // 묶이지 않은 개별 주차
  const looseParkingByBuilding: Record<string, typeof stalls> = {};
  for (const b of buildings) {
    looseParkingByBuilding[b] = stalls.filter(
      (s) => s.building === b && s.type === 'parking' && !s.section_id
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="신규 임대 계약"
      desc="사무실 N실 + 주차 블럭 N개 단위로 임대"
      width={920}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? '등록 중...' : '계약 생성'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 상사 + 기간 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="입주 상사">
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="select"
            >
              <option value="">— 선택 —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.biz_no})
                </option>
              ))}
              <option value="__new__">＋ 새 상사 등록</option>
            </select>
          </Field>
          <Field label="시작일">
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="종료일">
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="input"
            />
          </Field>
        </div>

        {tenantId === '__new__' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
            <Field label="법인명">
              <input className="input" value={newTenant.name || ''}
                onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })} />
            </Field>
            <Field label="사업자번호">
              <input className="input" value={newTenant.biz_no || ''}
                onChange={(e) => setNewTenant({ ...newTenant, biz_no: e.target.value })} />
            </Field>
            <Field label="대표자">
              <input className="input" value={newTenant.ceo || ''}
                onChange={(e) => setNewTenant({ ...newTenant, ceo: e.target.value })} />
            </Field>
            <Field label="전화">
              <input className="input" value={newTenant.phone || ''}
                onChange={(e) => setNewTenant({ ...newTenant, phone: e.target.value })} />
            </Field>
          </div>
        )}

        {/* 사무실 + 블럭 선택 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 사무실 */}
          <div>
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-700 mb-1.5">
              <Building className="w-3.5 h-3.5" /> 사무실 — 개별 호수 선택 ({pickedOfficeIds.length})
            </div>
            <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2.5 max-h-52 overflow-y-auto space-y-2">
              {buildings.map((b) => (
                <div key={b}>
                  <div className="text-[10px] text-zinc-500 mb-1 font-semibold">{b}동</div>
                  <div className="flex flex-wrap gap-1.5">
                    {officesByBuilding[b].map((s) => (
                      <PickChip
                        key={s.id}
                        code={s.id}
                        picked={pickedOfficeIds.includes(s.id)}
                        onClick={() => toggleOffice(s.id)}
                      />
                    ))}
                    {officesByBuilding[b].length === 0 && (
                      <span className="text-[10.5px] text-zinc-400">사무실 없음</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 주차 블럭 */}
          <div>
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-700 mb-1.5">
              <Car className="w-3.5 h-3.5" /> 주차 블럭 — 묶음 선택 ({pickedSectionIds.length})
            </div>
            <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2.5 max-h-52 overflow-y-auto space-y-2">
              {buildings.map((b) => (
                <div key={b}>
                  <div className="text-[10px] text-zinc-500 mb-1 font-semibold">{b}동</div>
                  <div className="space-y-1">
                    {sectionsByBuilding[b].map((sec) => {
                      const count = stalls.filter((s) => s.section_id === sec.id).length;
                      const picked = pickedSectionIds.includes(sec.id);
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          onClick={() => toggleSection(sec.id)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1 rounded border text-[11px] text-left transition',
                            picked
                              ? 'bg-zinc-900 text-white border-zinc-900'
                              : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500'
                          )}
                        >
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: sec.color }} />
                          <span className="flex-1 truncate font-medium">[{sec.code}] {sec.name}</span>
                          <span className={picked ? 'text-zinc-300' : 'text-zinc-500'}>{count}칸</span>
                        </button>
                      );
                    })}
                    {sectionsByBuilding[b].length === 0 && (
                      <div className="text-[10.5px] text-zinc-400">블럭 없음 · 도면 만들기에서 묶기</div>
                    )}
                  </div>
                </div>
              ))}
              {looseParkingByBuilding[buildings[0]]?.length > 0 && (
                <div className="text-[10px] text-zinc-500 mt-1.5 pt-1.5 border-t border-zinc-200">
                  ※ 블럭에 속하지 않은 개별 주차는 도면 만들기에서 묶어주세요
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 금액 */}
        <div className="grid grid-cols-3 gap-3">
          <Field label="월세 합계 (원)">
            <input type="number" value={rent}
              onChange={(e) => setRent(parseInt(e.target.value) || 0)}
              className="input tabular text-right" />
          </Field>
          <Field label="관리비 (원)">
            <input type="number" value={maint}
              onChange={(e) => setMaint(parseInt(e.target.value) || 0)}
              className="input tabular text-right" />
          </Field>
          <Field label={`보증금 (월세 × ${config.deposit_multiplier})`}>
            <input type="number" value={deposit}
              onChange={(e) => setDeposit(parseInt(e.target.value) || 0)}
              className="input tabular text-right" />
          </Field>
        </div>

        <Field label="메모 (선택)">
          <input className="input" value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="강제 등록 시 사유 등" />
        </Field>

        {/* 충돌 */}
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5">
            <div className="flex items-center gap-2 text-red-700 font-semibold text-[13px] mb-2">
              <AlertTriangle className="w-4 h-4" />
              충돌 감지 ({conflicts.length}개)
            </div>
            <div className="space-y-1 text-[12px] text-red-700/90 mb-3 max-h-24 overflow-y-auto">
              {conflicts.map((c, i) => {
                const t = tenants.find((x) => x.id === c.lease.tenant_id);
                return (
                  <div key={i}>
                    · {c.stallId} — {t?.name} ({c.lease.start} ~ {c.lease.end}) 점유 중
                  </div>
                );
              })}
            </div>
            <div className="text-[11.5px] text-red-700 font-semibold mb-1.5">운영자 선택:</div>
            <div className="space-y-1.5">
              {([
                ['shift', '신규 계약 시작일을 기존 만료 이후로 자동 조정'],
                ['terminate', '기존 계약을 신규 시작일 직전으로 중도 해지'],
                ['force', '메모 첨부 후 일시 강제 등록 (감사 이력 보존)'],
              ] as [ConflictChoice, string][]).map(([v, label]) => (
                <label key={v} className="flex items-start gap-2 text-[12px] text-zinc-800 cursor-pointer">
                  <input type="radio" name="cf_choice" value={v}
                    checked={choice === v} onChange={() => setChoice(v)}
                    className="mt-0.5" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 계약 스케줄 미리보기 */}
        {billingSchedule.length > 0 && (rent + maint) > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3.5">
            <div className="flex items-center gap-2 text-blue-900 font-semibold text-[13px] mb-2">
              <Calendar className="w-4 h-4" />
              자동 청구 스케줄 미리보기 — 총 {billingSchedule.length}회 · {fmtMoney(billingSchedule.length * (rent + maint))}원
            </div>
            <div className="max-h-40 overflow-y-auto bg-white rounded border border-blue-200">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-blue-50 z-10">
                  <tr className="border-b border-blue-200">
                    <th className="text-left px-2.5 py-1.5 font-semibold text-blue-900">회차</th>
                    <th className="text-left px-2.5 py-1.5 font-semibold text-blue-900">청구월</th>
                    <th className="text-center px-2.5 py-1.5 font-semibold text-blue-900">납기일</th>
                    <th className="text-right px-2.5 py-1.5 font-semibold text-blue-900">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {billingSchedule.map((b, i) => (
                    <tr key={i} className="border-b border-blue-100 last:border-0">
                      <td className="px-2.5 py-1 text-zinc-600">{i + 1}회</td>
                      <td className="px-2.5 py-1 font-medium">{b.period}</td>
                      <td className="px-2.5 py-1 text-center text-zinc-600">{b.dueDate}</td>
                      <td className="px-2.5 py-1 text-right tabular font-medium">{fmtMoney(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10.5px] text-blue-700 mt-1.5">
              ※ 매월 1일 정기 청구 자동 생성. 위 일정은 예상치며 단지 설정 변경 시 달라집니다.
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .input, .select {
          width: 100%;
          border: 1px solid #e4e4e7;
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 13px;
          background: white;
          transition: border-color 120ms;
        }
        .input:focus, .select:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }
      `}</style>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function PickChip({ code, picked, onClick }: { code: string; picked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 text-[11px] rounded border font-medium transition',
        picked
          ? 'bg-zinc-900 text-white border-zinc-900'
          : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500'
      )}
    >
      {code}
    </button>
  );
}
