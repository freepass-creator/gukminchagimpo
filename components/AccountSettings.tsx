'use client';

import { Crown, Shield, User, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardBody } from './Card';
import { Button } from './Button';

export function AccountSettings() {
  const { user, isAdmin, isManager, signOut } = useAuth();

  if (!user) return null;

  return (
    <Card>
      <CardHeader title="내 정보" desc="현재 로그인 계정 · 권한 확인 · 로그아웃" />
      <CardBody>
        <div className="space-y-3">
          {/* 이메일 + 권한 */}
          <div className="flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
            <div className="w-10 h-10 bg-zinc-900 rounded-full flex items-center justify-center shrink-0">
              {isAdmin ? <Crown className="w-5 h-5 text-amber-400" /> : isManager ? <Shield className="w-5 h-5 text-blue-400" /> : <User className="w-5 h-5 text-zinc-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13px] truncate">{user.email}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {isAdmin && (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10.5px] font-semibold rounded">
                    👑 마스터
                  </span>
                )}
                {!isAdmin && isManager && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10.5px] font-semibold rounded">
                    🛡 관리자
                  </span>
                )}
                {!isAdmin && !isManager && (
                  <span className="px-2 py-0.5 bg-zinc-100 text-zinc-700 text-[10.5px] font-semibold rounded">
                    일반 운영자
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 권한 안내 */}
          <div className="text-[11.5px] text-zinc-600 space-y-0.5 px-1">
            {isAdmin && (
              <>
                <div>· 모든 운영 기능 + 시드 + 관리자 부여 가능</div>
              </>
            )}
            {!isAdmin && isManager && (
              <>
                <div>· 도면 만들기 가능</div>
                <div>· 시드·관리자 부여는 마스터에게 요청</div>
              </>
            )}
            {!isAdmin && !isManager && (
              <>
                <div>· 보기·임대 계약·청구·자금일보 가능</div>
                <div>· 도면 편집 필요 시 마스터에게 관리자 권한 요청</div>
              </>
            )}
          </div>

          {/* 로그아웃 */}
          <div className="pt-2 border-t border-zinc-200">
            <Button variant="outline" onClick={signOut} className="w-full">
              <LogOut className="w-3.5 h-3.5" /> 로그아웃
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
