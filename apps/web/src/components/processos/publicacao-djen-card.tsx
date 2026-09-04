'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ExternalLink, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatData } from '@/lib/agenda';
import type { GrupoDePublicacoes } from '@/lib/publicacoes-irmas';

/**
 * O cartão de UMA publicação do DJEN — o mesmo na gaveta da atividade e na aba
 * do processo, para que o advogado leia a mesma coisa do mesmo jeito nos dois
 * lugares.
 *
 * Duas decisões de tela, as duas por medição:
 *
 * 1. O TEOR VEM DOBRADO. A maior publicação da produção tem 22.380 caracteres
 *    — um acórdão inteiro. Aberto, ele empurra o resto da gaveta para fora da
 *    tela e, no celular, vira rolagem infinita. Fica em seis linhas com "Ler
 *    tudo"; quem precisa do inteiro teor abre.
 * 2. AS CÓPIAS VIRAM UMA LINHA. Ver `publicacoes-irmas.ts`.
 */

export interface PublicacaoExibivel {
  id: string;
  texto: string;
  dataDisponibilizacao: string;
  link?: string | null;
  tipoComunicacao?: string | null;
  nomeOrgao?: string | null;
  prazoMencionadoDias?: number | null;
  advogados?: { nome: string | null; numeroOab: string | null; ufOab: string | null }[] | null;
}

/** Nome próprio em CAIXA ALTA cansa de ler; o tribunal manda tudo assim. */
function capitalizar(nome: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1),
    )
    .join(' ');
}

export function PublicacaoDjenCard({
  grupo,
  rotulo,
  chips,
  acoes,
  destacada,
  como: Tag = 'div',
  className,
}: {
  grupo: GrupoDePublicacoes<PublicacaoExibivel>;
  /**
   * Rótulo antes dos selos. A gaveta da atividade usa ("Teor da publicação"),
   * porque ali o texto do tribunal aparece dentro de uma TAREFA e precisa se
   * apresentar; a aba Publicações não usa, porque seria dizer o óbvio.
   */
  rotulo?: string;
  /** Selos extras da tela (providência, tribunal), ao lado do tipo. */
  chips?: React.ReactNode;
  /** Links de navegação que variam por tela (ver no processo, ver andamento). */
  acoes?: React.ReactNode;
  /** Id da publicação que a navegação está apontando — cópia também vale. */
  destacada?: string | null;
  como?: 'div' | 'li';
  className?: string;
}) {
  const [inteiro, setInteiro] = useState(false);
  const [verAdvogados, setVerAdvogados] = useState(false);
  const pub = grupo.principal;
  const copias = grupo.copias.length;
  const advogados = (pub.advogados ?? []).filter((a) => a.nome);
  const apontada =
    !!destacada && (destacada === pub.id || grupo.copias.some((c) => c.id === destacada));

  // Seis linhas cabem sem empurrar o resto da tela; ~90 caracteres por linha
  // no desktop, menos no celular — por isso o corte é generoso.
  const longo = pub.texto.length > 600;

  return (
    <Tag
      id={`pub-${pub.id}`}
      className={cn(
        'rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 transition-colors dark:border-indigo-900/40 dark:bg-indigo-950/10',
        apontada && 'bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-950/30',
        className,
      )}
    >
      {/*
        Âncoras das CÓPIAS. Vir de outra tela apontando para a cópia (é o id que
        o andamento guarda) tem de chegar ao cartão que a contém, e não a um
        elemento que o agrupamento removeu do DOM.
      */}
      {grupo.copias.map((c) => (
        <span key={c.id} id={`pub-${c.id}`} aria-hidden className="block h-0" />
      ))}

      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {rotulo && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {rotulo}
            </span>
          )}
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
            {pub.tipoComunicacao ?? 'Publicação'}
          </span>
          {chips}
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {formatData(pub.dataDisponibilizacao)}
        </span>
      </div>

      {pub.nomeOrgao && (
        <p className="mb-1 text-[11px] text-muted-foreground">{pub.nomeOrgao}</p>
      )}

      <div className="relative">
        <p
          className={cn(
            'whitespace-pre-wrap break-words text-sm leading-snug',
            longo && !inteiro && 'line-clamp-6',
          )}
        >
          {pub.texto}
        </p>
        {longo && !inteiro && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-indigo-50/90 to-transparent dark:from-indigo-950/30"
          />
        )}
      </div>
      {longo && (
        <button
          type="button"
          onClick={() => setInteiro((v) => !v)}
          className="mt-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
        >
          {/*
            "NO TOTAL" NÃO É REDUNDÂNCIA.
            "Ler tudo (822 caracteres)" se lê como "há mais 822 caracteres", e
            o jurídico leu exatamente assim. O número é o tamanho do texto
            inteiro, não do que está escondido — e o escondido não dá para
            contar, porque o corte é por LINHA (line-clamp), não por caractere.
            Duas palavras resolvem o que uma reescrita do corte não resolveria.
          */}
          {inteiro
            ? 'Recolher'
            : `Ler tudo (${pub.texto.length.toLocaleString('pt-BR')} caracteres no total)`}
        </button>
      )}

      {/*
        O prazo é o que o TEXTO diz — não um vencimento calculado. A contagem
        oficial depende de dias úteis forenses, feriado da comarca e forma de
        intimação, e o sistema não os conhece.
      */}
      {pub.prazoMencionadoDias != null && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            O texto menciona prazo de <strong>{pub.prazoMencionadoDias} dias</strong>. Confira a
            contagem oficial — o sistema não calcula vencimento.
          </span>
        </p>
      )}

      {(copias > 0 || advogados.length > 0) && (
        <div className="mt-2 border-t border-indigo-200/70 pt-2 dark:border-indigo-900/40">
          <button
            type="button"
            onClick={() => setVerAdvogados((v) => !v)}
            disabled={!advogados.length}
            className="flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground disabled:cursor-default"
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              {copias > 0 ? (
                <>
                  Mesma publicação, enviada a <strong>{copias + 1} destinatários</strong>
                </>
              ) : (
                <>
                  <strong>{advogados.length}</strong>{' '}
                  {advogados.length === 1 ? 'advogado intimado' : 'advogados intimados'}
                </>
              )}
            </span>
            {advogados.length > 0 && (
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform', verAdvogados && 'rotate-180')}
              />
            )}
          </button>
          {verAdvogados && advogados.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {advogados.map((a, i) => (
                <li key={`${a.numeroOab}-${i}`} className="text-[11px] leading-snug text-muted-foreground">
                  {capitalizar(a.nome ?? '')}
                  {a.numeroOab && (
                    <span className="text-muted-foreground/70">
                      {' '}
                      · OAB {a.numeroOab}
                      {a.ufOab ? `/${a.ufOab}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {acoes}
        {pub.link && (
          <a
            href={pub.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
          >
            <ExternalLink className="h-3 w-3" /> Documento no tribunal
          </a>
        )}
      </div>
    </Tag>
  );
}
