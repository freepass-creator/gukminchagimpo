import { Timestamp } from 'firebase/firestore';

/** 동 식별자 — 'A', 'B' 외 자유 확장 가능 */
export type Building = string;
export type StallType = 'office' | 'parking';
export type StallState = 'vacant' | 'active' | 'overdue' | 'expiring' | 'reserved';
export type LeaseStatus = 'active' | 'terminated' | 'expired';

export interface Stall {
  id: string;
  building: Building;
  type: StallType;
  code: string;          // "201" | "P07"
  area: number;          // ㎡
  rent: number;          // 표준 월세 (원)
  maint: number;         // 표준 관리비 (원)
  floor_id?: string;     // 'A-F1' 등 — 평면 에디터용
  /** 주차공간 섹션 ID — 여러 주차칸을 묶어서 한 단위로 임대 (사무실은 보통 미사용) */
  section_id?: string;
  layout?: {
    x: number;
    y: number;
    w: number;
    h: number;
    rotation?: 0 | 90;
  };
  created_at?: Timestamp;
}

/** 주차공간 섹션 — 여러 주차칸을 묶은 임대 단위 */
export interface ParkingSection {
  id: string;
  building: Building;
  floor_id: string;
  code: string;          // 'S01', 'S02' 등
  name: string;          // 사용자 정의 이름
  color: string;         // 표시 색상 (#hex)
  rent: number;          // 섹션 전체 월세
  maint: number;
  created_at?: Timestamp;
}

/** 섹션에 자동 부여할 색상 풀 (반복) */
export const SECTION_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

/** 동·층 (평면도 그리드 단위) */
export interface Floor {
  id: string;            // 'A-F1' (A동 1층), 'A-B1' (A동 지하1층)
  building: Building;
  label: string;         // '1층', '지하주차', '2층' 등 사용자 자유 라벨
  order: number;         // 정렬용 (0,1,2..)
  grid_cols: number;     // 가로 셀 수
  grid_rows: number;     // 세로 셀 수
  cell_size: number;     // 셀 픽셀 크기 (예: 28)
  focus_type?: StallType; // 이 층이 주로 사무실인지 / 주차인지 (UI 힌트)
  created_at?: Timestamp;
}

export interface Tenant {
  id: string;
  name: string;
  biz_no: string;
  ceo: string;
  phone: string;
  deposit_paid: number;
  /** 상사 본인 조회용 비밀번호 — 보안 강도 낮음 (개인정보 X) */
  password?: string;
  memo?: string;
  created_at?: Timestamp;
}

export interface Lease {
  id: string;
  tenant_id: string;
  /** 사무실 stall_id 목록 + 블럭에 속한 주차 stall_id 모두 펼친 형태 */
  stall_ids: string[];
  /** 임대된 주차 블럭 ID 목록 (UI 표시·청구 그룹화용) */
  section_ids?: string[];
  /** 사무실로 임대된 stall_id만 (UI용) */
  office_stall_ids?: string[];
  start: string;         // 'YYYY-MM-DD'
  end: string;
  rent_total: number;
  maint_total: number;
  deposit: number;
  status: LeaseStatus;
  signed_at?: string;
  terminated_at?: string;
  renewed_from?: string;
  memo?: string;
  created_at?: Timestamp;
}

/**
 * 임시 전시장 배정 — 기존 전시장 공실 일부를 일정 기간 동안 상사에게 배정.
 * 정규 lease와 독립적으로 활성 기간만 임대 현황·청구에 반영됨.
 */
export interface TempParkingAssignment {
  id: string;
  tenant_id: string;
  /** 연결된 정규 lease (옵션) — 같은 상사의 정규 임대와 묶고 싶을 때 */
  lease_id?: string;
  /** 임시 사용 stall_id 목록 (parking type만) */
  stall_ids: string[];
  start: string;          // 'YYYY-MM-DD'
  end: string;
  /** 월 사용료 (해당 기간 동안 청구에 추가) */
  rent: number;
  status: 'active' | 'ended';
  memo?: string;
  created_at?: Timestamp;
}

export interface BillingItem {
  type: string;          // '월세' | '관리비' | '공과금 안분' | '기타'
  amount: number;
}

export interface Billing {
  id: string;
  lease_id: string;
  tenant_id: string;
  period: string;        // 'YYYY-MM'
  items: BillingItem[];
  total: number;
  due_date: string;      // 'YYYY-MM-DD'
  paid_amount: number;
  created_at?: Timestamp;
}

export interface PaymentAllocation {
  billing_id: string;
  amount: number;
}

export interface Payment {
  id: string;
  tenant_id: string;
  amount: number;
  paid_at: string;
  method: string;
  allocations: PaymentAllocation[];
  created_at?: Timestamp;
}

