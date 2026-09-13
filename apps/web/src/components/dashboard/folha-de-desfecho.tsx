'use client';

import { useEffect, useState } from 'react';
import { CalendarPlus, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { OpcoesDeDesfecho } from '@/components/agenda/opcoes-de-desfecho';
import { cn } from '@/lib/utils';
import type { DesfechoOpcao } from '@/lib/agenda';
import type { CompromissoCard } from '@/lib/dashboard';
import {
  MINIMO_DA_OBSERVACAO, observacaoValida, pedeModalCompleto, previaDoSeguimento,
} from '@/lib/acao-rapida';

/** O que perguntar no campo, pelo desfecho — a mesma pergunta do modal da agenda. */
function perguntaDaObservacao(slug: string): { rotulo: string; exemplo: string } {
  switch (slug) {
    case 'DUVIDA_ESCLARECIDA':
      return { rotulo: 'O que foi orientado?', exemplo: 'A orientação dada — é o que fica no histórico do filiado.' };
    case 'PRAZO_CUMPRIDO':
      return { rotulo: 'O que foi protocolado', exemplo: 'Ex.: Contestação protocolada em 04/09, protocolo 12345/2026.' };
    case 'PRAZO_SEM_PECA':
      return { rotulo: 'Por que não cabe peça?', exemplo: 'Ex.: Intimação só para ciência; nada a manifestar.' };
    default:
      return { rotulo: 'Observação', exemplo: 'Anote o que for relevante.' };
  }
}

/**
 * A FOLHA DE DESFECHOS DO PAINEL — todas as opções do tipo, sem sair da tela.
 *
 * Abre de baixo no celular e no centro no computador, como o modal da agenda.
 * Traz o que o botão de um toque não tinha como dizer:
 *  · de quem é a atividade, quando não é sua (e que o SEU nome fica no histórico);
 *  · o campo de observação com botão "Concluir" — não depende de Enter, e o
 *    texto não some se a API recusar;
 *  · o que o desfecho vai criar, com a data que o SERVIDOR calculou;
 *  · vincular ou abrir processo vão para o formulário completo, porque escolher
 *    processo não cabe aqui.
 *
 * Só entrada animada: a folha desmonta ao fechar, e é isso que zera o formulário.
 */
export function FolhaDeDesfecho({
  compromisso: c,
  opcoes,
  carregando,
  erro,
  onTentarDeNovo,
  inicial,
  ehDeOutraPessoa,
  enviando,
  abrindoCompleto,
  onFechar,
  onConcluir,
  onAbrirCompleto,
}: {
  compromisso: CompromissoCard;
  opcoes: readonly DesfechoOpcao[] | undefined;
  carregando: boolean;
  erro: boolean;
  onTentarDeNovo: () => void;
  /** Opção já marcada ao abrir. Nula quando o tipo não tem primário honesto. */
  inicial: DesfechoOpcao | null;
  ehDeOutraPessoa: boolean;
  enviando: boolean;
  abrindoCompleto: boolean;
  onFechar: () => void;
  /** Resolve `true` quando gravou; a folha só fecha aí. */
  onConcluir: (v: { opcao: DesfechoOpcao; obs?: string; criarSeguimento?: boolean }) => Promise<boolean>;
  onAbrirCompleto: (slug: string) => void;
}) {
  const lista = opcoes ?? [];
  const [slug, setSlug] = useState(inicial?.slug ?? '');
  const [obs, setObs] = useState('');
  const [criarSeguimento, setCriarSeguimento] = useState(true);

  const escolhida = lista.find((o) => o.slug === slug) ?? null;
  const spec = escolhida?.acao === 'CRIAR_ATIVIDADE' ? escolhida.seguimento : undefined;
  const completo = pedeModalCompleto(escolhida);
  const exigeObs = !!escolhida?.exigeObs;
  const valido = !!escolhida && !completo && (!exigeObs || observacaoValida(obs));
  const previa = spec && (spec.obrigatorio || criarSeguimento) ? previaDoSeguimento(escolhida, c.responsavel) : null;
  const pergunta = perguntaDaObservacao(slug);
  const ocupado = enviando || abrindoCompleto;

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ocupado) onFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [ocupado, onFechar]);

  async function enviar() {
    if (!escolhida || !valido || ocupado) return;
    const ok = await onConcluir({
      opcao: escolhida,
      obs: obs.trim() || undefined,
      ...(spec && !spec.obrigatorio ? { criarSeguimento } : {}),
    });
    if (ok) onFechar();
  }

  const dona = c.responsavel.nomeExibicao || c.responsavel.nome;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={ocupado ? undefined : onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="folha-desfecho-titulo"
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b py-3 pl-5 pr-2">
          <div className="min-w-0 pt-1">
            <h3 id="folha-desfecho-titulo" className="text-base font-semibold">Concluir atividade</h3>
            <p className="truncate text-xs text-muted-foreground">{c.titulo}</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={ocupado}
            aria-label="Fechar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {ehDeOutraPessoa && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/25">
              <AvatarPessoa nome={dona} url={c.responsavel.avatarUrl} tamanho="xs" />
              <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                Esta atividade é de <strong className="font-semibold">{dona}</strong>. Você pode
                concluir, e o desfecho vai para o histórico com o{' '}
                <strong className="font-semibold">seu nome</strong> como quem fechou.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium">O que aconteceu?</p>
            <OpcoesDeDesfecho
              opcoes={lista}
              valor={slug}
              onEscolher={setSlug}
              carregando={carregando}
              erro={erro}
              onTentarDeNovo={onTentarDeNovo}
            />
          </div>

          {completo && escolhida && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-muted-foreground">
                {escolhida.acao === 'VINCULAR_PROCESSO'
                  ? 'Para vincular, é preciso escolher o processo — isso fica no formulário completo.'
                  : 'O caso novo pede área, advogado e observação — isso fica no formulário completo.'}
              </p>
              <Button variant="outline" onClick={() => onAbrirCompleto(escolhida.slug)} disabled={ocupado}>
                {abrindoCompleto ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Continuar no formulário completo
              </Button>
            </div>
          )}

          {spec && escolhida && (
            <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/10">
              {spec.obrigatorio ? (
                <p className="flex items-start gap-2 text-sm font-medium text-indigo-900 dark:text-indigo-200">
                  <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0" />
                  Este desfecho gera uma tarefa
                </p>
              ) : (
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-indigo-900 dark:text-indigo-200">
                  <input
                    type="checkbox"
                    checked={criarSeguimento}
                    onChange={(e) => setCriarSeguimento(e.target.checked)}
                    className="h-5 w-5 shrink-0 accent-indigo-600"
                  />
                  Criar a tarefa de acompanhamento
                </label>
              )}
              {previa && <p className="text-xs leading-snug text-indigo-900/90 dark:text-indigo-200/90">{previa}</p>}
              <button
                type="button"
                onClick={() => onAbrirCompleto(escolhida.slug)}
                disabled={ocupado}
                className="inline-flex min-h-11 items-center text-xs font-medium text-indigo-800 underline-offset-2 hover:underline disabled:opacity-50 sm:min-h-8 dark:text-indigo-300"
              >
                Mudar a data ou quem faz, no formulário completo
              </button>
            </div>
          )}

          {escolhida && !completo && (
            <div className="space-y-1.5">
              <label htmlFor="folha-desfecho-obs" className="text-sm font-medium">
                {pergunta.rotulo}
                {exigeObs ? ' *' : <span className="font-normal text-muted-foreground"> (opcional)</span>}
              </label>
              <textarea
                id="folha-desfecho-obs"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder={pergunta.exemplo}
                disabled={enviando}
                enterKeyHint="done"
                className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm"
              />
              {exigeObs && !observacaoValida(obs) && (
                <p className="text-[11px] text-muted-foreground">
                  Neste desfecho a observação é o registro: escreva pelo menos {MINIMO_DA_OBSERVACAO} letras.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onFechar} disabled={ocupado} className="h-11 sm:h-10">
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={!valido || ocupado} className={cn('h-11 sm:h-10', completo && 'hidden')}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Concluir
          </Button>
        </div>
      </div>
    </div>
  );
}
