'use client';

import { useData } from '@/lib/data-context';
import { Card, CardBody } from '@/components/Card';
import { PageHeader } from '@/components/list/PageHeader';
import { DataCard, stdTheadCls } from '@/components/list/DataCard';
import { addMonths, monthStart, monthEnd } from '@/lib/utils';
import { Building, Car } from 'lucide-react';

export default function TimelinePage() {
  const { stalls, leases, floors, today } = useData();
  const months: Date[] = [];
  for (let i = 0; i < 8; i++) {
    months.push(addMonths(monthStart(today), i));
  }

  // 동·층 정렬
  const sortedFloors = [...floors].sort(
    (a, b) => a.building.localeCompare(b.building) || a.order - b.order
  );

  /** 특정 stall이 특정 월에 점유 중인지 */
  function isOccupied(stallId: string, m: Date): boolean {
    const mStart = monthStart(m);
    const mEnd = monthEnd(m);
    return leases.some(
      (l) =>
        l.status === 'active' &&
        l.stall_ids.includes(stallId) &&
        new Date(l.start) <= mEnd &&
        new Date(l.end) >= mStart
    );
  }

  /** 특정 stall들 중 그 월에 점유된 수 */
  function countOccupied(stallIds: string[], m: Date): number {
    return stallIds.filter((id) => isOccupied(id, m)).length;
  }

  /** 점유율 → 색상 */
  function cellColor(occ: number, total: number) {
    if (total === 0) return { bg: '#f4f4f5', fg: '#a1a1aa' };
    const rate = occ / total;
    if (rate >= 0.9) return { bg: '#fef2f2', fg: '#b91c1c' };       // 거의 다 참
    if (rate >= 0.7) return { bg: '#fff7ed', fg: '#c2410c' };       // 70%+
    if (rate >= 0.4) return { bg: '#fefce8', fg: '#854d0e' };       // 보통
    if (rate > 0)    return { bg: '#f0fdf4', fg: '#15803d' };       // 여유
    return { bg: '#ecfdf5', fg: '#047857' };                         // 완전 비어
  }

  return (
    <div className="flex flex-col h-full space-y-5">
      <PageHeader
        title="가용성 스케줄"
        subtitle="미래 8개월 · 동별 층별로 사무실 N개 / 주차 N대 중 몇 개가 비는지 한눈에"
      />

      {/* 범례 */}
      <div className="flex items-center gap-3 text-[11px] text-zinc-600 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-100 border border-green-300" />
          여유 (0~40% 점유)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
          보통 (40~70%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-orange-100 border border-orange-300" />
          많음 (70~90%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-100 border border-red-300" />
          가득 (90%+)
        </span>
        <span className="ml-auto text-zinc-500">표시: <b className="text-zinc-700">공실 / 전체</b></span>
      </div>

      {sortedFloors.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-[12.5px] text-zinc-400">
            동·층이 없습니다 — 도면 만들기에서 먼저 생성하세요
          </CardBody>
        </Card>
      ) : (
        <DataCard scrollX>
              <table className="w-full border-collapse text-[12px]">
                <thead className={stdTheadCls}>
                  <tr>
                    <th className="sticky left-0 bg-zinc-50/95 px-3 py-2 text-left font-semibold border-r border-zinc-200 z-20 min-w-[180px]">
                      동 · 층
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-zinc-700 border-r border-zinc-200">
                      유형
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-zinc-700 border-r border-zinc-200">
                      전체
                    </th>
                    {months.map((m, i) => (
                      <th key={i} className="px-3 py-2 font-semibold text-zinc-700 min-w-[68px]">
                        {m.getFullYear().toString().slice(2)}.{String(m.getMonth() + 1).padStart(2, '0')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedFloors.map((f) => {
                    const floorStalls = stalls.filter((s) => s.floor_id === f.id);
                    const offices = floorStalls.filter((s) => s.type === 'office');
                    const parkings = floorStalls.filter((s) => s.type === 'parking');

                    const rows: { type: 'office' | 'parking'; stalls: typeof stalls; total: number }[] = [];
                    if (offices.length > 0) rows.push({ type: 'office', stalls: offices, total: offices.length });
                    if (parkings.length > 0) rows.push({ type: 'parking', stalls: parkings, total: parkings.length });

                    if (rows.length === 0) {
                      return (
                        <tr key={f.id} className="border-b border-zinc-100">
                          <td className="sticky left-0 bg-white px-3 py-2 border-r border-zinc-200 z-10">
                            <div className="font-semibold">{f.building}동</div>
                            <div className="text-[11px] text-zinc-500">{f.label}</div>
                          </td>
                          <td colSpan={2 + months.length} className="px-3 py-2 text-[11px] text-zinc-400 text-center">
                            공간 없음
                          </td>
                        </tr>
                      );
                    }

                    return rows.map((row, ridx) => (
                      <tr key={`${f.id}-${row.type}`} className="border-b border-zinc-100">
                        {ridx === 0 && (
                          <td
                            rowSpan={rows.length}
                            className="sticky left-0 bg-white px-3 py-2 border-r border-zinc-200 z-10 align-top"
                          >
                            <div className="font-semibold text-[12.5px]">{f.building}동</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5">{f.label}</div>
                          </td>
                        )}
                        <td className="px-3 py-2 text-center border-r border-zinc-100">
                          {row.type === 'office' ? (
                            <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                              <Building className="w-3 h-3" /> 사무실
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-violet-700 font-medium">
                              <Car className="w-3 h-3" /> 주차
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center tabular font-semibold border-r border-zinc-100">
                          {row.total}{row.type === 'office' ? '실' : '대'}
                        </td>
                        {months.map((m, i) => {
                          const occ = countOccupied(row.stalls.map((s) => s.id), m);
                          const free = row.total - occ;
                          const c = cellColor(occ, row.total);
                          return (
                            <td key={i} className="p-0">
                              <div
                                className="h-9 flex flex-col items-center justify-center gap-0 px-1"
                                style={{ backgroundColor: c.bg, color: c.fg }}
                                title={`${m.getFullYear()}.${String(m.getMonth() + 1).padStart(2, '0')} — 공실 ${free} / 전체 ${row.total}`}
                              >
                                <div className="text-[12px] font-bold tabular leading-none">{free}</div>
                                <div className="text-[9px] opacity-70 leading-none mt-0.5">/ {row.total}</div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
        </DataCard>
      )}

      <div className="text-[11px] text-zinc-500">
        ※ 각 셀의 숫자 = 해당 월의 <b>공실 수 / 전체 수</b>. 호버하면 자세한 정보 표시.
      </div>
    </div>
  );
}
