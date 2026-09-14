'use client';

import { useQuery } from '@tanstack/react-query';
import { Esqueleto } from '@/components/ui/esqueleto';
import { coberturaDoDiario } from '@/lib/djen';
import { linhasDaCobertura } from '@/lib/djen-cobertura';

/**
 * POR ONDE O DIÁRIO ALCANÇA ESTE PROCESSO — uma linha de estado na aba
 * Publicações.
 *
 * 14/09/2026. "Nenhuma publicação encontrada" não dizia se o processo era
 * vigiado. Os 37 processos cadastrados depois da carga de 04/09 tinham só 38,4%
 * dos dias com publicação cobertos, e a ficha não deixava ver isso. As frases
 * vêm prontas da API, que sabe se o processo é vivo, dormente ou sem número.
 *
 * Sem cor de alerta: é estado, não aviso. A chave fica debaixo de
 * `['djen-publicacoes', processoId]` de propósito: o "Buscar no DJEN" já
 * invalida esse prefixo, e a data da consulta se atualiza junto.
 *
 * Rota ausente (API antiga na janela de troca) ou erro sem dado: não mostra
 * nada. Falha de revalidação com dado bom mantém a linha.
 */
export function LinhaDeCobertura({ processoId }: { processoId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['djen-publicacoes', processoId, 'cobertura'],
    queryFn: () => coberturaDoDiario(processoId),
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading) return <Esqueleto className="h-4 w-3/4" />;

  const linhas = linhasDaCobertura(data);
  if (!linhas) return null;

  return <p className="text-xs leading-snug text-muted-foreground">{linhas.join(' ')}</p>;
}
