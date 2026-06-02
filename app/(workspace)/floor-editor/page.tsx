'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, LayoutGrid, Copy, ShieldX, Grid3x3 } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { FloorTree } from '@/components/FloorTree';
import { FloorCanvas } from '@/components/FloorCanvas';
import { FloorPalette } from '@/components/FloorPalette';
import { Button } from '@/components/Button';
import { BulkAddDialog } from '@/components/BulkAddDialog';
import { CopyFloorDialog } from '@/components/CopyFloorDialog';
import { FloorSettingsDialog } from '@/components/FloorSettingsDialog';
import { updateStall, updateFloor, saveStall, removeStall, writeAudit } from '@/lib/data';
import { wouldOverlap, expandToFit } from '@/lib/state';
import { fmtDate, newId } from '@/lib/utils';
import { toast } from 'sonner';
import type { PlacementConfig, Stall } from '@/lib/types';

export default function FloorEditorPage() {
  const router = useRouter();
  const { floors, stalls, decors, today } = useData();
  const { isManager, loading, user } = useAuth();
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [selectedStallIds, setSelectedStallIds] = useState<string[]>([]);
  const [openBulk, setOpenBulk] = useState(false);
  const [openCopy, setOpenCopy] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [placement, setPlacement] = useState<PlacementConfig | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [colsInput, setColsInput] = useState('');
  const [rowsInput, setRowsInput] = useState('');
  const [clipboard, setClipboard] = useState<Stall[]>([]);

  /** 키보드 단축키 */
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // ESC — placement 취소 또는 선택 해제
      if (e.key === 'Escape') {
        if (placement) { setPlacement(null); return; }
        if (selectedStallIds.length > 0) { setSelectedStallIds([]); }
        return;
      }

      const curFloor = floors.find((x) => x.id === selectedFloorId);
      if (!curFloor) return;

      const selectedList = stalls.filter((s) => selectedStallIds.includes(s.id));
      const single = selectedList.length === 1 ? selectedList[0] : null;

      // Delete / Backspace — 선택 삭제
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedList.length > 0) {
        e.preventDefault();
        const backups = selectedList.map((s) => ({ ...s }));
        for (const s of selectedList) await removeStall(s.id);
        await writeAudit({
          actor: user?.email || 'unknown',
          type: 'keyboard_delete',
          target: backups.map((s) => s.id).join(','),
          memo: `Delete 키 — ${backups.length}개 삭제`,
          at: fmtDate(today),
        });
        setSelectedStallIds([]);
        toast.success(`${backups.length}개 삭제됨`, {
          duration: 8000,
          action: {
            label: '복원',
            onClick: async () => {
              for (const b of backups) await saveStall(b);
              toast.success(`${backups.length}개 복원됨`);
            },
          },
        });
        return;
      }

      // R — 회전 (단일 선택)
      if ((e.key === 'r' || e.key === 'R') && single?.layout) {
        e.preventDefault();
        const cur = single.layout.rotation || 0;
        const next = {
          ...single.layout,
          w: single.layout.h, h: single.layout.w,
          rotation: (cur === 0 ? 90 : 0) as 0 | 90,
        };
        const expand = expandToFit(curFloor, next);
        if (expand) {
          await updateFloor(curFloor.id, expand);
          toast.info(`그리드 자동 확장: ${expand.grid_cols ?? curFloor.grid_cols} × ${expand.grid_rows ?? curFloor.grid_rows}`);
        }
        const { conflict } = wouldOverlap(single.id, curFloor.id, next, stalls, decors);
        if (conflict) { toast.error('회전 시 다른 공간과 겹쳐서 불가'); return; }
        await updateStall(single.id, { layout: next });
        return;
      }

      // Ctrl+C — 복사
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedList.length > 0) {
        e.preventDefault();
        setClipboard(selectedList.map((s) => ({ ...s })));
        toast.success(`${selectedList.length}개 복사됨 (Ctrl+V로 붙여넣기)`);
        return;
      }

      // Ctrl+V — 붙여넣기
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard.length > 0) {
        e.preventDefault();
        // 묶음의 바운딩 박스
        const minX = Math.min(...clipboard.map((s) => s.layout!.x));
        const minY = Math.min(...clipboard.map((s) => s.layout!.y));
        const maxX = Math.max(...clipboard.map((s) => s.layout!.x + s.layout!.w));
        const maxY = Math.max(...clipboard.map((s) => s.layout!.y + s.layout!.h));
        const groupW = maxX - minX;
        const groupH = maxY - minY;

        // 빈 자리 — 원본 옆부터, 안 되면 전체 스캔
        let slot: { x: number; y: number } | null = null;
        const tries = [
          { x: maxX, y: minY },
          { x: 0, y: maxY },
        ];
        for (const t of tries) {
          if (t.x + groupW > curFloor.grid_cols || t.y + groupH > curFloor.grid_rows) continue;
          let ok = true;
          for (const src of clipboard) {
            const dx = src.layout!.x - minX;
            const dy = src.layout!.y - minY;
            const { conflict } = wouldOverlap(null, curFloor.id,
              { x: t.x + dx, y: t.y + dy, w: src.layout!.w, h: src.layout!.h }, stalls, decors);
            if (conflict) { ok = false; break; }
          }
          if (ok) { slot = t; break; }
        }
        if (!slot) {
          // 전체 스캔
          outer:
          for (let y = 0; y <= curFloor.grid_rows - groupH; y++) {
            for (let x = 0; x <= curFloor.grid_cols - groupW; x++) {
              let ok = true;
              for (const src of clipboard) {
                const dx = src.layout!.x - minX;
                const dy = src.layout!.y - minY;
                const { conflict } = wouldOverlap(null, curFloor.id,
                  { x: x + dx, y: y + dy, w: src.layout!.w, h: src.layout!.h }, stalls, decors);
                if (conflict) { ok = false; break; }
              }
              if (ok) { slot = { x, y }; break outer; }
            }
          }
        }
        // 못 찾으면 우측 그리드 자동 확장
        if (!slot) {
          const newCols = curFloor.grid_cols + groupW + 1;
          await updateFloor(curFloor.id, { grid_cols: newCols });
          slot = { x: curFloor.grid_cols, y: 0 };
          toast.info(`그리드 자동 확장: ${newCols} × ${curFloor.grid_rows}`);
        }

        // 코드 자동 부여
        let nextOffice = (() => {
          const nums = stalls.filter((s) => s.building === curFloor.building && s.type === 'office')
            .map((s) => parseInt(s.code)).filter((n) => !isNaN(n));
          return nums.length ? Math.max(...nums) + 1 : (curFloor.building === 'A' ? 201 : 301);
        })();
        let nextParking = (() => {
          const nums = stalls.filter((s) => s.building === curFloor.building && s.type === 'parking' && /^P\d+$/.test(s.code))
            .map((s) => parseInt(s.code.slice(1)));
          return nums.length ? Math.max(...nums) + 1 : 1;
        })();

        const newIds: string[] = [];
        for (const src of clipboard) {
          const code = src.type === 'office'
            ? String(nextOffice++)
            : 'P' + String(nextParking++).padStart(2, '0');
          const dx = src.layout!.x - minX;
          const dy = src.layout!.y - minY;
          const copy: Stall = {
            ...src,
            id: `${curFloor.building}-${code}`,
            code,
            building: curFloor.building,
            floor_id: curFloor.id,
            layout: {
              x: slot.x + dx,
              y: slot.y + dy,
              w: src.layout!.w,
              h: src.layout!.h,
              rotation: src.layout!.rotation,
            },
          };
          await saveStall(copy);
          newIds.push(copy.id);
        }
        await writeAudit({
          actor: user?.email || 'unknown',
          type: 'keyboard_paste',
          target: newIds.join(','),
          memo: `Ctrl+V — ${newIds.length}개 붙여넣기`,
          at: fmtDate(today),
        });
        setSelectedStallIds(newIds);
        toast.success(`${newIds.length}개 붙여넣기`);
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [floors, selectedFloorId, stalls, selectedStallIds, clipboard, placement, user, today]);

  // floor 변경 시 input 동기화
  useEffect(() => {
    if (floors.length === 0) return;
    const f = floors.find((x) => x.id === selectedFloorId);
    if (f) {
      setColsInput(String(f.grid_cols));
      setRowsInput(String(f.grid_rows));
    }
  }, [selectedFloorId, floors]);

  function applyCols(floorId: string, currentVal: number) {
    const v = parseInt(colsInput);
    if (!v || isNaN(v) || v === currentVal) {
      setColsInput(String(currentVal));
      return;
    }
    const clamped = Math.max(4, Math.min(500, v));
    updateFloor(floorId, { grid_cols: clamped });
    setColsInput(String(clamped));
  }
  function applyRows(floorId: string, currentVal: number) {
    const v = parseInt(rowsInput);
    if (!v || isNaN(v) || v === currentVal) {
      setRowsInput(String(currentVal));
      return;
    }
    const clamped = Math.max(4, Math.min(500, v));
    updateFloor(floorId, { grid_rows: clamped });
    setRowsInput(String(clamped));
  }

  async function handlePlace(originX: number, originY: number) {
    if (!placement || !floor) return;
    // 코드 자동 부여 시작 번호
    const existing = stalls.filter((s) => s.building === floor.building && s.type === placement.type);
    let nextNum: number;
    if (placement.type === 'office') {
      const nums = existing.map((s) => parseInt(s.code)).filter((n) => !isNaN(n));
      nextNum = nums.length ? Math.max(...nums) + 1 : (floor.building === 'A' ? 201 : 301);
    } else {
      const nums = existing.filter((s) => /^P\d+$/.test(s.code))
        .map((s) => parseInt(s.code.slice(1)));
      nextNum = nums.length ? Math.max(...nums) + 1 : 1;
    }

    let created = 0;
    let skipped = 0;
    for (let r = 0; r < placement.rows; r++) {
      for (let c = 0; c < placement.cols; c++) {
        const x = originX + c * (placement.cellW + placement.gap);
        const y = originY + r * (placement.cellH + placement.gap);
        if (x + placement.cellW > floor.grid_cols || y + placement.cellH > floor.grid_rows) {
          skipped++; continue;
        }
        const { conflict } = wouldOverlap(null, floor.id,
          { x, y, w: placement.cellW, h: placement.cellH }, stalls, decors);
        if (conflict) { skipped++; continue; }
        const code = placement.type === 'office'
          ? String(nextNum + created)
          : 'P' + String(nextNum + created).padStart(2, '0');
        const s: Stall = {
          id: `${floor.building}-${code}`,
          building: floor.building,
          type: placement.type,
          code,
          area: placement.cellW * placement.cellH,
          rent: placement.type === 'office' ? 1800000 : 250000,
          maint: placement.type === 'office' ? 200000 : 30000,
          floor_id: floor.id,
          layout: { x, y, w: placement.cellW, h: placement.cellH },
        };
        await saveStall(s);
        created++;
      }
    }
    await writeAudit({
      actor: user?.email || 'unknown',
      type: 'placement_create', target: floor.id,
      memo: `${floor.label}에 ${placement.type === 'office' ? '사무실' : '주차'} ${created}개 배치 (캔버스 클릭)`,
      at: fmtDate(today),
    });
    toast.success(`${created}개 배치${skipped > 0 ? ` (충돌 ${skipped}개 제외)` : ''}`);
    setPlacement(null);
  }

  function handleStallSelect(id: string | null, shift: boolean) {
    if (id === null) {
      if (!shift) setSelectedStallIds([]);
      return;
    }
    setSelectedStallIds((arr) => {
      if (shift) {
        return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
      }
      return [id];
    });
  }

  useEffect(() => {
    if (!selectedFloorId && floors.length > 0) {
      setSelectedFloorId([...floors].sort((a, b) => a.order - b.order)[0].id);
    }
  }, [floors, selectedFloorId]);

  const floor = floors.find((f) => f.id === selectedFloorId);

  async function handleMove(stallId: string, x: number, y: number) {
    const s = stalls.find((x) => x.id === stallId);
    if (!s?.layout) return;
    await updateStall(stallId, { layout: { ...s.layout, x, y } });
  }

  async function handleResize(stallId: string, w: number, h: number) {
    const s = stalls.find((x) => x.id === stallId);
    if (!s?.layout) return;
    await updateStall(stallId, { layout: { ...s.layout, w, h } });
  }

  if (loading) return null;

  if (!isManager) {
    return (
      <div className="max-w-xl mx-auto py-10">
        <div className="bg-white border border-zinc-200 rounded-xl p-8 text-center shadow-soft">
          <ShieldX className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
          <h2 className="text-[16px] font-bold mb-1">관리자 권한 필요</h2>
          <p className="text-[12.5px] text-zinc-500">
            도면 만들기는 관리자만 사용할 수 있습니다. 마스터에게 관리자 권한 부여를 요청하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-7 -my-6 flex" style={{ height: 'calc(100vh - 56px)' }}>
      <FloorTree
        selectedFloorId={selectedFloorId}
        onSelectFloor={(id) => { setSelectedFloorId(id); setSelectedStallIds([]); }}
        editable
      />

      <div className="flex-1 min-w-0 flex flex-col bg-zinc-50">
        {/* 상단 툴바 */}
        <div className="h-12 px-5 border-b border-zinc-200 bg-white flex items-center gap-3 shrink-0">
          {floor ? (
            <>
              <div className="text-[13px] font-bold flex items-center gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5 text-zinc-500" />
                {floor.building}동 · {floor.label}
              </div>
              <div className="flex items-center gap-1 text-[11.5px] text-zinc-600">
                <span className="text-zinc-500">그리드</span>
                <input
                  type="number"
                  value={colsInput}
                  min={4} max={500}
                  onChange={(e) => setColsInput(e.target.value)}
                  onBlur={() => applyCols(floor.id, floor.grid_cols)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setColsInput(String(floor.grid_cols));
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-14 border border-zinc-200 rounded px-1.5 py-0.5 text-[12px] tabular text-center focus:outline-none focus:border-zinc-500"
                  title="가로 셀 수 — Enter로 반영"
                />
                <span className="text-zinc-400">×</span>
                <input
                  type="number"
                  value={rowsInput}
                  min={4} max={500}
                  onChange={(e) => setRowsInput(e.target.value)}
                  onBlur={() => applyRows(floor.id, floor.grid_rows)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setRowsInput(String(floor.grid_rows));
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-14 border border-zinc-200 rounded px-1.5 py-0.5 text-[12px] tabular text-center focus:outline-none focus:border-zinc-500"
                  title="세로 셀 수 — Enter로 반영"
                />
                <span className="text-zinc-400 ml-0.5">셀</span>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setShowGrid(!showGrid)}
                  className={`inline-flex items-center gap-1 px-2.5 h-[30px] rounded-md border text-[11.5px] font-medium ${
                    showGrid
                      ? 'bg-zinc-100 border-zinc-300 text-zinc-900'
                      : 'bg-white border-zinc-200 text-zinc-500'
                  }`}
                  title="그리드 격자 표시 토글"
                >
                  <Grid3x3 className="w-3.5 h-3.5" />
                  격자 {showGrid ? '켜짐' : '꺼짐'}
                </button>
                <Button size="sm" variant="outline" onClick={() => setOpenSettings(true)}>
                  <Settings className="w-3.5 h-3.5" /> 층 설정
                </Button>
                <Button size="sm" variant="outline" onClick={() => setOpenCopy(true)}>
                  <Copy className="w-3.5 h-3.5" /> 도면 복사
                </Button>
                <Button size="sm" variant="primary" onClick={() => setOpenBulk(true)}>
                  ＋ 여러 칸 한번에
                </Button>
              </div>
            </>
          ) : (
            <div className="text-[12px] text-zinc-500">왼쪽에서 층을 선택하세요</div>
          )}
        </div>

        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11.5px] text-amber-900 shrink-0">
          <b>편집 모드</b> · 박스 드래그로 이동 · 클릭으로 선택 후 우측에서 코드·위치·크기 변경 · 우측 ＋ 사무실/주차칸 단건 추가
        </div>

        {/* 캔버스 */}
        <div className="flex-1 overflow-auto p-5">
          {floor ? (
            <FloorCanvas
              floor={floor}
              mode="edit"
              selectedIds={selectedStallIds}
              onSelect={handleStallSelect}
              onMove={handleMove}
              onResize={handleResize}
              showGrid={showGrid}
              placement={placement}
              onPlace={handlePlace}
              onCancelPlacement={() => setPlacement(null)}
              selectedCell={selectedCell}
              onSelectCell={setSelectedCell}
            />
          ) : (
            <div className="text-center text-[13px] text-zinc-400 py-20">
              {floors.length === 0
                ? '동·층을 추가하세요 (좌측 + 버튼)'
                : '층을 선택하세요'}
            </div>
          )}
        </div>
      </div>

      {floor && (
        <FloorPalette
          floor={floor}
          selectedStallIds={selectedStallIds}
          onSelect={setSelectedStallIds}
          mode="edit"
          selectedCell={selectedCell}
          onConsumeCell={() => setSelectedCell(null)}
        />
      )}

      {floor && (
        <>
          <BulkAddDialog
            open={openBulk}
            onClose={() => setOpenBulk(false)}
            floor={floor}
            onStartPlacement={(cfg) => setPlacement(cfg)}
          />
          <CopyFloorDialog open={openCopy} onClose={() => setOpenCopy(false)} sourceFloor={floor} />
          <FloorSettingsDialog open={openSettings} onClose={() => setOpenSettings(false)} floor={floor} />
        </>
      )}

      {/* placement 모드 안내 바 */}
      {placement && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-3 text-[12.5px] z-50">
          <span>
            <b className="text-amber-300">캔버스 클릭 = 배치</b>
            <span className="text-zinc-400 mx-2">·</span>
            {placement.type === 'office' ? '사무실' : '주차'} {placement.cols}×{placement.rows}묶음
            <span className="text-zinc-400 mx-2">·</span>
            ESC 또는 우클릭 = 취소
          </span>
          <button onClick={() => setPlacement(null)} className="text-zinc-400 hover:text-white">×</button>
        </div>
      )}
    </div>
  );
}
