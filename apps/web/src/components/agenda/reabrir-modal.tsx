'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, PenLine, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  corrigirDesfecho, listarDesfechos, mudarStatusCompromisso,
  DESFECHO_LABEL,
  type Compromisso, type DesfechoOpcao, type StatusCompromisso,
} from '@/lib/agenda';
import { Portal } from '@/components/ui/portal';

/**
 * REABRIR PASSA A PERGUNTAR — e oferece a saída que quase sempre é a certa.
 *
 * "Quero que para reabrir, abra um modal e não somente reabra. Se eu tiver
 * reaberto, no caso, eu tenho que dá uma conclusão de novo ou tem opção
 * melhor?" — o dono, 21/09/2026.
 *
 * Tem opção melhor, e ela é o motivo deste diálogo existir com DUAS saídas.
 * Reabrir não é uma coisa só:
 *
 *  · ERREI O RÓTULO — escolhi "Analisado, nada a protocolar" e era "Peça
 *    protocolada". O trabalho está feito. Reabrir para consertar isso APAGA o
 *    desfecho, a data e o autor da conclusão, devolve o item para a fila de
 *    alguém e, sendo consulta, reabre o atendimento que ela fechou. Tudo isso
 *    para trocar uma palavra. É a saída de cima: "Corrigir o desfecho".
 *
 *  · O TRABALHO VOLTOU — o tribunal devolveu, o acordo caiu, a audiência foi
 *    remarcada. Aí sim a atividade tem de voltar para a fila, e vai precisar de
 *    uma conclusão nova quando terminar. É a saída de baixo, e ela diz
 *    exatamente isso antes de você clicar.
 *
 * O MOTIVO É PEDIDO, NÃO EXIGIDO. Reabrir apaga o desfecho do cartão e o
 * histórico vira o único lugar onde a decisão anterior sobrevive — "Reaberta
 * (estava concluída)" sem o porquê obriga quem ler depois a adivinhar. Mas
 * travar o botão num campo de texto, no celular, é o jeito mais rápido de a
 * pessoa desistir e deixar o registro errado no ar.
 *
 * A atividade CANCELADA não tem desfecho para corrigir: para ela o diálogo
 * mostra uma saída só, e explica que o motivo do cancelamento sai do cartão.
 */
