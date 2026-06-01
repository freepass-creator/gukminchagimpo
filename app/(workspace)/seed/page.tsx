'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Database, AlertTriangle, ShieldX } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardBody } from '@/components/Card';
import { Button } from '@/components/Button';
import { runSeed } from '@/lib/seed';

export default function SeedPage() {
  const { user, isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; today: string } | null>(null);

  if (!isAdmin) {
    return (
      <div className="max-w-xl">
        <Card>
          <CardBody className="pt-6 pb-6 text-center">
            <ShieldX className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
            <h2 className="text-[16px] font-bold mb-1">접근 권한 없음</h2>
            <p className="text-[12.5px] text-zinc-500">
              초기 데이터 시드는 마스터 어드민만 실행할 수 있습니다.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  async function trigger() {
    if (
      !confirm(
        '현재 Firestore의 운영 데이터를 모두 삭제하고 가상 초기 데이터로 재시드합니다.\n진행할까요?'
      )
    )
      return;
    setBusy(true);
    try {
      const res = await runSeed(user?.email || 'system');
      setResult(res);
      toast.success(`시드 완료 — ${res.created}건 생성`);
    } catch (e: any) {
      toast.error(e?.message || '시드 실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">데이터 시드</h1>
        <p className="text-[12.5px] text-zinc-500 mt-0.5">
          가상 초기 데이터를 Firestore에 입력. 데모/검증용.
        </p>
      </div>

      <Card>
        <CardHeader
          title="초기 데이터 구성"
          desc="국민차매매단지 공항점 가상 데이터"
        />
        <CardBody>
          <ul className="text-[12.5px] text-zinc-700 space-y-1.5 mb-5">
            <li>· A동 사무실 8실 + 주차공간 14칸</li>
            <li>· B동 사무실 4실 + 주차공간 10칸</li>
            <li>· 입주 상사 5곳 (천일모터스 · 대한오토 · 태성모빌리티 · 블루카 · 국민모터스)</li>
            <li>· 임대 계약 5건 (정상 · 만료예정 · 연체 · 입점예정 · 다중 사무실 케이스)</li>
            <li>· 4~6월 청구 + 일부 미납 (연체 시뮬레이션)</li>
            <li>· 단지 운영 정책 기본값</li>
          </ul>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-[12px] text-amber-900">
              실행 시 <b>기존 Firestore 데이터가 모두 삭제</b>됩니다.
              실제 운영 진입 후에는 사용하지 마세요.
            </div>
          </div>

          <Button variant="primary" onClick={trigger} disabled={busy}>
            <Database className="w-3.5 h-3.5" />
            {busy ? '시드 중...' : '초기 데이터 시드 실행'}
          </Button>

          {result && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-[12px] text-green-900">
              ✓ {result.created}개 도큐먼트 생성됨 · 가상 오늘 = {result.today}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
