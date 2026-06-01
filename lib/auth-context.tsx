'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { useRouter, usePathname } from 'next/navigation';

/** 마스터 어드민 이메일 화이트리스트 */
export const ADMIN_EMAILS = ['dudguq@gmail.com'];

export const isAdminEmail = (email?: string | null): boolean =>
  !!email && ADMIN_EMAILS.includes(email.toLowerCase());

interface AuthCtx {
  user: User | null;
  loading: boolean;
  /** 마스터 (코드 화이트리스트) */
  isAdmin: boolean;
  /** 관리자 (마스터가 부여) — 도면 편집 등 가능 */
  isManager: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [managerRole, setManagerRole] = useState<boolean>(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (!u && pathname !== '/login') {
        router.replace('/login');
      } else if (u && pathname === '/login') {
        router.replace('/dashboard');
      }
    });
  }, [pathname, router]);

  // Firestore users/{email} doc 구독 — role 확인
  useEffect(() => {
    if (!user?.email) { setManagerRole(false); return; }
    return onSnapshot(doc(db, 'users', user.email.toLowerCase()), (snap) => {
      if (snap.exists() && snap.data().role === 'admin') {
        setManagerRole(true);
      } else {
        setManagerRole(false);
      }
    });
  }, [user?.email]);

  async function signOut() {
    await fbSignOut(auth);
    router.replace('/login');
  }

  const isAdmin = isAdminEmail(user?.email);
  const isManager = isAdmin || managerRole;

  return (
    <Ctx.Provider value={{ user, loading, isAdmin, isManager, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
