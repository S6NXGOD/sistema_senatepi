'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileNav } from '@/components/mobile-nav';

export function Topbar() {
  const { theme, setTheme } = useTheme();

  /*
    Perfil e "Sair do Sistema" ficam na Sidebar/gaveta — não duplicados aqui.

    SEM SINO (12/09/2026). Ele repetia o painel numa gaveta que precisava ser
    aberta, e ninguém abria. O que não pode esperar aparece na faixa logo abaixo
    deste cabeçalho, em toda tela; o dia da pessoa mora no painel.
  */
  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-4 md:px-6">
      <div className="flex items-center gap-2">
        <MobileNav />
        <h1 className="text-base font-semibold md:text-lg">Painel administrativo</h1>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Alternar tema"
        >
          <Sun className="h-5 w-5 dark:hidden" />
          <Moon className="hidden h-5 w-5 dark:block" />
        </Button>
      </div>
    </header>
  );
}
