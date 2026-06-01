'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Crown, UserPlus, X, Shield } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { grantManager, revokeManager, writeAudit } from '@/lib/data';
import { useAuth, ADMIN_EMAILS } from '@/lib/auth-context';
import { Card, CardHeader, CardBody } from './Card';
import { Button } from './Button';
import { fmtDate } from '@/lib/utils';

interface ManagerDoc { email: string; role: string; }

export function ManagerSettings() {
  const { user, isAdmin } = useAuth();
  const [managers, setManagers] = useState<ManagerDoc[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(collection(db, 'users'), (snap) => {
      setManagers(snap.docs
        .map((d) => ({ email: d.id, role: d.data().role }))
        .filter((m) => m.role === 'admin'));
    });
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function add() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      toast.error('올바른 이메일 입력');
      return;
    }
    setBusy(true);
    try {
      await grantManager(email);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'manager_grant', target: email,
        memo: `${email} 관리자 권한 부여`,
        at: fmtDate(new Date()),
      });
      setNewEmail('');
      toast.success(`${email} 관리자 부여`);
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally { setBusy(false); }
  }

  async function remove(email: string) {
    if (!confirm(`${email} 관리자 권한을 해제할까요?`)) return;
    try {
      await revokeManager(email);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'manager_revoke', target: email,
        memo: `${email} 관리자 권한 해제`,
        at: fmtDate(new Date()),
      });
      toast.success(`${email} 권한 해제`);
    } catch (e: any) { toast.error(e?.message || '실패'); }
  }

  return (
    <Card>
      <CardHeader
        title="관리자 부여"
        desc="마스터 전용 · 도면 만들기 등 편집 권한을 가질 사용자 이메일 등록"
        action={<Crown className="w-4 h-4 text-amber-500" />}
      />
      <CardBody>
        <div className="space-y-2 mb-4">
          <div className="text-[11.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
            마스터 (코드 등록)
          </div>
          {ADMIN_EMAILS.map((e) => (
            <div key={e} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-md text-[12.5px]">
              <Crown className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="font-semibold text-amber-900">{e}</span>
              <span className="ml-auto text-[10.5px] text-amber-700">MASTER</span>
            </div>
          ))}
        </div>

        <div className="space-y-2 mb-4">
          <div className="text-[11.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
            관리자 ({managers.length})
          </div>
          {managers.length === 0 ? (
            <div className="text-[12px] text-zinc-400 text-center py-4 border border-dashed border-zinc-200 rounded-md">
              등록된 관리자 없음
            </div>
          ) : (
            managers.map((m) => (
              <div key={m.email} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-md text-[12.5px]">
                <Shield className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="font-semibold text-blue-900">{m.email}</span>
                <span className="ml-auto text-[10.5px] text-blue-700">MANAGER</span>
                <button
                  onClick={() => remove(m.email)}
                  className="text-blue-500 hover:text-red-600 p-0.5"
                  title="권한 해제"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="pt-3 border-t border-zinc-200">
          <div className="text-[11.5px] font-semibold text-zinc-500 mb-1.5">
            새 관리자 추가
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder="example@gmail.com"
              className="flex-1 border border-zinc-200 rounded-md px-3 py-1.5 text-[12.5px] focus:outline-none focus:border-zinc-500"
            />
            <Button variant="primary" size="sm" onClick={add} disabled={busy}>
              <UserPlus className="w-3.5 h-3.5" /> 부여
            </Button>
          </div>
          <div className="text-[10.5px] text-zinc-500 mt-1.5">
            * 사용자가 먼저 이 이메일로 가입해야 합니다. 등록 후 다음 로그인 시 적용
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
