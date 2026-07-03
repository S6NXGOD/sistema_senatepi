'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export function Topbar() {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div>
        <h1 className="text-lg font-semibold">Painel administrativo</h1>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Alternar tema"
        >
          <Sun className="h-5 w-5 dark:hidden" />
          <Moon className="hidden h-5 w-5 dark:block" />
        </Button>
        <div className="text-right">
          <p className="text-sm font-medium">{user?.nome}</p>
          <p className="text-xs text-muted-foreground">{user?.role}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-senatepi-400 font-semibold text-senatepi-900">
          {user?.nome?.charAt(0) ?? '?'}
        </div>
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
