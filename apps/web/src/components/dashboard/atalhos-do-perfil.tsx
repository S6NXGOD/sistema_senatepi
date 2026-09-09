'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Headset, UserPlus, Gavel, CalendarPlus, Scale, Search, CalendarRange,
  ShieldCheck, Building2, FileCheck2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { V } from '@/lib/vocabulario';
import { nivelEfetivo, type ModuloKey, type PerfilUsuario } from '@/lib/permissoes';

/**
 * ATALHOS DO PERFIL — o painel deixa de ser só leitura.
 *
 * O painel dizia muito bem o que está acontecendo e não oferecia NADA para
 * fazer a respeito. Quem abre o sistema de manhã sabe o que vai fazer: a
 * secretaria vai registrar um atendimento, o advogado vai lançar um andamento
 * ou marcar um prazo. Todos passavam pelo mesmo caminho — ler o painel, ir ao
 * menu, achar a tela, achar o botão.
 *
 * TRÊS REGRAS que mantêm isto útil em vez de virar enfeite:
 *
 * 1. NO MÁXIMO QUATRO. Uma fileira de dez atalhos é um segundo menu, e um
 *    segundo menu não é atalho de nada.
 * 2. SÓ O QUE O PERFIL FAZ TODO DIA. "Auditoria" é importante e não é diário;
 *    fica no menu.
 * 3. FILTRADO PELA PERMISSÃO REAL, com `nivelEfetivo` — o mesmo cálculo do
 *    back. Um atalho que leva a 403 é pior que atalho nenhum.
 */
interface Atalho {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Módulo e nível mínimo — o atalho some se a pessoa não puder. */
  modulo: ModuloKey;
  exigeEditar?: boolean;
}

function atalhosDe(role?: PerfilUsuario | string | null): Atalho[] {
  switch (role) {
    /**
     * O advogado trabalha em cima do PROCESSO e do PRAZO. "Novo atendimento"
     * não entra: quem faz triagem é o balcão.
     */
    case 'ADVOGADO':
      return [
        { href: '/agenda?aba=7dias', label: 'Meus prazos (7 dias)', icon: CalendarPlus, modulo: 'agenda' },
        { href: '/processos?preProcessuais=1', label: 'Casos a ajuizar', icon: FileCheck2, modulo: 'processos' },
        { href: '/processos?meus=1', label: 'Meus processos', icon: Gavel, modulo: 'processos' },
        { href: '/escalas', label: 'Escala', icon: CalendarRange, modulo: 'escalas' },
      ];

    /** O balcão: registrar quem chegou e achar quem ligou. */
    case 'TRIAGEM':
      return [
        { href: '/atendimentos?novo=1', label: 'Novo atendimento', icon: Headset, modulo: 'atendimentos', exigeEditar: true },
        { href: '/filiados/novo', label: 'Nova filiação', icon: UserPlus, modulo: 'filiados', exigeEditar: true },
        { href: '/filiados', label: `Buscar ${V.filiado}`, icon: Search, modulo: 'filiados' },
        { href: '/empresas', label: 'Empresas', icon: Building2, modulo: 'empresas' },
      ];

    /** Quem coordena olha a operação: onde está travando e quem está sobrecarregado. */
    case 'COORDENACAO':
      return [
        { href: '/agenda?aba=aberto', label: 'Prazos em aberto', icon: CalendarPlus, modulo: 'agenda' },
        { href: '/processos?semReu=1', label: 'Cadastros a fechar', icon: Scale, modulo: 'processos' },
        { href: '/escalas', label: 'Escalas', icon: CalendarRange, modulo: 'escalas' },
        { href: '/atendimentos', label: 'Fila de atendimento', icon: Headset, modulo: 'atendimentos' },
      ];

    default:
      return [
        { href: '/usuarios', label: 'Usuários e perfis', icon: ShieldCheck, modulo: 'usuarios' },
        { href: '/agenda?aba=aberto', label: 'Prazos em aberto', icon: CalendarPlus, modulo: 'agenda' },
        { href: '/processos?preProcessuais=1', label: 'Casos a ajuizar', icon: FileCheck2, modulo: 'processos' },
        { href: '/atendimentos', label: 'Fila de atendimento', icon: Headset, modulo: 'atendimentos' },
      ];
  }
}

export function AtalhosDoPerfil({
  role,
  permissoes,
  className,
}: {
  role?: PerfilUsuario | string | null;
  permissoes?: unknown;
  className?: string;
}) {
  const atalhos = atalhosDe(role).filter((a) => {
    const nivel = nivelEfetivo(role, permissoes, a.modulo);
    return a.exigeEditar ? nivel === 'EDITAR' : nivel !== 'SEM_ACESSO';
  });
  if (!atalhos.length) return null;

  return (
    /*
      UMA LINHA QUE ROLA, EM VEZ DE TRÊS QUE QUEBRAM.

      Com `flex-wrap`, quatro pílulas de texto viravam duas ou três linhas no
      telefone — mais altura que o cabeçalho inteiro, para atalhos que a barra
      lateral também oferece. Rolando na horizontal, ocupam UMA linha sempre, e
      o gesto (arrastar de lado) é o que já se usa em qualquer app.

      `scrollbar-none` some com a barra no desktop; `-mx-1 px-1` deixa o foco do
      teclado respirar sem cortar o anel. No desktop volta a quebrar, porque lá
      cabe e rolagem horizontal com mouse é ruim.
    */
    <div
      className={cn(
        'flex gap-2 overflow-x-auto scrollbar-none -mx-1 px-1 pb-0.5',
        'sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0',
        className,
      )}
    >
      {atalhos.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background',
              // 44px no telefone: a pílula tinha 32px de altura, abaixo do
              // mínimo de alvo de toque. No desktop volta a 32, onde o ponteiro
              // acerta e a altura conta.
              'h-11 px-3.5 text-sm font-medium transition hover:bg-muted sm:h-8 sm:px-3',
            )}
          >
            <Icon className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
