'use client';

import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveTempAssignment, writeAudit } from '@/lib/data';
import { fmtDate, newId, fmtFloorLabel } from '@/lib/utils';
import type { TempParkingAssignment } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 기본 상사 (임대 현황 행에서 열 때) */
  defaultTenantId?: string;
  defaultLeaseId?: string;
  /** 편집 모드 시 기존 assignment */
  editing?: TempParkingAssignment;
}

export function TempAssignmentDialog({ open, onClose, defaultTenantId, defaultLeaseId, editing }: Props) {
  const { tenants, leases, stalls, sections, byId, index, tempAssignments, today } = useData();
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState(defaultTenantId || '');
  const [leaseId, setLeaseId] = useState(defaultLeaseId || '');
  const [start, setStart] = useState(fmtDate(today));
  const [end, setEnd] = useState('');
  const [rent, setRent] = useState(0);
  const [memo, setMemo] = useState('');
  const [pickedStalls, setPickedStalls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) {
      setTenantId(editing.tenant_id);
      setLeaseId(editing.lease_id || '');
      setStart(editing.start);
      setEnd(editing.end);
      setRent(editing.rent);
      setMemo(editing.memo || '');
      setPickedStalls(editing.stall_ids);
    } else {
      setTenantId(defaultTenantId || '');
      setLeaseId(defaultLeaseId || '');
      setStart(fmtDate(today));
      setEnd('');
      setRent(0);
      setMemo('');
      setPickedStalls([]);
    }
  }, [open, editing?.id, defaultTenantId, defaultLeaseId]);

  // 현재 공실 주차 면 (active lease/임시 assignment에 안 묶인)
  const availableSections = useMemo(() => {
    const todayStr = fmtDate(today);
    // 정규 lease에 묶인 stall_id
    const occupiedByLease = new Set<string>();
    for (const l of leases) {
      if (l.status !== 'active') continue;
      if (l.start > todayStr || l.end < todayStr) continue;
      l.stall_ids.forEach((id) => occupiedByLease.add(id));
    }
    // 다른 활성 임시 assignment에 묶인 stall_id (편집 중인 건 제외)
    const occupiedByTemp = new Set<string>();
    for (const a of tempAssignments) {
      if (a.status !== 'active') continue;
      if (editing && a.id === editing.id) continue;
      if (a.start > todayStr || a.end < todayStr) continue;
      a.stall_ids.forEach((id) => occupiedByTemp.add(id));
    }
    // 블럭별로 그루핑 — 공실 면이 있는 블럭만
    return sections.map((sec) => {
      const secStalls = index.stallsBySection.get(sec.id) || [];
      const free = secStalls.filter((s) => !occupiedByLease.has(s.id) && !occupiedByTemp.has(s.id));
      const f = byId.floor.get(sec.floor_id);
      return {
        section: sec,
        floorLabel: fmtFloorLabel(f),
        freeStalls: free,
      };
    }).filter((x) => x.freeStalls.length > 0);
  }, [sections, leases, tempAssignments, index, byId, today, editing]);

  function toggleStall(id: string) {
    setPickedStalls((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  }

  // 상사별 활성 lease (lease 선택 드롭다운용)
  const tenantLeases = useMemo(
    () => (tenantId ? leases.filter((l) => l.tenant_id === tenantId && l.status === 'active') : []),
    [tenantId, leases]
  );

  async function submit() {
    if (!tenantId) { toast.error('상사를 선택하세요'); return; }
    if (!start || !end) { toast.error('기간을 입력하세요'); return; }
    if (end < start) { toast.error('종료일이 시작일보다 빠릅니다'); return; }
    if (pickedStalls.length === 0) { toast.error('면을 선택하세요'); return; }
    if (rent < 0) { toast.error('사용료는 0 이상'); return; }
    setBusy(true);
    try {
      const a: TempParkingAssignment = {
        id: editing?.id || newId('TA'),
        tenant_id: tenantId,
        lease_id: leaseId || undefined,
        stall_ids: pickedStalls,
        start, end,
        rent: Math.round(rent),
        status: 'active',
        memo: memo || undefined,
      };
      await saveTempAssignment(a);
      const tenant = byId.tenant.get(tenantId);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: editing ? 'temp_assignment_edit' : 'temp_assignment_create',
        target: a.id,
        memo: `${tenant?.name} 임시전시장 ${pickedStalls.length}면 (${start}~${end}, 월 ${rent.toLocaleString()})`,
        at: fmtDate(today),
      });
      toast.success(editing ? '임시전시장 수정됨' : `임시전시장 ${pickedStalls.length}면 배정됨`);
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
      title={editing ? '임시 전시장 수정' : '임시 전시장 배정'}
      desc="기존 전시장 공실 일부를 일정 기간 동안 상사에게 임시 배정"
      width={760}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? '저장 중...' : editing ? '수정 저장' : `${pickedStalls.length}면 배정`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 상사 + 연결 lease */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">상사</label>
            <select
              value={tenantId}
              onChange={(e) => { setTenantId(e.target.value); setLeaseId(''); }}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500"
            >
              <option value="">— 선택 —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.biz_no})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">연결 정규 계약 (선택)</label>
            <select
              value={leaseId}
              onChange={(e) => setLeaseId(e.target.value)}
              disabled={!tenantId}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500 disabled:bg-zinc-50"
            >
              <option value="">— 연결 없음 —</option>
              {tenantLeases.map((l) => (
                <option key={l.id} value={l.id}>{l.id} ({l.start} ~ {l.end})</option>
              ))}
            </select>
          </div>
        </div>

        {/* 기간 + 사용료 */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">시작일</label>
            <input
              type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">종료일</label>
            <input
              type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] tabular focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">월 사용료 (원)</label>
            <input
              type="number" value={rent} onChange={(e) => setRent(parseInt(e.target.value) || 0)}
              className="w-full h-8 px-2 border border-zinc-200 rounded-md text-[12.5px] text-right tabular focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>

        {/* 공실 면 선택 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11.5px] text-zinc-600 font-medium">사용할 면 선택 (공실만)</label>
            <span className="text-[10.5px] text-zinc-500">{pickedStalls.length}면 선택됨</span>
          </div>
          <div className="border border-zinc-200 rounded-md p-3 max-h-[260px] overflow-y-auto space-y-2.5">
            {availableSections.length === 0 ? (
              <div className="text-[11.5px] text-zinc-400 text-center py-4">공실 면이 없습니다</div>
            ) : (
              availableSections.map(({ section, floorLabel, freeStalls }) => (
                <div key={section.id}>
                  <div className="text-[11px] text-zinc-700 font-semibold mb-1">
                    {floorLabel} · {section.name} <span className="text-zinc-400 font-normal">({freeStalls.length}면 공실)</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {freeStalls.map((s) => {
                      const picked = pickedStalls.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => toggleStall(s.id)}
                          className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular ${
                            picked
                              ? 'bg-violet-600 border-violet-600 text-white'
                              : 'bg-white border-zinc-300 text-zinc-700 hover:border-violet-400'
                          }`}
                        >
                          {s.code}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <label className="text-[11.5px] text-zinc-600 font-medium block mb-1">메모 (선택)</label>
          <textarea
            value={memo} onChange={(e) => setMemo(e.target.value)} rows={2}
            placeholder="예: 7월 한정 행사용"
            className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-[12.5px] focus:outline-none focus:border-zinc-500 resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}
