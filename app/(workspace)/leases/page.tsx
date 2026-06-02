'use client';

import { useState, useMemo } from 'react';
import { Plus, Upload, CalendarClock } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { Button } from '@/components/Button';
import { NewLeaseDialog } from '@/components/NewLeaseDialog';
import { LeaseUploadDialog } from '@/components/LeaseUploadDialog';
import { LeaseDetailDialog } from '@/components/LeaseDetailDialog';
import { TempAssignmentDialog } from '@/components/TempAssignmentDialog';
import { PageHeader } from '@/components/list/PageHeader';
import { ListToolbar } from '@/components/list/ListToolbar';
import { DataCard, stdTheadCls, stdTrCls, thCls, tdCls } from '@/components/list/DataCard';
import { StateBadge as StdBadge, type BadgeTone } from '@/components/list/StateBadge';
import { fmtMoney, fmtDate, addDays, daysBetween } from '@/lib/utils';
import type { Lease, Stall, Floor, ParkingSection, Tenant } from '@/lib/types';

type RowKind = 'lease' | 'vacant-office' | 'vacant-section';
type RowState = 'occupied' | 'vacant' | 'reserved' | 'expiring' | 'overdue';

interface ParkingBlock {
  sectionId?: string;          // 블럭이면 있음, 개별 묶음이면 undefined
  sectionName: string;         // 'B블럭' 또는 '개별'
  floorLabel: string;
  stalls: Stall[];
}

interface Row {
  key: string;
  kind: RowKind;
  state: RowState;
  sortKey: string;
  floorLabel: string;
  // lease 행
  lease?: Lease;
  tenant?: Tenant;
  officeStalls?: Stall[];      // 이 lease가 가진 사무실들
  parkingBlocks?: ParkingBlock[]; // 블럭 단위로 묶인 주차
  monthly?: number;
  arrears?: number;
  // 공실 행
  vacantOffice?: Stall;
  vacantSection?: { section: ParkingSection; stalls: Stall[] };
}

type FilterValue =
  | 'all'
  | 'office-all' | 'office-occupied' | 'office-vacant'
  | 'parking-all' | 'parking-occupied' | 'parking-vacant'
  | 'reserved' | 'expiring' | 'overdue';

const FILTERS: { value: FilterValue | '__sep__'; label: string }[] = [
  { value: 'all',              label: '전체' },
  { value: '__sep__',          label: 'sep1' },
  { value: 'office-all',       label: '사무실 전체' },
  { value: 'office-occupied',  label: '사무실 임대중' },
  { value: 'office-vacant',    label: '사무실 공실' },
  { value: '__sep__',          label: 'sep2' },
  { value: 'parking-all',      label: '전시장 전체' },
  { value: 'parking-occupied', label: '전시장 임대중' },
  { value: 'parking-vacant',   label: '전시장 공실' },
  { value: '__sep__',          label: 'sep3' },
  { value: 'reserved',         label: '입점예정' },
  { value: 'expiring',         label: '만료예정' },
  { value: 'overdue',          label: '연체' },
];