export interface AuditLog {
  id: string;
  actor: string;         // user email or 'system'
  type: string;
  target: string;
  memo: string;
  at: string;
  before?: unknown;
  after?: unknown;
  created_at?: Timestamp;
}

export interface Config {
  complex_name: string;
  /** 단지 구조: 단일 건물 / 여러 동 */
  complex_layout: 'single' | 'multi';
  /** 단일 건물 모드에서 사용할 가상 동 이름 */
  single_building_label: string;
  billing_day: number;
  sending_day: number;
  due_day: number;
  expiring_threshold_days: number;
  overdue_threshold_days: number;
  deposit_multiplier: number;
  renewal_increase_rate: number;
  late_fee: 'daily' | 'monthly' | 'none';
  allocation_method: 'area' | 'days' | 'equal' | 'meter';
  notification_pre_expire: number[];
  notification_after_due: number[];
  receivable_aging: number[];
  notify_sender: string;
  account: string;
}

/** 건물 부속 시설 — 임대 단위가 아닌 시각 요소 (기둥·EV·계단·화장실 등) */
export type DecorType = 'pillar' | 'elevator' | 'stairs' | 'restroom' | 'ramp' | 'entrance' | 'wall';

export interface Decor {
  id: string;
  floor_id: string;
  building: Building;
  type: DecorType;
  label?: string;
  layout: {
    x: number;
    y: number;
    w: number;
    h: number;
    rotation?: 0 | 90;
  };
  created_at?: Timestamp;
}

export interface DecorPreset {
  w: number;
  h: number;
  label: string;
  fill: string;
  stroke: string;
  ink: string;
  /** 시각적 패턴 (선택) */
  pattern?: 'hatch' | 'dots';
}

export const DECOR_PRESETS: Record<DecorType, DecorPreset> = {
  pillar:   { w: 1, h: 1, label: '●',     fill: '#52525b', stroke: '#27272a', ink: '#fff' },
  elevator: { w: 2, h: 2, label: 'EV',    fill: '#94a3b8', stroke: '#475569', ink: '#fff' },
  stairs:   { w: 2, h: 3, label: '↑계단', fill: '#a8a29e', stroke: '#57534e', ink: '#fff', pattern: 'hatch' },
  restroom: { w: 2, h: 2, label: 'WC',    fill: '#7dd3fc', stroke: '#0284c7', ink: '#0c4a6e' },
  ramp:     { w: 2, h: 3, label: '↗램프', fill: '#fde68a', stroke: '#a16207', ink: '#78350f' },
  entrance: { w: 3, h: 1, label: '출입',  fill: '#bbf7d0', stroke: '#15803d', ink: '#14532d' },
  wall:     { w: 1, h: 5, label: '',      fill: '#27272a', stroke: '#000', ink: '#fff' },
};

export const DECOR_LABEL: Record<DecorType, string> = {
  pillar: '기둥',
  elevator: '엘리베이터',
  stairs: '계단',
  restroom: '화장실',
  ramp: '램프',
  entrance: '출입구',
  wall: '벽',
};

/** 통장 거래내역 — 자금일보·매칭 이력용 */
export interface BankTransaction {
  id: string;
  date: string;            // 'YYYY-MM-DD'
  description: string;     // 적요 (입금자명 등)
  deposit: number;         // 입금
  withdraw: number;        // 출금
  balance: number;         // 잔액 (입력 시점)
  /** 매칭된 Payment ID — 입금이 자동 수납으로 처리되면 기록 */
  matched_payment_id?: string;
  /** 매칭된 입주상사 ID */
  matched_tenant_id?: string;
  /** 분류: 수납 / 기타 입금 / 비용 / 환급 등 */
  category?: string;
  memo?: string;
  source?: string;         // '주거래은행', '농협' 등
  created_at?: Timestamp;
}

/** 캔버스 위에서 다중 배치 모드 설정 */
export interface PlacementConfig {
  type: StallType;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  gap: number;
}

export const DEFAULT_CONFIG: Config = {
  complex_name: '국민차매매단지 공항점',
  complex_layout: 'multi',
  single_building_label: '본관',
  billing_day: 1,
  sending_day: 7,
  due_day: 25,
  expiring_threshold_days: 30,
  overdue_threshold_days: 1,
  deposit_multiplier: 6,
  renewal_increase_rate: 0.05,
  late_fee: 'daily',
  allocation_method: 'area',
  notification_pre_expire: [30, 14, 7],
  notification_after_due: [1, 7, 15],
  receivable_aging: [30, 60, 90],
  notify_sender: '국민차매매 공항점',
  account: '농협 123-4567-8901-23',
};
