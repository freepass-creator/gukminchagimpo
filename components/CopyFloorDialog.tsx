'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Copy, ArrowRight } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveStall, writeAudit } from '@/lib/data';
import { fmtDate } from '@/lib/utils';
import type { Floor, Stall, StallType } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  sourceFloor: Floor;
}

export function CopyFloorDialog({ open, onClose, sourceFloor }: Props) {
  const { floors, stalls, today } = useData();
  const { user } = useAuth();
  const [targetFloorId, setTargetFloorId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [copyType, setCopyType] = useState<'all' | 'office' | 'parking'>('all');

  const sourceStalls = useMemo(
    () => stalls.filter((s) => s.floor_id === sourceFloor.id && s.layout),
    [stalls, sourceFloor.id]
  );

  const filteredCount = useMemo(() => {
    if (copyType === 'all') return sourceStalls.length;
    return sourceStalls.filter((s) => s.type === copyType).length;
  }, [sourceStalls, copyType]);

  const targetFloor = floors.find((f) => f.id === targetFloorId);
  const targetStalls = useMemo(
    () => stalls.filter((s) => s.floor_id === targetFloorId),
    [stalls, targetFloorId]
  );

  async function submit() {
    if (!targetFloor) return;
    if (targetStalls.length > 0 && !overwrite) {
      toast.error('대상 층에 이미 공간이 있습니다. "기존 공간 위에 덮어쓰기"를 체크하거나 빈 층을 선택하세요.');
      return;
    }
    setSubmitting(true);
    try {
      // 대상 동 기준 다음 코드 번호 계산
      const targetBuilding = targetFloor.building;
      const targetExisting = stalls.filter(
        (s) => s.building === targetBuilding && s.floor_id !== targetFloorId
      );
      const officeNums = targetExisting
        .filter((s) => s.type === 'office')
        .map((s) => parseInt(s.code)).filter((n) => !isNaN(n));
      const parkingNums = targetExisting
        .filter((s) => s.type === 'parking' && /^P\d+$/.test(s.code))
        .map((s) => parseInt(s.code.slice(1)));

      let nextOffice = officeNums.length
        ? Math.max(...officeNums) + 1
        : (targetBuilding === 'A' ? 201 : 301);
      let nextParking = parkingNums.length ? Math.max(...parkingNums) + 1 : 1;

      let created = 0;
      for (const src of sourceStalls) {
        if (copyType !== 'all' && src.type !== copyType) continue;
        // 그리드 크기 체크 — 대상 그리드 밖이면 스킵
        const { x, y, w, h } = src.layout!;
        if (x + w > targetFloor.grid_cols || y + h > targetFloor.grid_rows) continue;

        const code = src.type === 'office'
          ? String(nextOffice++)
          : 'P' + String(nextParking++).padStart(2, '0');
        const newStall: Stall = {
          ...src,
          id: `${targetBuilding}-${code}`,
          building: targetBuilding,
          code,
          floor_id: targetFloorId,
        };
        await saveStall(newStall);
        created++;
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'floor_copy',
        target: targetFloorId,
        memo: `${sourceFloor.label} → ${targetFloor.label} 도면 복사 (${created}개)`,
        at: fmtDate(today),
      });
      toast.success(`${created}개 공간을 ${targetFloor.label}에 복사 완료`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setSubmitting(false);
    }
  }

  const otherFloors = floors.filter((f) => f.id !== sourceFloor.id).sort((a, b) => a.order - b.order);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="이 층 도면 복사"
      desc="공간 좌표·크기·단가는 그대로 · 코드는 대상 동 기준 자동 부여"
      width={580}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={submitting || !targetFloorId}
          >
            <Copy className="w-3.5 h-3.5" />
            {submitting ? '복사 중...' : '복사 실행'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 bg-zinc-50 rounded-lg p-3.5 border border-zinc-200">
          <div className="text-[12.5px]">
            <div className="text-zinc-500 text-[11px] mb-0.5">원본</div>
            <div className="font-bold">{sourceFloor.building}동 {sourceFloor.label}</div>
            <div className="text-[11.5px] text-zinc-500">
              사무실 {sourceStalls.filter((s) => s.type === 'office').length} · 주차 {sourceStalls.filter((s) => s.type === 'parking').length}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-zinc-400" />
          <div className="text-[12.5px] flex-1">
            <div className="text-zinc-500 text-[11px] mb-0.5">대상</div>
            <select
              value={targetFloorId}
              onChange={(e) => setTargetFloorId(e.target.value)}
              className="w-full border border-zinc-300 rounded-md px-2 py-1.5 text-[12.5px] bg-white"
            >
              <option value="">— 선택 —</option>
              {otherFloors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.building}동 {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1.5">복사 대상</label>
          <div className="flex gap-2">
            {(['all', 'office', 'parking'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setCopyType(t)}
                className={`px-3 py-1.5 rounded-md border text-[12px] ${
                  copyType === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-300 text-zinc-700'
                }`}
              >
                {t === 'all' ? '전체' : t === 'office' ? '사무실만' : '주차칸만'}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">→ {filteredCount}개 공간 복사 예정</div>
        </div>

        {targetFloor && targetStalls.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <div className="text-[12px] font-semibold text-amber-900 mb-1">
              ⚠ 대상 층에 이미 {targetStalls.length}개 공간이 있습니다
            </div>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer text-amber-900">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              기존 공간 유지하고 복사본 추가 (코드는 대상 동의 다음 번호부터)
            </label>
          </div>
        )}

        {targetFloor && (
          <div className="text-[11.5px] text-zinc-500">
            대상 그리드: {targetFloor.grid_cols} × {targetFloor.grid_rows} ·
            원본보다 그리드가 작으면 벗어나는 칸은 자동 생략됩니다.
          </div>
        )}
      </div>
    </Modal>
  );
}
