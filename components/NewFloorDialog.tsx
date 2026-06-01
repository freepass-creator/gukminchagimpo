'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Building, Car } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveFloor, saveStall, writeAudit } from '@/lib/data';
import { fmtDate } from '@/lib/utils';
import type { Floor, Stall, Building as BuildingT } from '@/lib/types';

/** 주차칸 표준 사이즈 (셀 단위 2×3) */
const PARKING_W = 2;
const PARKING_H = 3;

/** 자동 배치: 사무실 N개 + 주차 M개를 그리드에 깔끔히 채움 */
function autoLayout(
  officeCount: number, officeW: number, officeH: number,
  parkingCount: number,
  gridCols: number,
  gridRows: number,
) {
  const items: { type: 'office' | 'parking'; x: number; y: number; w: number; h: number }[] = [];

  // 사무실 영역
  let cy = 1;
  let cx = 1;
  for (let i = 0; i < officeCount; i++) {
    if (cx + officeW > gridCols) {
      cx = 1; cy += officeH + 1; // 1셀 통로
    }
    if (cy + officeH > gridRows) return items; // 더 못 넣음
    items.push({ type: 'office', x: cx, y: cy, w: officeW, h: officeH });
    cx += officeW + 1; // 사무실 간 1셀 간격
  }

  // 사무실 끝났으면 한 줄 비우고 주차 시작
  if (officeCount > 0) cy += officeH + 2; // 2셀 통로
  else cy = 1;
  cx = 1;

  for (let i = 0; i < parkingCount; i++) {
    if (cx + PARKING_W > gridCols) {
      cx = 1; cy += PARKING_H + 1;
    }
    if (cy + PARKING_H > gridRows) return items;
    items.push({ type: 'parking', x: cx, y: cy, w: PARKING_W, h: PARKING_H });
    cx += PARKING_W; // 주차는 붙여서
  }
  return items;
}

/**
 * 그리드 기본 50×50 고정.
 * 사무실/주차 개수가 많아도 그리드를 키우지 않음 — 박스 추가 시 그 안에서 배치되고,
 * 안 들어가는 순간 자동으로 그리드가 우측으로 확장됨 (lib/state.ts findSlotOrExpand).
 */
function recommendGrid(
  _officeCount: number, _officeW: number, _officeH: number,
  _parkingCount: number,
) {
  return { cols: 50, rows: 50 };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * 동이 지정되어 호출 → "X동에 새 층" 모드, 동 변경 불가.
   * undefined → "새 동 + 첫 층" 모드, 동 이름 입력 활성.
   */
  defaultBuilding?: string;
}