export default function LeasesPage() {
  const { stalls, sections, leases, billings, tempAssignments, byId, index, floors, today, config } = useData();
  const [openNew, setOpenNew] = useState(false);
  const [openUpload, setOpenUpload] = useState(false);
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [openTempAssign, setOpenTempAssign] = useState(false);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [q, setQ] = useState('');

  const rows: Row[] = useMemo(() => {
    const expDays = (config as any).expiring_window_days ?? 30;
    const todayStr = fmtDate(today);
    const expCutoffStr = fmtDate(addDays(today, expDays));

    function floorLabel(f: Floor): string {
      return `${f.building}동 ${f.label.replace(/\s*\([^)]*\)/, '')}`;
    }
    function arrearsFor(leaseId: string): number {
      return (index.billingsByLease.get(leaseId) || [])
        .reduce((s, b) => s + (b.total - (b.paid_amount || 0)), 0);
    }

    const out: Row[] = [];

    // 1) lease 단위 행
    const occupiedOfficeIds = new Set<string>();
    const occupiedSectionIds = new Set<string>();
    const occupiedParkingStallIds = new Set<string>();

    for (const l of leases) {
      if (l.status !== 'active') continue;
      const isReserved = l.start > todayStr;
      const isPast = l.end < todayStr;
      if (isPast) continue;

      const officeStalls = (l.office_stall_ids || [])
        .map((id) => byId.stall.get(id))
        .filter((s): s is Stall => !!s);

      // 주차칸 블럭 단위로 묶기: section 단위 + 개별 stall (층별 묶음)
      const blocksMap = new Map<string, ParkingBlock>();
      const handledStallIds = new Set<string>();
      for (const sid of l.section_ids || []) {
        const sec = byId.section.get(sid);
        if (!sec) continue;
        const secStalls = (index.stallsBySection.get(sid) || []).slice()
          .sort((a, b) => a.code.localeCompare(b.code));
        const f = byId.floor.get(sec.floor_id);
        blocksMap.set(sid, {
          sectionId: sid,
          sectionName: sec.name,
          floorLabel: f ? floorLabel(f) : '?',
          stalls: secStalls,
        });
        for (const s of secStalls) {
          handledStallIds.add(s.id);
          occupiedParkingStallIds.add(s.id);
        }
        occupiedSectionIds.add(sid);
      }
      // section에 안 묶인 개별 주차칸 → 층별 '개별' 묶음
      for (const id of l.stall_ids) {
        const s = byId.stall.get(id);
        if (!s || s.type !== 'parking' || !s.floor_id) continue;
        if (handledStallIds.has(s.id)) continue;
        const key = `loose-${s.floor_id}`;
        const f = byId.floor.get(s.floor_id);
        const existing = blocksMap.get(key);
        if (existing) {
          existing.stalls.push(s);
        } else {
          blocksMap.set(key, {
            sectionName: '개별',
            floorLabel: f ? floorLabel(f) : '?',
            stalls: [s],
          });
        }
        occupiedParkingStallIds.add(s.id);
      }
      const parkingBlocks = Array.from(blocksMap.values())
        .map((b) => ({ ...b, stalls: b.stalls.slice().sort((a, c) => a.code.localeCompare(c.code)) }))
        .sort((a, b) =>
          a.floorLabel.localeCompare(b.floorLabel) || a.sectionName.localeCompare(b.sectionName)
        );

      officeStalls.forEach((s) => occupiedOfficeIds.add(s.id));

      const tenant = byId.tenant.get(l.tenant_id);
      const arrears = arrearsFor(l.id);

      let state: RowState = 'occupied';
      if (isReserved) state = 'reserved';
      else if (arrears > 0) state = 'overdue';
      else if (l.end <= expCutoffStr) state = 'expiring';

      // 정렬키: 첫 사무실 코드 → 없으면 첫 섹션
      const firstOffice = officeStalls[0];
      const firstFloor = firstOffice
        ? (firstOffice.floor_id ? byId.floor.get(firstOffice.floor_id) : undefined)
        : byId.floor.get(byId.section.get(l.section_ids?.[0] || '')?.floor_id || '');
      const flbl = firstFloor ? floorLabel(firstFloor) : '?';
      const sortKey = `${String(firstFloor?.order ?? 99).padStart(2, '0')}-${firstOffice?.code || 'Z' + (l.section_ids?.[0] || '')}`;

      out.push({
        key: `L-${l.id}`,
        kind: 'lease',
        state,
        sortKey,
        floorLabel: flbl,
        lease: l,
        tenant,
        officeStalls,
        parkingBlocks,
        monthly: l.rent_total + l.maint_total,
        arrears,
      });
    }

    // 2) 공실 사무실
    for (const s of stalls) {
      if (s.type !== 'office') continue;
      if (occupiedOfficeIds.has(s.id)) continue;
      if (!s.floor_id) continue;
      const f = byId.floor.get(s.floor_id);
      if (!f) continue;
      out.push({
        key: `VO-${s.id}`,
        kind: 'vacant-office',
        state: 'vacant',
        sortKey: `${String(f.order ?? 99).padStart(2, '0')}-${s.code}`,
        floorLabel: floorLabel(f),
        vacantOffice: s,
      });
    }

    // 3) 공실 주차블럭
    for (const sec of sections) {
      if (occupiedSectionIds.has(sec.id)) continue;
      const f = byId.floor.get(sec.floor_id);
      if (!f) continue;
      const secStalls = (index.stallsBySection.get(sec.id) || [])
        .filter((s) => !occupiedParkingStallIds.has(s.id));
      if (secStalls.length === 0) continue;
      out.push({
        key: `VS-${sec.id}`,
        kind: 'vacant-section',
        state: 'vacant',
        sortKey: `${String(f.order ?? 99).padStart(2, '0')}-Z-${sec.code}`,
        floorLabel: floorLabel(f),
        vacantSection: { section: sec, stalls: secStalls },
      });
    }

    return out.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [stalls, sections, leases, byId, index, today, config]);

  const counts = useMemo(() => {
    // 공간 단위 카운트 (실/면)
    const todayStr = fmtDate(today);
    const occupiedStallIds = new Set<string>();
    for (const l of leases) {
      if (l.status !== 'active') continue;
      if (l.start > todayStr || l.end < todayStr) continue;
      l.stall_ids.forEach((id) => occupiedStallIds.add(id));
    }
    const officeStalls = stalls.filter((s) => s.type === 'office');
    const parkingStalls = stalls.filter((s) => s.type === 'parking');
    const officeOccupied = officeStalls.filter((s) => occupiedStallIds.has(s.id)).length;
    const parkingOccupied = parkingStalls.filter((s) => occupiedStallIds.has(s.id)).length;
    // 상태별 행 카운트
    let reserved = 0, expiring = 0, overdue = 0;
    for (const r of rows) {
      if (r.state === 'reserved') reserved++;
      else if (r.state === 'expiring') expiring++;
      else if (r.state === 'overdue') overdue++;
    }
    return {
      all: rows.length,
      'office-all': officeStalls.length,
      'office-occupied': officeOccupied,
      'office-vacant': officeStalls.length - officeOccupied,
      'parking-all': parkingStalls.length,
      'parking-occupied': parkingOccupied,
      'parking-vacant': parkingStalls.length - parkingOccupied,
      reserved, expiring, overdue,
    } as Record<string, number>;
  }, [rows, stalls, leases, today]);

  // 동·층별 요약: 사무실 X실 중 Y실 / 주차 X면 중 Y면
  const floorSummaries = useMemo(() => {
    return floors
      .slice()
      .sort((a, b) => a.building.localeCompare(b.building) || (a.order ?? 0) - (b.order ?? 0))
      .map((f) => {
        const fStalls = stalls.filter((s) => s.floor_id === f.id);
        const offices = fStalls.filter((s) => s.type === 'office');
        const parkings = fStalls.filter((s) => s.type === 'parking');
        // 현재 임대 중인 stall set
        const occupiedStallIds = new Set<string>();
        const todayStr = fmtDate(today);
        for (const l of leases) {
          if (l.status !== 'active') continue;
          if (l.start > todayStr || l.end < todayStr) continue;
          l.stall_ids.forEach((id) => occupiedStallIds.add(id));
        }
        const officeOccupied = offices.filter((s) => occupiedStallIds.has(s.id)).length;
        const parkingOccupied = parkings.filter((s) => occupiedStallIds.has(s.id)).length;
        return {
          floor: f,
          label: f.label.replace(/\s*\([^)]*\)/, ''),
          officeTotal: offices.length,
          officeOccupied,
          officeVacant: offices.length - officeOccupied,
          parkingTotal: parkings.length,
          parkingOccupied,
          parkingVacant: parkings.length - parkingOccupied,
        };
      })
      .filter((s) => s.officeTotal > 0 || s.parkingTotal > 0);
  }, [floors, stalls, leases, today]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // 사무실 그룹
      if (filter.startsWith('office-')) {
        if (r.kind === 'vacant-section') return false;
        if (r.kind === 'lease' && (r.officeStalls || []).length === 0) return false;
        if (filter === 'office-occupied' && r.kind !== 'lease') return false;
        if (filter === 'office-vacant' && r.kind !== 'vacant-office') return false;
        // office-all = lease(office) + vacant-office 모두 통과
      } else if (filter.startsWith('parking-')) {
        if (r.kind === 'vacant-office') return false;
        if (r.kind === 'lease' && (r.parkingBlocks || []).length === 0) return false;
        if (filter === 'parking-occupied' && r.kind !== 'lease') return false;
        if (filter === 'parking-vacant' && r.kind !== 'vacant-section') return false;
      } else if (filter === 'reserved' || filter === 'expiring' || filter === 'overdue') {
        if (r.state !== filter) return false;
      }
      if (q) {
        const k = q.toLowerCase();
        const haystack = [
          // 공간 코드/블럭명
          ...(r.officeStalls?.map((s) => s.code) || []),
          ...(r.parkingBlocks?.flatMap((b) => [b.sectionName, ...b.stalls.map((s) => s.code)]) || []),
          r.vacantOffice?.code,
          r.vacantSection?.section.code,
          r.vacantSection?.section.name,
          // 상사 정보 전체
          r.tenant?.name,
          r.tenant?.biz_no,
          r.tenant?.ceo,
          r.tenant?.phone,
          // 위치
          r.floorLabel,
        ].filter(Boolean).map((x) => String(x).toLowerCase());
        if (!haystack.some((c) => c.includes(k))) return false;
      }
      return true;
    });
  }, [rows, filter, q]);

  return (
    <div className="flex flex-col h-full space-y-5">
      <PageHeader
        title="임대 현황"
        subtitle={`사무실 ${counts['office-occupied']}/${counts['office-all']}실 (공실 ${counts['office-vacant']}) · 전시장 ${counts['parking-occupied']}/${counts['parking-all']}면 (공실 ${counts['parking-vacant']}) · 연체 ${counts.overdue}`}
        actions={
          <>
            <Button variant="outline" size="md" onClick={() => setOpenTempAssign(true)}>
              <CalendarClock className="w-3.5 h-3.5" /> 임시 전시장 배정
            </Button>
            <Button variant="outline" size="md" onClick={() => setOpenUpload(true)}>
              <Upload className="w-3.5 h-3.5" /> 엑셀로 한번에
            </Button>
            <Button variant="primary" size="md" onClick={() => setOpenNew(true)}>
              <Plus className="w-3.5 h-3.5" /> 신규 계약
            </Button>
          </>
        }
      />

      <ListToolbar
        search={{ value: q, onChange: setQ, placeholder: '호수 · 블럭 · 상사명 · 사업자번호 · 대표 · 전화 검색' }}
        filters={FILTERS}
        filterValue={filter}
        onFilterChange={(v) => setFilter(v as FilterValue)}
        counts={counts as Record<string, number>}
      />

      <DataCard>
        <table className="w-full text-[12.5px]">
          <thead className={stdTheadCls}>
            <tr>
              <th className={`${thCls.left} whitespace-nowrap w-[16%]`}>상사</th>
              <th className={`${thCls.left} w-[36%]`}>사무실 · 주차 블럭</th>
              <th className={thCls.center}>시작</th>
              <th className={thCls.center}>종료</th>
              <th className={thCls.center}>잔여</th>
              <th className={thCls.right}>사무실</th>
              <th className={thCls.right}>전시장</th>
              <th className={thCls.right}>임시전시장</th>
              <th className={thCls.right}>공급가액</th>
              <th className={thCls.right}>미수</th>
              <th className={thCls.center}>상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <RowView key={r.key} row={r} onClickLease={(id) => setOpenDetail(id)} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-10 text-zinc-400 text-[12px]">
                  해당하는 공간이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataCard>

      <NewLeaseDialog open={openNew} onClose={() => setOpenNew(false)} />
      <LeaseUploadDialog open={openUpload} onClose={() => setOpenUpload(false)} />
      <LeaseDetailDialog
        open={!!openDetail}
        onClose={() => setOpenDetail(null)}
        leaseId={openDetail}
      />
      <TempAssignmentDialog open={openTempAssign} onClose={() => setOpenTempAssign(false)} />
    </div>
  );
}

