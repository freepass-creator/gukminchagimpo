'use client';

import { useRef, useState, MouseEvent, useEffect } from 'react';
import { toast } from 'sonner';
import { Trash2, Copy, RotateCw } from 'lucide-react';
import { getStallState, wouldOverlap, findSlotOrExpand, expandToFit } from '@/lib/state';
import { nextOfficeCode, nextParkingCode, makeStallId, makeDecorId } from '@/lib/codes';
import { updateFloor } from '@/lib/data';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveStall, removeStall, updateStall, writeAudit, updateFloor as _uf, saveDecor, removeDecor, updateDecor } from '@/lib/data';
import { fmtDate } from '@/lib/utils';
import type { Floor, Stall, StallState, StallType, PlacementConfig, Decor, DecorType } from '@/lib/types';
import { DECOR_PRESETS, DECOR_LABEL } from '@/lib/types';
import { Building as BuildingIcon, Car, ArrowUpRight, ArrowUp, Box, DoorOpen } from 'lucide-react';

/**
 * 색상 매핑 — 공실은 사무실/주차 다른 톤(파랑/보라).
 * 점유/연체/만료/예정은 사무실·주차 공통(상태가 더 중요).
 */
function getFill(type: StallType, state: StallState) {
  if (state === 'vacant') {
    return type === 'office'
      ? { fill: '#dbeafe', stroke: '#60a5fa', ink: '#1d4ed8' }   // 사무실 공실 — 파랑
      : { fill: '#ede9fe', stroke: '#a78bfa', ink: '#6d28d9' };  // 주차 공실 — 보라
  }
  switch (state) {
    case 'active':   return { fill: '#dcfce7', stroke: '#22c55e', ink: '#15803d' };
    case 'overdue':  return { fill: '#fee2e2', stroke: '#ef4444', ink: '#b91c1c' };
    case 'expiring': return { fill: '#fef3c7', stroke: '#f59e0b', ink: '#a16207' };
    case 'reserved': return { fill: '#ffedd5', stroke: '#fb923c', ink: '#c2410c' };
  }
  return { fill: '#f4f4f5', stroke: '#d4d4d8', ink: '#71717a' };
}

