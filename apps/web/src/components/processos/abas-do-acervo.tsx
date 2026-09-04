'use client';

import Link from 'next/link';
import { Gavel, Newspaper, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIntegracoes } from '@/lib/use-integracoes';

/**
 * AS TRÊS VISTAS DO MESMO ACERVO, numa barra só.
 *
 * Publicações e Panorama nasceram como itens de menu, e foi erro meu: a seção
 * Jurídica foi de cinco para sete linhas, e "processos", "publicações dos
 * processos" e "panorama dos processos" competiam como se fossem três lugares
 * diferentes. São o mesmo lugar visto de três alturas — a lista, o que os
 * tribunais publicaram nela, e o que ela mostra quando somada.
 *
 * As ROTAS continuam existindo (`/publicacoes`, `/panorama`): link salvo em
 * favorito, atalho da home e link colado no WhatsApp continuam abrindo. O que
 * mudou foi o caminho de descoberta.
 */

const ABAS = [
  { chave: 'lista', href: '/processos', label: 'Processos', icon: Gavel },
  { chave: 'publicacoes', href: '/publicacoes', label: 'Publicações', icon: Newspaper },
  { chave: 'panorama', href: '/panorama', label: 'Panorama', icon: Scale },
] as const;

export type AbaDoAcervo = (typeof ABAS)[number]['chave'];

export function AbasDoAcervo({ atual }: { atual: AbaDoAcervo }) {
  const { djen } = useIntegracoes();

  // Sem DJEN não há publicações — a aba some, como o item de menu sumia.
  const visiveis = ABAS.filter((a) => a.chave !== 'publicacoes' || djen);
  if (visiveis.length < 2) return null;

  return (
    <nav
      aria-label="Vistas do acervo"
      className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 md:mx-0 md:px-0"
    >
      {visiveis.map((a) => {
        const ativo = a.chave === atual;
        return (
          <Link
            key={a.chave}
            href={a.href}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              // -mb-px encosta a borda ativa na borda do contêiner, sem degrau.
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition',
              ativo
                ? 'border-brand-700 font-semibold text-brand-800 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            style={{ marginBottom: -1 }}
          >
            <a.icon className="h-4 w-4" />
            {a.label}
          </Link>
        );
      })}
    </nav>
  );
}
