'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Home, IdCard, LogOut, Receipt, UserRound } from 'lucide-react';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import { moduloAtivo } from '@/tenant.config';
import { usePortalFiliado } from '@/components/portal-filiado/portal-guard';

/**
 * A CASCA DO PORTAL — cabeçalho e navegação.
 *
 * MOBILE PRIMEIRO, e aqui não é slogan: quem usa isto abre do celular, no
 * corredor do hospital, entre um plantão e outro. A navegação é uma barra
 * FIXA NO RODAPÉ, onde o polegar alcança; no desktop a mesma lista vira uma
 * fileira de abas embaixo do cabeçalho.
 *
 * COBRANÇAS SÓ ONDE EXISTE. O SINDSERM tem o módulo desligado — lá a
 * contribuição é desconto em folha —, e a aba simplesmente não nasce. Ler o
 * registro do cliente é mais honesto do que esconder com CSS: a rota da API
 * também recusa, então uma aba visível levaria a um 403.
 */
const ITENS = [
  { href: '/filiado', rotulo: 'Início', Icone: Home, exato: true },
  { href: '/filiado/carteirinha', rotulo: 'Carteirinha', Icone: IdCard },
  { href: '/filiado/processos', rotulo: 'Processos', Icone: FileText },
  { href: '/filiado/cobrancas', rotulo: 'Cobranças', Icone: Receipt, modulo: 'cobrancas' as const },
  { href: '/filiado/cadastro', rotulo: 'Cadastro', Icone: UserRound },
];

export function CascaDoPortal({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { filiado, sair } = usePortalFiliado();

  const itens = ITENS.filter((i) => !i.modulo || moduloAtivo(i.modulo));
  const ativo = (i: (typeof ITENS)[number]) =>
    i.exato ? pathname === i.href : pathname.startsWith(i.href);

  const primeiroNome = filiado?.nomeCompleto.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Logo orientation="horizontal" variant="auto" className="h-7 shrink-0" />
          <div className="min-w-0 flex-1 text-right">
            {/* O nome some no celular: o espaço vale mais para o logo e o sair. */}
            <p className="hidden truncate text-xs font-medium sm:block">{primeiroNome}</p>
          </div>
          <button
            type="button"
            onClick={sair}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </div>

        {/* Abas do desktop — no celular a navegação está no rodapé. */}
        <nav className="mx-auto hidden max-w-3xl gap-1 px-4 pb-2 sm:flex">
          {itens.map(({ href, rotulo, Icone, ...resto }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                ativo({ href, rotulo, Icone, ...resto })
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icone className="h-4 w-4" /> {rotulo}
            </Link>
          ))}
        </nav>
      </header>

      {/* `pb-24` no celular: a barra do rodapé não pode cobrir o fim do conteúdo. */}
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:pb-10">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="mx-auto grid max-w-3xl"
          style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}
        >
          {itens.map(({ href, rotulo, Icone, ...resto }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                // 56px de altura: alvo de toque confortável sem comer a tela.
                'flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                ativo({ href, rotulo, Icone, ...resto })
                  ? 'text-brand-800 dark:text-brand-300'
                  : 'text-muted-foreground',
              )}
            >
              <Icone className="h-5 w-5" />
              {rotulo}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
