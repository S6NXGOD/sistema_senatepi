'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { filtrarNav, ehItemAtivo } from './nav-items';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/profile';

/**
 * A BARRA LATERAL — e as três coisas que ela fazia mal.
 *
 * 1. ELA NÃO CABIA. Com dezesseis itens em seis seções, o administrador
 *    precisava de ~910px de lista numa área de `100vh − 238px`. Em 1080p com o
 *    Chrome maximizado sobram ~700px: cinco linhas ficavam escondidas atrás do
 *    scroll, e as escondidas eram sempre as mesmas — Relatórios e Auditoria, no
 *    fim de Administração. Item de menu que ninguém vê não existe.
 *
 *    O conserto é densidade, não corte: `py-2` no lugar de `py-2.5` e um espaço
 *    menor entre seções. São ~120px recuperados, e a lista passa a caber inteira
 *    para ADVOGADO (9 itens) e TRIAGEM (6) — os dois perfis que mais usam. Para
 *    o administrador ainda sobra rolagem, e é por isso que existem os dois itens
 *    seguintes.
 *
 * 2. NADA LEVAVA O ITEM ATIVO PARA A VISTA. Abrindo /auditoria com a lista
 *    rolada no topo, o item aceso ficava fora da tela e a lateral inteira
 *    parecia apagada. Agora ele se traz para dentro na montagem.
 *
 * 3. O ATIVO ERA SÓ COR. Sem `aria-current`, um leitor de tela não sabe onde
 *    está — e a barra de abas do acervo já fazia certo, com teste cobrando.
 *
 * A REGRA DO ITEM ATIVO mora em `nav-items.ts` (`ehItemAtivo`), não copiada
 * aqui: ela estava duplicada literalmente nesta barra e na gaveta do celular, e
 * duas cópias da mesma regra é como o sistema já teve duas definições de
 * "atrasada" discordando na mesma tela.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const secoes = filtrarNav(user?.role, user?.permissoes);
  const nav = useRef<HTMLElement>(null);

  /*
    TRAZ O ATIVO PARA A VISTA — uma vez, na montagem, e sem animação.
    `block: 'nearest'` não mexe se o item já estiver visível, que é o caso comum;
    rolar suavemente a cada navegação chamaria atenção para o menu quando a
    atenção deve ir para o conteúdo.
  */
  useEffect(() => {
    const alvo = nav.current?.querySelector('[data-ativo="true"]');
    alvo?.scrollIntoView({ block: 'nearest' });
  }, [pathname]);

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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-400 text-sm font-bold text-brand-900">
            {(user?.nomeExibicao || user?.nome)?.charAt(0) ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          {/* O apelido é o que a interface exibe; sem ele, o nome completo. */}
          <p className="truncate text-sm font-semibold">{user?.nomeExibicao || user?.nome || '—'}</p>
          {user?.role && (
            <span className="mt-0.5 inline-block rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
              {ROLE_LABEL[user.role]}
            </span>
          )}
        </div>
      </Link>

      <nav ref={nav} aria-label="Navegação principal" className="flex-1 space-y-3 overflow-y-auto p-3">
        {secoes.map((secao) => (
          <div key={secao.titulo} className="space-y-0.5">
            <p className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {secao.titulo}
            </p>
            {secao.itens.map((item) => {
              const ativo = ehItemAtivo(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-ativo={ativo}
                  aria-current={ativo ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    ativo
                      ? 'bg-brand-800 text-white shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Rodapé: Meu Perfil + Sair do Sistema */}
      <div className="space-y-0.5 border-t p-3">
        <Link
          href="/configuracoes"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-5 w-5 shrink-0" /> Meu Perfil
        </Link>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <LogOut className="h-5 w-5 shrink-0" /> Sair do Sistema
        </button>
      </div>
    </aside>
  );
}
