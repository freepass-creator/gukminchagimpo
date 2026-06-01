'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from 'firebase/auth';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u) router.replace('/dashboard');
    });
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, pw);
        toast.success('로그인 성공');
      } else {
        await createUserWithEmailAndPassword(auth, email, pw);
        toast.success('계정 생성 + 로그인 성공');
      }
      router.replace('/dashboard');
    } catch (e: any) {
      toast.error(e?.message || '로그인 실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-zinc-200 shadow-card p-7">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 bg-zinc-900 rounded-lg flex items-center justify-center">
            <Building2 className="w-[18px] h-[18px] text-white" />
          </div>
          <div>
            <div className="text-[14px] font-semibold leading-tight">
              국민차매매단지 공항점
            </div>
            <div className="text-[11.5px] text-zinc-500 leading-tight mt-0.5">
              임대관리 시스템
            </div>
          </div>
        </div>

        <h2 className="text-[18px] font-bold mb-1">
          {mode === 'signin' ? '로그인' : '계정 만들기'}
        </h2>
        <p className="text-[12px] text-zinc-500 mb-5">
          이메일과 비밀번호로 접속
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">
              이메일
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="w-full border border-zinc-200 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">
              비밀번호 (6자 이상)
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full border border-zinc-200 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-zinc-500"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy}
          >
            {busy ? '처리 중...' : mode === 'signin' ? '로그인' : '계정 생성'}
          </Button>
        </form>

        <div className="mt-4 text-center text-[12px] text-zinc-500">
          {mode === 'signin' ? '처음이신가요?' : '계정이 있으신가요?'}{' '}
          <button
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            className="text-zinc-900 font-semibold hover:underline"
          >
            {mode === 'signin' ? '계정 만들기' : '로그인'}
          </button>
        </div>
      </div>
    </div>
  );
}
