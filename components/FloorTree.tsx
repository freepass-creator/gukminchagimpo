'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Building, Plus, MoreHorizontal, Trash2, Pencil } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import {
  saveFloor, saveStall, removeFloor, removeStall, updateFloor, writeAudit,
} from '@/lib/data';
import { Button } from './Button';
import { fmtDate } from '@/lib/utils';
import { NewFloorDialog } from './NewFloorDialog';
import type { Floor } from '@/lib/types';

interface Props {
  selectedFloorId: string | null;
  onSelectFloor: (id: string) => void;
  /** true = 마스터에게 편집 컨트롤 노출 (도면 만들기 페이지) */
  editable?: boolean;
}

export function FloorTree({ selectedFloorId, onSelectFloor, editable = false }: Props) {
  const { floors, stalls, config } = useData();
  const { user, isAdmin } = useAuth();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const canEdit = editable;
  const isSingleMode = config.complex_layout === 'single';

  // 외부 클릭 / ESC 시 메뉴 닫기
  useEffect(() => {
    if (!menuFor) return;
    const onClick = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuFor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuFor(null);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  // 동별 그룹화
  const buildings = Array.from(new Set(floors.map((f) => f.building))).sort();
  const grouped: Record<string, Floor[]> = {};
  for (const b of buildings) {
    grouped[b] = floors
      .filter((f) => f.building === b)
      .sort((a, b) => a.order - b.order);
  }

  async function renameFloor(f: Floor) {
    const label = prompt('층 이름 변경', f.label);
    if (!label || label === f.label) return;
    await updateFloor(f.id, { label });
    toast.success('이름 변경됨');
  }

  async function deleteFloor(f: Floor) {
    const floorStalls = stalls.filter((s) => s.floor_id === f.id);
    const floorBackup: Floor = { ...f };
    const stallBackups = floorStalls.map((s) => ({ ...s }));
    try {
      // 층 안의 stall들 먼저 삭제
      for (const s of floorStalls) {
        await removeStall(s.id);
      }
      await removeFloor(f.id);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'floor_delete',
        target: f.id, memo: `${f.label} 삭제 (공간 ${stallBackups.length}개 포함)`,
        at: fmtDate(new Date()),
      });
      toast.success(
        `${f.label} 삭제됨${stallBackups.length > 0 ? ` (공간 ${stallBackups.length}개 포함)` : ''}`,
        {
          duration: 12000,
          action: {
            label: '복원',
            onClick: async () => {
              try {
                await saveFloor(floorBackup);
                for (const s of stallBackups) await saveStall(s);
                await writeAudit({
                  actor: user?.email || 'unknown',
                  type: 'floor_restore',
                  target: floorBackup.id,
                  memo: `${floorBackup.label} + 공간 ${stallBackups.length}개 복원`,
                  at: fmtDate(new Date()),
                });
                toast.success(`${floorBackup.label} 복원됨`);
              } catch (e: any) { toast.error(e?.message || '복원 실패'); }
            },
          },
        }
      );
    } catch (e: any) {
      toast.error(e?.message || '실패');
    }
  }

  async function resize(f: Floor, axis: 'col' | 'row', diff: number) {
    if (axis === 'col') {
      const next = Math.max(4, Math.min(40, f.grid_cols + diff));
      await updateFloor(f.id, { grid_cols: next });
    } else {
      const next = Math.max(4, Math.min(40, f.grid_rows + diff));
      await updateFloor(f.id, { grid_rows: next });
    }
  }

  return (
    <aside className="w-[220px] shrink-0 bg-white border-r border-zinc-200 p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-[12px] font-bold text-zinc-700 uppercase tracking-wider">
          {isSingleMode ? '층 목록' : '동 · 층'}
        </h3>
        {canEdit && (
          <button
            onClick={() => setOpenNew(isSingleMode ? (buildings[0] || config.single_building_label) : '*')}
            className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 font-semibold px-2 py-0.5 rounded border border-amber-300 bg-amber-50"
            title={isSingleMode ? '새 층 만들기' : '새 동 + 첫 층 만들기'}
          >
            <Plus className="w-3 h-3" /> {isSingleMode ? '새 층' : '새 동'}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {buildings.map((b) => (
          <div key={b}>
            {!isSingleMode && (
              <div className="flex items-center gap-1.5 px-2 py-1 text-[12px] font-bold text-zinc-700">
                <Building className="w-3.5 h-3.5 text-zinc-500" />
                {b}동
                <span className="text-[10px] text-zinc-400 ml-auto">
                  {grouped[b].length}개 층
                </span>
              </div>
            )}
            <div className="space-y-0.5 mt-1">
              {grouped[b].map((f) => {
                const stallCount = stalls.filter((s) => s.floor_id === f.id).length;
                return (
                  <div
                    key={f.id}
                    className={`group flex items-center gap-1 rounded-md text-[12px] ${
                      selectedFloorId === f.id
                        ? 'bg-zinc-900 text-white'
                        : 'text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    <button
                      onClick={() => onSelectFloor(f.id)}
                      className="flex-1 text-left px-2 py-1.5 min-w-0 flex items-center gap-1.5"
                    >
                      <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
                      <span className="truncate">{f.label}</span>
                      <span
                        className={`ml-auto text-[10px] tabular ${
                          selectedFloorId === f.id ? 'text-zinc-400' : 'text-zinc-400'
                        }`}
                      >
                        {stallCount}
                      </span>
                    </button>
                    {canEdit && (
                      <div className="relative" ref={menuFor === f.id ? menuContainerRef : undefined}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor(menuFor === f.id ? null : f.id);
                          }}
                          className={`p-1 opacity-0 group-hover:opacity-100 ${
                            selectedFloorId === f.id ? 'text-white' : 'text-zinc-400'
                          }`}
                        >
                          <MoreHorizontal className="w-3 h-3" />
                        </button>
                        {menuFor === f.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded-md shadow-lg z-10 py-1 min-w-[140px] text-zinc-700">
                            <MenuItem onClick={() => { setMenuFor(null); renameFloor(f); }}>
                              <Pencil className="w-3 h-3" /> 이름 변경
                            </MenuItem>
                            <MenuItem onClick={() => { setMenuFor(null); resize(f, 'col', 2); }}>
                              + 가로 2칸
                            </MenuItem>
                            <MenuItem onClick={() => { setMenuFor(null); resize(f, 'col', -2); }}>
                              − 가로 2칸
                            </MenuItem>
                            <MenuItem onClick={() => { setMenuFor(null); resize(f, 'row', 2); }}>
                              + 세로 2칸
                            </MenuItem>
                            <MenuItem onClick={() => { setMenuFor(null); resize(f, 'row', -2); }}>
                              − 세로 2칸
                            </MenuItem>
                            <div className="border-t border-zinc-200 my-1" />
                            <MenuItem onClick={() => { setMenuFor(null); deleteFloor(f); }}>
                              <Trash2 className="w-3 h-3 text-red-600" />
                              <span className="text-red-600">삭제</span>
                            </MenuItem>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {canEdit && !isSingleMode && (
                <button
                  onClick={() => setOpenNew(b)}
                  className="w-full text-left px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-900 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> 새 층
                </button>
              )}
            </div>
          </div>
        ))}

        {floors.length === 0 && (
          <div className="text-[11px] text-zinc-400 text-center py-8">
            동·층이 없습니다.<br />
            {canEdit ? '+ 버튼으로 추가' : '도면 만들기에서 생성'}
          </div>
        )}
      </div>

      {canEdit && openNew && (
        <NewFloorDialog
          open={!!openNew}
          onClose={() => setOpenNew(null)}
          defaultBuilding={openNew === '*' ? undefined : openNew}
        />
      )}
    </aside>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-zinc-100 flex items-center gap-1.5"
    >
      {children}
    </button>
  );
}
