'use client';

import { useMemo } from 'react';
import { useData } from '@/lib/data-context';
import { fmtDate, fmtFloorLabel } from '@/lib/utils';
import type { Floor } from '@/lib/types';

interface Props {
  selectedFloorId: string | null;
  onSelectFloor: (id: string) => void;
}

/**
 * 단지 미니맵 — 건물을 층으로 쌓인 빌딩 형태로 표현.
 * 각 층 박스에 사무실/주차 점유 표시 (X / Y).
 */
export function FloorMiniMap({ selectedFloorId, onSelectFloor }: Props) {
  const { floors, stalls, leases, today } = useData();

  // 동별 그룹 + 동 내 order asc (1층이 위, 지하가 아래)
  const buildings = Array.from(new Set(floors.map((f) => f.building))).sort();
  const grouped: Record<string, Floor[]> = {};
  for (const b of buildings) {
    grouped[b] = floors
      .filter((f) => f.building === b)
      .sort((a, c) => (a.order ?? 0) - (c.order ?? 0));
  }

  // 현재 임대 중인 stall set
  const occupiedStallIds = useMemo(() => {
    const todayStr = fmtDate(today);
    const set = new Set<string>();
    for (const l of leases) {
      if (l.status !== 'active') continue;
      if (l.start > todayStr || l.end < todayStr) continue;
      l.stall_ids.forEach((id) => set.add(id));
    }
    return set;
  }, [leases, today]);

  function summary(floorId: string) {
    const fStalls = stalls.filter((s) => s.floor_id === floorId);
    const offices = fStalls.filter((s) => s.type === 'office');
    const parkings = fStalls.filter((s) => s.type === 'parking');
    return {
      officeTotal: offices.length,
      officeOccupied: offices.filter((s) => occupiedStallIds.has(s.id)).length,
      parkingTotal: parkings.length,
      parkingOccupied: parkings.filter((s) => occupiedStallIds.has(s.id)).length,
    };
  }

  return (
    <div className="w-[200px] shrink-0 border-r border-zinc-200 bg-white overflow-y-auto py-4 px-3">
      <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        단지 미니맵
      </div>
      <div className="space-y-4">
        {buildings.map((b) => (
          <div key={b}>
            <div className="text-[12px] font-bold text-zinc-800 mb-1.5 text-center">
              {b}동
            </div>
            {/* 빌딩 stack — 층 박스 위아래로 붙임 */}
            <div className="border border-zinc-300 rounded-md overflow-hidden shadow-sm">
              {grouped[b].map((f, idx) => {
                const isSelected = selectedFloorId === f.id;
                const isFirst = idx === 0;
                const label = fmtFloorLabel(f, { withBuilding: false });
                const s = summary(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => onSelectFloor(f.id)}
                    className={`w-full px-2.5 py-2 flex flex-col items-center justify-center transition ${
                      isFirst ? '' : 'border-t border-zinc-300'
                    } ${
                      isSelected
                        ? 'bg-zinc-900 text-white'
                        : 'bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    <div className="text-[12.5px] font-bold leading-tight">{label}</div>
                    <div className={`text-[10px] mt-1 tabular leading-tight ${
                      isSelected ? 'text-zinc-300' : 'text-zinc-500'
                    }`}>
                      {s.officeTotal > 0 && (
                        <span>사무실 {s.officeOccupied}/{s.officeTotal}</span>
                      )}
                      {s.officeTotal > 0 && s.parkingTotal > 0 && (
                        <span className="opacity-60"> · </span>
                      )}
                      {s.parkingTotal > 0 && (
                        <span>주차 {s.parkingOccupied}/{s.parkingTotal}</span>
                      )}
                      {s.officeTotal === 0 && s.parkingTotal === 0 && (
                        <span className="opacity-60">공간 없음</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {buildings.length === 0 && (
          <div className="text-[11.5px] text-zinc-400 text-center py-6">
            동·층이 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
