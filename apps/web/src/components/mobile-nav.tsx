'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Logo } from '@/components/logo';
import { NAV_ITENS } from '@/components/nav-items';
import { useAuth } from '@/lib/auth';

/** Hamburger + Sheet lateral com a navegação — visível só no mobile (md:hidden). */
export function MobileNav() {
  const [aberto, setAberto] = useState(false);
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <div className="md:hidden">
      <Button variant="ghost" size="icon" onClick={() => setAberto(true)} aria-label="Abrir menu">
        <Menu className="h-6 w-6" />
      </Button>

      <Sheet open={aberto} onClose={() => setAberto(false)} side="left">
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
          <Logo orientation="horizontal" variant="auto" className="h-8" />
          <Button variant="ghost" size="icon" onClick={() => setAberto(false)} aria-label="Fechar menu">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITENS.map((item) => {
            const ativo = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setAberto(false)}
                className={cn(
                  'flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  ativo
                    ? 'bg-senatepi-800 text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Rodapé: Meu Perfil + Sair do Sistema */}
        <div className="space-y-1 border-t p-3">
          <Link
            href="/configuracoes"
            onClick={() => setAberto(false)}
            className="flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="h-5 w-5" /> Meu Perfil
          </Link>
          <button
            type="button"
            onClick={() => { setAberto(false); logout(); }}
            className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <LogOut className="h-5 w-5" /> Sair do Sistema
          </button>
        </div>
      </Sheet>
    </div>
  );
}