interface Props {
  floor: Floor;
  mode: 'view' | 'edit';
  selectedIds: string[];
  onSelect: (id: string | null, shiftKey: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  /** 그리드 격자 표시 (default true) */
  showGrid?: boolean;
  /** 캔버스 위 다중 배치 모드. 있으면 마우스 호버 시 묶음 미리보기 표시. */
  placement?: PlacementConfig | null;
  /** placement 모드에서 캔버스 클릭 시 호출 */
  onPlace?: (originX: number, originY: number) => void;
  /** placement 모드 취소 (ESC) */
  onCancelPlacement?: () => void;
  /** 셀 선택 (빈 곳 클릭 시) — 우측 패널에서 추가할 위치로 사용 */
  selectedCell?: { x: number; y: number } | null;
  onSelectCell?: (cell: { x: number; y: number } | null) => void;
}

interface ResizeAxis {
  axis: 'br' | 'right' | 'bottom';
}

interface DragState {
  id: string;
  isDecor: boolean;
  offsetX: number;
  offsetY: number;
  origX: number;
  origY: number;
}

interface ResizeState {
  id: string;
  isDecor: boolean;
  axis: 'br' | 'right' | 'bottom';
}

interface ContextMenuState {
  x: number;        // screen px
  y: number;
  stallId: string | null;
  decorId?: string | null;
  cellX: number;    // grid cell
  cellY: number;
}

export function FloorCanvas({
  floor, mode, selectedIds, onSelect, onMove, onResize,
  showGrid = true, placement, onPlace, onCancelPlacement,
  selectedCell, onSelectCell,
}: Props) {
  const { stalls, leases, billings, tenants, config, today, decors, sections } = useData();
  const { user } = useAuth();
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [selectedDecorId, setSelectedDecorId] = useState<string | null>(null);

  const floorStalls = stalls.filter((s) => s.floor_id === floor.id && s.layout);
  const floorDecors = decors.filter((d) => d.floor_id === floor.id && d.layout);
  const W = floor.grid_cols * floor.cell_size;
  const H = floor.grid_rows * floor.cell_size;

  const toCell = (px: number, py: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const scale = W / rect.width;
    return {
      cx: (px - rect.left) * scale / floor.cell_size,
      cy: (py - rect.top) * scale / floor.cell_size,
    };
  };

  function startDrag(e: MouseEvent<SVGGElement>, stall: Stall) {
    if (mode !== 'edit' || !stall.layout) return;
    e.stopPropagation();
    const { cx, cy } = toCell(e.clientX, e.clientY);
    setDrag({
      id: stall.id,
      isDecor: false,
      offsetX: cx - stall.layout.x,
      offsetY: cy - stall.layout.y,
      origX: stall.layout.x,
      origY: stall.layout.y,
    });
    onSelect(stall.id, e.shiftKey);
    setSelectedDecorId(null);
  }

  function startDragDecor(e: MouseEvent<SVGGElement>, d: Decor) {
    if (mode !== 'edit') return;
    e.stopPropagation();
    const { cx, cy } = toCell(e.clientX, e.clientY);
    setDrag({
      id: d.id,
      isDecor: true,
      offsetX: cx - d.layout.x,
      offsetY: cy - d.layout.y,
      origX: d.layout.x,
      origY: d.layout.y,
    });
    setSelectedDecorId(d.id);
    onSelect(null, false);
  }

  function startResize(e: MouseEvent<SVGRectElement>, stall: Stall, axis: 'br' | 'right' | 'bottom') {
    if (mode !== 'edit' || !stall.layout) return;
    e.stopPropagation();
    setResize({ id: stall.id, isDecor: false, axis });
    onSelect(stall.id, false);
  }

  function startResizeDecor(e: MouseEvent<SVGRectElement>, d: Decor, axis: 'br' | 'right' | 'bottom') {
    if (mode !== 'edit') return;
    e.stopPropagation();
    setResize({ id: d.id, isDecor: true, axis });
    setSelectedDecorId(d.id);
  }

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    const { cx, cy } = toCell(e.clientX, e.clientY);
    setHoverCell({ x: Math.floor(cx), y: Math.floor(cy) });

    // 리사이즈 진행 중
    if (resize) {
      if (resize.isDecor) {
        const d = floorDecors.find((x) => x.id === resize.id);
        if (!d) return;
        let newW = d.layout.w, newH = d.layout.h;
        if (resize.axis === 'br' || resize.axis === 'right') {
          newW = Math.max(1, Math.min(floor.grid_cols - d.layout.x, Math.round(cx - d.layout.x)));
        }
        if (resize.axis === 'br' || resize.axis === 'bottom') {
          newH = Math.max(1, Math.min(floor.grid_rows - d.layout.y, Math.round(cy - d.layout.y)));
        }
        if (newW === d.layout.w && newH === d.layout.h) return;
        updateDecor(d.id, { layout: { ...d.layout, w: newW, h: newH } });
        return;
      }
      const stall = stalls.find((s) => s.id === resize.id);
      if (!stall?.layout || !onResize) return;
      let newW = stall.layout.w;
      let newH = stall.layout.h;
      if (resize.axis === 'br' || resize.axis === 'right') {
        newW = Math.max(1, Math.min(
          floor.grid_cols - stall.layout.x,
          Math.round(cx - stall.layout.x)
        ));
      }
      if (resize.axis === 'br' || resize.axis === 'bottom') {
        newH = Math.max(1, Math.min(
          floor.grid_rows - stall.layout.y,
          Math.round(cy - stall.layout.y)
        ));
      }
      if (newW === stall.layout.w && newH === stall.layout.h) return;
      const next = { x: stall.layout.x, y: stall.layout.y, w: newW, h: newH };
      const { conflict } = wouldOverlap(stall.id, floor.id, next, stalls);
      if (conflict) return;
      onResize(stall.id, newW, newH);
      return;
    }

    // 이동 진행 중
    if (!drag) return;
    if (drag.isDecor) {
      const d = floorDecors.find((x) => x.id === drag.id);
      if (!d) return;
      const newX = Math.max(0, Math.min(Math.round(cx - drag.offsetX), floor.grid_cols - d.layout.w));
      const newY = Math.max(0, Math.min(Math.round(cy - drag.offsetY), floor.grid_rows - d.layout.h));
      if (newX === d.layout.x && newY === d.layout.y) return;
      updateDecor(d.id, { layout: { ...d.layout, x: newX, y: newY } });
      return;
    }
    const stall = stalls.find((s) => s.id === drag.id);
    if (!stall?.layout) return;
    const newX = Math.max(0, Math.min(
      Math.round(cx - drag.offsetX),
      floor.grid_cols - stall.layout.w
    ));
    const newY = Math.max(0, Math.min(
      Math.round(cy - drag.offsetY),
      floor.grid_rows - stall.layout.h
    ));
    if (newX === stall.layout.x && newY === stall.layout.y) return;
    const next = { x: newX, y: newY, w: stall.layout.w, h: stall.layout.h };
    const { conflict } = wouldOverlap(stall.id, floor.id, next, stalls);
    if (conflict) return;
    onMove(drag.id, newX, newY);
  }

  function endInteraction() {
    setDrag(null);
    setResize(null);
  }

