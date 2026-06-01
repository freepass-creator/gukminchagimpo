'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, RotateCw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Copy } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import {
  saveStall, updateStall, removeStall, writeAudit, saveDecor, saveSection, removeSection,
} from '@/lib/data';
import { DECOR_PRESETS, DECOR_LABEL, SECTION_COLORS } from '@/lib/types';
import type { DecorType, Decor, ParkingSection } from '@/lib/types';
import { makeDecorId } from '@/lib/codes';
import { Box, ArrowUpRight, DoorOpen } from 'lucide-react';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';
import { getStallState, wouldOverlap, findSlotOrExpand, expandToFit } from '@/lib/state';
import { updateFloor } from '@/lib/data';
import {
  nextOfficeCode, nextParkingCode, nextSectionCode, suggestSectionName,
  makeStallId, makeSectionId,
} from '@/lib/codes';
import { fmtDate, fmtMoney } from '@/lib/utils';
import type { Floor, Stall, StallType } from '@/lib/types';

interface Props {
  floor: Floor;
  selectedStallIds: string[];
  onSelect: (ids: string[]) => void;
  mode?: 'view' | 'edit';
  /** 사용자가 캔버스에서 선택한 셀 — 추가 위치 우선 */
  selectedCell?: { x: number; y: number } | null;
  onConsumeCell?: () => void;
}

