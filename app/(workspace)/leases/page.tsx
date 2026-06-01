'use client';

import { useState, useMemo } from 'react';
import { Plus, Upload } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { Button } from '@/components/Button';
import { NewLeaseDialog } from '@/components/NewLeaseDialog';
import { LeaseUploadDialog } from '@/components/LeaseUploadDialog';
import { LeaseDetailDialog } from '@/components/LeaseDetailDialog';
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

const FILTERS: { value: 'all' | RowState | 'office' | 'parking'; label: string }[] = [
  { value: 'all',      label: '전체' },
  { value: 'occupied', label: '임대중' },
  { value: 'vacant',   label: '공실' },
  { value: 'reserved', label: '입점예정' },
  { value: 'expiring', label: '만료예정' },
  { value: 'overdue',  label: '연체' },
];

export default function LeasesPage() {
  const { stalls, sections, leases, billings, byId, index, today, config } = useData();
  const [openNew, setOpenNew] = useState(false);
  const [openUpload, setOpenUpload] = useState(false);
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [filter, setFilter] = useState<typeof FILTERS[number]['value']>('all');
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
        if (!s || s.type !== 'parking') continue;
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
        ? byId.floor.get(firstOffice.floor_id)
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
    const c = { all: rows.length, occupied: 0, vacant: 0, reserved: 0, expiring: 0, overdue: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== 'all' && r.state !== filter) return false;
      if (q) {
        const k = q.toLowerCase();
        const codes = [
          ...(r.officeStalls?.map((s) => s.code) || []),
          r.vacantOffice?.code,
          r.vacantSection?.section.code,
          r.vacantSection?.section.name,
          r.tenant?.name,
        ].filter(Boolean).map((x) => String(x).toLowerCase());
        if (!codes.some((c) => c.includes(k))) return false;
      }
      return true;
    });
  }, [rows, filter, q]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="임대 현황"
        subtitle={`전체 ${rows.length} · 임대중 ${counts.occupied} · 공실 ${counts.vacant} · 연체 ${counts.overdue} · 만료예정 ${counts.expiring}`}
        actions={
          <>
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
        search={{ value: q, onChange: setQ, placeholder: '호수 · 블럭 · 상사명 검색' }}
        filters={FILTERS}
        filterValue={filter}
        onFilterChange={setFilter}
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
              <th className={thCls.right}>월 합계</th>
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
                <td colSpan={8} className="text-center py-10 text-zinc-400 text-[12px]">
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
    </div>
  );
}

function RowView({ row, onClickLease }: { row: Row; onClickLease: (id: string) => void }) {
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
      <td className="py-3 px-4 whitespace-nowrap">
        {row.tenant ? (
          <>
            <div className="font-semibold">{row.tenant.name}</div>
            <div className="text-[10.5px] text-zinc-500 tabular">{row.tenant.biz_no}</div>
            <div className="text-[10.5px] text-zinc-500">{row.tenant.ceo}</div>
          </>
        ) : (
          <span className="text-[11.5px] text-zinc-400">— 공실 —</span>
        )}
      </td>

      {/* 사무실 + 블럭(차량) (가로 죽) */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* lease 행 */}
          {row.kind === 'lease' && (() => {
            const totalParking = (row.parkingBlocks || []).reduce((s, b) => s + b.stalls.length, 0);
            return (
              <>
                {row.officeStalls!.map((s) => (
                  <OfficeBox key={s.id} code={s.code} floorLabel={row.floorLabel} />
                ))}
                {(row.parkingBlocks || []).length > 0 && (
                  <>
                    <span className="text-zinc-300 px-1">·</span>
                    {row.parkingBlocks!.map((b, i) => (
                      <ParkingBlockBox key={i} block={b} />
                    ))}
                    <span className="text-[11px] text-zinc-700 font-semibold ml-1 whitespace-nowrap">
                      총 {totalParking}면
                    </span>
                  </>
                )}
                {totalParking === 0 && row.officeStalls!.length > 0 && (
                  <span className="text-[10.5px] text-zinc-400 ml-1">진열공간 없음</span>
                )}
              </>
            );
          })()}
          {/* 공실 사무실 */}
          {row.kind === 'vacant-office' && (
            <OfficeBox code={row.vacantOffice!.code} floorLabel={row.floorLabel} vacant />
          )}
          {/* 공실 주차블럭 */}
          {row.kind === 'vacant-section' && (
            <ParkingBlockBox
              block={{
                sectionId: row.vacantSection!.section.id,
                sectionName: row.vacantSection!.section.name,
                floorLabel: row.floorLabel,
                stalls: row.vacantSection!.stalls,
              }}
              vacant
            />
          )}
        </div>
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

      {/* 월 합계 */}
      <td className="py-3 px-4 text-right tabular">
        {row.kind === 'lease' ? (
          <>
            <div className="font-semibold">{fmtMoney(row.monthly!)}</div>
            <div className="text-[10px] text-zinc-500">
              월 {fmtMoney(row.lease!.rent_total)} · 관 {fmtMoney(row.lease!.maint_total)}
            </div>
          </>
        ) : row.kind === 'vacant-office' ? (
          <div className="text-zinc-400">{fmtMoney(row.vacantOffice!.rent + row.vacantOffice!.maint)}</div>
        ) : (
          <div className="text-zinc-400">{fmtMoney(row.vacantSection!.section.rent + row.vacantSection!.section.maint)}</div>
        )}
      </td>

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

function OfficeBox({ code, floorLabel, vacant }: { code: string; floorLabel: string; vacant?: boolean }) {
  return (
    <div
      className={`inline-flex flex-col items-center justify-center px-2 py-1 rounded border min-w-[52px] ${
        vacant
          ? 'bg-zinc-50 border-zinc-200 border-dashed text-zinc-400'
          : 'bg-blue-50 border-blue-300 text-blue-800'
      }`}
      title={floorLabel}
    >
      <span className="text-[9.5px] uppercase tracking-wider font-semibold opacity-70">
        {floorLabel.split(' ')[0]}
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
      className={`inline-flex flex-col items-center justify-center px-2 py-1 rounded border min-w-[60px] ${colorBase}`}
      title={`${block.floorLabel} · ${block.sectionName}`}
    >
      <span className={`text-[9.5px] uppercase tracking-wider font-semibold opacity-70 ${textBase}`}>
        {block.floorLabel.split(' ')[0]}
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
