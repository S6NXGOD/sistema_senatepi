'use client';

import { useEffect, useRef } from 'react';

/**
 * À MEIA-NOITE, OS DADOS VIRAM JUNTO COM OS RÓTULOS (15/09/2026).
 *
 * `useHojeBR` passou a virar o "Hoje" e o "Amanhã" da agenda à meia-noite de
 * Teresina, mas as consultas não levam o dia na chave: o recorte de Hoje era o
 * pedido ontem. Com a agenda aberta a noite toda (o computador da recepção), a
 * manhã abria "Hoje · ter, 15/09" com "Nenhuma atividade hoje." e as consultas
 * do dia de fora, e os números das abas eram os de ontem. Nada refazia a busca
 * sozinho: o QueryClient só tem staleTime, sem refetchInterval.
 *
 * O prefixo `compromissos` alcança quadro, todas, recortes, minhas e mês; as
 * pendências e o resumo do painel também cortam pelo dia. As chaves ficam
 * literais no laço: o teste das chaves do web só confere o que consegue ler.
 */
interface QueInvalida {
  invalidateQueries(filtro: { queryKey: string[] }): unknown;
}

/**
 * Refaz as consultas se o dia mudou desde o último visto. O primeiro desenho
 * não conta: quem abre a tela já busca com o dia certo.
 */
export function refazerSeODiaVirou(visto: { current: string }, hoje: string, qc: QueInvalida): boolean {
  if (visto.current === hoje) return false;
  visto.current = hoje;
  for (const chave of [['compromissos'], ['minhas-pendencias'], ['dashboard-resumo']]) qc.invalidateQueries({ queryKey: chave });
  return true;
}

export function useRefazerNaViradaDoDia(hoje: string, qc: QueInvalida): void {
  const visto = useRef(hoje);
  useEffect(() => {
    refazerSeODiaVirou(visto, hoje, qc);
  }, [hoje, qc]);
}
