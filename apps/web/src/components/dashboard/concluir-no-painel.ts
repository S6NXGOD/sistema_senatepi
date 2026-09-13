'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  concluirCompromisso, desfazerConclusao, mudarStatusCompromisso,
  type ConcluirResposta, type DesfechoOpcao,
} from '@/lib/agenda';
import {
  CHAVES_DEPOIS_DE_CONCLUIR, concluirNoResumo,
  type CompromissoCard, type ResumoDashboard,
} from '@/lib/dashboard';
import { avisoDeConcluida, DURACAO_DO_DESFAZER_MS } from '@/lib/acao-rapida';

export interface PedidoDeConclusao {
  c: CompromissoCard;
  opcao: DesfechoOpcao;
  obs?: string;
  /** `false` dispensa o seguimento SUGERIDO; o obrigatório ignora. */
  criarSeguimento?: boolean;
}

function mensagemDaApi(e: unknown, padrao: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return typeof m === 'string' && m ? m : padrao;
}

/**
 * CONCLUIR, INICIAR E DESFAZER A PARTIR DO PAINEL — um lugar só para a linha e a folha.
 *
 * O que mudou em relação ao botão antigo:
 *  · a linha sai da fila na hora (`concluirNoResumo`) e volta se a API recusar;
 *  · as chaves invalidadas são as que existem (`CHAVES_DEPOIS_DE_CONCLUIR`);
 *  · o aviso diz o que foi gravado e o que nasceu junto, e oferece "Desfazer"
 *    por 8 s quando a conclusão não criou nada;
 *  · `origem: 'PAINEL'` vai para o histórico — sem isso, a próxima medição de
 *    "desfecho mais usado" mede o próprio botão;
 *  · "ocupado" é por linha: terminar uma conclusão não libera o botão de outra
 *    que ainda está no ar.
 */
export function useConcluirNoPainel() {
  const qc = useQueryClient();
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set());

  const marcar = (id: string, ligado: boolean) =>
    setOcupados((antes) => {
      const depois = new Set(antes);
      if (ligado) depois.add(id);
      else depois.delete(id);
      return depois;
    });

  const invalidar = () => {
    for (const queryKey of CHAVES_DEPOIS_DE_CONCLUIR) {
      void qc.invalidateQueries({ queryKey: [...queryKey] });
    }
  };

  const desfazer = useMutation({
    mutationFn: (id: string) => desfazerConclusao(id),
    onSuccess: () => toast.success('Conclusão desfeita. A atividade voltou para a fila.'),
    onError: (e) => toast.error(mensagemDaApi(e, 'Não foi possível desfazer a conclusão.')),
    onSettled: () => invalidar(),
  });

  const concluir = useMutation({
    mutationFn: ({ c, opcao, obs, criarSeguimento }: PedidoDeConclusao) =>
      concluirCompromisso(c.id, {
        desfecho: opcao.slug,
        ...(obs ? { desfechoObs: obs } : {}),
        ...(criarSeguimento === false ? { criarSeguimento: false } : {}),
        origem: 'PAINEL',
      }),
    onMutate: async ({ c }) => {
      marcar(c.id, true);
      await qc.cancelQueries({ queryKey: ['dashboard-resumo'] });
      const antes = qc.getQueryData<ResumoDashboard>(['dashboard-resumo']);
      if (antes) qc.setQueryData<ResumoDashboard>(['dashboard-resumo'], concluirNoResumo(antes, c.id));
      return { antes };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(['dashboard-resumo'], ctx.antes);
      toast.error(mensagemDaApi(e, 'Não foi possível concluir agora.'));
    },
    onSuccess: (resp: ConcluirResposta, { c, opcao }) => {
      const aviso = avisoDeConcluida(resp, opcao.label);
      if (aviso.desfazer) {
        toast.success(aviso.texto, {
          duration: DURACAO_DO_DESFAZER_MS,
          action: { label: 'Desfazer', onClick: () => desfazer.mutate(c.id) },
        });
      } else {
        toast.success(aviso.texto);
      }
    },
    onSettled: (_r, _e, { c }) => {
      marcar(c.id, false);
      invalidar();
    },
  });

  const iniciar = useMutation({
    mutationFn: (id: string) => mudarStatusCompromisso(id, 'EM_ANDAMENTO'),
    onMutate: (id) => marcar(id, true),
    onSuccess: () => toast.success('Iniciada. O cronômetro corre na agenda.'),
    onError: (e) => toast.error(mensagemDaApi(e, 'Não foi possível iniciar agora.')),
    onSettled: (_r, _e, id) => {
      marcar(id, false);
      invalidar();
    },
  });

  return {
    /** Resolve com a resposta, ou `null` quando a API recusou (o aviso já saiu). */
    concluir: async (pedido: PedidoDeConclusao): Promise<ConcluirResposta | null> => {
      try {
        return await concluir.mutateAsync(pedido);
      } catch {
        return null;
      }
    },
    iniciar: (id: string) => iniciar.mutate(id),
    ocupado: (id: string) => ocupados.has(id),
    invalidar,
  };
}
