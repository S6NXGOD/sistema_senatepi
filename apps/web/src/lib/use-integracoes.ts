'use client';

import { useQuery } from '@tanstack/react-query';
import { statusDjen } from '@/lib/djen';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';

/**
 * Quais integrações externas estão LIGADAS nesta instalação, agora.
 *
 * Por que não vem do `tenant.config`: aquele arquivo é resolvido no BUILD, e
 * desligar uma integração é mudar uma variável de ambiente e reiniciar a API —
 * sem rebuild do front. Uma cópia da decisão no bundle mentiria no intervalo
 * entre as duas coisas, e a mentira apareceria como um item de menu que abre
 * uma tela dizendo "desligado".
 *
 * `/djen/status` é de propósito a única rota do DJEN que responde com a
 * integração desligada — as outras devolvem 404. A resposta fica em cache por
 * cinco minutos: ninguém liga e desliga integração no meio da navegação.
 */
export function useIntegracoes(): { djen: boolean; carregando: boolean } {
  const { user } = useAuth();
  /**
   * Nem pergunta quando a pessoa não tem o módulo.
   *
   * `/djen/status` é `@Modulo('processos')`, e a Triagem tem SEM_ACESSO ali —
   * perguntar levaria 403 em toda navegação dela. O resultado seria o mesmo
   * (item escondido), mas com um erro por página no console e no log da API.
   */
  const permitido = podeVer(user?.role, user?.permissoes, 'processos');

  const { data, isLoading } = useQuery({
    queryKey: ['djen-status'],
    queryFn: statusDjen,
    enabled: permitido,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { djen: permitido && !!data?.ativo, carregando: permitido && isLoading };
}