export function ReabrirModal({
  compromisso, destino, open, onClose, onPronto,
}: {
  compromisso: Compromisso | null;
  /** Para onde o arrasto (ou o botão) está levando: Pendente ou Em andamento. */
  destino: StatusCompromisso;
  open: boolean;
  onClose: () => void;
  onPronto: () => void;
}) {
  const { user } = useAuth();
  const concluida = compromisso?.status === 'CONCLUIDO';
  const ehDeOutro = !!compromisso && !!user?.id && compromisso.responsavel.id !== user.id;

  /** Qual das duas saídas está aberta. A correção só existe na concluída. */
  const [modo, setModo] = useState<'corrigir' | 'reabrir'>('corrigir');
  const [motivo, setMotivo] = useState('');
  const [desfecho, setDesfecho] = useState('');
  const [obs, setObs] = useState('');

  const opcoes = useQuery({
    queryKey: ['desfechos', compromisso?.tipo],
    queryFn: () => listarDesfechos(compromisso!.tipo),
    enabled: open && concluida && !!compromisso?.tipo,
    staleTime: 5 * 60_000,
  });
  const lista: DesfechoOpcao[] = opcoes.data ?? [];
  const escolhido = lista.find((d) => d.slug === desfecho);

  useEffect(() => {
    if (!open || !compromisso) return;
    setModo(compromisso.status === 'CONCLUIDO' ? 'corrigir' : 'reabrir');
    setMotivo('');
    // Começa no desfecho que está lá: corrigir é trocar, não preencher do zero.
    setDesfecho(compromisso.desfecho ?? '');
    setObs(compromisso.desfechoObs ?? '');
  }, [open, compromisso]);

  const corrigir = useMutation({
    mutationFn: () => corrigirDesfecho(compromisso!.id, desfecho, obs.trim() || undefined),
    onSuccess: () => {
      toast.success('Desfecho corrigido — a atividade continua concluída.');
      onPronto();
      onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : (m ?? 'Não foi possível corrigir o desfecho.'));
    },
  });

  const reabrir = useMutation({
    mutationFn: () => mudarStatusCompromisso(compromisso!.id, destino, motivo.trim() || undefined),
    onSuccess: () => {
      toast.success(
        destino === 'EM_ANDAMENTO' ? 'Atividade reaberta em andamento.' : 'Atividade reaberta.',
      );
      onPronto();
      onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : (m ?? 'Não foi possível reabrir.'));
    },
  });

  if (!open || !compromisso) return null;

  const salvando = corrigir.isPending || reabrir.isPending;
  const mudouDesfecho =
    desfecho !== (compromisso.desfecho ?? '') || obs.trim() !== (compromisso.desfechoObs ?? '');
  const podeCorrigir = !!desfecho && mudouDesfecho && !(escolhido?.exigeObs && !obs.trim());

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
        onClick={salvando ? undefined : onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="flex max-h-[92vh] w-full max-w-md animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b p-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/30">
                <RotateCcw className="h-4.5 w-4.5 text-sky-700 dark:text-sky-300" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold">
                  {concluida ? 'O que você quer fazer?' : 'Reabrir atividade'}
                </h3>
                <p className="truncate text-xs text-muted-foreground">{compromisso.titulo}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {ehDeOutro && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/25">
                <AvatarPessoa
                  nome={compromisso.responsavel.nomeExibicao || compromisso.responsavel.nome}
                  url={compromisso.responsavel.avatarUrl}
                  tamanho="xs"
                />
                <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                  Esta atividade é de{' '}
                  <strong className="font-semibold">
                    {compromisso.responsavel.nomeExibicao || compromisso.responsavel.nome}
                  </strong>
                  , e o que você fizer aqui fica registrado com o{' '}
                  <strong className="font-semibold">seu nome</strong>.
                </p>
              </div>
            )}

            {/*
              AS DUAS SAÍDAS, UMA EMBAIXO DA OUTRA. Não são abas: são duas coisas
              diferentes com consequências diferentes, e a de menor dano vem
              primeiro. Na cancelada só existe a segunda, e aí nem seletor aparece.
            */}
            {concluida && (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['corrigir', PenLine, 'Corrigir o desfecho', 'Continua concluída'],
                    ['reabrir', RotateCcw, 'Reabrir mesmo', 'Volta para a fila'],
                  ] as const
                ).map(([valor, Icone, titulo, sub]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setModo(valor)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition',
                      modo === valor
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                        : 'hover:bg-muted/50',
                    )}
                  >
                    <Icone
                      className={cn(
                        'mb-1 h-4 w-4',
                        modo === valor ? 'text-brand-700 dark:text-brand-300' : 'text-muted-foreground',
                      )}
                    />
                    <span className="block text-sm font-semibold leading-tight">{titulo}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">{sub}</span>
                  </button>
                ))}
              </div>
            )}

            {concluida && modo === 'corrigir' && (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Troca só o resultado registrado. Quem concluiu, quando concluiu e o que a conclusão
                  já produziu — seguimento, processo, atendimento fechado — ficam como estão.
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Qual foi o resultado?</label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {lista.map((d) => (
                      <button
                        key={d.slug}
                        type="button"
                        onClick={() => setDesfecho(d.slug)}
                        className={cn(
                          'rounded-lg border p-2.5 text-left transition',
                          desfecho === d.slug
                            ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                            : 'hover:bg-muted/50',
                        )}
                      >
                        <span className="block text-sm font-medium">{d.label}</span>
                        {d.ajuda && (
                          <span className="block text-[11px] leading-snug text-muted-foreground">
                            {d.ajuda}
                          </span>
                        )}
                      </button>
                    ))}
                    {opcoes.isLoading && (
                      <p className="py-2 text-xs text-muted-foreground">Carregando os resultados…</p>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Comentário{' '}
                    <span className="font-normal text-muted-foreground">
                      {escolhido?.exigeObs ? '(obrigatório)' : '(opcional)'}
                    </span>
                  </label>
                  <textarea
                    className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    placeholder="O que ficou registrado sobre esta atividade."
                  />
                </div>
              </div>
            )}

            {(!concluida || modo === 'reabrir') && (
              <div className="space-y-3">
                {/*
                  O AVISO DIZ O QUE SE PERDE. Reabrir não é grave, mas é
                  irreversível no cartão: o desfecho sai dali e passa a existir só
                  no histórico. Quem lê isto antes de clicar decide melhor.
                */}
                <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {concluida ? (
                      <>
                        A atividade volta para{' '}
                        <strong>{destino === 'EM_ANDAMENTO' ? 'Em andamento' : 'Pendente'}</strong> e o
                        desfecho{' '}
                        <strong>
                          {DESFECHO_LABEL[compromisso.desfecho ?? ''] ??
                            compromisso.desfecho ??
                            'registrado'}
                        </strong>{' '}
                        sai do cartão — ele continua no histórico. Quando terminar, ela vai pedir uma
                        conclusão nova.
                      </>
                    ) : (
                      <>
                        A atividade volta para{' '}
                        <strong>{destino === 'EM_ANDAMENTO' ? 'Em andamento' : 'Pendente'}</strong> e o
                        motivo do cancelamento sai do cartão — ele continua no histórico.
                      </>
                    )}
                  </span>
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Por que está reabrindo?{' '}
                    <span className="font-normal text-muted-foreground">(opcional)</span>
                  </label>
                  <textarea
                    className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex.: o tribunal devolveu os autos para complementar a peça."
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Vai para o histórico da atividade, junto com o seu nome.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose} disabled={salvando}>
              Voltar
            </Button>
            {concluida && modo === 'corrigir' ? (
              <Button onClick={() => corrigir.mutate()} disabled={!podeCorrigir || salvando}>
                {corrigir.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Salvar a correção
              </Button>
            ) : (
              <Button onClick={() => reabrir.mutate()} disabled={salvando}>
                {reabrir.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Reabrir atividade
              </Button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
