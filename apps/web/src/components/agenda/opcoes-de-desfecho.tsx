'use client';

import {
  CheckCircle2, FilePlus2, Gavel, Link2, Scale, Handshake, FileCheck2, AlertTriangle, UserX,
  PhoneCall, PhoneOff, ClipboardCheck, CalendarClock, CircleSlash, FileSearch, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Carregando, Esqueleto } from '@/components/ui/esqueleto';
import type { DesfechoOpcao } from '@/lib/agenda';

/** Ícone por desfecho; o que não estiver aqui usa o genérico. */
export const ICONE_DO_DESFECHO: Record<string, typeof CheckCircle2> = {
  DUVIDA_ESCLARECIDA: CheckCircle2,
  VINCULADO_PROCESSO: Link2,
  PROCESSO_CRIADO: FilePlus2,
  CONCLUIDA: CheckCircle2,
  AUDIENCIA_ACORDO: Handshake,
  AUDIENCIA_SEM_ACORDO: Gavel,
  AUDIENCIA_INSTRUCAO: Gavel,
  PRAZO_CUMPRIDO: FileCheck2,
  PRAZO_SEM_PECA: FileSearch,
  PRAZO_PERDIDO: AlertTriangle,
  DILIGENCIA_CUMPRIDA: CheckCircle2,
  DILIGENCIA_INFRUTIFERA: AlertTriangle,
  DESPACHO_OBTIDO: FileCheck2,
  DESPACHO_NAO_ATENDIDO: AlertTriangle,
  PERICIA_REALIZADA: CalendarClock,
  PERICIA_LAUDO_ENTREGUE: FileCheck2,
  CONTATO_CONFIRMADO: PhoneCall,
  CONTATO_NAO_COMPARECERA: UserX,
  CONTATO_SEM_SUCESSO: PhoneOff,
  ACOMPANHAMENTO_CUMPRIDO: ClipboardCheck,
  ACOMPANHAMENTO_PENDENTE: CalendarClock,
  ACOMPANHAMENTO_SEM_OBJETO: CircleSlash,
};

/**
 * AS OPÇÕES DE DESFECHO DE UM TIPO — uma grade só, para o modal e para a folha.
 *
 * O painel tinha a terceira implementação de "concluir": uma tabela de palpites
 * escrita no front, com um desfecho por tipo. A reunião sem deliberação só
 * podia fechar "com encaminhamentos", e a API criava calada uma tarefa
 * obrigatória na agenda de alguém. Esta grade lê o catálogo da API e é a MESMA
 * no modal da agenda e na folha do painel — o que um oferece, o outro oferece.
 *
 * Resultado ruim (`alerta`) sai em âmbar, nunca em vermelho: o sistema registra
 * o que a pessoa disse, não afirma perda de prazo.
 *
 * Erro não vira lista vazia: sem o catálogo não se conclui, e a tela diz por quê.
 */
export function OpcoesDeDesfecho({
  opcoes,
  valor,
  onEscolher,
  carregando,
  erro,
  onTentarDeNovo,
  rotulo = 'O que aconteceu?',
  className,
}: {
  opcoes: readonly DesfechoOpcao[];
  /** Slug escolhido; vazio quando ninguém escolheu ainda. */
  valor: string;
  onEscolher: (slug: string) => void;
  carregando?: boolean;
  erro?: boolean;
  onTentarDeNovo?: () => void;
  /** Nome acessível do grupo. */
  rotulo?: string;
  className?: string;
}) {
  if (carregando) {
    return (
      <Carregando texto="Carregando as opções deste tipo de atividade" className={className}>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <Esqueleto key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </Carregando>
    );
  }

  if (erro) {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200',
          className,
        )}
      >
        <span>Não foi possível carregar as opções deste tipo. Sem elas não dá para concluir.</span>
        {onTentarDeNovo && (
          <button
            type="button"
            onClick={onTentarDeNovo}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-background/70 px-3 text-xs font-semibold transition hover:bg-background sm:h-9 dark:border-amber-900/60"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
          </button>
        )}
      </div>
    );
  }

  if (!opcoes.length) return null;

  return (
    <div role="radiogroup" aria-label={rotulo} className={cn('grid grid-cols-1 gap-1.5 sm:grid-cols-2', className)}>
      {opcoes.map((o) => {
        const Icon = ICONE_DO_DESFECHO[o.slug] ?? Scale;
        const ativo = valor === o.slug;
        return (
          <button
            key={o.slug}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onEscolher(o.slug)}
            className={cn(
              'flex min-h-11 items-start gap-2 rounded-lg border p-2.5 text-left transition',
              ativo
                ? o.alerta
                  ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/25'
                  : 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                : 'hover:bg-muted/50',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                o.alerta
                  ? 'text-amber-600 dark:text-amber-400'
                  : ativo
                    ? 'text-brand-700 dark:text-brand-400'
                    : 'text-muted-foreground',
              )}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              {o.ajuda && (
                <span className="block text-[11px] leading-snug text-muted-foreground">{o.ajuda}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
