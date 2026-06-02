'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { FilePlus2 } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { FloorMiniMap } from '@/components/FloorMiniMap';
import { FloorCanvas } from '@/components/FloorCanvas';
import { FloorPalette } from '@/components/FloorPalette';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/Button';
import { NewLeaseDialog } from '@/components/NewLeaseDialog';

export default function MapPage() {
  const { floors, stalls, sections } = useData();
  const { isAdmin } = useAuth();
  const searchParams = useSearchParams();
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [selectedStallIds, setSelectedStallIds] = useState<string[]>([]);
  const [openNewLease, setOpenNewLease] = useState(false);

  useEffect(() => {
    const q = searchParams.get('floor');
    if (q && floors.some((f) => f.id === q)) {
      setSelectedFloorId(q);
      return;
    }
    if (!selectedFloorId && floors.length > 0) {
      setSelectedFloorId([...floors].sort((a, b) => a.order - b.order)[0].id);
    }
  }, [floors, searchParams, selectedFloorId]);

  const floor = floors.find((f) => f.id === selectedFloorId);

  // 선택된 stall에서 사무실 / 주차블럭 분리
  const { selectedOfficeIds, selectedSectionIds } = useMemo(() => {
    const officeIds: string[] = [];
    const secIds = new Set<string>();
    for (const id of selectedStallIds) {
      const s = stalls.find((x) => x.id === id);
      if (!s) continue;
      if (s.type === 'office') officeIds.push(s.id);
      else if (s.type === 'parking' && s.section_id) secIds.add(s.section_id);
    }
    return { selectedOfficeIds: officeIds, selectedSectionIds: Array.from(secIds) };
  }, [selectedStallIds, stalls]);

  const canCreateLease = selectedOfficeIds.length > 0 || selectedSectionIds.length > 0;

  return (
    <div className="-mx-7 -my-6 flex" style={{ height: 'calc(100vh - 56px)' }}>
      <FloorMiniMap
        selectedFloorId={selectedFloorId}
        onSelectFloor={(id) => { setSelectedFloorId(id); setSelectedStallIds([]); }}
      />

      <div className="flex-1 min-w-0 flex flex-col bg-zinc-50">
        <div className="h-12 px-5 border-b border-zinc-200 bg-white flex items-center gap-3 shrink-0">
          {floor ? (
            <>
              <div className="text-[13px] font-bold">
                {floor.building}동 · {floor.label}
              </div>
              <div className="text-[11px] text-zinc-500 tabular">
                {floor.grid_cols} × {floor.grid_rows} 셀
              </div>
              <div className="flex items-center gap-1 px-1.5 text-[11px] text-zinc-500">
                <StatusBadge state="vacant" />
                <StatusBadge state="active" />
                <StatusBadge state="overdue" />
                <StatusBadge state="expiring" />
                <StatusBadge state="reserved" />
              </div>
              <div className="ml-auto flex items-center gap-2">
                {canCreateLease && (
                  <span className="text-[11px] text-zinc-600 tabular">
                    선택: 사무실 {selectedOfficeIds.length}실 · 전시장 {selectedSectionIds.length}블럭
                  </span>
                )}
                <Button
                  variant={canCreateLease ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setOpenNewLease(true)}
                  disabled={!canCreateLease}
                >
                  <FilePlus2 className="w-3.5 h-3.5" /> 계약 생성
                </Button>
              </div>
            </>
          ) : (
            <div className="text-[12px] text-zinc-500">왼쪽에서 층을 선택하세요</div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {floor ? (
            <FloorCanvas
              floor={floor}
              mode="view"
              selectedIds={selectedStallIds}
              onSelect={(id, shiftKey) => {
                if (!id) { setSelectedStallIds([]); return; }
                if (shiftKey) {
                  setSelectedStallIds((arr) =>
                    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
                  );
                } else {
                  setSelectedStallIds([id]);
                }
              }}
              onMove={() => {}}
            />
          ) : (
            <div className="text-center text-[13px] text-zinc-400 py-20">
              {floors.length === 0
                ? isAdmin
                  ? '도면이 없습니다. 사이드바 "도면 만들기"에서 생성하세요.'
                  : '도면이 아직 만들어지지 않았습니다. 마스터에게 요청하세요.'
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
          mode="view"
        />
      )}

      <NewLeaseDialog
        open={openNewLease}
        onClose={() => { setOpenNewLease(false); setSelectedStallIds([]); }}
        defaultOfficeIds={selectedOfficeIds}
        defaultSectionIds={selectedSectionIds}
      />
    </div>
  );
}
