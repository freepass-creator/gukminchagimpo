'use client';

import { useEffect, useState } from 'react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { FloorTree } from '@/components/FloorTree';
import { FloorCanvas } from '@/components/FloorCanvas';
import { FloorPalette } from '@/components/FloorPalette';
import { StatusBadge } from '@/components/StatusBadge';

export default function MapPage() {
  const { floors } = useData();
  const { isAdmin } = useAuth();
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [selectedStallIds, setSelectedStallIds] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedFloorId && floors.length > 0) {
      setSelectedFloorId([...floors].sort((a, b) => a.order - b.order)[0].id);
    }
  }, [floors, selectedFloorId]);

  const floor = floors.find((f) => f.id === selectedFloorId);

  return (
    <div className="-mx-7 -my-6 flex" style={{ height: 'calc(100vh - 56px)' }}>
      <FloorTree
        selectedFloorId={selectedFloorId}
        onSelectFloor={(id) => { setSelectedFloorId(id); setSelectedStallIds([]); }}
        editable={false}
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
              <div className="ml-auto flex items-center gap-1 px-1.5 text-[11px] text-zinc-500">
                <StatusBadge state="vacant" />
                <StatusBadge state="active" />
                <StatusBadge state="overdue" />
                <StatusBadge state="expiring" />
                <StatusBadge state="reserved" />
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
              onSelect={(id) => setSelectedStallIds(id ? [id] : [])}
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
    </div>
  );
}
