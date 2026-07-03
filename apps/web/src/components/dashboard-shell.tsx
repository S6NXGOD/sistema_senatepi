'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { Loader2 } from 'lucide-react';

/** Casca do administrativo (guard de auth + Sidebar + Topbar). Mobile-first. */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, carregando } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!carregando && !user) router.replace('/login');
  }, [carregando, user, router]);

  if (carregando || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-senatepi-800" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-cinza-claro dark:bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