function RowView({ row, onClickLease }: { row: Row; onClickLease: (id: string) => void }) {
  const { today, tempAssignments } = useData();
  const isVacant = row.state === 'vacant';
  const clickable = !!row.lease;

  return (
    <tr
      onClick={() => row.lease && onClickLease(row.lease.id)}
      className={`border-b border-zinc-100 last:border-0 align-middle ${
        isVacant ? 'bg-zinc-50/40 hover:bg-zinc-100/60' : 'hover:bg-zinc-50/80'
      } ${clickable ? 'cursor-pointer' : ''}`}
    >
      {/* 상사 */}
      <td className="py-2 px-4 whitespace-nowrap">
        {row.tenant ? (
          <>
            <div className="font-semibold leading-tight">{row.tenant.name}</div>
            <div className="text-[10.5px] text-zinc-500 leading-tight mt-0.5">
              <span className="tabular">{row.tenant.biz_no}</span>
              <span className="text-zinc-300"> · </span>
              {row.tenant.ceo}
            </div>
          </>
        ) : (
          <span className="text-[11.5px] text-zinc-400">— 공실 —</span>
        )}
      </td>

      {/* 사무실 + 주차 (한 줄) */}
      <td className="py-2 px-4">
        {row.kind === 'lease' && (() => {
          const totalParking = (row.parkingBlocks || []).reduce((s, b) => s + b.stalls.length, 0);
          const offices = row.officeStalls!.map((s) => ({
            key: `o-${s.id}`,
            label: `${s.code}호`,
            sub: row.floorLabel,
          }));
          const parkings = (row.parkingBlocks || []).map((b, i) => ({
            key: `p-${i}`,
            label: `${b.sectionName} ${b.stalls.length}면`,
            sub: b.floorLabel,
          }));
          // 활성 임시 전시장 (이 상사의 today 시점 활성)
          const todayStr = fmtDate(today);
          const activeTemps = tempAssignments.filter(
            (a) => a.status === 'active'
              && a.tenant_id === row.lease!.tenant_id
              && a.start <= todayStr && a.end >= todayStr
          );
          const tempCount = activeTemps.reduce((s, a) => s + a.stall_ids.length, 0);
          const tempRent = activeTemps.reduce((s, a) => s + a.rent, 0);
          return (
            <CombinedSpaceRow
              offices={offices}
              parkings={parkings}
              totalParking={totalParking}
              tempParking={tempCount > 0 ? { count: tempCount, rent: tempRent } : undefined}
            />
          );
        })()}
        {row.kind === 'vacant-office' && (
          <CombinedSpaceRow
            offices={[{ key: row.vacantOffice!.id, label: `${row.vacantOffice!.code}호`, sub: row.floorLabel }]}
            parkings={[]}
            totalParking={0}
            vacant
          />
        )}
        {row.kind === 'vacant-section' && (
          <CombinedSpaceRow
            offices={[]}
            parkings={[{
              key: row.vacantSection!.section.id,
              label: `${row.vacantSection!.section.name} ${row.vacantSection!.stalls.length}면`,
              sub: row.floorLabel,
            }]}
            totalParking={row.vacantSection!.stalls.length}
            vacant
          />
        )}
      </td>

      {/* 시작 */}
      <td className="py-3 px-3 text-center text-[11.5px] tabular whitespace-nowrap text-zinc-700">
        {row.lease ? row.lease.start : <span className="text-zinc-300">—</span>}
      </td>
      {/* 종료 */}
      <td className="py-3 px-3 text-center text-[11.5px] tabular whitespace-nowrap text-zinc-700">
        {row.lease ? row.lease.end : <span className="text-zinc-300">—</span>}
      </td>
      {/* 잔여 */}
      <td className="py-3 px-3 text-center whitespace-nowrap">
        {row.lease ? <RemainingPill start={row.lease.start} end={row.lease.end} /> : <span className="text-zinc-300">—</span>}
      </td>

      {/* 사무실 / 전시장 / 임시전시장 각 1컬럼 */}
      {(() => {
        let officeRent = 0, parkingRent = 0, tempRent = 0;
        if (row.kind === 'lease') {
          officeRent = (row.officeStalls || []).reduce((s, x) => s + (x.rent || 0), 0);
          parkingRent = (row.parkingBlocks || []).reduce(
            (s, b) => s + b.stalls.reduce((acc, x) => acc + (x.rent || 0), 0),
            0
          );
          const todayStr = fmtDate(today);
          const activeTemps = tempAssignments.filter(
            (a) => a.status === 'active'
              && a.tenant_id === row.lease!.tenant_id
              && a.start <= todayStr && a.end >= todayStr
          );
          tempRent = activeTemps.reduce((s, a) => s + a.rent, 0);
        } else if (row.kind === 'vacant-office') {
          officeRent = row.vacantOffice!.rent || 0;
        } else {
          parkingRent = row.vacantSection!.stalls.reduce((s, x) => s + (x.rent || 0), 0)
            || row.vacantSection!.section.rent;
        }
        const vacantStyle = row.kind !== 'lease';
        const total = officeRent + parkingRent + tempRent;
        return (
          <>
            <td className={`py-2 px-4 text-right tabular ${vacantStyle ? 'text-zinc-400' : 'font-medium'}`}>
              {officeRent > 0 ? fmtMoney(officeRent) : <span className="text-zinc-300">—</span>}
            </td>
            <td className={`py-2 px-4 text-right tabular ${vacantStyle ? 'text-zinc-400' : 'font-medium'}`}>
              {parkingRent > 0 ? fmtMoney(parkingRent) : <span className="text-zinc-300">—</span>}
            </td>
            <td className="py-2 px-4 text-right tabular text-violet-700 font-medium">
              {tempRent > 0 ? fmtMoney(tempRent) : <span className="text-zinc-300">—</span>}
            </td>
            <td className={`py-2 px-4 text-right tabular ${vacantStyle ? 'text-zinc-400' : 'font-bold text-[13px]'}`}>
              {total > 0 ? fmtMoney(total) : <span className="text-zinc-300">—</span>}
            </td>
          </>
        );
      })()}

      {/* 미수 */}
      <td className={`py-3 px-4 text-right tabular ${
        (row.arrears || 0) > 0 ? 'text-red-600 font-bold' : 'text-zinc-300'
      }`}>
        {(row.arrears || 0) > 0 ? fmtMoney(row.arrears!) : '—'}
      </td>

      {/* 상태 */}
      <td className="py-3 px-4 text-center">
        <StateBadge state={row.state} />
      </td>
    </tr>
  );
}

