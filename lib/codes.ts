/**
 * 코드 자동 부여 — 모든 신규 ID/코드 발급은 여기로 통일.
 * 중복 / 시그니처 일관 / 추후 정책 변경 시 한 곳만 수정.
 */
import type { Stall, ParkingSection, Building } from './types';

const BUILDING_NUMBER_BASE: Record<string, number> = {};
function defaultOfficeStart(building: Building): number {
  // A=201, B=301, C=401, ...
  const ch = building.charCodeAt(0);
  if (ch >= 65 && ch <= 90) {
    return 200 + (ch - 64) * 100 + 1;
  }
  return BUILDING_NUMBER_BASE[building] ?? 101;
}

/** 다음 사무실 호수 (동 기준 max+1, 없으면 동별 시작) */
export function nextOfficeCode(stalls: Stall[], building: Building): string {
  const nums = stalls
    .filter((s) => s.building === building && s.type === 'office')
    .map((s) => parseInt(s.code))
    .filter((n) => !isNaN(n));
  if (nums.length === 0) return String(defaultOfficeStart(building));
  return String(Math.max(...nums) + 1);
}

/** 다음 주차칸 코드 (동 기준 P01, P02...) */
export function nextParkingCode(stalls: Stall[], building: Building): string {
  const nums = stalls
    .filter((s) => s.building === building && s.type === 'parking' && /^P\d+$/.test(s.code))
    .map((s) => parseInt(s.code.slice(1)));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'P' + String(next).padStart(2, '0');
}

/** 다음 블럭 코드 (전체 단지 단위 B01, B02...) */
export function nextSectionCode(sections: ParkingSection[]): string {
  const nums = sections
    .filter((s) => /^B\d+$/.test(s.code))
    .map((s) => parseInt(s.code.slice(1)));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'B' + String(next).padStart(2, '0');
}

/** 그 층의 다음 블럭 자동 이름 (A블럭, B블럭...) */
export function suggestSectionName(
  sections: ParkingSection[],
  floorId: string,
  suffix = '블럭'
): string {
  const sameFloor = sections.filter((s) => s.floor_id === floorId).length;
  return String.fromCharCode(65 + sameFloor) + suffix;
}

/** Stall ID 표준 형식 */
export const makeStallId = (building: Building, code: string): string =>
  `${building}-${code}`;

/** Section ID — 시간기반 unique */
export const makeSectionId = (): string =>
  `SEC-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Decor ID — 시간기반 unique */
export const makeDecorId = (): string =>
  `D-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Floor ID — 동·order 기반 */
export const makeFloorId = (building: Building, order: number): string =>
  `${building}-F${order + 1}`;

/** BankTransaction ID */
export const makeBankTxId = (): string =>
  `TX-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Lease ID */
export const makeLeaseId = (): string =>
  `L-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Tenant ID */
export const makeTenantId = (): string =>
  `T-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Payment ID */
export const makePaymentId = (): string =>
  `PM-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
