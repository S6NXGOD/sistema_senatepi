'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { CompromissoCard } from '@/components/agenda/compromisso-card';
import { cn } from '@/lib/utils';
import {
  Compromisso, StatusCompromisso, STATUS_ORDEM, STATUS_LABEL, TRANSICOES,
} from '@/lib/agenda';

const COL_DOT: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-amber-400',
  EM_ANDAMENTO: 'bg-sky-500',
  CONCLUIDO: 'bg-emerald-500',
  CANCELADO: 'bg-muted-foreground',
};

/**
 * COLUNAS TERMINAIS — o que já acabou.
 *
 * Elas continuam no quadro porque reabrir é permitido (`TRANSICOES` deixa
 * CONCLUIDO e CANCELADO voltarem para PENDENTE), e arrastar de volta exige ver
 * o cartão. O que muda nelas é só o TETO: cheias, mostram as mais recentes.
 *
 * VAZIAS, CONTINUAM DO TAMANHO NORMAL. Cheguei a encolhê-las e estava errado —
 * ver o comentário do estado vazio abaixo.
 */
const TERMINAIS: StatusCompromisso[] = ['CONCLUIDO', 'CANCELADO'];

/**
 * QUANTAS CABEM ANTES DE VIRAR DEPÓSITO.
 *
 * Medido na produção em 04/09/2026, na aba "Todos": 37 concluídas e 18
 * canceladas contra 6 pendentes — **90% do quadro é trabalho morto**, e cresce
 * todo mês. Dez é o que se olha ("o que fechamos ultimamente"); o resto vira
 * rolagem que ninguém percorre. As outras continuam a um clique.
 */
const TETO_TERMINAL = 10;

/**
 * Quadro Kanban por status.
 *
 * O ARRASTE respeita a mesma máquina de estados da API: uma coluna só aceita o
 * card se a transição existir, e soltar em "Concluído"/"Cancelado" abre o
 * diálogo correspondente em vez de fechar o evento sem desfecho/motivo. Antes,
 * arrastar mudava o status direto — era por aí que os eventos terminavam sem
 * ninguém saber o que tinha acontecido.
 */
