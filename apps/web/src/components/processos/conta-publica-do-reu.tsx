'use client';

import Link from 'next/link';
import { ArrowRight, Landmark, TriangleAlert } from 'lucide-react';
import { SITUACAO_FISCAL, type SituacaoFiscal } from '@/lib/municipios';
import { cn } from '@/lib/utils';

/**
 * A CONTA PÚBLICA DE QUEM ESTÁ DO OUTRO LADO — 22/09/2026.
 *
 * O PEDIDO: "Não seria interessante de vez em quando aparecer uma notícia aos
 * advogados com uma orientação — por exemplo, se houver processos para
 * respeitar o piso em tal cidade, mostrar se estão ou não amparados pela LRF."
 *
 * O DIAGNÓSTICO NÃO ERA "FALTA DADO". Contas Públicas já classifica a situação,
 * já calcula em reais quanto cabe na folha antes de a lei proibir aumento, já
 * conhece as exceções do art. 22 e já avisa do art. 21 no fim do mandato. O que
 * faltava é que nada disso chegava a quem está com o processo na mão: é uma
 * tela que ninguém abre no meio de uma petição.
 *
 * Medido na produção: **52 dos 191 processos** não arquivados têm uma parte
 * ligada a um ente do IBGE. Teresina responde por 11 deles.
 *
 * O SISTEMA NÃO RECOMENDA — e aqui isso pesa mais do que em qualquer outro
 * lugar. Ele mostra o NÚMERO e NOMEIA o argumento que a outra parte vai
 * levantar; a tese é do advogado. Por isso a frase do art. 22 vai inteira, com
 * as ressalvas, e não virou um selo "pode/não pode".
 *
 * O MESMO VOCABULÁRIO DAS CONTAS PÚBLICAS (`SITUACAO_FISCAL`): mesma cor, mesmo
 * rótulo. Duas telas que falam do mesmo número com palavras diferentes fazem a
 * pessoa achar que são dois números.
 */

export interface ContaPublicaDoReu {
  codigoIBGE: number;
  nome: string;
  uf: string | null;
  esfera: string;
  situacao: SituacaoFiscal;
  oQueSignifica: string;
  percentualRcl: number | null;
  limitePrudencial: number | null;
  limiteMaximo: number | null;
  folga: { valor: number; percentualDaFolha: number } | null;
  aviso: { fimDeMandato: boolean; posse: string; texto: string } | null;
  exercicio: number | null;
  quadrimestre: number | null;
}

const pct = (v: number | null) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Dinheiro público em petição se lê em milhão, não em centavo.
 *
 * "R$ 512.243.118,44" ocupa a linha e ninguém retém; "R$ 512,2 milhões" é o que
 * a pessoa vai dizer na mesa. Abaixo de um milhão volta ao formato normal,
 * porque "R$ 0,4 milhão" é pior que "R$ 412 mil".
 */
export function emDinheiroCurto(valor: number): string {
  const abs = Math.abs(valor);
  if (abs >= 1e9) return `R$ ${(valor / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bilhões`;
  if (abs >= 1e6) return `R$ ${(valor / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} milhões`;
  if (abs >= 1e3) return `R$ ${(valor / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return `R$ ${valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

/** O selo curto, para caber ao lado do nome do réu no cabeçalho. */
export function SeloFiscalDoReu({ conta }: { conta: ContaPublicaDoReu }) {
  const s = SITUACAO_FISCAL[conta.situacao];
  if (!s) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold', s.cor)}
      title={`${conta.nome}: ${s.rotulo}. ${s.ajuda}`}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', s.ponto)} aria-hidden="true" />
      {conta.percentualRcl === null ? s.curto : pct(conta.percentualRcl)}
    </span>
  );
}

export function ContaPublicaDoReuCard({ conta }: { conta: ContaPublicaDoReu }) {
  const s = SITUACAO_FISCAL[conta.situacao];
  if (!s) return null;

  const folgaPositiva = conta.folga && conta.folga.valor > 0;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-4 py-2.5">
        <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-bold">
          {conta.nome}
          {conta.uf ? `/${conta.uf}` : ''}
        </h3>
        <span className="text-xs text-muted-foreground">gasto com pessoal</span>
      </div>

      <div className="space-y-3 px-4 py-3.5">
        {/*
          O NÚMERO PRIMEIRO, GRANDE. É o que o advogado vai citar. Os limites
          ao lado, pequenos: sem eles o percentual não quer dizer nada — 47% é
          confortável numa prefeitura (teto 54) e quase estouro no Estado (49).
        */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums leading-none">{pct(conta.percentualRcl)}</span>
          <span
            className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', s.cor)}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', s.ponto)} aria-hidden="true" />
            {s.rotulo}
          </span>
          {conta.limiteMaximo !== null && (
            <span className="text-xs text-muted-foreground">
              teto {pct(conta.limiteMaximo)} · prudencial {pct(conta.limitePrudencial)}
            </span>
          )}
        </div>

        {/*
          A FOLGA EM REAIS é o número de negociação, e é o que não existia em
          lugar nenhum perto de um processo: "há R$ X de espaço legal na folha"
          responde de frente o "não posso, a LRF me impede".
        */}
        {folgaPositiva && (
          <p className="text-sm leading-relaxed">
            Cabe ainda <strong className="font-semibold">{emDinheiroCurto(conta.folga!.valor)}</strong> na
            folha antes do limite prudencial —{' '}
            {conta.folga!.percentualDaFolha.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% a mais
            do que o ente gasta hoje.
          </p>
        )}

        {/*
          A FRASE INTEIRA DO ART. 22, com as exceções. Ela é longa de propósito:
          é nela que está a ressalva do "que decorre de sentença judicial ou de
          lei" — exatamente o que a prefeitura omite ao dizer "estou no
          prudencial, não posso pagar o piso".
        */}
        <p className="text-xs leading-relaxed text-muted-foreground">{conta.oQueSignifica}</p>

        {/*
          O ART. 21 NÃO OLHA O PERCENTUAL. Nos 180 dias finais do mandato o
          aumento é NULO mesmo com o ente dentro do limite — sem esta linha a
          ficha diria "pode" a quem não pode.
        */}
        {conta.aviso && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{conta.aviso.texto}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
          <span className="text-[11px] text-muted-foreground">
            {conta.exercicio
              ? `Relatório de Gestão Fiscal · ${conta.quadrimestre}º quadrimestre de ${conta.exercicio} · Tesouro Nacional`
              : 'Tesouro Nacional'}
          </span>
          <Link
            href={`/contas-publicas?ente=${conta.codigoIBGE}`}
            className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-brand-800 transition hover:underline dark:text-brand-300"
          >
            Ver a ficha completa <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