interface CategoryItem {
  key: string;
  label: string;     // 박스 표시 텍스트 (예: '201호', 'A블럭 60면')
  sub: string;       // tooltip용 동·층
  rent?: number;     // 박스 안에 표시할 월 사용료
}

function CombinedSpaceRow({
  offices,
  parkings,
  totalParking,
  tempParking,
  vacant,
}: {
  offices: CategoryItem[];
  parkings: CategoryItem[];
  totalParking: number;
  tempParking?: { count: number; rent: number };
  vacant?: boolean;
}) {
  const MAX_OFFICE = 5;
  const MAX_PARKING = 4;
  const officeVisible = offices.slice(0, MAX_OFFICE);
  const officeHidden = offices.length - officeVisible.length;
  const parkingVisible = parkings.slice(0, MAX_PARKING);
  const parkingHidden = parkings.length - parkingVisible.length;

  const officeCls = vacant
    ? 'bg-zinc-50 border-zinc-200 border-dashed text-zinc-500'
    : 'bg-blue-50 border-blue-300 text-blue-800';
  const parkingCls = vacant
    ? 'bg-zinc-50 border-zinc-200 border-dashed text-zinc-500'
    : 'bg-amber-50 border-amber-300 text-amber-800';

  if (offices.length === 0 && parkings.length === 0) {
    return <span className="text-[10.5px] text-zinc-400">공간 없음</span>;
  }

  return (
    <div className="flex items-center gap-1 flex-nowrap whitespace-nowrap">
      {officeVisible.map((it) => (
        <span
          key={it.key}
          title={`${it.sub} · ${it.label}`}
          className={`shrink-0 inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular ${officeCls}`}
        >
          {it.label}
        </span>
      ))}
      {officeHidden > 0 && (
        <span className="shrink-0 inline-block px-1.5 py-0.5 rounded border border-zinc-200 bg-zinc-50 text-zinc-600 text-[11px] font-medium">
          외 {officeHidden}
        </span>
      )}
      {offices.length > 0 && parkings.length > 0 && (
        <span className="shrink-0 text-zinc-300 px-1">·</span>
      )}
      {parkingVisible.map((it) => (
        <span
          key={it.key}
          title={`${it.sub} · ${it.label}`}
          className={`shrink-0 inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular ${parkingCls}`}
        >
          {it.label}
        </span>
      ))}
      {parkingHidden > 0 && (
        <span className="shrink-0 inline-block px-1.5 py-0.5 rounded border border-zinc-200 bg-zinc-50 text-zinc-600 text-[11px] font-medium">
          외 {parkingHidden}
        </span>
      )}
      {totalParking > 0 && (
        <span className="shrink-0 text-[10.5px] text-zinc-600 tabular font-semibold ml-1">
          총 {totalParking}면
        </span>
      )}
      {tempParking && tempParking.count > 0 && (
        <>
          <span className="shrink-0 text-zinc-300 px-1">·</span>
          <span
            className="shrink-0 inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular bg-violet-50 border-violet-300 text-violet-800"
            title="임시 전시장"
          >
            임시 {tempParking.count}면
          </span>
        </>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  summary,
  items,
  vacant,
}: {
  category: 'office' | 'parking';
  summary: string;
  items: CategoryItem[];
  vacant?: boolean;
}) {
  const MAX_SHOW = 6;
  const visible = items.slice(0, MAX_SHOW);
  const hidden = items.length - visible.length;

  const tagCls = category === 'office'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-amber-100 text-amber-700';
  const tagLabel = category === 'office' ? '사무실' : '주차';

  // 사무실 = 호수 뱃지만 (라벨/요약 X)
  if (category === 'office') {
    const itemCls = vacant
      ? 'bg-zinc-50 border-zinc-200 border-dashed text-zinc-500'
      : 'bg-blue-50 border-blue-300 text-blue-800';
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {visible.map((it) => (
          <span
            key={it.key}
            title={`${it.sub} · ${it.label}`}
            className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular whitespace-nowrap ${itemCls}`}
          >
            {it.label}
          </span>
        ))}
        {hidden > 0 && (
          <span className="inline-block px-1.5 py-0.5 rounded border border-zinc-200 bg-zinc-50 text-zinc-600 text-[11px] font-medium whitespace-nowrap">
            외 {hidden}
          </span>
        )}
      </div>
    );
  }

  // 주차 = 블럭 뱃지 + 총 면수
  const itemCls = vacant
    ? 'bg-zinc-50 border-zinc-200 border-dashed text-zinc-500'
    : 'bg-amber-50 border-amber-300 text-amber-800';
  const totalFaces = items.reduce((s, it) => {
    const m = it.label.match(/(\d+)면/);
    return s + (m ? parseInt(m[1]) : 0);
  }, 0);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {visible.map((it) => (
        <span
          key={it.key}
          title={`${it.sub} · ${it.label}`}
          className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular whitespace-nowrap ${itemCls}`}
        >
          {it.label}
        </span>
      ))}
      {hidden > 0 && (
        <span className="inline-block px-1.5 py-0.5 rounded border border-zinc-200 bg-zinc-50 text-zinc-600 text-[11px] font-medium whitespace-nowrap">
          외 {hidden}
        </span>
      )}
      {totalFaces > 0 && (
        <span className="text-[10.5px] text-zinc-600 tabular font-semibold ml-1 whitespace-nowrap">
          총 {totalFaces}면
        </span>
      )}
    </div>
  );
}

function OfficeBox({ code, floorLabel, vacant }: { code: string; floorLabel: string; vacant?: boolean }) {
  return (
    <div
      className={`inline-flex flex-col items-center justify-center px-2 py-1 rounded border min-w-[68px] ${
        vacant
          ? 'bg-zinc-50 border-zinc-200 border-dashed text-zinc-400'
          : 'bg-blue-50 border-blue-300 text-blue-800'
      }`}
      title={floorLabel}
    >
      <span className="text-[9.5px] font-semibold opacity-70 whitespace-nowrap">
        {floorLabel}
      </span>
      <span className="text-[13px] font-bold tabular leading-tight">{code}호</span>
    </div>
  );
}

function ParkingBlockBox({ block, vacant }: { block: ParkingBlock; vacant?: boolean }) {
  const colorBase = vacant
    ? 'bg-zinc-50 border-zinc-200 border-dashed'
    : 'bg-amber-50 border-amber-300';
  const textBase = vacant ? 'text-zinc-500' : 'text-amber-800';
  return (
    <div
      className={`inline-flex flex-col items-center justify-center px-2 py-1 rounded border min-w-[78px] ${colorBase}`}
      title={`${block.floorLabel} · ${block.sectionName}`}
    >
      <span className={`text-[9.5px] font-semibold opacity-70 whitespace-nowrap ${textBase}`}>
        {block.floorLabel}
      </span>
      <span className={`text-[12.5px] font-bold leading-tight ${textBase}`}>
        {block.sectionName} <span className="font-semibold tabular">{block.stalls.length}면</span>
      </span>
    </div>
  );
}

function RemainingPill({ start, end }: { start: string; end: string }) {
  const { today } = useData();
  const todayStr = fmtDate(today);
  // 입점예정
  if (start > todayStr) {
    const days = daysBetween(todayStr, start);
    return (
      <span className="inline-block px-1.5 py-0.5 text-[10.5px] font-semibold rounded bg-orange-50 text-orange-700 border border-orange-200 tabular">
        D-{days}
      </span>
    );
  }
  const days = daysBetween(todayStr, end);
  if (days < 0) {
    return (
      <span className="inline-block px-1.5 py-0.5 text-[10.5px] font-semibold rounded bg-zinc-100 text-zinc-500 border border-zinc-200 tabular">
        만료
      </span>
    );
  }
  // 색상: 30일 이내 빨강, 90일 이내 황색, 그 외 회색
  const cls =
    days <= 30 ? 'bg-red-50 text-red-700 border-red-200'
    : days <= 90 ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
    : 'bg-zinc-50 text-zinc-600 border-zinc-200';
  // 30일 이내 → 일 단위, 그 외 → 개월
  const label = days <= 60 ? `${days}일` : `${Math.floor(days / 30)}개월`;
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10.5px] font-semibold rounded border tabular ${cls}`}>
      {label}
    </span>
  );
}

const STATE_BADGE: Record<RowState, { tone: BadgeTone; label: string }> = {
  occupied: { tone: 'green',  label: '임대중' },
  vacant:   { tone: 'zinc',   label: '공실' },
  reserved: { tone: 'orange', label: '입점예정' },
  expiring: { tone: 'yellow', label: '만료예정' },
  overdue:  { tone: 'red',    label: '연체' },
};

function StateBadge({ state }: { state: RowState }) {
  const { tone, label } = STATE_BADGE[state];
  return <StdBadge tone={tone}>{label}</StdBadge>;
}
