import type {
  Stall,
  Lease,
  Billing,
  StallState,
  Config,
  Floor,
  Decor,
} from './types';
import { daysBetween } from './utils';

export const STATE_LABEL: Record<StallState, string> = {
  vacant: '공실',
  active: '계약중·정상',
  overdue: '계약중·연체',
  expiring: '만료예정',
  reserved: '입점예정',
};

export const STATE_TONE: Record<StallState, string> = {
  vacant: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  overdue: 'bg-red-50 text-red-700 border-red-200',
  expiring: 'bg-amber-50 text-amber-700 border-amber-200',
  reserved: 'bg-orange-50 text-orange-700 border-orange-200',
};

export interface StallStateResult {
  state: StallState;
  lease: Lease | null;
  futureLease?: Lease;
}

/**
 * 공간 상태 산출 — 계약·미수·일자로 실시간 자동 판단.
 * 별도 필드 저장이 아니라 derived state.
 *
 * ⚠️ 다수 stall을 화면에 그리는 경우(매트릭스/캔버스/대시보드)는 buildStallStateMap을 쓰는 게
 * 훨씬 빠릅니다 (O(L+B) 1회 + stall당 O(1) lookup).
 */
export function getStallState(
  stallId: string,
  leases: Lease[],
  billings: Billing[],
  config: Config,
  today: Date = new Date()
): StallStateResult {
  const activeLeases = leases.filter((l) => l.stall_ids.includes(stallId));

  const current = activeLeases.find(
    (l) =>
      l.status === 'active' &&
      new Date(l.start) <= today &&
      new Date(l.end) >= today
  );

  const future = activeLeases
    .filter((l) => l.status === 'active' && new Date(l.start) > today)
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  if (!current) {
    if (future) return { state: 'reserved', lease: future, futureLease: future };
    return { state: 'vacant', lease: null };
  }

  // 미수 확인
  const owed = billings
    .filter((b) => b.lease_id === current.id)
    .some((b) => b.total > (b.paid_amount || 0) && new Date(b.due_date) < today);
  if (owed) return { state: 'overdue', lease: current, futureLease: future };

  // 만료 임박
  const daysToExpire = daysBetween(today, current.end);
  if (daysToExpire <= config.expiring_threshold_days) {
    return { state: 'expiring', lease: current, futureLease: future };
  }

  return { state: 'active', lease: current, futureLease: future };
}

/**
 * 전체 stall에 대해 한 번에 state Map 빌드.
 * - L = leases 수, B = billings 수, S = stalls 수일 때 O(L + B + L×k) (k = lease당 stall_ids 길이)
 * - 호출처: stall마다 .get(id) O(1)
 */
export function buildStallStateMap(
  stalls: Stall[],
  leases: Lease[],
  billings: Billing[],
  config: Config,
  today: Date = new Date()
): Map<string, StallStateResult> {
  const todayMs = today.getTime();
  // 1) lease를 active(current) / future로 미리 분류 + stall별 인덱스
  const currentByStall = new Map<string, Lease>();
  const futureByStall = new Map<string, Lease>();
  for (const l of leases) {
    if (l.status !== 'active') continue;
    const startMs = new Date(l.start).getTime();
    const endMs = new Date(l.end).getTime();
    if (startMs <= todayMs && endMs >= todayMs) {
      for (const id of l.stall_ids) {
        // 같은 stall에 활성 lease가 여러 개면 첫 번째만 기록 (이상 데이터)
        if (!currentByStall.has(id)) currentByStall.set(id, l);
      }
    } else if (startMs > todayMs) {
      for (const id of l.stall_ids) {
        const prev = futureByStall.get(id);
        if (!prev || l.start < prev.start) futureByStall.set(id, l);
      }
    }
  }

  // 2) lease별 연체 여부 미리 계산 (over due billing 있나)
  const overdueLeaseIds = new Set<string>();
  for (const b of billings) {
    if (b.total <= (b.paid_amount || 0)) continue;
    if (new Date(b.due_date).getTime() >= todayMs) continue;
    overdueLeaseIds.add(b.lease_id);
  }

  // 3) stall마다 결과 판정 (O(1))
  const result = new Map<string, StallStateResult>();
  for (const s of stalls) {
    const current = currentByStall.get(s.id);
    const future = futureByStall.get(s.id);
    if (!current) {
      if (future) result.set(s.id, { state: 'reserved', lease: future, futureLease: future });
      else result.set(s.id, { state: 'vacant', lease: null });
      continue;
    }
    if (overdueLeaseIds.has(current.id)) {
      result.set(s.id, { state: 'overdue', lease: current, futureLease: future });
      continue;
    }
    const daysToExpire = daysBetween(today, current.end);
    if (daysToExpire <= config.expiring_threshold_days) {
      result.set(s.id, { state: 'expiring', lease: current, futureLease: future });
      continue;
    }
    result.set(s.id, { state: 'active', lease: current, futureLease: future });
  }
  return result;
}

