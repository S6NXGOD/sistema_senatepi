'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { NAV_ITENS } from './nav-items';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/profile';

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-16 items-center border-b px-6">
        <Logo orientation="horizontal" variant="auto" className="h-9" />
      </div>

      {/* Perfil do usuário logado (abre as Configurações) */}
      <Link
        href="/configuracoes"
        className="flex items-center gap-3 border-b px-4 py-3 transition-colors hover:bg-muted"
        title="Meu perfil"
      >
        {user?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-senatepi-400 text-sm font-bold text-senatepi-900">
            {user?.nome?.charAt(0) ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.nome ?? '—'}</p>
          {user?.role && (
            <span className="mt-0.5 inline-block rounded bg-senatepi-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300">
              {ROLE_LABEL[user.role]}
            </span>
          )}
        </div>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITENS.map((item) => {
          const ativo = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                ativo
                  ? 'bg-senatepi-800 text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Rodapé: Meu Perfil + Sair do Sistema */}
      <div className="space-y-1 border-t p-3">
        <Link
          href="/configuracoes"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-5 w-5" /> Meu Perfil
        </Link>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <LogOut className="h-5 w-5" /> Sair do Sistema
        </button>
      </div>
    </aside>
  );
}
