/** 자금일보 계정과목 — 입금/지출 공통 */
export const ACCOUNT_CATEGORIES = {
  income: [
    '임대료',       // 매칭된 수납 자동 기본값
    '관리비',
    '주차료',
    '보증금',
    '환불',
    '기타입금',
  ],
  expense: [
    '인건비',
    '공과금',       // 전기·수도·가스
    '시설관리',
    '청소·경비',
    '소모품',
    '세금·공과',
    '기타지출',
  ],
} as const;

export const ALL_CATEGORIES: string[] = [
  ...ACCOUNT_CATEGORIES.income,
  ...ACCOUNT_CATEGORIES.expense,
];

/**
 * 거래에 대한 기본 계정과목 추천
 * - 매칭된 수납(deposit + matched_tenant_id) → 임대료
 * - 일반 입금 → 기타입금
 * - 출금 → 기타지출
 */
export function suggestCategory(tx: { deposit?: number; withdraw?: number; matched_tenant_id?: string }): string {
  if ((tx.deposit || 0) > 0) {
    if (tx.matched_tenant_id) return '임대료';
    return '기타입금';
  }
  if ((tx.withdraw || 0) > 0) return '기타지출';
  return '';
}
