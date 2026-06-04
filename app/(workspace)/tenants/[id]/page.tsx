'use client';

import { useMemo, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Lock, KeyRound } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveTenant } from '@/lib/data';
import { PageHeader } from '@/components/list/PageHeader';
import { Card, CardBody } from '@/components/Card';
import { Button } from '@/components/Button';
import { BillingDetailDialog } from '@/components/BillingDetailDialog';
import { fmtMoney, fmtDate, daysBetween } from '@/lib/utils';

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { tenants, leases, billings, payments, bankTx, byId, index, today } = useData();
  const { isAdmin, isManager } = useAuth();
  const [openBilling, setOpenBilling] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  const tenant = tenants.find((t) => t.id === params.id);

  // 관리자/마스터 자동 우회
  const bypassGate = isAdmin || isManager;
  // 비밀번호 미설정 시 자동 통과 (관리자가 아직 부여 안 함)
  const noPassword = !tenant?.password;

  /** 비밀번호 기반 token — 비밀번호 모르면 sessionStorage 직접 set으로 우회 불가 */
  function makeAuthToken(tid: string, password: string): string {
    if (typeof window === 'undefined') return '';
    return window.btoa(`${tid}:${password}:v1`);
  }

  // sessionStorage에 인증 기억 (단순 '1'이 아니라 token)
  useEffect(() => {
    if (!tenant) return;
    if (bypassGate || noPassword) { setUnlocked(true); return; }
    const key = `tenant-auth-${tenant.id}`;
    const expected = makeAuthToken(tenant.id, tenant.password || '');
    if (sessionStorage.getItem(key) === expected) setUnlocked(true);
  }, [tenant?.id, tenant?.password, bypassGate, noPassword]);

  function tryUnlock(e?: React.FormEvent) {
    e?.preventDefault();
    if (!tenant) return;
    if (pw === tenant.password) {
      sessionStorage.setItem(`tenant-auth-${tenant.id}`, makeAuthToken(tenant.id, tenant.password));
      setUnlocked(true);
    } else {
      toast.error('비밀번호가 일치하지 않습니다');
    }
  }

  async function setPassword() {
    if (!tenant) return;
    const newPw = prompt('새 비밀번호 (4~12자)', tenant.password || '');
    if (newPw === null) return;
    if (newPw.length < 4 || newPw.length > 12) {
      toast.error('4~12자 사이로 입력하세요');
      return;
    }
    try {
      await saveTenant({ ...tenant, password: newPw });
      toast.success('비밀번호 저장됨');
    } catch (e: any) {
      toast.error(e?.message || '실패');
    }
  }

  const tenantLeases = useMemo(
    () => (tenant ? leases.filter((l) => l.tenant_id === tenant.id) : []),
    [tenant?.id, leases]
  );
  const tenantBillings = useMemo(
    () => (tenant ? billings.filter((b) => b.tenant_id === tenant.id).slice().sort((a, b) => b.period.localeCompare(a.period)) : []),
    [tenant?.id, billings]
  );
  const tenantBankTx = useMemo(
    () => (tenant ? bankTx.filter((tx) => tx.matched_tenant_id === tenant.id).slice().sort((a, b) => b.date.localeCompare(a.date)) : []),
    [tenant?.id, bankTx]
  );

  const totalCharged = tenantBillings.reduce((s, b) => s + b.total, 0);
  const totalPaid = tenantBillings.reduce((s, b) => s + (b.paid_amount || 0), 0);
  const owe = totalCharged - totalPaid;
  const todayStr = fmtDate(today);
  const oldestUnpaid = tenantBillings
    .filter((b) => b.total - (b.paid_amount || 0) > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const maxOverdueDays = oldestUnpaid && oldestUnpaid.due_date < todayStr
    ? daysBetween(oldestUnpaid.due_date, todayStr)
    : 0;

  function goToFloor(floorId: string | undefined) {
    if (!floorId) return;
    router.push(`/map?floor=${encodeURIComponent(floorId)}`);
  }

  if (!tenant) {
    return (
      <div className="space-y-5">
        <Card>
          <CardBody className="py-10 text-center text-[13px] text-zinc-400">
            해당 상사를 찾을 수 없습니다. <Link href="/tenants" className="text-blue-600 hover:underline ml-2">목록으로</Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  // 비밀번호 게이트
  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Card>
          <CardBody className="py-8">
            <div className="text-center mb-5">
              <Lock className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
              <h2 className="text-[16px] font-bold">{tenant.name}</h2>
              <p className="text-[11.5px] text-zinc-500 tabular mt-1">{tenant.biz_no}</p>
              <p className="text-[11.5px] text-zinc-500 mt-2">조회용 비밀번호를 입력하세요</p>
            </div>
            <form onSubmit={tryUnlock} className="space-y-3">
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="비밀번호"
                autoFocus
                className="w-full h-10 px-3 border border-zinc-300 rounded-md text-[13px] focus:outline-none focus:border-zinc-700"
              />
              <Button variant="primary" onClick={() => tryUnlock()} className="w-full">
                <KeyRound className="w-4 h-4" /> 조회
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Link href="/tenants" className="text-[11.5px] text-zinc-500 hover:text-zinc-900">← 목록으로</Link>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/tenants" className="inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="w-3.5 h-3.5" /> 입주상사 목록
        </Link>
        {bypassGate && (
          <button
            onClick={setPassword}
            className="ml-auto inline-flex items-center gap-1 px-2.5 h-7 text-[11.5px] border border-zinc-200 rounded-md hover:bg-zinc-50"
          >
            <KeyRound className="w-3 h-3" /> {tenant.password ? '비밀번호 변경' : '비밀번호 부여'}
          </button>
        )}
      </div>

      <PageHeader
        title={tenant.name}
        subtitle={
          <>
            <span className="tabular">{tenant.biz_no}</span>
            <span className="text-zinc-300 mx-1.5">·</span>
            {tenant.ceo}
            <span className="text-zinc-300 mx-1.5">·</span>
            <span className="tabular">{tenant.phone}</span>
          </>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Info label="계약" value={`${tenantLeases.filter((l) => l.status === 'active').length}건 활성`} />
        <Info label="누적 청구" value={`${fmtMoney(totalCharged)}원`} />
        <Info label="누적 수납" value={`${fmtMoney(totalPaid)}원`} tone="success" />
        <Info label="미수금" value={`${fmtMoney(Math.max(0, owe))}원`} tone={owe > 0 ? 'danger' : 'muted'} />
        <Info label="보증금" value={`${fmtMoney(tenant.deposit_paid || 0)}원`} />
      </div>

      {owe > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-red-700 font-semibold">미수 현황</div>
            <div className="text-[18px] font-bold text-red-700 tabular mt-0.5">{fmtMoney(owe)}원</div>
            <div className="text-[11px] text-red-700 mt-0.5">
              미납 {tenantBillings.filter((b) => b.total - (b.paid_amount || 0) > 0).length}건
              {maxOverdueDays > 0 && (<> · 최장 연체 <span className="font-bold">{maxOverdueDays}일</span></>)}
            </div>
          </div>
        </div>
      )}

      {/* 계약 */}
      <Card className="overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-[13.5px] font-semibold">계약 ({tenantLeases.length}건)</h2>
        </div>
        <table className="w-full text-[12px]">
          <thead className="bg-zinc-50 border-y border-zinc-200 text-zinc-600">
            <tr>
              <th className="text-left py-1.5 px-4 font-semibold whitespace-nowrap">계약 ID</th>
              <th className="text-left py-1.5 px-4 font-semibold">사무실</th>
              <th className="text-left py-1.5 px-4 font-semibold">전시장</th>
              <th className="text-center py-1.5 px-4 font-semibold whitespace-nowrap">기간</th>
              <th className="text-right py-1.5 px-4 font-semibold whitespace-nowrap">월 합계</th>
              <th className="text-center py-1.5 px-4 font-semibold whitespace-nowrap">상태</th>
            </tr>
          </thead>
          <tbody>
            {tenantLeases.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-6 text-zinc-400">계약 없음</td></tr>
            ) : (
              tenantLeases.map((l) => {
                const officeStalls = (l.office_stall_ids || l.stall_ids.filter((id) => byId.stall.get(id)?.type === 'office'))
                  .map((id) => byId.stall.get(id))
                  .filter((s): s is NonNullable<typeof s> => !!s);
                const officeRent = officeStalls.reduce((s, x) => s + (x.rent || 0), 0);
                const sectionInfos = (l.section_ids || []).map((sid) => {
                  const sec = byId.section.get(sid);
                  const secStalls = index.stallsBySection.get(sid) || [];
                  return { sec, count: secStalls.length, rent: secStalls.reduce((s, x) => s + (x.rent || 0), 0) };
                }).filter((x) => !!x.sec);
                const parkingRent = sectionInfos.reduce((s, x) => s + x.rent, 0);
                return (
                  <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 px-4 font-mono text-[10.5px] text-zinc-600">{l.id}</td>
                    <td className="py-2 px-4">
                      <div className="flex flex-wrap gap-1">
                        {officeStalls.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => goToFloor(s.floor_id)}
                            className="px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100"
                          >
                            {s.code}호
                          </button>
                        ))}
                        {officeStalls.length === 0 && <span className="text-zinc-300 text-[11px]">—</span>}
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex flex-wrap gap-1">
                        {sectionInfos.map(({ sec, count }) => (
                          <button
                            key={sec!.id}
                            onClick={() => goToFloor(sec!.floor_id)}
                            className="px-1.5 py-0.5 rounded border text-[11px] font-semibold tabular bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                          >
                            {sec!.name} {count}면
                          </button>
                        ))}
                        {sectionInfos.length === 0 && <span className="text-zinc-300 text-[11px]">—</span>}
                      </div>
                    </td>
                    <td className="py-2 px-4 text-center text-[11px] tabular text-zinc-700 whitespace-nowrap">
                      <div>{l.start}</div>
                      <div className="text-zinc-500">~ {l.end}</div>
                    </td>
                    <td className="py-2 px-4 text-right tabular font-semibold whitespace-nowrap">{fmtMoney(officeRent + parkingRent)}</td>
                    <td className="py-2 px-4 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        l.status === 'active' ? 'bg-green-100 text-green-700'
                        : l.status === 'terminated' ? 'bg-zinc-100 text-zinc-600'
                        : 'bg-orange-100 text-orange-700'
                      }`}>
                        {l.status === 'active' ? '활성' : l.status === 'terminated' ? '해지' : l.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      {/* 청구·수납 이력 */}
      <Card className="overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-[13.5px] font-semibold">청구·수납 이력 ({tenantBillings.length}건)</h2>
        </div>
        <table className="w-full text-[12px]">
          <thead className="bg-zinc-50 border-y border-zinc-200 text-zinc-600">
            <tr>
              <th className="text-center py-1.5 px-4 font-semibold whitespace-nowrap">청구월</th>
              <th className="text-right py-1.5 px-4 font-semibold whitespace-nowrap">청구액</th>
              <th className="text-right py-1.5 px-4 font-semibold whitespace-nowrap">수납</th>
              <th className="text-right py-1.5 px-4 font-semibold whitespace-nowrap">미수</th>
              <th className="text-center py-1.5 px-4 font-semibold whitespace-nowrap">마감일</th>
              <th className="text-center py-1.5 px-4 font-semibold whitespace-nowrap">상태</th>
            </tr>
          </thead>
          <tbody>
            {tenantBillings.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-6 text-zinc-400">청구 없음</td></tr>
            ) : (
              tenantBillings.map((b) => {
                const paid = b.paid_amount || 0;
                const o = b.total - paid;
                const overdue = o > 0 && b.due_date < todayStr;
                return (
                  <tr
                    key={b.id}
                    onClick={() => setOpenBilling(b.id)}
                    className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50/80 cursor-pointer ${overdue ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="py-2 px-4 text-center font-semibold tabular whitespace-nowrap">{b.period}</td>
                    <td className="py-2 px-4 text-right tabular">{fmtMoney(b.total)}</td>
                    <td className="py-2 px-4 text-right tabular text-green-700">{paid > 0 ? fmtMoney(paid) : '—'}</td>
                    <td className={`py-2 px-4 text-right tabular ${o > 0 ? 'text-red-600 font-bold' : 'text-zinc-300'}`}>
                      {o > 0 ? fmtMoney(o) : '—'}
                    </td>
                    <td className="py-2 px-4 text-center tabular text-zinc-600 whitespace-nowrap">{b.due_date}</td>
                    <td className="py-2 px-4 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        o === 0 ? 'bg-green-100 text-green-700'
                        : overdue ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {o === 0 ? '완납' : overdue ? '연체' : '미납'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      {/* 통장 매칭 입금 */}
      <Card className="overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-[13.5px] font-semibold">통장 매칭 입금 ({tenantBankTx.length}건)</h2>
        </div>
        <table className="w-full text-[12px]">
          <thead className="bg-zinc-50 border-y border-zinc-200 text-zinc-600">
            <tr>
              <th className="text-left py-1.5 px-4 font-semibold whitespace-nowrap">일자</th>
              <th className="text-left py-1.5 px-4 font-semibold">적요</th>
              <th className="text-right py-1.5 px-4 font-semibold whitespace-nowrap">입금</th>
              <th className="text-left py-1.5 px-4 font-semibold whitespace-nowrap">분류</th>
            </tr>
          </thead>
          <tbody>
            {tenantBankTx.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-6 text-zinc-400">매칭 입금 없음</td></tr>
            ) : (
              tenantBankTx.map((tx) => (
                <tr key={tx.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 px-4 tabular whitespace-nowrap text-zinc-700">{tx.date}</td>
                  <td className="py-2 px-4 text-zinc-700">{tx.description}</td>
                  <td className="py-2 px-4 text-right tabular text-green-700 font-semibold whitespace-nowrap">
                    +{fmtMoney(tx.deposit || 0)}
                  </td>
                  <td className="py-2 px-4 text-zinc-600 text-[11px] whitespace-nowrap">{tx.category || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <BillingDetailDialog
        open={!!openBilling}
        onClose={() => setOpenBilling(null)}
        billingId={openBilling}
      />
    </div>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' | 'muted' }) {
  const color =
    tone === 'success' ? 'text-green-700'
    : tone === 'danger' ? 'text-red-600'
    : tone === 'muted' ? 'text-zinc-500'
    : 'text-zinc-900';
  return (
    <div className="bg-zinc-50 rounded-md border border-zinc-200 px-2.5 py-1.5">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[13px] font-bold mt-0.5 tabular ${color}`}>{value}</div>
    </div>
  );
}