export function NewFloorDialog({ open, onClose, defaultBuilding }: Props) {
  const { floors, stalls, config, today } = useData();
  const { user } = useAuth();

  const isSingleMode = config.complex_layout === 'single';
  const singleBuildingId = config.single_building_label || '본관';

  const buildings = Array.from(new Set(floors.map((f) => f.building))).sort();
  // single 모드에서는 동 입력을 건너뛰고 본관 자동 사용
  const isNewBuildingMode = !isSingleMode && !defaultBuilding;

  const [building, setBuilding] = useState<string>(
    isSingleMode ? singleBuildingId : (defaultBuilding || '__new__')
  );
  const [newBuilding, setNewBuilding] = useState('');
  const [label, setLabel] = useState('1층');
  const [officeCount, setOfficeCount] = useState(8);
  const [officeW, setOfficeW] = useState(4);
  const [officeH, setOfficeH] = useState(5);
  const [parkingCount, setParkingCount] = useState(0);
  const [gridCols, setGridCols] = useState(50);
  const [gridRows, setGridRows] = useState(50);
  const [autoGrid, setAutoGrid] = useState(true);
  const [busy, setBusy] = useState(false);

  // 다이얼로그 열릴 때 초기화
  useEffect(() => {
    if (open) {
      if (isSingleMode) {
        setBuilding(singleBuildingId);
      } else {
        setBuilding(defaultBuilding || '__new__');
        if (!defaultBuilding) {
          const next = String.fromCharCode(65 + buildings.length); // A=65
          setNewBuilding(next > 'Z' ? '' : next);
        } else {
          setNewBuilding('');
        }
      }
      setOfficeCount(2);
      setOfficeW(3);
      setOfficeH(3);
      setParkingCount(0);
      setAutoGrid(true);
    }
  }, [open, defaultBuilding, buildings.join(','), isSingleMode, singleBuildingId]);

  /**
   * 층 번호 자동 추천 — 대상 동의 기존 층 수 + 1.
   * - 새 동 모드면 동 이름이 변할 때마다 다시 계산 (입력한 동에 이미 같은 이름이 있을 수도 있음)
   * - 기존 동에 추가면 그 동의 다음 층
   * 모달 처음 열릴 때 + 동/새동 이름 / floors 변화 시 발동.
   */
  useEffect(() => {
    if (!open) return;
    const target = isSingleMode
      ? singleBuildingId
      : (building === '__new__' ? newBuilding : building);
    if (!target) {
      setLabel('1층');
      return;
    }
    const sameFloors = floors.filter((f) => f.building === target);
    setLabel(`${sameFloors.length + 1}층`);
  }, [open, isSingleMode, singleBuildingId, building, newBuilding, floors.length]);

  // 자동 그리드 크기 권장
  useEffect(() => {
    if (autoGrid) {
      const r = recommendGrid(officeCount, officeW, officeH, parkingCount);
      setGridCols(r.cols);
      setGridRows(r.rows);
    }
  }, [autoGrid, officeCount, officeW, officeH, parkingCount]);

  const items = useMemo(
    () => autoLayout(officeCount, officeW, officeH, parkingCount, gridCols, gridRows),
    [officeCount, officeW, officeH, parkingCount, gridCols, gridRows]
  );
  const officePlaced = items.filter((x) => x.type === 'office').length;
  const parkingPlaced = items.filter((x) => x.type === 'parking').length;
  const overflowed = officePlaced < officeCount || parkingPlaced < parkingCount;

  const actualBuilding = building === '__new__' ? newBuilding.trim().toUpperCase() : building;

  async function submit() {
    if (!actualBuilding) { toast.error('동 이름을 입력하세요'); return; }
    if (!label.trim()) { toast.error('층 이름을 입력하세요'); return; }
    setBusy(true);
    try {
      // 같은 동의 다음 order
      const sameB = floors.filter((f) => f.building === actualBuilding);
      const order = sameB.length > 0 ? Math.max(...sameB.map((f) => f.order)) + 1 : floors.length;
      const floorId = `${actualBuilding}-F${order + 1}`;
      const floor: Floor = {
        id: floorId,
        building: actualBuilding as BuildingT,
        label: label.trim(),
        order,
        grid_cols: gridCols,
        grid_rows: gridRows,
        cell_size: 16,
        focus_type: parkingCount > officeCount ? 'parking' : 'office',
      };
      await saveFloor(floor);

      // 코드 자동 부여 시작 번호
      const existing = stalls.filter((s) => s.building === actualBuilding);
      const officeNums = existing.filter((s) => s.type === 'office')
        .map((s) => parseInt(s.code)).filter((n) => !isNaN(n));
      const parkingNums = existing.filter((s) => s.type === 'parking' && /^P\d+$/.test(s.code))
        .map((s) => parseInt(s.code.slice(1)));
      let nextOffice = officeNums.length ? Math.max(...officeNums) + 1
        : (actualBuilding === 'A' ? 201 : actualBuilding === 'B' ? 301 : 101);
      let nextParking = parkingNums.length ? Math.max(...parkingNums) + 1 : 1;

      let created = 0;
      for (const it of items) {
        const code = it.type === 'office'
          ? String(nextOffice++)
          : 'P' + String(nextParking++).padStart(2, '0');
        const stall: Stall = {
          id: `${actualBuilding}-${code}`,
          building: actualBuilding as BuildingT,
          type: it.type,
          code,
          area: it.type === 'office' ? officeW * officeH : PARKING_W * PARKING_H,
          rent: it.type === 'office' ? 1800000 : 250000,
          maint: it.type === 'office' ? 200000 : 30000,
          floor_id: floorId,
          layout: { x: it.x, y: it.y, w: it.w, h: it.h },
        };
        await saveStall(stall);
        created++;
      }

      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'floor_create_with_stalls',
        target: floorId,
        memo: `${actualBuilding}동 ${label} 신규 생성 (${officePlaced} 사무실 + ${parkingPlaced} 주차)`,
        at: fmtDate(today),
      });

      toast.success(`${actualBuilding}동 ${label} 생성 — ${created}개 공간 자동 배치 완료`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setBusy(false);
    }
  }

  const previewSize = 10;
  const pw = gridCols * previewSize;
  const ph = gridRows * previewSize;

  const dialogTitle = isSingleMode
    ? '새 층 만들기'
    : isNewBuildingMode
      ? '새 동 + 첫 층 만들기'
      : `${defaultBuilding}동에 새 층 추가`;
  const dialogDesc = isSingleMode
    ? '단일 건물 단지 · 새 층 + 공간 자동 배치'
    : isNewBuildingMode
      ? '단지에 새 동을 추가하면서 그 동의 첫 층까지 한 번에 만듭니다.'
      : '기존 동에 새 층을 추가 + 사무실/주차 자동 배치';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={dialogTitle}
      desc={dialogDesc}
      width={820}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? '생성 중...' :
              isNewBuildingMode ? '동 + 층 생성' : '층 생성 + 자동 배치'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr,280px] gap-5">
        {/* 입력 */}
        <div className="space-y-4">

          {/* 동 정보 — single 모드면 숨김 */}
          {!isSingleMode && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5">
              <div className="text-[11.5px] font-semibold text-blue-900 mb-2 uppercase tracking-wide">
                ① 동
              </div>
              {isNewBuildingMode ? (
                <div>
                  <label className="block text-[11.5px] font-semibold text-zinc-700 mb-1">
                    새 동 이름
                  </label>
                  <input
                    value={newBuilding}
                    onChange={(e) => setNewBuilding(e.target.value.toUpperCase())}
                    placeholder="예: A, B, C, 본관, 별관"
                    className="input"
                    autoFocus
                  />
                  <div className="text-[10.5px] text-zinc-500 mt-1">
                    현재 단지의 동: {buildings.length > 0 ? buildings.map((b) => `${b}동`).join(', ') : '없음 (이 동이 첫 동)'}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-bold text-[14px] text-blue-900">{defaultBuilding}동</div>
                  <div className="text-[10.5px] text-zinc-500 mt-0.5">
                    이미 {floors.filter((f) => f.building === defaultBuilding).length}개 층
                    {floors.filter((f) => f.building === defaultBuilding).length > 0 &&
                      ' (' + floors.filter((f) => f.building === defaultBuilding).map((f) => f.label).join(' · ') + ')'}
                  </div>
                </div>
              )}
            </div>
          )}

          {isSingleMode && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-[11.5px] text-blue-900">
              🏢 단일 건물 단지 ({singleBuildingId}) — 동 입력 없이 층만 만듭니다.
              <span className="text-zinc-500 ml-1">(단지 설정에서 다동으로 변경 가능)</span>
            </div>
          )}

          {/* 층 정보 */}
          <div>
            <div className="text-[11.5px] font-semibold text-zinc-600 mb-2 uppercase tracking-wide">
              {isSingleMode ? '① 층' : '② 층'}
            </div>
            <Field label="층 이름">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 1층, 2층, 지하주차, 옥상"
                className="input"
              />
            </Field>
          </div>

          {/* 사무실 */}
          <div className="text-[11.5px] font-semibold text-zinc-600 mb-1 uppercase tracking-wide">
            {isSingleMode ? '② 공간 자동 배치' : '③ 공간 자동 배치'}
          </div>
          <div className="bg-zinc-50 rounded-lg p-3.5 border border-zinc-200">
            <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-zinc-700 mb-2">
              <Building className="w-3.5 h-3.5" /> 사무실
            </div>
            <div className="grid grid-cols-[1fr,1fr,1.2fr] gap-2">
              <NumField label="가로 (셀)" value={officeW} onChange={setOfficeW} min={1} max={20} />
              <NumField label="세로 (셀)" value={officeH} onChange={setOfficeH} min={1} max={20} />
              <NumField label="개수" value={officeCount} onChange={setOfficeCount} min={0} max={100} />
            </div>
            <div className="text-[10.5px] text-zinc-500 mt-1.5">
              · 기본 2×2 (4셀). 큰·작은 사무실은 도면에서 개별로 크기 조정
            </div>
          </div>

          {/* 주차 — 개수만 */}
          <div className="bg-zinc-50 rounded-lg p-3.5 border border-zinc-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-zinc-700">
                <Car className="w-3.5 h-3.5" /> 주차칸
              </div>
              <div className="text-[10.5px] text-zinc-500">
                칸 사이즈 <b className="text-zinc-700">2 × 3 셀</b> (= 6셀, 고정)
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 mb-0.5">개수</div>
              <input
                type="number"
                value={parkingCount}
                min={0}
                max={1000}
                onChange={(e) => setParkingCount(parseInt(e.target.value) || 0)}
                className="w-full border border-zinc-200 rounded-md px-3 py-2 text-[15px] tabular text-center font-bold focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {/* 그리드 */}
          <div className="bg-white rounded-lg p-3 border border-zinc-200">
            <label className="flex items-center gap-2 mb-2 text-[12px] font-semibold text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoGrid}
                onChange={(e) => setAutoGrid(e.target.checked)}
              />
              그리드 크기 자동 계산
            </label>
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label={`그리드 가로 ${autoGrid ? '(자동)' : '(수동)'}`}
                value={gridCols} onChange={setGridCols}
                min={4} max={80} disabled={autoGrid}
              />
              <NumField
                label={`그리드 세로 ${autoGrid ? '(자동)' : '(수동)'}`}
                value={gridRows} onChange={setGridRows}
                min={4} max={80} disabled={autoGrid}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11.5px]">
            <span className="text-zinc-500">배치 결과:</span>
            <span className="font-semibold">사무실 {officePlaced}/{officeCount}</span>
            <span className="font-semibold">주차 {parkingPlaced}/{parkingCount}</span>
            {overflowed && (
              <span className="text-red-600 font-semibold">⚠ 그리드 부족 — 사이즈 ↑</span>
            )}
          </div>
        </div>

        {/* 미리보기 */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">미리보기</div>
          <div className="border border-zinc-200 rounded-md bg-white overflow-auto" style={{ maxWidth: 280 }}>
            <svg viewBox={`0 0 ${pw} ${ph}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
              <rect width={pw} height={ph} fill="#fafafa" />
              <g stroke="#e4e4e7" strokeWidth="0.3">
                {Array.from({ length: gridCols + 1 }).map((_, i) => (
                  <line key={`v${i}`} x1={i * previewSize} y1={0} x2={i * previewSize} y2={ph} />
                ))}
                {Array.from({ length: gridRows + 1 }).map((_, i) => (
                  <line key={`h${i}`} x1={0} y1={i * previewSize} x2={pw} y2={i * previewSize} />
                ))}
              </g>
              {items.map((it, i) => (
                <rect
                  key={i}
                  x={it.x * previewSize}
                  y={it.y * previewSize}
                  width={it.w * previewSize}
                  height={it.h * previewSize}
                  fill={it.type === 'office' ? '#bfdbfe' : '#e9d5ff'}
                  stroke={it.type === 'office' ? '#3b82f6' : '#9333ea'}
                  strokeWidth={0.6}
                  opacity={0.85}
                />
              ))}
            </svg>
          </div>
          <div className="text-[10.5px] text-zinc-500 mt-1.5">
            <span className="inline-block w-2 h-2 bg-blue-300 mr-1" />사무실
            <span className="inline-block w-2 h-2 bg-purple-300 ml-2 mr-1" />주차
          </div>
        </div>
      </div>

      <style jsx>{`
        .input, .select {
          width: 100%;
          border: 1px solid #e4e4e7;
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 13px;
          background: white;
        }
        .input:focus, .select:focus {
          outline: none; border-color: #2563eb;
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

function NumField({
  label, value, onChange, min, max, disabled,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 mb-0.5">{label}</div>
      <input
        type="number"
        value={value}
        min={min} max={max} disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className={`w-full border border-zinc-200 rounded-md px-2.5 py-1.5 text-[12.5px] tabular text-center focus:outline-none focus:border-zinc-500 ${
          disabled ? 'bg-zinc-100 text-zinc-400' : 'bg-white'
        }`}
      />
    </div>
  );
}
