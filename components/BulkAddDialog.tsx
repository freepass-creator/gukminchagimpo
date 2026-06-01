'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Building, Car } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveStall, writeAudit } from '@/lib/data';
import { fmtDate } from '@/lib/utils';
import type { Floor, Stall, StallType } from '@/lib/types';

/** 점유 셀 집합 만들기 */
function occupiedCells(stalls: Stall[], floorId: string): Set<string> {
  const set = new Set<string>();
  for (const s of stalls.filter((x) => x.floor_id === floorId && x.layout)) {
    const { x, y, w, h } = s.layout!;
    for (let dx = 0; dx < w; dx++)
      for (let dy = 0; dy < h; dy++) set.add(`${x + dx},${y + dy}`);
  }
  return set;
}

interface Props {
  open: boolean;
  onClose: () => void;
  floor: Floor;
  /** "캔버스에서 위치 지정" 클릭 시. 설정값 들고 모달 닫음 → 부모가 placement 모드 시작 */
  onStartPlacement?: (cfg: { type: StallType; cols: number; rows: number; cellW: number; cellH: number; gap: number }) => void;
}

export function BulkAddDialog({ open, onClose, floor, onStartPlacement }: Props) {
  const { stalls, today } = useData();
  const { user } = useAuth();

  const [type, setType] = useState<StallType>('parking');
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(3);
  const [cellW, setCellW] = useState(3);   // 한 칸 가로 (셀)
  const [cellH, setCellH] = useState(5);   // 한 칸 세로 (셀)
  const [gap, setGap] = useState(0);       // 칸 간격 (셀)
  const [startX, setStartX] = useState(1);
  const [startY, setStartY] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 사무실/주차 기본값
    if (type === 'office') {
      setCellW(3); setCellH(3); setGap(1);
    } else {
      setCellW(2); setCellH(3); setGap(0);
    }
  }, [type, open]);

  const total = cols * rows;
  const occupied = useMemo(() => occupiedCells(stalls, floor.id), [stalls, floor.id]);

  // 미리보기: 어느 좌표에 들어가나
  const previews = useMemo(() => {
    const arr: { x: number; y: number; conflict: boolean }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * (cellW + gap);
        const y = startY + r * (cellH + gap);
        // 그리드 밖이거나 충돌하는지
        let conflict = false;
        if (x + cellW > floor.grid_cols || y + cellH > floor.grid_rows) {
          conflict = true;
        } else {
          outer:
          for (let dx = 0; dx < cellW; dx++)
            for (let dy = 0; dy < cellH; dy++)
              if (occupied.has(`${x + dx},${y + dy}`)) {
                conflict = true; break outer;
              }
        }
        arr.push({ x, y, conflict });
      }
    }
    return arr;
  }, [cols, rows, cellW, cellH, gap, startX, startY, occupied, floor]);

  const conflictCount = previews.filter((p) => p.conflict).length;

  async function submit() {
    if (conflictCount > 0) {
      if (!confirm(`${conflictCount}개 칸이 충돌하거나 그리드를 벗어납니다. 충돌하지 않는 칸만 생성할까요?`)) return;
    }
    setSubmitting(true);
    try {
      // 코드 자동 부여 시작 번호
      const existing = stalls.filter((s) => s.building === floor.building && s.type === type);
      let nextNum: number;
      if (type === 'office') {
        const nums = existing.map((s) => parseInt(s.code)).filter((n) => !isNaN(n));
        nextNum = nums.length ? Math.max(...nums) + 1 : (floor.building === 'A' ? 201 : 301);
      } else {
        const nums = existing
          .filter((s) => /^P\d+$/.test(s.code))
          .map((s) => parseInt(s.code.slice(1)));
        nextNum = nums.length ? Math.max(...nums) + 1 : 1;
      }

      let created = 0;
      for (let i = 0; i < previews.length; i++) {
        const p = previews[i];
        if (p.conflict) continue;
        const code = type === 'office'
          ? String(nextNum + created)
          : 'P' + String(nextNum + created).padStart(2, '0');
        const stall: Stall = {
          id: `${floor.building}-${code}`,
          building: floor.building,
          type,
          code,
          area: cellW * cellH,
          rent: type === 'office' ? 1800000 : 250000,
          maint: type === 'office' ? 200000 : 30000,
          floor_id: floor.id,
          layout: { x: p.x, y: p.y, w: cellW, h: cellH },
        };
        await saveStall(stall);
        created++;
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'bulk_stall_create',
        target: floor.id,
        memo: `${floor.label}에 ${type === 'office' ? '사무실' : '주차'} ${created}개 일괄 생성`,
        at: fmtDate(today),
      });
      toast.success(`${created}개 생성 완료`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setSubmitting(false);
    }
  }

  const previewSize = 12; // px per cell in preview
  const previewW = floor.grid_cols * previewSize;
  const previewH = floor.grid_rows * previewSize;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="여러 칸 한 번에 만들기"
      desc={`${floor.building}동 ${floor.label} · 가로 N × 세로 M 묶음으로 자동 배치 + 코드 자동 부여`}
      width={780}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          {onStartPlacement && (
            <Button
              variant="outline"
              onClick={() => {
                onStartPlacement({ type, cols, rows, cellW, cellH, gap });
                onClose();
              }}
              disabled={total === 0}
            >
              캔버스에서 위치 지정 →
            </Button>
          )}
          <Button variant="primary" onClick={submit} disabled={submitting || total === 0}>
            {submitting ? '생성 중...' : `현재 좌표에 ${total - conflictCount}칸 생성`}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr,260px] gap-5">
        {/* 입력 */}
        <div className="space-y-3">
          <div>
            <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1.5">유형</label>
            <div className="flex gap-2">
              <button
                onClick={() => setType('office')}
                className={`flex-1 px-3 py-2 rounded-md border text-[12.5px] font-medium flex items-center justify-center gap-1.5 ${
                  type === 'office' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-300 text-zinc-700'
                }`}
              >
                <Building className="w-3.5 h-3.5" /> 사무실
              </button>
              <button
                onClick={() => setType('parking')}
                className={`flex-1 px-3 py-2 rounded-md border text-[12.5px] font-medium flex items-center justify-center gap-1.5 ${
                  type === 'parking' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-300 text-zinc-700'
                }`}
              >
                <Car className="w-3.5 h-3.5" /> 주차칸
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1.5">
              개수 — <b className="text-zinc-900">가로 {cols}개 × 세로 {rows}개 = {total}칸</b>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <NumInput label="가로 (개)" value={cols} onChange={setCols} min={1} max={30} />
              <NumInput label="세로 (개)" value={rows} onChange={setRows} min={1} max={30} />
            </div>
          </div>

          <div>
            <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1.5">
              한 칸 크기 (셀 = 1m)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <NumInput label="가로" value={cellW} onChange={setCellW} min={1} max={20} />
              <NumInput label="세로" value={cellH} onChange={setCellH} min={1} max={20} />
              <NumInput label="간격" value={gap} onChange={setGap} min={0} max={5} />
            </div>
          </div>

          <div>
            <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1.5">
              시작 위치 (좌상단 셀 좌표)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <NumInput label="X" value={startX} onChange={setStartX} min={0} max={floor.grid_cols} />
              <NumInput label="Y" value={startY} onChange={setStartY} min={0} max={floor.grid_rows} />
            </div>
          </div>

          {conflictCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-[11.5px] text-amber-900">
              ⚠ {conflictCount}개 칸이 기존 공간과 충돌하거나 그리드 바깥. 해당 칸은 생성에서 제외됩니다.
            </div>
          )}
        </div>

        {/* 미리보기 */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">미리보기</div>
          <div className="border border-zinc-200 rounded-md bg-white overflow-auto" style={{ maxWidth: 260 }}>
            <svg
              viewBox={`0 0 ${previewW} ${previewH}`}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            >
              <rect width={previewW} height={previewH} fill="#fafafa" />
              {/* grid */}
              <g stroke="#e4e4e7" strokeWidth="0.3">
                {Array.from({ length: floor.grid_cols + 1 }).map((_, i) => (
                  <line key={`v${i}`} x1={i * previewSize} y1={0} x2={i * previewSize} y2={previewH} />
                ))}
                {Array.from({ length: floor.grid_rows + 1 }).map((_, i) => (
                  <line key={`h${i}`} x1={0} y1={i * previewSize} x2={previewW} y2={i * previewSize} />
                ))}
              </g>
              {/* existing stalls */}
              {stalls.filter((s) => s.floor_id === floor.id && s.layout).map((s) => (
                <rect
                  key={s.id}
                  x={s.layout!.x * previewSize}
                  y={s.layout!.y * previewSize}
                  width={s.layout!.w * previewSize}
                  height={s.layout!.h * previewSize}
                  fill="#d4d4d8"
                  opacity={0.6}
                />
              ))}
              {/* previews */}
              {previews.map((p, i) => (
                <rect
                  key={i}
                  x={p.x * previewSize}
                  y={p.y * previewSize}
                  width={cellW * previewSize}
                  height={cellH * previewSize}
                  fill={p.conflict ? '#fca5a5' : '#3b82f6'}
                  opacity={0.7}
                  stroke="#fff"
                  strokeWidth="0.5"
                />
              ))}
            </svg>
          </div>
          <div className="text-[10.5px] text-zinc-500 mt-1.5">
            파랑 = 새 칸, 빨강 = 충돌, 회색 = 기존 공간
          </div>
        </div>
      </div>
    </Modal>
  );
}

function NumInput({
  label, value, onChange, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 mb-0.5">{label}</div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full border border-zinc-200 rounded-md px-2 py-1.5 text-[12.5px] tabular text-center focus:outline-none focus:border-zinc-500"
      />
    </div>
  );
}
