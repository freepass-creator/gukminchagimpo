'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Database, AlertTriangle, ShieldX, Crown, FileCode, Trash2, Upload } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardBody } from '@/components/Card';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/list/PageHeader';
import { MigrationDialog } from '@/components/MigrationDialog';
import { runSeed } from '@/lib/seed';
import { wipeCollection } from '@/lib/data';

export default function DevToolsPage() {
  const { user, isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; today: string } | null>(null);
  const [openMigration, setOpenMigration] = useState(false);

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto py-10">
        <Card>
          <CardBody className="pt-6 pb-6 text-center">
            <ShieldX className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
            <h2 className="text-[16px] font-bold mb-1">마스터 전용</h2>
            <p className="text-[12.5px] text-zinc-500">
              개발 도구는 마스터 어드민(👑)만 접근할 수 있습니다.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  async function doSeed() {
    if (!confirm('현재 Firestore의 모든 운영 데이터를 삭제하고 가상 초기 데이터로 재시드합니다. 진행할까요?')) return;
    setBusy(true);
    try {
      const res = await runSeed(user?.email || 'system');
      setResult(res);
      toast.success(`시드 완료 — ${res.created}건 생성`);
    } catch (e: any) {
      toast.error(e?.message || '시드 실패');
    } finally { setBusy(false); }
  }

  async function wipeAll() {
    const phrase = prompt('정말로 모든 데이터를 삭제하시려면 "DELETE ALL"을 입력하세요');
    if (phrase !== 'DELETE ALL') { toast.error('확인 문구가 일치하지 않아 취소됨'); return; }
    setBusy(true);
    try {
      const cols = ['stalls', 'tenants', 'leases', 'billings', 'payments', 'audit_logs', 'floors', 'decors', 'parking_sections', 'bank_transactions'];
      let total = 0;
      for (const c of cols) total += await wipeCollection(c);
      toast.success(`${total}건 삭제됨`);
    } catch (e: any) { toast.error(e?.message || '실패'); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="개발 도구"
        subtitle={
          <>
            <Crown className="w-3 h-3 text-amber-500 inline mr-1" />
            마스터 전용 · 데이터 시드 · 일괄 삭제 · 디버깅 도구
          </>
        }
      />

      {/* 시드 */}
      <Card>
        <CardHeader
          title="초기 데이터 시드"
          desc="가상 단지·상사·계약·청구 등 데모 데이터 일괄 생성"
          action={<Database className="w-4 h-4 text-zinc-400" />}
        />
        <CardBody>
          <ul className="text-[12.5px] text-zinc-700 space-y-1.5 mb-4">
            <li>· A동·B동 (각 50×50 그리드)</li>
            <li>· 사무실 + 주차칸 (자동 배치)</li>
            <li>· 입주상사 5곳 + 계약 5건</li>
            <li>· 최근 3개월 청구 + 일부 미납</li>
            <li>· 단지 운영 정책 기본값</li>
          </ul>
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-4 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-[12px] text-amber-900">
              <b>주의:</b> 실행 시 기존 Firestore 데이터가 모두 삭제됩니다.
            </div>
          </div>
          <Button variant="primary" onClick={doSeed} disabled={busy}>
            <Database className="w-3.5 h-3.5" />
            {busy ? '시드 중...' : '초기 데이터 시드 실행'}
          </Button>
          {result && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md text-[12px] text-green-900">
              ✓ {result.created}개 도큐먼트 생성됨 · 가상 오늘 = {result.today}
            </div>
          )}
        </CardBody>
      </Card>

      {/* 마이그레이션 */}
      <Card>
        <CardHeader
          title="임대 현황·미수금 일괄 마이그레이션"
          desc="신규 운영 시작 시 기존 상사·계약·이월 미수금을 엑셀로 한 번에 업로드"
          action={<Upload className="w-4 h-4 text-zinc-400" />}
        />
        <CardBody>
          <ul className="text-[12.5px] text-zinc-700 space-y-1.5 mb-4">
            <li>· 엑셀 컬럼: 상사명 · 사업자번호 · 대표 · 전화 · 사무실호수 · 블럭코드 · 시작일 · 종료일 · 월세 · 관리비 · 보증금 · 이월미수금</li>
            <li>· 상사 자동 매칭 (없으면 자동 생성)</li>
            <li>· 이월 미수금은 'open' 청구로 등록 → 미수 관리에 즉시 반영</li>
            <li>· 검증 단계에서 오류 행은 제외</li>
          </ul>
          <Button variant="primary" onClick={() => setOpenMigration(true)} disabled={busy}>
            <Upload className="w-3.5 h-3.5" /> 마이그레이션 시작
          </Button>
        </CardBody>
      </Card>

      <MigrationDialog open={openMigration} onClose={() => setOpenMigration(false)} />

      {/* 전체 삭제 */}
      <Card>
        <CardHeader
          title="전체 데이터 삭제"
          desc="단지·계약·청구·통장 등 모든 운영 데이터 일괄 삭제"
          action={<Trash2 className="w-4 h-4 text-red-500" />}
        />
        <CardBody>
          <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-[12px] text-red-900">
            ⚠ 이 작업은 되돌릴 수 없습니다. 확인 문구 입력 필요.
          </div>
          <Button variant="danger" onClick={wipeAll} disabled={busy}>
            <Trash2 className="w-3.5 h-3.5" /> 모든 데이터 삭제
          </Button>
        </CardBody>
      </Card>

      {/* 안내 */}
      <Card>
        <CardHeader
          title="시스템 정보"
          action={<FileCode className="w-4 h-4 text-zinc-400" />}
        />
        <CardBody className="text-[12px] text-zinc-700 space-y-1">
          <div>· Firestore 프로젝트: <span className="font-mono">gukminchagimpo</span></div>
          <div>· 마스터 이메일: <span className="font-mono">dudguq@gmail.com</span></div>
          <div>· 데모용 가상 오늘: <span className="font-mono">2026-06-01</span></div>
          <div>· 추가 개발 도구는 여기에 누적됩니다</div>
        </CardBody>
      </Card>
    </div>
  );
}