export function KanbanView({
  compromissos, onAbrir, onEditar, onVerTriagem, onAcao,
  onConcluir, onCancelar, onRemarcar, onExcluir, podeExcluir, apontado, onNovo,
}: {
  compromissos: Compromisso[];
  onAbrir: (c: Compromisso) => void;
  onEditar: (c: Compromisso) => void;
  onVerTriagem: (atendimentoId: string) => void;
  onAcao: (id: string, status: StatusCompromisso) => void;
  onConcluir: (c: Compromisso) => void;
  onCancelar: (c: Compromisso) => void;
  onRemarcar: (c: Compromisso) => void;
  onExcluir?: (c: Compromisso) => void;
  podeExcluir?: boolean;
  /** Id do cartão para o qual a navegação apontou — ver `CompromissoCard`. */
  apontado?: string | null;
  /**
   * Abre o formulário de nova atividade — é o que a coluna vazia oferece.
   * Ver o comentário do estado vazio, abaixo.
   */
  onNovo?: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [sobre, setSobre] = useState<StatusCompromisso | null>(null);
  /** Colunas terminais que a pessoa mandou abrir por inteiro. */
  const [semTeto, setSemTeto] = useState<StatusCompromisso[]>([]);

  const porStatus = (s: StatusCompromisso) => compromissos.filter((c) => c.status === s);
  const arrastado = compromissos.find((c) => c.id === dragId) ?? null;

  /** A coluna aceita o card? (mesma regra da API — a tela não promete o que o servidor recusa.) */
  function aceita(destino: StatusCompromisso): boolean {
    if (!arrastado) return false;
    if (arrastado.status === destino) return false;
    return TRANSICOES[arrastado.status]?.includes(destino) ?? false;
  }

  function soltar(destino: StatusCompromisso) {
    const card = arrastado;
    setDragId(null);
    setSobre(null);
    if (!card || !aceita(destino)) return;
    // Concluir e cancelar precisam de informação — abrem o diálogo próprio.
    if (destino === 'CONCLUIDO') return onConcluir(card);
    if (destino === 'CANCELADO') return onCancelar(card);
    onAcao(card.id, destino);
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {STATUS_ORDEM.map((s) => {
        const itens = porStatus(s);
        const podeSoltar = aceita(s);
        const bloqueada = !!arrastado && !podeSoltar && arrastado.status !== s;
        const terminal = TERMINAIS.includes(s);
        const aberta = semTeto.includes(s);
        const visiveis = terminal && !aberta ? itens.slice(0, TETO_TERMINAL) : itens;
        const escondidas = itens.length - visiveis.length;

        return (
          <div
            key={s}
            onDragOver={(e) => { if (podeSoltar) { e.preventDefault(); setSobre(s); } }}
            onDragLeave={() => setSobre((cur) => (cur === s ? null : cur))}
            onDrop={() => soltar(s)}
            className={cn(
              'flex flex-col rounded-xl border bg-muted/30 p-2 transition-colors',
              sobre === s && podeSoltar && 'border-brand-500 bg-brand-50/50 dark:bg-brand-900/20',
              bloqueada && 'opacity-50',
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${COL_DOT[s]}`} /> {STATUS_LABEL[s]}
              </p>
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {itens.length}
              </span>
            </div>

            <div className="min-h-[80px] flex-1 space-y-2">
                {visiveis.map((c) => (
                  <CompromissoCard
                    key={c.id}
                    c={c}
                    apontado={apontado === c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onAbrir={onAbrir}
                    onEditar={onEditar}
                    onVerTriagem={onVerTriagem}
                    onAcao={onAcao}
                    onConcluir={onConcluir}
                    onCancelar={onCancelar}
                    onRemarcar={onRemarcar}
                    onExcluir={onExcluir}
                    podeExcluir={podeExcluir}
                  />
                ))}

                {/*
                  O RESTO CONTINUA A UM CLIQUE. Esconder sem dizer quantas seria
                  mentir sobre o tamanho da coluna; dizer sem deixar abrir seria
                  um beco.
                */}
                {escondidas > 0 && (
                  <button
                    type="button"
                    onClick={() => setSemTeto((v) => [...v, s])}
                    className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    Ver as outras {escondidas}
                  </button>
                )}

                {/*
                  A COLUNA VAZIA CONTINUA À VISTA — e eu já tentei o contrário.

                  Cheguei a trocar as quatro colunas vazias por uma mensagem
                  central ("nada marcado para hoje"). Estava errado, e a
                  correção veio de quem usa: sem os contêineres, some o convite.
                  O quadro deixa de ser um lugar onde trabalho CABE e vira um
                  aviso de que não há trabalho — o que, num acervo em que quatro
                  dos nove advogados têm ZERO atividades e mais de oitenta
                  processos, confirma exatamente a crença errada. A frase dele
                  foi "causa preguiça em cadastrar uma atividade", e é isso
                  mesmo: uma tela que diz "está tudo em dia" não pede nada.

                  Então a estrutura fica, e a coluna de PENDENTE — a única em
                  que faz sentido começar algo — passa a oferecer o gesto. As
                  outras três seguem discretas: ninguém cria uma atividade já
                  concluída.
                */}
                {itens.length === 0 && (
                  s === 'PENDENTE' && onNovo ? (
                    <button
                      type="button"
                      onClick={onNovo}
                      className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-900/10"
                    >
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-medium">Nova atividade</span>
                      <span className="px-3 text-[11px] leading-snug text-muted-foreground">
                        Prazo, audiência, contato — o que precisa de data e dono.
                      </span>
                    </button>
                  ) : (
                    <div className="rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
                      Sem atividades
                    </div>
                  )
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
