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
  await updateDoc(doc(db, 'stalls', id), patch as any);
}

/* ─── Floor ─── */
export const saveFloor = (f: Floor) => saveDoc('floors', f);
export const removeFloor = (id: string) => deleteDoc(doc(db, 'floors', id));
export async function updateFloor(id: string, patch: Partial<Floor>): Promise<void> {
  await updateDoc(doc(db, 'floors', id), patch as any);
}

/* ─── Decor (건물 부속) ─── */
export const saveDecor = (d: Decor) => saveDoc('decors', d);
export const removeDecor = (id: string) => deleteDoc(doc(db, 'decors', id));
export async function updateDecor(id: string, patch: Partial<Decor>): Promise<void> {
  await updateDoc(doc(db, 'decors', id), patch as any);
}

/* ─── Parking Section ─── */
export const saveSection = (s: ParkingSection) => saveDoc('parking_sections', s);
export const removeSection = (id: string) => deleteDoc(doc(db, 'parking_sections', id));
export async function updateSection(id: string, patch: Partial<ParkingSection>): Promise<void> {
  await updateDoc(doc(db, 'parking_sections', id), patch as any);
}

/* ─── Bank Transaction ─── */
export const saveBankTx = (t: BankTransaction) => saveDoc('bank_transactions', t);
export const removeBankTx = (id: string) => deleteDoc(doc(db, 'bank_transactions', id));
export async function updateBankTx(id: string, patch: Partial<BankTransaction>): Promise<void> {
  await updateDoc(doc(db, 'bank_transactions', id), patch as any);
}

/* ─── Temp Parking Assignment ─── */
export const saveTempAssignment = (a: TempParkingAssignment) => saveDoc('temp_assignments', a);
export const removeTempAssignment = (id: string) => deleteDoc(doc(db, 'temp_assignments', id));
export async function updateTempAssignment(id: string, patch: Partial<TempParkingAssignment>): Promise<void> {
  await updateDoc(doc(db, 'temp_assignments', id), patch as any);
}

/* ─── Tenant ─── */
export const saveTenant = (t: Tenant) => saveDoc('tenants', t);
export const removeTenant = (id: string) => deleteDoc(doc(db, 'tenants', id));

/* ─── Lease ─── */
export const saveLease = (l: Lease) => saveDoc('leases', l);
export async function updateLease(id: string, patch: Partial<Lease>): Promise<void> {
  await updateDoc(doc(db, 'leases', id), patch as any);
}

/* ─── Billing ─── */
export const saveBilling = (b: Billing) => saveDoc('billings', b);
export async function updateBilling(id: string, patch: Partial<Billing>): Promise<void> {
  await updateDoc(doc(db, 'billings', id), patch as any);
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