export function FloorPalette({
  floor, selectedStallIds, onSelect, mode = 'view',
  selectedCell, onConsumeCell,
}: Props) {
  const { stalls, leases, billings, tenants, config, today, sections } = useData();
  const { user, isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const canEdit = mode === 'edit';

  const selectedList = stalls.filter((s) => selectedStallIds.includes(s.id));
  const single = selectedList.length === 1 ? selectedList[0] : null;
  const multi = selectedList.length > 1;

  async function addStall(type: StallType) {
    setBusy(true);
    try {
      const w = type === 'office' ? 3 : 2;
      const h = type === 'office' ? 3 : 3;
      let slot: { x: number; y: number };
      if (selectedCell) {
        // 사용자가 선택한 셀에 추가
        slot = selectedCell;
        const needCols = Math.max(floor.grid_cols, slot.x + w);
        const needRows = Math.max(floor.grid_rows, slot.y + h);
        if (needCols !== floor.grid_cols || needRows !== floor.grid_rows) {
          await updateFloor(floor.id, { grid_cols: needCols, grid_rows: needRows });
        }
        const { conflict } = wouldOverlap(null, floor.id, { x: slot.x, y: slot.y, w, h }, stalls);
        if (conflict) { toast.error('이 위치에 다른 박스가 있어 추가 불가'); return; }
        onConsumeCell?.();
      } else {
        const result = findSlotOrExpand(floor, stalls, w, h);
        slot = result.slot;
        if (result.expand) {
          await updateFloor(floor.id, result.expand);
          toast.info(`그리드 자동 확장: ${result.expand.grid_cols ?? floor.grid_cols} × ${result.expand.grid_rows ?? floor.grid_rows}`);
        }
      }
      const code = type === 'office'
        ? nextOfficeCode(stalls, floor.building)
        : nextParkingCode(stalls, floor.building);
      const newStall: Stall = {
        id: makeStallId(floor.building, code),
        building: floor.building, type, code,
        area: type === 'office' ? 9 : 6,
        rent: type === 'office' ? 1800000 : 250000,
        maint: type === 'office' ? 200000 : 30000,
        floor_id: floor.id,
        layout: { x: slot.x, y: slot.y, w, h },
      };
      await saveStall(newStall);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'stall_create',
        target: newStall.id,
        memo: `${floor.label}에 ${type === 'office' ? '사무실' : '주차'} 추가`,
        at: fmtDate(today),
      });
      onSelect([newStall.id]);
      toast.success(`${newStall.id} 추가됨`);
    } catch (e: any) {
      toast.error(e?.message || '추가 실패');
    } finally {
      setBusy(false);
    }
  }

  async function addDecor(type: DecorType) {
    setBusy(true);
    try {
      const preset = DECOR_PRESETS[type];
      let slot: { x: number; y: number };
      if (selectedCell) {
        slot = selectedCell;
        const needCols = Math.max(floor.grid_cols, slot.x + preset.w);
        const needRows = Math.max(floor.grid_rows, slot.y + preset.h);
        if (needCols !== floor.grid_cols || needRows !== floor.grid_rows) {
          await updateFloor(floor.id, { grid_cols: needCols, grid_rows: needRows });
        }
        onConsumeCell?.();
      } else {
        const result = findSlotOrExpand(floor, stalls, preset.w, preset.h);
        slot = result.slot;
        if (result.expand) {
          await updateFloor(floor.id, result.expand);
          toast.info(`그리드 자동 확장: ${result.expand.grid_cols ?? floor.grid_cols} × ${result.expand.grid_rows ?? floor.grid_rows}`);
        }
      }
      const newDecor: Decor = {
        id: makeDecorId(),
        floor_id: floor.id,
        building: floor.building,
        type,
        label: preset.label || undefined,
        layout: { x: slot.x, y: slot.y, w: preset.w, h: preset.h },
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
    } finally {
      setBusy(false);
    }
  }

  async function patch(p: Partial<Stall>) {
    if (!single) return;
    await updateStall(single.id, p);
  }

  async function patchLayout(diff: { dx?: number; dy?: number; dw?: number; dh?: number }) {
    if (!single?.layout) return;
    const next = {
      x: Math.max(0, Math.min(floor.grid_cols - single.layout.w, single.layout.x + (diff.dx || 0))),
      y: Math.max(0, Math.min(floor.grid_rows - single.layout.h, single.layout.y + (diff.dy || 0))),
      w: Math.max(1, Math.min(floor.grid_cols - single.layout.x, single.layout.w + (diff.dw || 0))),
      h: Math.max(1, Math.min(floor.grid_rows - single.layout.y, single.layout.h + (diff.dh || 0))),
      rotation: single.layout.rotation,
    };
    const { conflict, with: cw } = wouldOverlap(single.id, floor.id, next, stalls);
    if (conflict) { toast.error(`${cw}와 겹쳐서 불가`); return; }
    await updateStall(single.id, { layout: next });
  }

  async function rotate() {
    if (!single?.layout) return;
    const cur = single.layout.rotation || 0;
    const newRot = cur === 0 ? 90 : 0;
    const next = {
      ...single.layout,
      w: single.layout.h,
      h: single.layout.w,
      rotation: newRot as 0 | 90,
    };
    // 그리드 밖이면 자동 확장 (좌표 보존)
    const expand = expandToFit(floor, next);
    if (expand) {
      await updateFloor(floor.id, expand);
      toast.info(`그리드 자동 확장: ${expand.grid_cols ?? floor.grid_cols} × ${expand.grid_rows ?? floor.grid_rows}`);
    }
    const { conflict, with: cw } = wouldOverlap(single.id, floor.id, next, stalls);
    if (conflict) { toast.error(`회전 시 ${cw}와 겹쳐서 불가`); return; }
    await updateStall(single.id, { layout: next });
  }

  async function remove() {
    if (!single) return;
    const used = leases.some((l) => l.status === 'active' && l.stall_ids.includes(single.id));
    if (used) toast.warning(`${single.id} 활성 계약 사용 중 — 삭제 진행 (복원 가능)`);
    const backup: Stall = { ...single };
    try {
      await removeStall(single.id);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'stall_delete', target: single.id,
        memo: `${single.id} 공간 삭제`,
        at: fmtDate(today),
      });
      onSelect([]);
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

  /** 다중 묶음 옆에 복제 */
  async function duplicateMulti() {
    if (selectedList.length === 0) {
      toast.error('복사할 박스를 먼저 선택하세요');
      return;
    }
    setBusy(true);
    try {
      // 묶음의 바운딩 박스
      const minX = Math.min(...selectedList.map((s) => s.layout!.x));
      const minY = Math.min(...selectedList.map((s) => s.layout!.y));
      const maxX = Math.max(...selectedList.map((s) => s.layout!.x + s.layout!.w));
      const maxY = Math.max(...selectedList.map((s) => s.layout!.y + s.layout!.h));
      const groupW = maxX - minX;
      const groupH = maxY - minY;

      const { slot, expand } = findSlotOrExpand(floor, stalls, groupW, groupH, { x: maxX, y: minY });
      if (expand) {
        await updateFloor(floor.id, expand);
        toast.info(`그리드 자동 확장: ${expand.grid_cols ?? floor.grid_cols} × ${expand.grid_rows ?? floor.grid_rows}`);
      }

      // 누적 stall — 복제 중에도 코드 부여 정확히 반영
      const accStalls = [...stalls];
      const newIds: string[] = [];
      for (const src of selectedList) {
        const code = src.type === 'office'
          ? nextOfficeCode(accStalls, floor.building)
          : nextParkingCode(accStalls, floor.building);
        const dx = src.layout!.x - minX;
        const dy = src.layout!.y - minY;
        const copy: Stall = {
          ...src,
          id: makeStallId(floor.building, code),
          code,
          floor_id: floor.id,
          layout: {
            x: slot.x + dx,
            y: slot.y + dy,
            w: src.layout!.w,
            h: src.layout!.h,
            rotation: src.layout!.rotation,
          },
        };
        await saveStall(copy);
        accStalls.push(copy);
        newIds.push(copy.id);
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'multi_duplicate', target: newIds.join(','),
        memo: `${selectedList.length}개 묶음 복제`,
        at: fmtDate(today),
      });
      onSelect(newIds);
      toast.success(`${selectedList.length}개 복제 완료`);
    } catch (e: any) { toast.error(e?.message || '실패'); }
    finally { setBusy(false); }
  }

  /** 다중 주차칸 → 하나의 블럭으로 묶기 */
  async function groupAsSection() {
    const parkingOnly = selectedList.filter((s) => s.type === 'parking');
    if (parkingOnly.length === 0) {
      toast.error('주차칸만 선택해서 블럭으로 묶을 수 있습니다');
      return;
    }
    if (parkingOnly.length !== selectedList.length) {
      toast.warning(`주차칸 ${parkingOnly.length}개만 블럭으로 묶음 (사무실은 제외)`);
    }
    // 다음 블럭 코드 + 자동 이름
    const code = nextSectionCode(sections);
    const suggested = suggestSectionName(sections, floor.id);
    const name = prompt(
      `${floor.building}동 · ${floor.label} · 번호 ${code}\n블럭 이름을 정해주세요 (예: A블럭, 입구쪽, 1열)`,
      suggested
    );
    if (!name) return;
    setBusy(true);
    try {
      const sectionId = `SEC-${Date.now().toString(36)}`;
      const color = SECTION_COLORS[(nextNum - 1) % SECTION_COLORS.length];

      const totalRent = parkingOnly.reduce((s, x) => s + x.rent, 0);
      const totalMaint = parkingOnly.reduce((s, x) => s + x.maint, 0);

      const section: ParkingSection = {
        id: sectionId,
        building: floor.building,
        floor_id: floor.id,
        code, name, color,
        rent: totalRent,
        maint: totalMaint,
      };
      await saveSection(section);

      // 각 주차칸에 section_id 부여
      for (const p of parkingOnly) {
        await updateStall(p.id, { section_id: sectionId });
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'block_create',
        target: sectionId,
        memo: `${floor.label} 블럭 "${name}" 생성 (주차 ${parkingOnly.length}칸)`,
        at: fmtDate(today),
      });
      toast.success(`블럭 "${name}" 생성 — ${parkingOnly.length}칸 묶음`);
    } catch (e: any) { toast.error(e?.message || '실패'); }
    finally { setBusy(false); }
  }

  /** 선택된 주차칸들의 블럭 해제 */
  async function ungroupSection() {
    const parkingWithSection = selectedList.filter((s) => s.type === 'parking' && s.section_id);
    if (parkingWithSection.length === 0) {
      toast.error('블럭에 속한 주차칸이 없음');
      return;
    }
    const sectionIds = Array.from(new Set(parkingWithSection.map((s) => s.section_id!)));
    if (!confirm(`주차칸 ${parkingWithSection.length}개의 블럭 묶음을 해제할까요?`)) return;
    setBusy(true);
    try {
      for (const p of parkingWithSection) {
        await updateStall(p.id, { section_id: undefined });
      }
      // 블럭 자체도 사용 안 하면 삭제
      for (const sid of sectionIds) {
        const stillUsed = stalls.some((s) => s.id !== undefined && s.section_id === sid && !parkingWithSection.some((p) => p.id === s.id));
        if (!stillUsed) await removeSection(sid);
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'block_ungroup',
        target: sectionIds.join(','),
        memo: `블럭 ${parkingWithSection.length}칸 해제`,
        at: fmtDate(today),
      });
      toast.success('블럭 해제됨');
    } catch (e: any) { toast.error(e?.message || '실패'); }
    finally { setBusy(false); }
  }

  async function removeMulti() {
    if (selectedList.length === 0) return;
    const usedIds: string[] = [];
    for (const s of selectedList) {
      const used = leases.some((l) => l.status === 'active' && l.stall_ids.includes(s.id));
      if (used) usedIds.push(s.id);
    }
    if (usedIds.length > 0) {
      toast.warning(`활성 계약 사용 중 ${usedIds.length}개 포함 — 삭제 진행 (복원 가능)`);
    }
    const backups: Stall[] = selectedList.map((s) => ({ ...s }));
    setBusy(true);
    try {
      for (const s of selectedList) {
        await removeStall(s.id);
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'multi_delete', target: backups.map((s) => s.id).join(','),
        memo: `${backups.length}개 묶음 삭제`,
        at: fmtDate(today),
      });
      onSelect([]);
      toast.success(`${backups.length}개 삭제됨`, {
        duration: 10000,
        action: {
          label: '복원',
          onClick: async () => {
            try {
              for (const b of backups) await saveStall(b);
              await writeAudit({
                actor: user?.email || 'unknown',
                type: 'multi_restore', target: backups.map((s) => s.id).join(','),
                memo: `${backups.length}개 삭제 복원`,
                at: fmtDate(today),
              });
              toast.success(`${backups.length}개 복원됨`);
            } catch (e: any) { toast.error(e?.message || '복원 실패'); }
          },
        },
      });
    } catch (e: any) { toast.error(e?.message || '실패'); }
    finally { setBusy(false); }
  }

  return (
    <aside className="w-[280px] shrink-0 bg-white border-l border-zinc-200 p-4 overflow-y-auto">
      <h3 className="text-[13px] font-bold mb-3">{floor.label}</h3>

      {canEdit && (
        <div className="mb-4">
          {selectedCell && (
            <div className="mb-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-900">
              <b>셀 ({selectedCell.x}, {selectedCell.y})</b> 선택됨 — 추가 버튼 누르면 여기에 배치
            </div>
          )}
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            새 공간 추가
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => addStall('office')} disabled={busy}>
              <Plus className="w-3 h-3" /> 사무실
            </Button>
            <Button variant="outline" size="sm" onClick={() => addStall('parking')} disabled={busy}>
              <Plus className="w-3 h-3" /> 주차칸
            </Button>
          </div>

          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mt-3 mb-2">
            시설 추가
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" size="sm" onClick={() => addDecor('pillar')} disabled={busy}>
              <Box className="w-3 h-3" /> 기둥
            </Button>
            <Button variant="outline" size="sm" onClick={() => addDecor('elevator')} disabled={busy}>
              <Box className="w-3 h-3" /> 엘리베이터
            </Button>
            <Button variant="outline" size="sm" onClick={() => addDecor('stairs')} disabled={busy}>
              <ArrowUpRight className="w-3 h-3" /> 계단
            </Button>
            <Button variant="outline" size="sm" onClick={() => addDecor('restroom')} disabled={busy}>
              <DoorOpen className="w-3 h-3" /> 화장실
            </Button>
            <Button variant="outline" size="sm" onClick={() => addDecor('ramp')} disabled={busy}>
              <ArrowUpRight className="w-3 h-3" /> 램프
            </Button>
            <Button variant="outline" size="sm" onClick={() => addDecor('entrance')} disabled={busy}>
              <DoorOpen className="w-3 h-3" /> 출입구
            </Button>
          </div>
        </div>
      )}

      {/* 다중 선택 */}
      {multi && (
        <div className="space-y-3">
          <div className="bg-zinc-900 text-white rounded-lg p-3">
            <div className="text-[14px] font-bold mb-0.5">
              {selectedList.length}개 선택됨
            </div>
            <div className="text-[10.5px] text-zinc-300">
              사무실 {selectedList.filter((s) => s.type === 'office').length} ·
              주차 {selectedList.filter((s) => s.type === 'parking').length}
            </div>
            {selectedList.some((s) => s.section_id) && (
              <div className="text-[10.5px] text-amber-300 mt-1">
                ※ 이미 블럭에 속한 칸 포함
              </div>
            )}
          </div>
          {canEdit && (
            <>
              {/* 주차칸이 포함되어 있으면 블럭 묶기 / 해제 */}
              {selectedList.some((s) => s.type === 'parking') && (
                <>
                  {selectedList.some((s) => s.type === 'parking' && s.section_id) ? (
                    <Button variant="outline" size="sm" onClick={ungroupSection} disabled={busy} className="w-full">
                      블럭 해제
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={groupAsSection} disabled={busy} className="w-full">
                      📦 블럭으로 묶기
                    </Button>
                  )}
                </>
              )}
              <Button variant="outline" size="sm" onClick={duplicateMulti} disabled={busy} className="w-full">
                <Copy className="w-3 h-3" /> 묶음 옆에 복제
              </Button>
              <Button variant="danger" size="sm" onClick={removeMulti} disabled={busy} className="w-full">
                <Trash2 className="w-3 h-3" /> 묶음 삭제
              </Button>
              <div className="text-[11px] text-zinc-500 text-center">
                Shift+클릭으로 선택 변경
              </div>
            </>
          )}
        </div>
      )}

      {/* 단일 선택 */}
      {single && !multi && (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
            선택 공간
          </div>

          <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="font-bold text-[14px]">{single.id}</div>
              <StatusBadge state={getStallState(single.id, leases, billings, config, today).state} />
            </div>
            <div className="text-[11px] text-zinc-500">
              {single.type === 'office' ? '사무실' : '주차공간'} · {single.area}㎡
            </div>
            {(() => {
              const r = getStallState(single.id, leases, billings, config, today);
              const t = r.lease ? tenants.find((x) => x.id === r.lease!.tenant_id) : null;
              return t ? (
                <div className="text-[11px] text-zinc-700 mt-1.5 pt-1.5 border-t border-zinc-200">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-zinc-500">{r.lease!.start} ~ {r.lease!.end}</div>
                </div>
              ) : null;
            })()}
          </div>

          {canEdit && (
            <>
              <Field label="코드">
                <input className="input" value={single.code} onChange={(e) => patch({ code: e.target.value })} />
              </Field>

              {single.layout && (
                <>
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide pt-2">
                    위치 · 크기
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                    <div>X = {single.layout.x}</div>
                    <div>Y = {single.layout.y}</div>
                    <div>W = {single.layout.w}</div>
                    <div>H = {single.layout.h}</div>
                  </div>

                  <div className="grid grid-cols-3 gap-1 mt-1">
                    <span />
                    <Button size="sm" variant="ghost" onClick={() => patchLayout({ dy: -1 })}><ArrowUp className="w-3 h-3" /></Button>
                    <span />
                    <Button size="sm" variant="ghost" onClick={() => patchLayout({ dx: -1 })}><ArrowLeft className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={rotate}><RotateCw className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => patchLayout({ dx: 1 })}><ArrowRight className="w-3 h-3" /></Button>
                    <span />
                    <Button size="sm" variant="ghost" onClick={() => patchLayout({ dy: 1 })}><ArrowDown className="w-3 h-3" /></Button>
                    <span />
                  </div>

                  <div className="grid grid-cols-2 gap-1 mt-2">
                    <Button size="sm" variant="outline" onClick={() => patchLayout({ dw: -1 })}>가로 −</Button>
                    <Button size="sm" variant="outline" onClick={() => patchLayout({ dw: 1 })}>가로 ＋</Button>
                    <Button size="sm" variant="outline" onClick={() => patchLayout({ dh: -1 })}>세로 −</Button>
                    <Button size="sm" variant="outline" onClick={() => patchLayout({ dh: 1 })}>세로 ＋</Button>
                  </div>
                </>
              )}

              <div className="pt-3 border-t border-zinc-200 space-y-2">
                <Button variant="outline" size="sm" onClick={duplicateMulti} disabled={busy} className="w-full">
                  <Copy className="w-3 h-3" /> 옆에 복제
                </Button>
                <Button variant="danger" size="sm" onClick={remove} className="w-full">
                  <Trash2 className="w-3 h-3" /> 공간 삭제
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 빈 선택 */}
      {!single && !multi && (() => {
        const floorStalls = stalls.filter((s) => s.floor_id === floor.id);
        const offices = floorStalls.filter((s) => s.type === 'office');
        const parking = floorStalls.filter((s) => s.type === 'parking');
        const states = floorStalls.map((s) => getStallState(s.id, leases, billings, config, today));
        const occ = states.filter((r) => r.state !== 'vacant').length;
        const vacant = states.filter((r) => r.state === 'vacant').length;
        const overdue = states.filter((r) => r.state === 'overdue').length;
        const expiring = states.filter((r) => r.state === 'expiring').length;
        const reserved = states.filter((r) => r.state === 'reserved').length;
        const occRate = floorStalls.length ? Math.round((occ / floorStalls.length) * 100) : 0;
        const floorSections = sections.filter((sec) => sec.floor_id === floor.id);

        return (
          <div className="space-y-3">
            {/* 층 요약 */}
            <div className="bg-zinc-50 rounded-lg border border-zinc-200 p-3">
              <div className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                {floor.building}동 · {floor.label} 요약
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">사무실</span>
                  <span className="font-bold">{offices.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">주차칸</span>
                  <span className="font-bold">{parking.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">점유율</span>
                  <span className="font-bold text-green-700">{occRate}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">공실</span>
                  <span className="font-bold">{vacant}</span>
                </div>
                {floorSections.length > 0 && (
                  <div className="col-span-2 flex items-center justify-between pt-1.5 border-t border-zinc-200">
                    <span className="text-zinc-600">주차 블럭</span>
                    <span className="font-bold">{floorSections.length}개</span>
                  </div>
                )}
              </div>
            </div>

            {/* 상태별 분포 */}
            {(overdue + expiring + reserved) > 0 && (
              <div className="space-y-1.5">
                {overdue > 0 && (
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-md text-[11.5px]">
                    <span className="text-red-700 font-medium">연체</span>
                    <span className="text-red-700 font-bold">{overdue}</span>
                  </div>
                )}
                {expiring > 0 && (
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-md text-[11.5px]">
                    <span className="text-amber-800 font-medium">만료예정</span>
                    <span className="text-amber-800 font-bold">{expiring}</span>
                  </div>
                )}
                {reserved > 0 && (
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-orange-50 border border-orange-200 rounded-md text-[11.5px]">
                    <span className="text-orange-800 font-medium">입점예정</span>
                    <span className="text-orange-800 font-bold">{reserved}</span>
                  </div>
                )}
              </div>
            )}

            {/* 블럭 목록 */}
            {floorSections.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">
                  주차 블럭
                </div>
                <div className="space-y-1">
                  {floorSections.map((sec) => {
                    const count = stalls.filter((s) => s.section_id === sec.id).length;
                    return (
                      <div
                        key={sec.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11.5px] border"
                        style={{ borderColor: sec.color, backgroundColor: sec.color + '15' }}
                      >
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: sec.color }} />
                        <span className="font-semibold flex-1 truncate">[{sec.code}] {sec.name}</span>
                        <span className="text-zinc-600">{count}칸</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 사용 안내 */}
            <div className="text-[10.5px] text-zinc-500 text-center pt-3 border-t border-zinc-100">
              {mode === 'edit'
                ? '박스 클릭 = 선택 · Shift+클릭 = 다중 · 빈 셀 클릭 = 위치 지정'
                : '박스 클릭하면 점유 상사·계약 정보 표시'}
            </div>
          </div>
        );
      })()}

      <style jsx>{`
        .input {
          width: 100%;
          border: 1px solid #e4e4e7;
          border-radius: 5px;
          padding: 5px 8px;
          font-size: 12px;
          background: white;
        }
        .input:focus { outline: none; border-color: #2563eb; }
      `}</style>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10.5px] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
