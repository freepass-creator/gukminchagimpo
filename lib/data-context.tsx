'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { onSnapshot, query, orderBy } from 'firebase/firestore';
import { col } from './data';
import { db } from './firebase';
import { doc, onSnapshot as docSnap } from 'firebase/firestore';
import type { Stall, Tenant, Lease, Billing, Payment, Config, Floor, Decor, ParkingSection, BankTransaction, TempParkingAssignment } from './types';
import { DEFAULT_CONFIG } from './types';

interface DataCtx {
  stalls: Stall[];
  tenants: Tenant[];
  leases: Lease[];
  billings: Billing[];
  payments: Payment[];
  floors: Floor[];
  decors: Decor[];
  sections: ParkingSection[];
  bankTx: BankTransaction[];
  tempAssignments: TempParkingAssignment[];
  config: Config;
  loading: boolean;
  today: Date;
  /** O(1) lookup — 반복 find() 제거용 */
  byId: {
    tenant: Map<string, Tenant>;
    stall: Map<string, Stall>;
    lease: Map<string, Lease>;
    floor: Map<string, Floor>;
    section: Map<string, ParkingSection>;
    billing: Map<string, Billing>;
  };
  /** 자주 쓰는 그룹화 인덱스 */
  index: {
    /** floor_id별 stall들 */
    stallsByFloor: Map<string, Stall[]>;
    /** floor_id별 decor들 */
    decorsByFloor: Map<string, Decor[]>;
    /** section_id별 stall들 */
    stallsBySection: Map<string, Stall[]>;
    /** lease_id별 billing들 */
    billingsByLease: Map<string, Billing[]>;
    /** tenant_id별 lease들 */
    leasesByTenant: Map<string, Lease[]>;
  };
}

const Ctx = createContext<DataCtx | null>(null);

/**
 * 데모용 고정 오늘 — 가상 데이터 시드와 정합성 맞추기 위해.
 * 실제 운영 진입 시 new Date()로 교체.
 */
const DEMO_TODAY = new Date('2026-06-01');

export function DataProvider({ children }: { children: ReactNode }) {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [billings, setBillings] = useState<Billing[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [decors, setDecors] = useState<Decor[]>([]);
  const [sections, setSections] = useState<ParkingSection[]>([]);
  const [bankTx, setBankTx] = useState<BankTransaction[]>([]);
  const [tempAssignments, setTempAssignments] = useState<TempParkingAssignment[]>([]);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [loadingCount, setLoadingCount] = useState(11);

  useEffect(() => {
    const sub = (
      collectionGetter: () => any,
      setter: (arr: any[]) => void
    ) => {
      return onSnapshot(collectionGetter(), (snap: any) => {
        setter(snap.docs.map((d: any) => ({ ...(d.data() as any), id: d.id })));
        setLoadingCount((n) => Math.max(0, n - 1));
      });
    };

    const unsubs = [
      sub(col.stalls, setStalls),
      sub(col.tenants, setTenants),
      sub(col.leases, setLeases),
      sub(col.billings, setBillings),
      sub(col.payments, setPayments),
      sub(col.floors, setFloors),
      sub(col.decors, setDecors),
      sub(col.sections, setSections),
      sub(col.bankTx, setBankTx),
      sub(col.tempAssignments, setTempAssignments),
    ];

    const unsubConfig = docSnap(col.config(), (snap) => {
      if (snap.exists()) {
        setConfig({ ...DEFAULT_CONFIG, ...(snap.data() as Config) });
      }
      setLoadingCount((n) => Math.max(0, n - 1));
    });

    return () => {
      unsubs.forEach((u) => u());
      unsubConfig();
    };
  }, []);

  // 자주 쓰는 lookup 인덱스 — useMemo로 한 번만 빌드
  const byId = useMemo(() => ({
    tenant: new Map(tenants.map((t) => [t.id, t])),
    stall: new Map(stalls.map((s) => [s.id, s])),
    lease: new Map(leases.map((l) => [l.id, l])),
    floor: new Map(floors.map((f) => [f.id, f])),
    section: new Map(sections.map((s) => [s.id, s])),
    billing: new Map(billings.map((b) => [b.id, b])),
  }), [tenants, stalls, leases, floors, sections, billings]);

  const index = useMemo(() => {
    const stallsByFloor = new Map<string, Stall[]>();
    for (const s of stalls) {
      if (!s.floor_id) continue;
      const arr = stallsByFloor.get(s.floor_id) || [];
      arr.push(s);
      stallsByFloor.set(s.floor_id, arr);
    }
    const decorsByFloor = new Map<string, Decor[]>();
    for (const d of decors) {
      const arr = decorsByFloor.get(d.floor_id) || [];
      arr.push(d);
      decorsByFloor.set(d.floor_id, arr);
    }
    const stallsBySection = new Map<string, Stall[]>();
    for (const s of stalls) {
      if (!s.section_id) continue;
      const arr = stallsBySection.get(s.section_id) || [];
      arr.push(s);
      stallsBySection.set(s.section_id, arr);
    }
    const billingsByLease = new Map<string, Billing[]>();
    for (const b of billings) {
      const arr = billingsByLease.get(b.lease_id) || [];
      arr.push(b);
      billingsByLease.set(b.lease_id, arr);
    }
    const leasesByTenant = new Map<string, Lease[]>();
    for (const l of leases) {
      const arr = leasesByTenant.get(l.tenant_id) || [];
      arr.push(l);
      leasesByTenant.set(l.tenant_id, arr);
    }
    return { stallsByFloor, decorsByFloor, stallsBySection, billingsByLease, leasesByTenant };
  }, [stalls, decors, billings, leases]);

  const value = useMemo<DataCtx>(
    () => ({
      stalls,
      tenants,
      leases,
      billings,
      payments,
      floors,
      decors,
      sections,
      bankTx,
      tempAssignments,
      config,
      loading: loadingCount > 0,
      today: DEMO_TODAY,
      byId,
      index,
    }),
    [stalls, tenants, leases, billings, payments, floors, decors, sections, bankTx, tempAssignments, config, loadingCount, byId, index]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used within DataProvider');
  return v;
}

/* 헬퍼 selector */
export function useTenant(id?: string) {
  const { tenants } = useData();
  return tenants.find((t) => t.id === id);
}
export function useStall(id?: string) {
  const { stalls } = useData();
  return stalls.find((s) => s.id === id);
}
export function useLease(id?: string) {
  const { leases } = useData();
  return leases.find((l) => l.id === id);
}
