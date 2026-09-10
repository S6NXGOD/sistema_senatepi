'use client';

import { useMemo, useState } from 'react';
import { Check, Search, Star, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import type { Responsavel } from '@/lib/agenda';

/**
 * QUEM TRABALHA NESTA ATIVIDADE — um controle só, com rosto.
 *
 * O QUE HAVIA. Dois controles para a mesma pergunta: um `<select>` de
 * "Responsável", sem foto, e logo abaixo uma caixa com TODOS os colaboradores
 * como chips de texto — dezesseis nomes soltos ocupando meia tela, sem busca,
 * sem avatar, e sem nada dizendo quem já estava escolhido além da cor da borda.
 * Para pôr duas pessoas numa audiência era preciso entender que "Responsável" e
 * "Também atuam" são listas diferentes da mesma coisa.
 *
 * O PEDIDO FOI "mostrar a fotinha e poder colocar mais de um responsável". A
 * foto entra aqui; sobre o "mais de um", o que o sistema já faz é melhor do que
 * parecia — ver abaixo.
 *
 * UM RESPONDE, VÁRIOS ATUAM — e os dois papéis são reais:
 *
 *  · o RESPONSÁVEL é quem aparece na listagem, na carga da equipe e em "de quem
 *    é este prazo". Cobrança precisa de destinatário: se todos respondem,
 *    ninguém responde.
 *  · quem ATUA vê a atividade na PRÓPRIA agenda (o filtro pessoal do painel é
 *    `responsavelId OR equipe.some`), conta na carga e — isto foi conferido no
 *    serviço — PODE CONCLUIR. Não há trava nenhuma no `concluir`.
 *
 * A tela dizia "Só ele conclui", e era mentira: nada no servidor impede um
 * colega de fechar. E está certo que não impeça — quem fechou fica registrado
 * em `concluidoPor`, com nome e foto na gaveta. A frase saiu.
 *
 * Ou seja: co-responsável JÁ funciona. O que faltava era a tela permitir montar
 * a dupla sem garimpar dois controles, e dizer com todas as letras o que cada
 * um dos dois papéis significa.
 *
 * MOBILE-FIRST: quem já está escolhido vem primeiro, em linhas de 44px; a busca
 * só aparece quando há mais de seis pessoas (com quatro, procurar é mais lento
 * que olhar); e a lista de disponíveis não passa de uma dobra — o resto se
 * alcança digitando.
 */

/** Acima disto, uma lista de nomes vira garimpo e a busca se paga. */
const MINIMO_PARA_BUSCA = 6;
/** Altura máxima da lista de disponíveis: uma dobra de telefone. */
const ALTURA_LISTA = 'max-h-56';

const rotulo = (p: Responsavel) => p.nomeExibicao || p.nome;

/** Sem acento e em minúsculas — "Sherad" acha "Shérad". */
const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function SeletorDePessoas({
  pessoas,
  responsavelId,
  participantes,
  onResponsavel,
  onParticipantes,
  carregando,
}: {
  pessoas: Responsavel[];
  responsavelId: string;
  participantes: string[];
  onResponsavel: (id: string) => void;
  onParticipantes: (ids: string[]) => void;
  carregando?: boolean;
}) {
  const [busca, setBusca] = useState('');

  const porId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);

  /* O responsável primeiro; os demais na ordem em que foram adicionados. */
  const escolhidos = useMemo(() => {
    const ids = [responsavelId, ...participantes].filter(Boolean);
    return [...new Set(ids)].map((id) => porId.get(id)).filter(Boolean) as Responsavel[];
  }, [responsavelId, participantes, porId]);

  const disponiveis = useMemo(() => {
    const dentro = new Set(escolhidos.map((p) => p.id));
    const alvo = normalizar(busca.trim());
    return pessoas
      .filter((p) => !dentro.has(p.id))
      .filter((p) => !alvo || normalizar(rotulo(p)).includes(alvo))
      .sort((a, b) => rotulo(a).localeCompare(rotulo(b), 'pt-BR'));
  }, [pessoas, escolhidos, busca]);

  function adicionar(id: string) {
    /* Sem responsável ainda? A primeira pessoa escolhida assume — é o que
       acontece em 99% dos casos, e poupa um clique. */
    if (!responsavelId) onResponsavel(id);
    else if (!participantes.includes(id)) onParticipantes([...participantes, id]);
    setBusca('');
  }

  function remover(id: string) {
    if (id === responsavelId) {
      /* Tirando quem responde, o próximo da fila assume: a atividade não pode
         ficar sem destinatário, e obrigar a reescolher seria um passo a mais. */
      const [proximo, ...resto] = participantes;
      onResponsavel(proximo ?? '');
      onParticipantes(resto);
      return;
    }
    onParticipantes(participantes.filter((i) => i !== id));
  }

  /** Promove alguém a responsável e devolve o antigo para a equipe. */
  function tornarResponsavel(id: string) {
    const anterior = responsavelId;
    onResponsavel(id);
    onParticipantes([
      ...participantes.filter((i) => i !== id),
      ...(anterior && anterior !== id ? [anterior] : []),
    ]);
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        Quem trabalha nesta atividade <span className="text-red-600">*</span>
      </label>

      {/* ---- Escolhidos ---- */}
      {escolhidos.length > 0 && (
        <ul className="space-y-1 rounded-lg border p-1.5">
          {escolhidos.map((p) => {
            const responde = p.id === responsavelId;
            return (
              <li
                key={p.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5',
                  responde && 'bg-brand-50/70 dark:bg-brand-900/20',
                )}
              >
                <AvatarPessoa nome={rotulo(p)} url={p.avatarUrl} tamanho="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rotulo(p)}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {responde ? 'Responde pela atividade' : 'Atua junto'}
                    {p.role ? ` · ${p.role}` : ''}
                  </p>
                </div>

                {/*
                  TROCAR QUEM RESPONDE é um clique, e não um passeio até o
                  seletor de cima. A estrela some no próprio responsável — ele
                  já é.
                */}
                {!responde && (
                  <button
                    type="button"
                    onClick={() => tornarResponsavel(p.id)}
                    title="Tornar responsável"
                    aria-label={`Tornar ${rotulo(p)} responsável`}
                    className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-amber-600 sm:h-8 sm:w-8"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                {responde && (
                  <span className="flex h-8 items-center gap-1 rounded-full bg-brand-800 px-2 text-[11px] font-semibold text-white">
                    <Star className="h-3 w-3 fill-current" /> Responsável
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remover(p.id)}
                  title="Remover"
                  aria-label={`Remover ${rotulo(p)}`}
                  className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-red-600 sm:h-8 sm:w-8"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        O QUE OS DOIS PAPÉIS SIGNIFICAM, escrito uma vez e só quando há mais de
        uma pessoa — com uma só, a frase seria óbvia e ocuparia uma linha.
      */}
      {escolhidos.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Quem responde aparece na listagem e na carga da equipe. Todos veem a
          atividade na própria agenda e podem concluí-la.
        </p>
      )}

      {/* ---- Disponíveis ---- */}
      {pessoas.length > MINIMO_PARA_BUSCA && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar para adicionar…"
            className="h-11 w-full rounded-md border border-input bg-background pl-8 pr-3 text-base md:h-9 md:text-sm"
          />
        </div>
      )}

      {carregando ? (
        <p className="px-1 text-xs text-muted-foreground">Carregando pessoas…</p>
      ) : disponiveis.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {escolhidos.length === 0
            ? 'Nenhuma pessoa disponível.'
            : busca
              ? 'Ninguém com esse nome fora da lista acima.'
              : 'Todo mundo já está nesta atividade.'}
        </p>
      ) : (
        <ul className={cn('space-y-0.5 overflow-y-auto rounded-lg border p-1', ALTURA_LISTA)}>
          {disponiveis.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => adicionar(p.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
              >
                <AvatarPessoa nome={rotulo(p)} url={p.avatarUrl} tamanho="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{rotulo(p)}</span>
                {p.role && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">{p.role}</span>
                )}
                <Check className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
