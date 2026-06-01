'use client';

import type {
  Stall, Tenant, Lease, Billing, Payment, Floor,
  ParkingSection, Decor, BankTransaction,
} from './types';
import { fmtDate } from './utils';
import {
  saveStall, saveTenant, saveLease, saveBilling, savePayment,
  saveConfig, saveFloor, saveSection, saveDecor, saveBankTx,
  wipeCollection, writeAudit,
} from './data';
import { DEFAULT_CONFIG, SECTION_COLORS } from './types';
import { makeDecorId, makeBankTxId, makePaymentId } from './codes';

/**
 * 제안 데모용 풍부한 시드.
 * - 입주상사 10곳
 * - 사무실 + 주차 블럭 + 시설
 * - 임대 계약 10건 (정상·만료예정·연체·입점예정 다양)
 * - 4월~6월 청구 + 부분미수 + 통장 거래내역
 */
export async function runSeed(actor: string = 'system'): Promise<{ created: number; today: string }> {
  const TODAY = new Date('2026-06-01');

  await Promise.all([
    wipeCollection('stalls'),
    wipeCollection('tenants'),
    wipeCollection('leases'),
    wipeCollection('billings'),
    wipeCollection('payments'),
    wipeCollection('audit_logs'),
    wipeCollection('floors'),
    wipeCollection('decors'),
    wipeCollection('parking_sections'),
    wipeCollection('bank_transactions'),
  ]);

  let created = 0;

  /* ─── 동·층 ─── */
  const floors: Floor[] = [
    { id: 'A-F1', building: 'A', label: '1층 (사무실)', order: 0, grid_cols: 50, grid_rows: 30, cell_size: 16, focus_type: 'office' },
    { id: 'A-B1', building: 'A', label: '지하 (주차장)', order: 1, grid_cols: 50, grid_rows: 30, cell_size: 14, focus_type: 'parking' },
    { id: 'B-F1', building: 'B', label: '1층 (사무실)', order: 2, grid_cols: 40, grid_rows: 24, cell_size: 16, focus_type: 'office' },
    { id: 'B-B1', building: 'B', label: '지하 (주차장)', order: 3, grid_cols: 40, grid_rows: 24, cell_size: 14, focus_type: 'parking' },
  ];
  for (const f of floors) { await saveFloor(f); created++; }

  /* ─── 입주상사 10곳 ─── */
  const tenants: Tenant[] = [
    { id:'T1',  name:'천일모터스',     biz_no:'124-86-12345', ceo:'박천일', phone:'010-1111-2222', deposit_paid:18300000 },
    { id:'T2',  name:'대한오토',       biz_no:'215-87-22221', ceo:'김대한', phone:'010-2222-3333', deposit_paid:18300000 },
    { id:'T3',  name:'태성모빌리티',   biz_no:'318-22-33333', ceo:'이태성', phone:'010-3333-4444', deposit_paid:18300000 },
    { id:'T4',  name:'블루카',         biz_no:'440-91-55555', ceo:'정블루', phone:'010-4444-5555', deposit_paid:18300000 },
    { id:'T5',  name:'국민모터스',     biz_no:'556-88-77777', ceo:'최국민', phone:'010-5555-6666', deposit_paid:32400000 },
    { id:'T6',  name:'한라오토',       biz_no:'604-81-12345', ceo:'한승호', phone:'010-6666-7777', deposit_paid:18300000 },
    { id:'T7',  name:'서울모터스',     biz_no:'712-82-23456', ceo:'서대표', phone:'010-7777-8888', deposit_paid:20400000 },
    { id:'T8',  name:'스카이모빌리티', biz_no:'823-83-34567', ceo:'김스카이', phone:'010-8888-9999', deposit_paid:18300000 },
    { id:'T9',  name:'골드오토',       biz_no:'934-84-45678', ceo:'황금석', phone:'010-9999-0000', deposit_paid:20400000 },
    { id:'T10', name:'에이스카',       biz_no:'104-85-56789', ceo:'이에이스', phone:'010-1010-2020', deposit_paid:19200000 },
  ];
  for (const t of tenants) { await saveTenant(t); created++; }

  /* ─── 사무실 + 주차칸 ─── */
  const stalls: Stall[] = [];

  // A동 사무실 8실 (201~208) — 4×2 grid, 각 3×3
  for (let i = 1; i <= 8; i++) {
    const c = (i - 1) % 4;
    const r = Math.floor((i - 1) / 4);
    stalls.push({
      id: `A-${200 + i}`, building: 'A', type: 'office',
      code: String(200 + i), area: 9, rent: 2000000, maint: 250000,
      floor_id: 'A-F1',
      layout: { x: 2 + c * 5, y: 2 + r * 5, w: 3, h: 3 },
    });
  }
  // A동 주차 30칸 — 6 블럭 × 5칸 (10×3 그리드 형태)
  for (let i = 1; i <= 30; i++) {
    const blockIdx = Math.floor((i - 1) / 5);  // 0..5
    const inBlock = (i - 1) % 5;
    const c = inBlock + (blockIdx % 3) * 6;
    const r = Math.floor(blockIdx / 3);
    stalls.push({
      id: `A-P${String(i).padStart(2, '0')}`, building: 'A', type: 'parking',
      code: `P${String(i).padStart(2, '0')}`, area: 6, rent: 250000, maint: 30000,
      floor_id: 'A-B1', section_id: `SEC-A${blockIdx + 1}`,
      layout: { x: 1 + c * 2, y: 2 + r * 4, w: 2, h: 3 },
    });
  }
  // B동 사무실 4실 (301~304) — 4×1 grid
  for (let i = 1; i <= 4; i++) {
    stalls.push({
      id: `B-${300 + i}`, building: 'B', type: 'office',
      code: String(300 + i), area: 9, rent: 2200000, maint: 270000,
      floor_id: 'B-F1',
      layout: { x: 2 + (i - 1) * 5, y: 3, w: 3, h: 3 },
    });
  }
  // B동 주차 20칸 — 4 블럭 × 5칸
  for (let i = 1; i <= 20; i++) {
    const blockIdx = Math.floor((i - 1) / 5);
    const inBlock = (i - 1) % 5;
    const c = inBlock + (blockIdx % 2) * 6;
    const r = Math.floor(blockIdx / 2);
    stalls.push({
      id: `B-P${String(i).padStart(2, '0')}`, building: 'B', type: 'parking',
      code: `P${String(i).padStart(2, '0')}`, area: 6, rent: 280000, maint: 30000,
      floor_id: 'B-B1', section_id: `SEC-B${blockIdx + 1}`,
      layout: { x: 1 + c * 2, y: 2 + r * 4, w: 2, h: 3 },
    });
  }
  for (const s of stalls) { await saveStall(s); created++; }

  /* ─── 주차 블럭 ─── */
  const sections: ParkingSection[] = [];
  for (let i = 0; i < 6; i++) {
    sections.push({
      id: `SEC-A${i + 1}`, building: 'A', floor_id: 'A-B1',
      code: 'B' + String(i + 1).padStart(2, '0'),
      name: String.fromCharCode(65 + i) + '블럭',
      color: SECTION_COLORS[i % SECTION_COLORS.length],
      rent: 1250000, maint: 150000,
    });
  }
  for (let i = 0; i < 4; i++) {
    sections.push({
      id: `SEC-B${i + 1}`, building: 'B', floor_id: 'B-B1',
      code: 'B' + String(i + 7).padStart(2, '0'),
      name: String.fromCharCode(65 + i) + '블럭',
      color: SECTION_COLORS[(i + 6) % SECTION_COLORS.length],
      rent: 1400000, maint: 150000,
    });
  }
  for (const sec of sections) { await saveSection(sec); created++; }

  /* ─── 시설 ─── */
  const decors: Decor[] = [
    { id: makeDecorId(), floor_id: 'A-F1', building: 'A', type: 'elevator', label: 'EV', layout: { x: 24, y: 4, w: 2, h: 2 } },
    { id: makeDecorId(), floor_id: 'A-F1', building: 'A', type: 'stairs',   label: '↑계단', layout: { x: 24, y: 8, w: 2, h: 3 } },
    { id: makeDecorId(), floor_id: 'A-F1', building: 'A', type: 'restroom', label: 'WC', layout: { x: 24, y: 13, w: 2, h: 2 } },
    { id: makeDecorId(), floor_id: 'A-B1', building: 'A', type: 'pillar',   label: '●', layout: { x: 14, y: 6, w: 1, h: 1 } },
    { id: makeDecorId(), floor_id: 'A-B1', building: 'A', type: 'pillar',   label: '●', layout: { x: 28, y: 6, w: 1, h: 1 } },
    { id: makeDecorId(), floor_id: 'A-B1', building: 'A', type: 'ramp',     label: '↗램프', layout: { x: 36, y: 0, w: 2, h: 3 } },
    { id: makeDecorId(), floor_id: 'B-F1', building: 'B', type: 'elevator', label: 'EV', layout: { x: 22, y: 4, w: 2, h: 2 } },
    { id: makeDecorId(), floor_id: 'B-F1', building: 'B', type: 'restroom', label: 'WC', layout: { x: 22, y: 8, w: 2, h: 2 } },
  ];
  for (const d of decors) { await saveDecor(d); created++; }

  /* ─── 임대 계약 10건 ─── */
  const leases: Lease[] = [
    { id:'L1',  tenant_id:'T1',  office_stall_ids:['A-201'], section_ids:['SEC-A1'],
      stall_ids:['A-201','A-P01','A-P02','A-P03','A-P04','A-P05'],
      start:'2026-04-01', end:'2027-03-31', rent_total:3050000, maint_total:350000, deposit:18300000,
      status:'active', signed_at:'2026-03-25' },
    // 만료예정 (6/30 만료)
    { id:'L2',  tenant_id:'T2',  office_stall_ids:['A-203'], section_ids:['SEC-A2'],
      stall_ids:['A-203','A-P06','A-P07','A-P08','A-P09','A-P10'],
      start:'2025-09-01', end:'2026-06-30', rent_total:3050000, maint_total:350000, deposit:18300000,
      status:'active', signed_at:'2025-08-25' },
    // 연체
    { id:'L3',  tenant_id:'T3',  office_stall_ids:['A-205'], section_ids:['SEC-A3'],
      stall_ids:['A-205','A-P11','A-P12','A-P13','A-P14','A-P15'],
      start:'2026-01-01', end:'2026-12-31', rent_total:3050000, maint_total:350000, deposit:18300000,
      status:'active', signed_at:'2025-12-20' },
    // 입점예정
    { id:'L4',  tenant_id:'T4',  office_stall_ids:['A-204'], section_ids:['SEC-A4'],
      stall_ids:['A-204','A-P16','A-P17','A-P18','A-P19','A-P20'],
      start:'2026-08-01', end:'2027-07-31', rent_total:3050000, maint_total:350000, deposit:18300000,
      status:'active', signed_at:'2026-05-15' },
    // 다중 사무실 (B동)
    { id:'L5',  tenant_id:'T5',  office_stall_ids:['B-301','B-302'], section_ids:['SEC-B1'],
      stall_ids:['B-301','B-302','B-P01','B-P02','B-P03','B-P04','B-P05'],
      start:'2026-02-01', end:'2027-01-31', rent_total:5400000, maint_total:590000, deposit:32400000,
      status:'active', signed_at:'2026-01-25' },
    { id:'L6',  tenant_id:'T6',  office_stall_ids:['A-202'], section_ids:['SEC-A5'],
      stall_ids:['A-202','A-P21','A-P22','A-P23','A-P24','A-P25'],
      start:'2026-03-01', end:'2027-02-28', rent_total:3050000, maint_total:350000, deposit:18300000,
      status:'active', signed_at:'2026-02-20' },
    { id:'L7',  tenant_id:'T7',  office_stall_ids:['B-303'], section_ids:['SEC-B2'],
      stall_ids:['B-303','B-P06','B-P07','B-P08','B-P09','B-P10'],
      start:'2026-05-01', end:'2027-04-30', rent_total:3400000, maint_total:370000, deposit:20400000,
      status:'active', signed_at:'2026-04-15' },
    // 만료예정 (7/31)
    { id:'L8',  tenant_id:'T8',  office_stall_ids:['A-206'], section_ids:['SEC-A6'],
      stall_ids:['A-206','A-P26','A-P27','A-P28','A-P29','A-P30'],
      start:'2025-08-01', end:'2026-07-31', rent_total:3050000, maint_total:350000, deposit:18300000,
      status:'active', signed_at:'2025-07-25' },
    { id:'L9',  tenant_id:'T9',  office_stall_ids:['B-304'], section_ids:['SEC-B3'],
      stall_ids:['B-304','B-P11','B-P12','B-P13','B-P14','B-P15'],
      start:'2026-06-01', end:'2027-05-31', rent_total:3400000, maint_total:370000, deposit:20400000,
      status:'active', signed_at:'2026-05-20' },
    { id:'L10', tenant_id:'T10', office_stall_ids:['A-207'], section_ids:['SEC-B4'],
      stall_ids:['A-207','B-P16','B-P17','B-P18','B-P19','B-P20'],
      start:'2026-04-15', end:'2027-04-14', rent_total:3200000, maint_total:350000, deposit:19200000,
      status:'active', signed_at:'2026-04-01' },
  ];
  for (const l of leases) { await saveLease(l); created++; }

  /* ─── 4월~6월 청구 + 일부 미수 ─── */
  const billings: Billing[] = [];
  for (const l of leases) {
    if (new Date(l.start) > TODAY) continue;
    const startM = new Date(l.start) > new Date('2026-04-01') ? new Date(l.start) : new Date('2026-04-01');
    const cursor = new Date(startM.getFullYear(), startM.getMonth(), 1);
    while (cursor <= TODAY) {
      const period = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0');
      const total = l.rent_total + l.maint_total + 38000;
      billings.push({
        id: `BL_${l.id}_${period.replace('-', '')}`,
        lease_id: l.id, tenant_id: l.tenant_id, period,
        items: [
          { type:'월세',         amount: l.rent_total },
          { type:'관리비',       amount: l.maint_total },
          { type:'공과금 안분', amount: 38000 },
        ],
        total, due_date: period + '-25', paid_amount: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // 수납: T3 5/6월 미납, T8 5월 부분 미수, 나머지 완납
  const payments: Payment[] = [];
  for (const b of billings) {
    const t3Unpaid = b.tenant_id === 'T3' && b.period >= '2026-05';
    const t8Partial = b.tenant_id === 'T8' && b.period === '2026-05';
    if (t3Unpaid) continue;
    if (t8Partial) {
      b.paid_amount = Math.floor(b.total * 0.6);
      payments.push({
        id: makePaymentId(), tenant_id: b.tenant_id, amount: b.paid_amount,
        paid_at: b.due_date, method: '계좌이체',
        allocations: [{ billing_id: b.id, amount: b.paid_amount }],
      });
      continue;
    }
    b.paid_amount = b.total;
    payments.push({
      id: makePaymentId(), tenant_id: b.tenant_id, amount: b.total,
      paid_at: b.due_date, method: '계좌이체',
      allocations: [{ billing_id: b.id, amount: b.total }],
    });
  }
  for (const b of billings) { await saveBilling(b); created++; }
  for (const p of payments) { await savePayment(p); created++; }

  /* ─── 통장 거래내역 (자금일보용) ─── */
  let bal = 100_000_000;
  const txs: BankTransaction[] = [];

  // 수납 거래
  for (const p of payments) {
    const tn = tenants.find((t) => t.id === p.tenant_id);
    txs.push({
      id: makeBankTxId(),
      date: p.paid_at,
      description: tn?.name || '입금',
      deposit: p.amount,
      withdraw: 0,
      balance: 0,
      category: '수납',
      matched_tenant_id: p.tenant_id,
      matched_payment_id: p.id,
    });
  }
  // 비용 출금
  const expenses: { date: string; desc: string; amount: number }[] = [
    { date: '2026-04-05', desc: '전기요금',    amount: 850000  },
    { date: '2026-04-25', desc: '청소용역비',  amount: 1200000 },
    { date: '2026-05-05', desc: '전기요금',    amount: 920000  },
    { date: '2026-05-15', desc: '경비용역비',  amount: 2400000 },
    { date: '2026-05-25', desc: '수도요금',    amount: 380000  },
    { date: '2026-06-05', desc: '전기요금',    amount: 880000  },
    { date: '2026-06-10', desc: '단지 광고비', amount: 500000  },
  ];
  for (const ex of expenses) {
    txs.push({
      id: makeBankTxId(),
      date: ex.date,
      description: ex.desc,
      deposit: 0,
      withdraw: ex.amount,
      balance: 0,
      category: '출금',
    });
  }
  txs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const tx of txs) {
    bal += (tx.deposit || 0) - (tx.withdraw || 0);
    tx.balance = bal;
    await saveBankTx(tx);
    created++;
  }

  /* ─── Config ─── */
  await saveConfig(DEFAULT_CONFIG);

  /* ─── Audit ─── */
  await writeAudit({
    actor, type: 'seed', target: 'all',
    memo: `초기 데이터 시드: 동·층 ${floors.length} · 사무실+주차 ${stalls.length} · 블럭 ${sections.length} · 시설 ${decors.length} · 상사 ${tenants.length} · 계약 ${leases.length} · 청구 ${billings.length} · 수납 ${payments.length} · 통장 ${txs.length}`,
    at: fmtDate(TODAY),
  });

  return { created, today: fmtDate(TODAY) };
}
