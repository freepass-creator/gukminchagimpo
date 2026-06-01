/**
 * 검증 헬퍼 — 데이터 무결성·중복·정합성 체크.
 * 모든 검증은 여기로 통일하여 곳곳에 흩어진 inline check 제거.
 */
import type { Stall, ParkingSection, Lease, Building } from './types';

/** Stall 코드 중복 검사 (동 기준) */
export function isStallCodeDuplicate(
  stalls: Stall[],
  building: Building,
  code: string,
  excludeId?: string
): boolean {
  return stalls.some(
    (s) => s.building === building && s.code === code && s.id !== excludeId
  );
}

/** Section 코드 중복 검사 (전체) */
export function isSectionCodeDuplicate(
  sections: ParkingSection[],
  code: string,
  excludeId?: string
): boolean {
  return sections.some((s) => s.code === code && s.id !== excludeId);
}

/** 같은 stall_id를 같은 기간 갖는 활성 lease가 있는지 */
export function hasOverlappingLease(
  leases: Lease[],
  stallId: string,
  start: string,
  end: string,
  excludeLeaseId?: string
): Lease[] {
  return leases.filter(
    (l) =>
      l.id !== excludeLeaseId &&
      l.status === 'active' &&
      l.stall_ids.includes(stallId) &&
      !(new Date(l.end) < new Date(start) || new Date(l.start) > new Date(end))
  );
}

/** Floor 안의 stall layout 무결성 — 그리드 밖, 음수, 0 이하 사이즈 검사 */
export interface LayoutIssue {
  stallId: string;
  reason: string;
}
export function findLayoutIssues(
  floor: { id: string; grid_cols: number; grid_rows: number },
  stalls: Stall[]
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const s of stalls) {
    if (s.floor_id !== floor.id || !s.layout) continue;
    const { x, y, w, h } = s.layout;
    if (x < 0 || y < 0) issues.push({ stallId: s.id, reason: '음수 좌표' });
    if (w <= 0 || h <= 0) issues.push({ stallId: s.id, reason: '0 이하 크기' });
    if (x + w > floor.grid_cols || y + h > floor.grid_rows)
      issues.push({ stallId: s.id, reason: '그리드 바깥' });
  }
  return issues;
}

/** 임대 계약 데이터 무결성 — 기간 / stall_ids 중복 */
export function validateLease(lease: Lease): string[] {
  const errs: string[] = [];
  if (!lease.tenant_id) errs.push('상사 미선택');
  if (!lease.stall_ids || lease.stall_ids.length === 0) errs.push('공간 미선택');
  if (!lease.start || !lease.end) errs.push('기간 미설정');
  else if (lease.end <= lease.start) errs.push('종료일이 시작일보다 이전');
  if (new Set(lease.stall_ids).size !== lease.stall_ids.length)
    errs.push('stall_ids 중복');
  if ((lease.rent_total || 0) < 0) errs.push('월세 음수');
  if ((lease.deposit || 0) < 0) errs.push('보증금 음수');
  return errs;
}