  useEffect(() => {
    const up = () => endInteraction();
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // placement 모드 ESC 취소
  useEffect(() => {
    if (!placement) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelPlacement?.(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [placement, onCancelPlacement]);

  // 시설 선택 시 Delete 키 처리 (단축키 - 단순 삭제)
  useEffect(() => {
    if (!selectedDecorId || mode !== 'edit') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeDecor(selectedDecorId);
        setSelectedDecorId(null);
        toast.success('시설 삭제됨');
      }
      if (e.key === 'Escape') setSelectedDecorId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedDecorId, mode]);

  /** placement 모드: 호버 셀 기준 N×M 묶음 위치 계산 */
  const placementPreview = (() => {
    if (!placement || !hoverCell) return null;
    const items: { x: number; y: number; conflict: boolean }[] = [];
    let anyConflict = false;
    for (let r = 0; r < placement.rows; r++) {
      for (let c = 0; c < placement.cols; c++) {
        const x = hoverCell.x + c * (placement.cellW + placement.gap);
        const y = hoverCell.y + r * (placement.cellH + placement.gap);
        let conflict = false;
        if (x + placement.cellW > floor.grid_cols || y + placement.cellH > floor.grid_rows) {
          conflict = true;
        } else {
          const { conflict: c1 } = wouldOverlap(null, floor.id,
            { x, y, w: placement.cellW, h: placement.cellH }, stalls);
          conflict = c1;
        }
        if (conflict) anyConflict = true;
        items.push({ x, y, conflict });
      }
    }
    return { items, anyConflict };
  })();

  // 외부 클릭 시 컨텍스트 메뉴 닫기
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [ctxMenu]);

  function handleContextMenu(e: MouseEvent<any>, stall: Stall | null) {
    if (mode !== 'edit') return;
    e.preventDefault();
    e.stopPropagation();
    const { cx, cy } = toCell(e.clientX, e.clientY);
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      stallId: stall?.id || null,
      decorId: null,
      cellX: Math.max(0, Math.min(floor.grid_cols - 1, Math.floor(cx))),
      cellY: Math.max(0, Math.min(floor.grid_rows - 1, Math.floor(cy))),
    });
    if (stall) onSelect(stall.id, false);
  }

