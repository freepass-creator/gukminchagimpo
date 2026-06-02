'use client';

import { ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { DataProvider } from '@/lib/data-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        <Shell>{children}</Shell>
      </DataProvider>
    </AuthProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[12px] text-zinc-500 animate-pulse">로그인 확인 중...</div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="h-screen flex bg-zinc-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <Header />
        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="px-7 py-6 h-full min-h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
