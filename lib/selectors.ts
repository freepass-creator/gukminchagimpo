/**
 * 도메인 derived 셀렉터 — 페이지 useMemo 안에서 한 번만 구축하고 lookup으로 활용.
 * 각 함수는 O(N) 한 패스로 Map을 빌드하며, 호출처는 .get(id)로 O(1) 조회.
 */

import type { Billing, Payment, BankTransaction, TempParkingAssignment, Tenant, Lease } from './types';

/**
 * 상사별 미수금 합계.
 * `arrears = total - paid_amount` 음수 처리는 0으로 클램프하지 않음(부분 환불·과수납 추적용).
 */
export function buildArrearsByTenant(billings: Billing[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of billings) {
    const owe = b.total - (b.paid_amount || 0);
    if (owe === 0) continue;
    map.set(b.tenant_id, (map.get(b.tenant_id) || 0) + owe);
  }
  return map;
}

/**
 * 상사별 누적 청구 합계.
 */
export function buildChargedByTenant(billings: Billing[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of billings) {
    map.set(b.tenant_id, (map.get(b.tenant_id) || 0) + b.total);
  }
  return map;
}

/**
 * 상사별 누적 수납 합계.
 */
export function buildPaidByTenant(billings: Billing[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of billings) {
    const paid = b.paid_amount || 0;
    if (paid === 0) continue;
    map.set(b.tenant_id, (map.get(b.tenant_id) || 0) + paid);
  }
  return map;
}

/**
 * 상사별 미납 건수 + 가장 오래된 미납 마감일.
 */
export function buildUnpaidStatsByTenant(
  billings: Billing[]
): Map<string, { unpaidCount: number; oldestDueDate: string | null }> {
  const map = new Map<string, { unpaidCount: number; oldestDueDate: string | null }>();
  for (const b of billings) {
    if (b.total - (b.paid_amount || 0) <= 0) continue;
    const cur = map.get(b.tenant_id) || { unpaidCount: 0, oldestDueDate: null };
    cur.unpaidCount += 1;
    if (!cur.oldestDueDate || b.due_date < cur.oldestDueDate) cur.oldestDueDate = b.due_date;
    map.set(b.tenant_id, cur);
  }
  return map;
}

/**
 * 상사별 최근 입금 통장 거래. 가장 큰 date 기준.
 */
export function buildLastDepositByTenant(bankTx: BankTransaction[]): Map<string, BankTransaction> {
  const map = new Map<string, BankTransaction>();
  for (const tx of bankTx) {
    if (!tx.matched_tenant_id || !(tx.deposit > 0)) continue;
    const cur = map.get(tx.matched_tenant_id);
    if (!cur || tx.date > cur.date) map.set(tx.matched_tenant_id, tx);
  }
  return map;
}

/**
 * 상사별 현재 활성 임시 전시장 배정들 (today 시점).
 */
export function buildActiveTempsByTenant(
  tempAssignments: TempParkingAssignment[],
  todayStr: string
): Map<string, TempParkingAssignment[]> {
  const map = new Map<string, TempParkingAssignment[]>();
  for (const a of tempAssignments) {
    if (a.status !== 'active') continue;
    if (a.start > todayStr || a.end < todayStr) continue;
    const arr = map.get(a.tenant_id) || [];
    arr.push(a);
    map.set(a.tenant_id, arr);
  }
  return map;
}

/**
 * 현재 활성 lease 기준 점유 stall_id 집합 (today 시점).
 * - 임시 전시장이 점유한 stall도 포함하려면 includeTempAssignments=true 전달.
 */
export function buildOccupiedStallIds(
  leases: Lease[],
  todayStr: string,
  tempAssignments?: TempParkingAssignment[]
): Set<string> {
  const set = new Set<string>();
  for (const l of leases) {
    if (l.status !== 'active') continue;
    if (l.start > todayStr || l.end < todayStr) continue;
    for (const id of l.stall_ids) set.add(id);
  }
  if (tempAssignments) {
    for (const a of tempAssignments) {
      if (a.status !== 'active') continue;
      if (a.start > todayStr || a.end < todayStr) continue;
      for (const id of a.stall_ids) set.add(id);
    }
  }
  return set;
}

/**
 * 한 상사의 활성 lease (today 시점, 시작 전 포함 X — reserved는 별도 필터 필요).
 */
export function pickActiveLeasesForTenant(
  tenantLeases: Lease[],
  todayStr: string
): { active: Lease[]; reserved: Lease[] } {
  const active: Lease[] = [];
  const reserved: Lease[] = [];
  for (const l of tenantLeases) {
    if (l.status !== 'active') continue;
    if (l.start <= todayStr && l.end >= todayStr) active.push(l);
    else if (l.start > todayStr) reserved.push(l);
  }
  return { active, reserved };
}

/**
 * 정렬 표준: 상사 활성 lease 중 가장 빠른 start (입점일), 활성 lease 중 가장 늦은 end (계약 종료).
 */
export function pickMoveInOut(active: Lease[]): { moveIn: string | null; moveOut: string | null } {
  if (active.length === 0) return { moveIn: null, moveOut: null };
  let moveIn = active[0].start;
  let moveOut = active[0].end;
  for (const l of active) {
    if (l.start < moveIn) moveIn = l.start;
    if (l.end > moveOut) moveOut = l.end;
  }
  return { moveIn, moveOut };
}

/** Tenant 검색 정합 — 표준 키워드 매칭 (이름/사업자/대표/전화) */
export function tenantMatchesQuery(t: Tenant | undefined, q: string): boolean {
  if (!t || !q) return !!t;
  const k = q.toLowerCase();
  return (
    t.name.toLowerCase().includes(k) ||
    t.biz_no.includes(q) ||
    t.ceo.includes(q) ||
    (t.phone || '').includes(q)
  );
}

/** 한 청구건의 미수금 (양수만, 음수=과수납은 0). */
export function billingOwe(b: Billing): number {
  return Math.max(0, b.total - (b.paid_amount || 0));
}

/** 한 청구건의 수납 완료 여부. */
export function isBillingPaid(b: Billing): boolean {
  return b.total - (b.paid_amount || 0) <= 0;
}