  function handleDecorContextMenu(e: MouseEvent<any>, d: Decor) {
    if (mode !== 'edit') return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      stallId: null,
      decorId: d.id,
      cellX: 0,
      cellY: 0,
    });
    setSelectedDecorId(d.id);
  }

  /* ─── 컨텍스트 메뉴 액션들 ─── */

  async function ctxAddDecor(type: DecorType, cellX: number, cellY: number) {
    setCtxMenu(null);
    const preset = DECOR_PRESETS[type];
    let x = Math.max(0, cellX);
    let y = Math.max(0, cellY);
    let newCols = floor.grid_cols;
    let newRows = floor.grid_rows;
    if (x + preset.w > newCols) { newCols = x + preset.w; }
    if (y + preset.h > newRows) { newRows = y + preset.h; }
    if (newCols !== floor.grid_cols || newRows !== floor.grid_rows) {
      await updateFloor(floor.id, { grid_cols: newCols, grid_rows: newRows });
      toast.info(`그리드 자동 확장: ${newCols} × ${newRows}`);
    }
    try {
      const newDecor: Decor = {
        id: makeDecorId(),
        floor_id: floor.id,
        building: floor.building,
        type,
        label: preset.label || undefined,
        layout: { x, y, w: preset.w, h: preset.h },
      };
      await saveDecor(newDecor);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'decor_create',
        target: newDecor.id,
        memo: `${floor.label}에 ${DECOR_LABEL[type]} 추가`,
        at: fmtDate(today),
      });
      toast.success(`${DECOR_LABEL[type]} 추가`);
    } catch (e: any) {
      toast.error(e?.message || '실패');
    }
  }

  async function ctxAddAt(type: StallType, cellX: number, cellY: number) {
    setCtxMenu(null);
    const w = type === 'office' ? 3 : 2;
    const h = type === 'office' ? 3 : 3;
    // 클릭 위치가 그리드 밖이면 자동 확장
    let x = Math.max(0, cellX);
    let y = Math.max(0, cellY);
    let needExpand = false;
    let newCols = floor.grid_cols;
    let newRows = floor.grid_rows;
    if (x + w > newCols) { newCols = x + w; needExpand = true; }
    if (y + h > newRows) { newRows = y + h; needExpand = true; }
    if (needExpand) {
      await updateFloor(floor.id, { grid_cols: newCols, grid_rows: newRows });
      toast.info(`그리드 자동 확장: ${newCols} × ${newRows}`);
    }
    const { conflict } = wouldOverlap(null, floor.id, { x, y, w, h }, stalls);
    if (conflict) {
      toast.error('이미 다른 공간이 차지하고 있어 추가 불가');
      return;
    }
    const code = type === 'office'
      ? nextOfficeCode(stalls, floor.building)
      : nextParkingCode(stalls, floor.building);
    try {
      const newStall: Stall = {
        id: makeStallId(floor.building, code),
        building: floor.building, type, code,
        area: type === 'office' ? 9 : 6,
        rent: type === 'office' ? 1800000 : 250000,
        maint: type === 'office' ? 200000 : 30000,
        floor_id: floor.id,
        layout: { x, y, w, h },
      };
      await saveStall(newStall);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'stall_create_context',
        target: newStall.id,
        memo: `${floor.label}에 ${type === 'office' ? '사무실' : '주차'} (${x},${y})`,
        at: fmtDate(today),
      });
      onSelect(newStall.id, false);
      toast.success(`${newStall.id} 추가`);
    } catch (e: any) {
      toast.error(e?.message || '추가 실패');
    }
  }

  async function ctxDelete(stallId: string) {
    setCtxMenu(null);
    const stall = stalls.find((s) => s.id === stallId);
    if (!stall) return;
    const used = leases.some((l) => l.status === 'active' && l.stall_ids.includes(stallId));
    if (used) toast.warning(`${stallId} 활성 계약 사용 중 — 삭제 진행 (복원 가능)`);
    const backup: Stall = { ...stall };
    try {
      await removeStall(stallId);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'stall_delete_context', target: stallId,
        memo: `${stallId} 우클릭 삭제`,
        at: fmtDate(today),
      });
      onSelect(null, false);
      toast.success(`${backup.id} 삭제됨`, {
        duration: 8000,
        action: {
          label: '복원',
          onClick: async () => {
            try {
              await saveStall(backup);
              await writeAudit({
                actor: user?.email || 'unknown',
                type: 'stall_restore', target: backup.id,
                memo: `${backup.id} 삭제 복원`,
                at: fmtDate(today),
              });
              toast.success(`${backup.id} 복원됨`);
            } catch (e: any) { toast.error(e?.message || '복원 실패'); }
          },
        },
      });
    } catch (e: any) { toast.error(e?.message || '실패'); }
  }

  async function ctxDuplicate(stallId: string) {
    setCtxMenu(null);
    const src = stalls.find((s) => s.id === stallId);
    if (!src?.layout) return;
    const w = src.layout.w, h = src.layout.h;
    // 빈 자리 + 자동 확장 fallback
    const { slot, expand } = findSlotOrExpand(floor, stalls, w, h,
      { x: src.layout.x + w, y: src.layout.y });
    if (expand) {
      await updateFloor(floor.id, expand);
      toast.info(`그리드 자동 확장: ${expand.grid_cols ?? floor.grid_cols} × ${expand.grid_rows ?? floor.grid_rows}`);
    }
    const code = src.type === 'office'
      ? nextOfficeCode(stalls, src.building)
      : nextParkingCode(stalls, src.building);
    try {
      const copy: Stall = {
        ...src,
        id: makeStallId(src.building, code),
        code,
        layout: { ...src.layout, x: slot.x, y: slot.y },
      };
      await saveStall(copy);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'stall_duplicate_context', target: copy.id,
        memo: `${src.id} → ${copy.id} 복제`,
        at: fmtDate(today),
      });
      onSelect(copy.id, false);
      toast.success(`${copy.id} 복제됨`);
    } catch (e: any) { toast.error(e?.message || '실패'); }
  }

  async function rotateDecor(d: Decor) {
    const cur = d.layout.rotation || 0;
    const next = {
      ...d.layout,
      w: d.layout.h, h: d.layout.w,
      rotation: (cur === 0 ? 90 : 0) as 0 | 90,
    };
    next.x = Math.min(next.x, Math.max(0, floor.grid_cols - next.w));
    next.y = Math.min(next.y, Math.max(0, floor.grid_rows - next.h));
    try {
      await updateDecor(d.id, { layout: next });
    } catch (e: any) { toast.error(e?.message || '실패'); }
  }

  async function ctxRotate(stallId: string) {
    setCtxMenu(null);
    const stall = stalls.find((s) => s.id === stallId);
    if (!stall?.layout) return;
    const cur = stall.layout.rotation || 0;
    const next = {
      ...stall.layout,
      w: stall.layout.h,
      h: stall.layout.w,
      rotation: (cur === 0 ? 90 : 0) as 0 | 90,
    };
    // 그리드 밖이면 자동 확장
    const expand = expandToFit(floor, next);
    if (expand) {
      await updateFloor(floor.id, expand);
      toast.info(`그리드 자동 확장: ${expand.grid_cols ?? floor.grid_cols} × ${expand.grid_rows ?? floor.grid_rows}`);
    }
    const { conflict, with: cw } = wouldOverlap(stallId, floor.id, next, stalls);
    if (conflict) { toast.error(`회전 시 ${cw}와 겹쳐서 불가`); return; }
    try {
      await updateStall(stallId, { layout: next });
      toast.success('회전');
    } catch (e: any) { toast.error(e?.message || '실패'); }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white w-full" style={{ overflow: 'visible' }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        overflow="visible"
        style={{
          width: '100%',
          maxWidth: '900px',
          height: 'auto',
          display: 'block',
          margin: '0 auto',
          overflow: 'visible',
        }}
        onMouseMove={handleMove}
        onMouseUp={endInteraction}
        onMouseLeave={endInteraction}
        onClick={(e) => {
          if (placement && hoverCell && onPlace) {
            e.stopPropagation();
            onPlace(hoverCell.x, hoverCell.y);
            return;
          }
          // 빈 곳 클릭 = 셀 선택 + 모든 박스/시설 선택 해제
          if (mode === 'edit' && onSelectCell && hoverCell) {
            onSelectCell(hoverCell);
          }
          onSelect(null, e.shiftKey);
          setSelectedDecorId(null);
        }}
        onContextMenu={(e) => {
          if (placement) {
            e.preventDefault();
            onCancelPlacement?.();
            return;
          }
          handleContextMenu(e, null);
        }}
        style={{ cursor: placement ? 'crosshair' : undefined }}
      >
        {/* 배경 */}
        <rect x="0" y="0" width={W} height={H} fill="#fafafa" />

        {/* 그리드 라인 (showGrid 토글) */}
        {showGrid && (
          <g stroke="#e4e4e7" strokeWidth="0.5">
            {Array.from({ length: floor.grid_cols + 1 }).map((_, i) => (
              <line key={`v${i}`} x1={i * floor.cell_size} y1={0} x2={i * floor.cell_size} y2={H} />
            ))}
            {Array.from({ length: floor.grid_rows + 1 }).map((_, i) => (
              <line key={`h${i}`} x1={0} y1={i * floor.cell_size} x2={W} y2={i * floor.cell_size} />
            ))}
          </g>
        )}

        {/* hover cell highlight */}
        {mode === 'edit' && hoverCell && !drag && (
          <rect
            x={hoverCell.x * floor.cell_size}
            y={hoverCell.y * floor.cell_size}
            width={floor.cell_size}
            height={floor.cell_size}
            fill="#3b82f6"
            opacity={0.06}
            pointerEvents="none"
          />
        )}
        {/* 선택된 셀 — 우측 패널 추가용 */}
        {mode === 'edit' && selectedCell && (
          <rect
            x={selectedCell.x * floor.cell_size}
            y={selectedCell.y * floor.cell_size}
            width={floor.cell_size}
            height={floor.cell_size}
            fill="#f59e0b"
            opacity={0.35}
            stroke="#d97706"
            strokeWidth={1.5}
            strokeDasharray="3,2"
            pointerEvents="none"
          />
        )}

        {/* 선택된 셀 — 우측 패널에서 박스 추가할 위치 */}
        {mode === 'edit' && selectedCell && (
          <rect
            x={selectedCell.x * floor.cell_size}
            y={selectedCell.y * floor.cell_size}
            width={floor.cell_size}
            height={floor.cell_size}
            fill="#f59e0b"
            opacity={0.35}
            stroke="#d97706"
            strokeWidth={1.5}
            strokeDasharray="3,2"
            pointerEvents="none"
          />
        )}

        {/* 시설 (Decor) 렌더 — stall보다 먼저 그림 */}
        {floorDecors.map((d) => {
          const preset = DECOR_PRESETS[d.type];
          const x = d.layout.x * floor.cell_size;
          const y = d.layout.y * floor.cell_size;
          const w = d.layout.w * floor.cell_size;
          const h = d.layout.h * floor.cell_size;
          const isDecorSelected = selectedDecorId === d.id;
          return (
            <g
              key={d.id}
              transform={`translate(${x},${y})`}
              onMouseDown={(e) => startDragDecor(e, d)}
              onClick={(e) => {
                e.stopPropagation();
                // 선택은 mousedown에서 이미 처리됨
              }}
              onContextMenu={(e) => handleDecorContextMenu(e, d)}
              style={{ cursor: mode === 'edit' ? 'grab' : 'default' }}
            >
              <rect
                x={1}
                y={1}
                width={w - 2}
                height={h - 2}
                rx={2}
                fill={preset.fill}
                stroke={isDecorSelected ? '#0f172a' : preset.stroke}
                strokeWidth={isDecorSelected ? 2.5 : 1}
                opacity={0.9}
              />
              {preset.pattern === 'hatch' && (
                <g pointerEvents="none">
                  {Array.from({ length: Math.ceil((w + h) / 4) }).map((_, i) => (
                    <line
                      key={i}
                      x1={i * 4} y1={0}
                      x2={0} y2={i * 4}
                      stroke="#fff" strokeWidth={0.5} opacity={0.4}
                    />
                  ))}
                </g>
              )}
              {d.label && (
                <text
                  x={w / 2}
                  y={h / 2}
                  fill={preset.ink}
                  fontSize={Math.min(w, h) * 0.3}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                  style={{ userSelect: 'none' }}
                >
                  {d.label}
                </text>
              )}

              {/* 선택된 시설 리사이즈 + 회전 핸들 */}
              {mode === 'edit' && isDecorSelected && (
                <>
                  <circle
                    cx={w} cy={h / 2} r={3}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={(e) => startResizeDecor(e, d, 'right')}
                  />
                  <circle
                    cx={w / 2} cy={h} r={3}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    style={{ cursor: 'ns-resize' }}
                    onMouseDown={(e) => startResizeDecor(e, d, 'bottom')}
                  />
                  <circle
                    cx={w} cy={h} r={4}
                    fill="#2563eb"
                    stroke="#fff"
                    strokeWidth={1.5}
                    style={{ cursor: 'nwse-resize' }}
                    onMouseDown={(e) => startResizeDecor(e, d, 'br')}
                  />
                  <g
                    style={{ cursor: 'pointer' }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onClick={(e) => { e.stopPropagation(); rotateDecor(d); }}
                  >
                    <circle
                      cx={6} cy={6} r={5}
                      fill="#2563eb"
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                    <text
                      x={6} y={6}
                      fontSize={7}
                      fontWeight={900}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      pointerEvents="none"
                    >↻</text>
                  </g>
                </>
              )}
            </g>
          );
        })}

        {/* 섹션 그룹 박스 — 같은 section_id 주차칸들의 바운딩 박스 */}
        {(() => {
          const floorSections = sections.filter((sec) => sec.floor_id === floor.id);
          return floorSections.map((sec) => {
            const members = floorStalls.filter((s) => s.section_id === sec.id && s.layout);
            if (members.length === 0) return null;
            const minX = Math.min(...members.map((s) => s.layout!.x));
            const minY = Math.min(...members.map((s) => s.layout!.y));
            const maxX = Math.max(...members.map((s) => s.layout!.x + s.layout!.w));
            const maxY = Math.max(...members.map((s) => s.layout!.y + s.layout!.h));
            const x = minX * floor.cell_size;
            const y = minY * floor.cell_size;
            const w = (maxX - minX) * floor.cell_size;
            const h = (maxY - minY) * floor.cell_size;
            const labelFontSize = Math.max(6, Math.min(w, h) * 0.08);
            return (
              <g key={sec.id} pointerEvents="none">
                {/* 섹션 배경 박스 */}
                <rect
                  x={x - 2} y={y - 2}
                  width={w + 4} height={h + 4}
                  rx={6}
                  fill={sec.color}
                  opacity={0.12}
                />
                {/* 섹션 외곽선 */}
                <rect
                  x={x - 2} y={y - 2}
                  width={w + 4} height={h + 4}
                  rx={6}
                  fill="none"
                  stroke={sec.color}
                  strokeWidth={1.5}
                  strokeDasharray="4,2"
                  opacity={0.7}
                />
                {/* 섹션 라벨 — 좌상단 */}
                <rect
                  x={x - 2} y={y - labelFontSize - 6}
                  width={Math.max((sec.code.length + sec.name.length + 8) * labelFontSize * 0.55, 40)}
                  height={labelFontSize + 4}
                  rx={3}
                  fill={sec.color}
                />
                <text
                  x={x + 2} y={y - labelFontSize / 2 - 3}
                  fontSize={labelFontSize}
                  fontWeight={700}
                  fill="#fff"
                  dominantBaseline="middle"
                  style={{ userSelect: 'none' }}
                >
                  [{sec.code}] {sec.name} · {members.length}칸
                </text>
              </g>
            );
          });
        })()}

        {/* 공간 박스 */}
        {floorStalls.map((s) => {
          const layout = s.layout!;
          const result = getStallState(s.id, leases, billings, config, today);
          const fill = getFill(s.type, result.state);
          const tenant = result.lease ? tenants.find((t) => t.id === result.lease!.tenant_id) : null;
          const x = layout.x * floor.cell_size;
          const y = layout.y * floor.cell_size;
          const w = layout.w * floor.cell_size;
          const h = layout.h * floor.cell_size;
          const isSelected = selectedIds.includes(s.id);
          const padding = 4;

          return (
            <g
              key={s.id}
              transform={`translate(${x},${y})`}
              onMouseDown={(e) => startDrag(e, s)}
              onClick={(e) => {
                e.stopPropagation();
                // view 모드: 박스 선택. edit 모드: mousedown에서 이미 처리됨
                if (mode === 'view') {
                  onSelect(s.id, e.shiftKey);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, s)}
              style={{ cursor: mode === 'edit' ? 'grab' : 'pointer' }}
            >
              {(() => {
                const section = s.section_id ? sections.find((sec) => sec.id === s.section_id) : null;
                const strokeColor = isSelected ? '#0f172a' : (section ? section.color : fill.stroke);
                return (
                  <rect
                    x={padding / 2}
                    y={padding / 2}
                    width={w - padding}
                    height={h - padding}
                    rx={4}
                    fill={fill.fill}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2.5 : (section ? 2.5 : 1.5)}
                    strokeDasharray={s.type === 'parking' && result.state === 'vacant' && !section ? '3,2' : undefined}
                  />
                );
              })()}
              {/* 선택 시 강조 외곽선 */}
              {isSelected && (
                <rect
                  x={padding / 2 - 2}
                  y={padding / 2 - 2}
                  width={w - padding + 4}
                  height={h - padding + 4}
                  rx={6}
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth={1}
                  strokeDasharray="2,3"
                  opacity={0.7}
                />
              )}
              <text
                x={w / 2}
                y={h / 2 - (tenant ? 4 : 0)}
                fill={fill.ink}
                fontSize={s.type === 'office' ? 7 : 6}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
                style={{ userSelect: 'none' }}
              >
                {s.code}
              </text>
              {tenant && (
                <text
                  x={w / 2}
                  y={h / 2 + 5}
                  fill={fill.ink}
                  fontSize={s.type === 'office' ? 5 : 4}
                  fontWeight={500}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                  opacity={0.85}
                  style={{ userSelect: 'none' }}
                >
                  {tenant.name}
                </text>
              )}
              {/* 공실인 경우 유형 라벨 작게 표시 */}
              {!tenant && (
                <text
                  x={w / 2}
                  y={h / 2 + 5}
                  fill={fill.ink}
                  fontSize={3.5}
                  fontWeight={500}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  pointerEvents="none"
                  opacity={0.5}
                  style={{ userSelect: 'none' }}
                >
                  {s.type === 'office' ? '사무실' : '주차'}
                </text>
              )}

              {/* 리사이즈 핸들 — Figma 스타일 작은 원형 노드 */}
              {mode === 'edit' && isSelected && onResize && (
                <>
                  <circle
                    cx={w} cy={h / 2} r={3}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={(e) => startResize(e, s, 'right')}
                  />
                  <circle
                    cx={w / 2} cy={h} r={3}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    style={{ cursor: 'ns-resize' }}
                    onMouseDown={(e) => startResize(e, s, 'bottom')}
                  />
                  <circle
                    cx={w} cy={h} r={4}
                    fill="#2563eb"
                    stroke="#fff"
                    strokeWidth={1.5}
                    style={{ cursor: 'nwse-resize' }}
                    onMouseDown={(e) => startResize(e, s, 'br')}
                  />
                  {/* 회전 핸들 — 박스 좌상단 모서리 안쪽 (항상 viewBox 안에 위치) */}
                  <g
                    style={{ cursor: 'pointer' }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onClick={(e) => { e.stopPropagation(); ctxRotate(s.id); }}
                  >
                    <circle
                      cx={6} cy={6} r={5}
                      fill="#2563eb"
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                    <text
                      x={6} y={6}
                      fontSize={7}
                      fontWeight={900}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      pointerEvents="none"
                    >↻</text>
                  </g>
                </>
              )}
            </g>
          );
        })}

        {/* placement 미리보기 */}
        {placement && placementPreview && (
          <g pointerEvents="none">
            {placementPreview.items.map((p, i) => (
              <rect
                key={i}
                x={p.x * floor.cell_size + 1}
                y={p.y * floor.cell_size + 1}
                width={placement.cellW * floor.cell_size - 2}
                height={placement.cellH * floor.cell_size - 2}
                rx={2}
                fill={p.conflict ? '#fca5a5' : (placement.type === 'office' ? '#93c5fd' : '#c4b5fd')}
                stroke={p.conflict ? '#dc2626' : (placement.type === 'office' ? '#2563eb' : '#7c3aed')}
                strokeWidth={1.5}
                opacity={0.7}
              />
            ))}
          </g>
        )}

        {floorStalls.length === 0 && (
          <text x={W / 2} y={H / 2} fill="#a1a1aa" fontSize={14}
            textAnchor="middle" dominantBaseline="middle"
          >
            이 층에 배치된 공간이 없습니다 — 편집 모드에서 추가하세요
          </text>
        )}
      </svg>

      {/* 안내 */}
      <div className="px-3 py-1.5 border-t border-zinc-200 bg-zinc-50/50 text-[10.5px] text-zinc-500 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span>
            <span className="inline-block w-2.5 h-2.5 bg-blue-200 border border-blue-400 mr-1 align-middle" />
            사무실 공실
          </span>
          <span>
            <span className="inline-block w-2.5 h-2.5 bg-violet-200 border border-violet-400 mr-1 align-middle" />
            주차 공실
          </span>
          <span>
            <span className="inline-block w-2.5 h-2.5 bg-green-200 border border-green-500 mr-1 align-middle" />
            정상
          </span>
          <span>
            <span className="inline-block w-2.5 h-2.5 bg-red-200 border border-red-500 mr-1 align-middle" />
            연체
          </span>
          <span>
            <span className="inline-block w-2.5 h-2.5 bg-amber-200 border border-amber-500 mr-1 align-middle" />
            만료예정
          </span>
          <span>
            <span className="inline-block w-2.5 h-2.5 bg-orange-200 border border-orange-500 mr-1 align-middle" />
            입점예정
          </span>
        </div>
        {mode === 'edit' && (
          <span className="text-zinc-600 flex items-center gap-2 flex-wrap">
            <span><kbd className="px-1 py-0.5 bg-white border border-zinc-300 rounded text-[10px]">Shift</kbd>+클릭 다중</span>
            <span className="text-zinc-400">·</span>
            <span><kbd className="px-1 py-0.5 bg-white border border-zinc-300 rounded text-[10px]">Del</kbd> 삭제</span>
            <span className="text-zinc-400">·</span>
            <span><kbd className="px-1 py-0.5 bg-white border border-zinc-300 rounded text-[10px]">R</kbd> 회전</span>
            <span className="text-zinc-400">·</span>
            <span><kbd className="px-1 py-0.5 bg-white border border-zinc-300 rounded text-[10px]">Ctrl+C</kbd>/<kbd className="px-1 py-0.5 bg-white border border-zinc-300 rounded text-[10px]">V</kbd></span>
            <span className="text-zinc-400">·</span>
            <span><kbd className="px-1 py-0.5 bg-white border border-zinc-300 rounded text-[10px]">Esc</kbd> 해제</span>
          </span>
        )}
      </div>

      {/* 컨텍스트 메뉴 */}
      {ctxMenu && mode === 'edit' && (
        <div
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 100,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="bg-white border border-zinc-200 rounded-lg shadow-xl py-1 min-w-[180px] animate-fade-in"
        >
          {ctxMenu.decorId ? (
            (() => {
              const d = floorDecors.find((x) => x.id === ctxMenu.decorId);
              if (!d) return null;
              return (
                <>
                  <div className="px-3 py-1.5 text-[10.5px] text-zinc-500 border-b border-zinc-100 mb-1">
                    {DECOR_LABEL[d.type]}
                  </div>
                  <CtxItem onClick={() => { setCtxMenu(null); rotateDecor(d); }} icon={RotateCw}>회전 (가로↔세로)</CtxItem>
                  <div className="my-1 border-t border-zinc-100" />
                  <CtxItem onClick={() => { setCtxMenu(null); removeDecor(d.id); setSelectedDecorId(null); toast.success('시설 삭제됨'); }} icon={Trash2} danger>삭제</CtxItem>
                </>
              );
            })()
          ) : ctxMenu.stallId ? (
            <>
              <div className="px-3 py-1.5 text-[10.5px] text-zinc-500 border-b border-zinc-100 mb-1">
                {ctxMenu.stallId}
              </div>
              <CtxItem onClick={() => ctxDuplicate(ctxMenu.stallId!)} icon={Copy}>옆에 복제</CtxItem>
              <CtxItem onClick={() => ctxRotate(ctxMenu.stallId!)} icon={RotateCw}>회전 (가로↔세로)</CtxItem>
              <div className="my-1 border-t border-zinc-100" />
              <CtxItem onClick={() => ctxDelete(ctxMenu.stallId!)} icon={Trash2} danger>삭제</CtxItem>
            </>
          ) : (
            <>
              <div className="px-3 py-1.5 text-[10.5px] text-zinc-500 border-b border-zinc-100 mb-1">
                셀 ({ctxMenu.cellX}, {ctxMenu.cellY})
              </div>
              <CtxItem onClick={() => ctxAddAt('office', ctxMenu.cellX, ctxMenu.cellY)} icon={BuildingIcon}>
                사무실
              </CtxItem>
              <CtxItem onClick={() => ctxAddAt('parking', ctxMenu.cellX, ctxMenu.cellY)} icon={Car}>
                주차칸
              </CtxItem>
              <div className="my-1 border-t border-zinc-100" />
              <div className="px-3 py-0.5 text-[10px] text-zinc-400">— 시설 —</div>
              <CtxItem onClick={() => ctxAddDecor('pillar', ctxMenu.cellX, ctxMenu.cellY)} icon={Box}>기둥</CtxItem>
              <CtxItem onClick={() => ctxAddDecor('elevator', ctxMenu.cellX, ctxMenu.cellY)} icon={ArrowUp}>엘리베이터</CtxItem>
              <CtxItem onClick={() => ctxAddDecor('stairs', ctxMenu.cellX, ctxMenu.cellY)} icon={ArrowUpRight}>계단</CtxItem>
              <CtxItem onClick={() => ctxAddDecor('restroom', ctxMenu.cellX, ctxMenu.cellY)} icon={DoorOpen}>화장실</CtxItem>
              <CtxItem onClick={() => ctxAddDecor('ramp', ctxMenu.cellX, ctxMenu.cellY)} icon={ArrowUpRight}>램프</CtxItem>
              <CtxItem onClick={() => ctxAddDecor('entrance', ctxMenu.cellX, ctxMenu.cellY)} icon={DoorOpen}>출입구</CtxItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CtxItem({
  onClick, icon: Icon, children, danger,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-zinc-100 flex items-center gap-2 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-zinc-700'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {children}
    </button>
  );
}