/** 한 공간에 신규 계약 시 기간 충돌 검사 */
export function findConflicts(
  stallIds: string[],
  start: string,
  end: string,
  leases: Lease[]
): { stallId: string; lease: Lease }[] {
  const conflicts: { stallId: string; lease: Lease }[] = [];
  for (const sid of stallIds) {
    const overlap = leases.filter(
      (l) =>
        l.status === 'active' &&
        l.stall_ids.includes(sid) &&
        !(new Date(l.end) < new Date(start) || new Date(l.start) > new Date(end))
    );
    overlap.forEach((l) => conflicts.push({ stallId: sid, lease: l }));
  }
  return conflicts;
}


/**
 * 같은 층의 다른 공간과 겹치는지 검사.
 * - 자기 자신은 제외 (이동·리사이즈 시 자기 자신 자리 OK)
 * - AABB(축 정렬 사각형) 겹침 판정
 */
export function wouldOverlap(
  stallId: string | null,
  floorId: string,
  layout: { x: number; y: number; w: number; h: number },
  stalls: Stall[],
  decors?: Decor[]
): { conflict: boolean; with?: string; kind?: 'stall' | 'decor' } {
  // 다른 stall과 겹침
  for (const s of stalls) {
    if (s.id === stallId) continue;
    if (s.floor_id !== floorId) continue;
    if (!s.layout) continue;
    const a = layout;
    const b = s.layout;
    if (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    ) {
      return { conflict: true, with: s.id, kind: 'stall' };
    }
  }
  // 시설물(decor)과 겹침 — 기둥·램프 등 통과 불가 시설
  if (decors) {
    for (const d of decors) {
      if (d.floor_id !== floorId) continue;
      const a = layout;
      const b = d.layout;
      if (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
      ) {
        return { conflict: true, with: d.id, kind: 'decor' };
      }
    }
  }
  return { conflict: false };
}

/** 그리드 안에서 w×h 들어갈 빈 자리 찾기 */
export function findFreeSlot(
  floor: Floor,
  stalls: Stall[],
  w: number,
  h: number,
  startAfter?: { x: number; y: number },
  decors?: Decor[]
): { x: number; y: number } | null {
  const occupied = new Set<string>();
  for (const s of stalls.filter((x) => x.floor_id === floor.id && x.layout)) {
    const { x, y, w: sw, h: sh } = s.layout!;
    for (let dx = 0; dx < sw; dx++)
      for (let dy = 0; dy < sh; dy++) occupied.add(`${x + dx},${y + dy}`);
  }
  // 시설물 셀도 점유로 처리
  if (decors) {
    for (const d of decors.filter((x) => x.floor_id === floor.id)) {
      const { x, y, w: dw, h: dh } = d.layout;
      for (let dx = 0; dx < dw; dx++)
        for (let dy = 0; dy < dh; dy++) occupied.add(`${x + dx},${y + dy}`);
    }
  }
  const sx = startAfter?.x ?? 0;
  const sy = startAfter?.y ?? 0;
  for (let y = sy; y <= floor.grid_rows - h; y++) {
    for (let x = (y === sy ? sx : 0); x <= floor.grid_cols - w; x++) {
      let free = true;
      outer:
      for (let dx = 0; dx < w; dx++)
        for (let dy = 0; dy < h; dy++)
          if (occupied.has(`${x + dx},${y + dy}`)) { free = false; break outer; }
      if (free) return { x, y };
    }
  }
  return null;
}

/**
 * 빈 자리 + 그리드 자동 확장 fallback.
 * - 현 그리드 안에 빈 자리 있으면 그대로
 * - 없으면 우측에 박스 한 줄 추가하고 그 자리에 배치
 */
export function findSlotOrExpand(
  floor: Floor,
  stalls: Stall[],
  w: number,
  h: number,
  startAfter?: { x: number; y: number }
): { slot: { x: number; y: number }; expand: { grid_cols?: number; grid_rows?: number } | null } {
  const slot = findFreeSlot(floor, stalls, w, h, startAfter);
  if (slot) return { slot, expand: null };
  // 우측 확장
  return {
    slot: { x: floor.grid_cols, y: 0 },
    expand: { grid_cols: floor.grid_cols + w + 1 },
  };
}

/** 특정 layout이 그리드 벗어나면 확장값 반환 (벗어나지 않으면 null) */
export function expandToFit(
  floor: Floor,
  layout: { x: number; y: number; w: number; h: number }
): { grid_cols?: number; grid_rows?: number } | null {
  const newCols = layout.x + layout.w > floor.grid_cols ? layout.x + layout.w : floor.grid_cols;
  const newRows = layout.y + layout.h > floor.grid_rows ? layout.y + layout.h : floor.grid_rows;
  if (newCols === floor.grid_cols && newRows === floor.grid_rows) return null;
  const patch: { grid_cols?: number; grid_rows?: number } = {};
  if (newCols !== floor.grid_cols) patch.grid_cols = newCols;
  if (newRows !== floor.grid_rows) patch.grid_rows = newRows;
  return patch;
}

