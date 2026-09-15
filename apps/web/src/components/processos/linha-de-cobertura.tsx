'use client';

import { useQuery } from '@tanstack/react-query';
import { Esqueleto } from '@/components/ui/esqueleto';
import { coberturaDoDiario } from '@/lib/djen';
import { partesDaCobertura } from '@/lib/djen-cobertura';

/**
 * POR ONDE O DIÁRIO ALCANÇA ESTE PROCESSO — uma linha de estado na aba
 * Publicações.
 *
 * 14/09/2026. "Nenhuma publicação encontrada" não dizia se o processo era
 * vigiado. Os 37 processos cadastrados depois da carga de 04/09 tinham só 38,4%
 * dos dias com publicação cobertos, e a ficha não deixava ver isso. As frases
 * vêm prontas da API, que sabe se o processo é vivo, dormente ou sem número.
 *
 * 15/09/2026: a principal numa linha e o resto embaixo, menor. Coladas num
 * parágrafo só, a frase que responde "por onde chega?" sumia entre as datas.
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

  if (isLoading) {
    return (
      <div aria-hidden="true" className="space-y-1.5">
        <Esqueleto className="h-3.5 w-3/4" />
        <Esqueleto className="h-3 w-2/5" />
      </div>
    );
  }

  const partes = partesDaCobertura(data);
  if (!partes) return null;

  return (
    <div className="animate-surgir space-y-0.5">
      <p className="text-xs leading-snug text-foreground/80">{partes.principal}</p>
      {partes.apoio.map((linha) => (
        <p key={linha} className="text-[11px] leading-snug text-muted-foreground">
          {linha}
        </p>
      ))}
    </div>
  );
}
