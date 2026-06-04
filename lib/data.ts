'use client';

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  Stall,
  Tenant,
  Lease,
  Billing,
  Payment,
  AuditLog,
  Config,
  Floor,
  Decor,
  ParkingSection,
  BankTransaction,
  TempParkingAssignment,
} from './types';
import { DEFAULT_CONFIG } from './types';

/* ─── Collection refs ─── */
export const col = {
  stalls: () => collection(db, 'stalls'),
  tenants: () => collection(db, 'tenants'),
  leases: () => collection(db, 'leases'),
  billings: () => collection(db, 'billings'),
  payments: () => collection(db, 'payments'),
  audit: () => collection(db, 'audit_logs'),
  floors: () => collection(db, 'floors'),
  decors: () => collection(db, 'decors'),
  sections: () => collection(db, 'parking_sections'),
  bankTx: () => collection(db, 'bank_transactions'),
  tempAssignments: () => collection(db, 'temp_assignments'),
  config: () => doc(db, 'config', 'main'),
};

/** Firestore는 undefined 값 거부 — 깊이 순회하며 undefined 키 제거 */
function stripUndefined(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (typeof obj !== 'object') return obj;
  // Firestore의 serverTimestamp() 같은 sentinel은 객체이지만 그대로 통과
  if (obj.constructor && obj.constructor.name !== 'Object') return obj;
  const result: any = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v !== undefined) result[k] = stripUndefined(v);
  }
  return result;
}

/* ─── Generic save with id ─── */
async function saveDoc<T extends { id: string }>(colName: string, item: T): Promise<void> {
  const ref = doc(db, colName, item.id);
  const cleaned = stripUndefined(item);
  await setDoc(ref, { ...cleaned, updated_at: serverTimestamp() } as any, { merge: true });
}

/** Generic update — undefined 값 자동 제거 (Firestore 거부 방지) */
async function updateDocSafe(colName: string, id: string, patch: any): Promise<void> {
  await updateDoc(doc(db, colName, id), stripUndefined(patch));
}

/* ─── Audit log ─── */
export async function writeAudit(
  log: Omit<AuditLog, 'id' | 'created_at'> & { actor: string }
): Promise<void> {
  await addDoc(col.audit(), {
    ...log,
    created_at: serverTimestamp(),
  });
}

/* ─── Stall ─── */
export const saveStall = (s: Stall) => saveDoc('stalls', s);
export const removeStall = (id: string) => deleteDoc(doc(db, 'stalls', id));
export async function updateStall(id: string, patch: Partial<Stall>): Promise<void> {
  await updateDocSafe('stalls', id, patch);
}

/* ─── Floor ─── */
export const saveFloor = (f: Floor) => saveDoc('floors', f);
export const removeFloor = (id: string) => deleteDoc(doc(db, 'floors', id));
export async function updateFloor(id: string, patch: Partial<Floor>): Promise<void> {
  await updateDocSafe('floors', id, patch);
}

/* ─── Decor (건물 부속) ─── */
export const saveDecor = (d: Decor) => saveDoc('decors', d);
export const removeDecor = (id: string) => deleteDoc(doc(db, 'decors', id));
export async function updateDecor(id: string, patch: Partial<Decor>): Promise<void> {
  await updateDocSafe('decors', id, patch);
}

/* ─── Parking Section ─── */
export const saveSection = (s: ParkingSection) => saveDoc('parking_sections', s);
export const removeSection = (id: string) => deleteDoc(doc(db, 'parking_sections', id));
export async function updateSection(id: string, patch: Partial<ParkingSection>): Promise<void> {
  await updateDocSafe('parking_sections', id, patch);
}

/* ─── Bank Transaction ─── */
export const saveBankTx = (t: BankTransaction) => saveDoc('bank_transactions', t);
export const removeBankTx = (id: string) => deleteDoc(doc(db, 'bank_transactions', id));
export async function updateBankTx(id: string, patch: Partial<BankTransaction>): Promise<void> {
  await updateDocSafe('bank_transactions', id, patch);
}

/* ─── Temp Parking Assignment ─── */
export const saveTempAssignment = (a: TempParkingAssignment) => saveDoc('temp_assignments', a);
export const removeTempAssignment = (id: string) => deleteDoc(doc(db, 'temp_assignments', id));
export async function updateTempAssignment(id: string, patch: Partial<TempParkingAssignment>): Promise<void> {
  await updateDocSafe('temp_assignments', id, patch);
}

/* ─── Tenant ─── */
export const saveTenant = (t: Tenant) => saveDoc('tenants', t);
export const removeTenant = (id: string) => deleteDoc(doc(db, 'tenants', id));

/* ─── Lease ─── */
export const saveLease = (l: Lease) => saveDoc('leases', l);
export async function updateLease(id: string, patch: Partial<Lease>): Promise<void> {
  await updateDocSafe('leases', id, patch);
}

/* ─── Billing ─── */
/**
 * 청구서 저장 — 기존 paid_amount는 자동 보존 (덮어쓰기 시 수납액 손실 방지).
 * 명시적으로 paid_amount를 변경하려면 updateBilling 사용.
 */
export async function saveBilling(b: Billing): Promise<void> {
  const ref = doc(db, 'billings', b.id);
  const existing = await getDoc(ref);
  const existingPaid = existing.exists() ? ((existing.data() as any).paid_amount || 0) : 0;
  const preserved: Billing = { ...b, paid_amount: Math.max(existingPaid, b.paid_amount || 0) };
  await saveDoc('billings', preserved);
}
export async function updateBilling(id: string, patch: Partial<Billing>): Promise<void> {
  await updateDocSafe('billings', id, patch);
}
/**
 * 청구 삭제 — 관련 payment.allocations에서 이 billing 배분 제거.
 * payment 자체는 유지 (다른 billing 배분 또는 미배분 상태로 남음).
 */
export async function deleteBillingWithCleanup(billingId: string): Promise<void> {
  // payment.allocations에서 billing_id 제거
  const paymentsSnap = await getDocs(col.payments());
  for (const pd of paymentsSnap.docs) {
    const p = pd.data() as Payment;
    if (!p.allocations?.some((a) => a.billing_id === billingId)) continue;
    const newAllocs = p.allocations.filter((a) => a.billing_id !== billingId);
    await updateDocSafe('payments', pd.id, { allocations: newAllocs });
  }
  await deleteDoc(doc(db, 'billings', billingId));
}

/* ─── Payment ─── */
export const savePayment = (p: Payment) => saveDoc('payments', p);

/* ─── Config ─── */
export async function loadConfig(): Promise<Config> {
  const snap = await getDoc(col.config());
  if (snap.exists()) return { ...DEFAULT_CONFIG, ...(snap.data() as Config) };
  await setDoc(col.config(), DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}
export async function saveConfig(c: Config): Promise<void> {
  await setDoc(col.config(), c, { merge: true });
}

/* ─── 사용자 역할 관리 (관리자 부여/해제) ─── */
export async function grantManager(email: string): Promise<void> {
  const e = email.toLowerCase().trim();
  await setDoc(doc(db, 'users', e), { email: e, role: 'admin' }, { merge: true });
}
export async function revokeManager(email: string): Promise<void> {
  await deleteDoc(doc(db, 'users', email.toLowerCase()));
}

/* ─── Bulk wipe (for re-seed) ─── */
export async function wipeCollection(colName: string): Promise<number> {
  const snap = await getDocs(collection(db, colName));
  let n = 0;
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
    n++;
  }
  return n;
}
