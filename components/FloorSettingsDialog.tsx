'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { Button } from './Button';
import { updateFloor, writeAudit } from '@/lib/data';
import { useAuth } from '@/lib/auth-context';
import { fmtDate } from '@/lib/utils';
import type { Floor } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  floor: Floor;
}

export function FloorSettingsDialog({ open, onClose, floor }: Props) {
  const { user } = useAuth();
  const [label, setLabel] = useState(floor.label);
  const [cols, setCols] = useState(floor.grid_cols);
  const [rows, setRows] = useState(floor.grid_rows);
  const [cellSize, setCellSize] = useState(floor.cell_size);
  const [busy, setBusy] = useState(false);
  // 권장 cellSize 범위 8~40

  useEffect(() => {
    if (open) {
      setLabel(floor.label);
      setCols(floor.grid_cols);
      setRows(floor.grid_rows);
      setCellSize(floor.cell_size);
    }
  }, [open, floor]);

  async function save() {
    setBusy(true);
    try {
      await updateFloor(floor.id, {
        label,
        grid_cols: Math.max(4, Math.min(500, cols)),
        grid_rows: Math.max(4, Math.min(500, rows)),
        cell_size: Math.max(4, Math.min(40, cellSize)),
      });
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'floor_update',
        target: floor.id,
        memo: `${floor.label} → ${label} · ${cols}×${rows} · 셀 ${cellSize}px`,
        at: fmtDate(new Date()),
      });
      toast.success('층 설정 저장됨');
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
      title="층 설정"
      desc="1셀 = 1m × 1m 권장 · 매매단지 한 동은 보통 30×20"
      width={460}
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
        <Field label="층 이름">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-[13px]"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="그리드 가로 (셀, 4~500)">
            <input
              type="number"
              value={cols}
              min={4}
              max={500}
              onChange={(e) => setCols(parseInt(e.target.value) || 0)}
              className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-[13px] tabular text-right"
            />
          </Field>
          <Field label="그리드 세로 (셀, 4~500)">
            <input
              type="number"
              value={rows}
              min={4}
              max={500}
              onChange={(e) => setRows(parseInt(e.target.value) || 0)}
              className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-[13px] tabular text-right"
            />
          </Field>
        </div>

        <Field label="셀 픽셀 크기 (화면 표시용, 8~40)">
          <input
            type="number"
            value={cellSize}
            min={8}
            max={40}
            onChange={(e) => setCellSize(parseInt(e.target.value) || 0)}
            className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-[13px] tabular text-right"
          />
        </Field>

        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-[11.5px] text-blue-900 space-y-0.5">
          <div className="font-semibold mb-1">권장값 (매매단지 기준)</div>
          <div>· 1셀 = 1m × 1m</div>
          <div>· 사무실 6평 = 4 × 5 셀 (4m × 5m)</div>
          <div>· 주차칸 1대 = 3 × 5 셀 (2.5m × 5m, 반올림)</div>
          <div>· 한 동 = 30 × 20 셀 (30m × 20m)</div>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
