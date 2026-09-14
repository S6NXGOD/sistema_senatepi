'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, CopyPlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { cn } from '@/lib/utils';
import {
  PreviaDaCopia, agruparCopiaPorDia, avisoDoDestinoPreenchido, chaveDaCopia, comMaiuscula, contar, copiarEscala,
  ehConflito, faixaDoPlantao, itensEscolhidosDaCopia, mensagemDoErro, nomeDeExibicao, nomeDoMes, nomeDoMesComAno,
  origemPadraoDaCopia, preverCopia, resumoDaCopia, rotuloCurtoDoDia, rotuloDoBotaoDaCopia, MAXIMO_DA_COPIA,
} from '@/lib/escalas';

/**
 * COPIAR A ESCALA DE UM MÊS PARA OUTRO (D15, 14/09/2026).
 *
 * "Copiar do mês anterior" como botão fixo errava em janeiro e julho de
 * recesso: a origem é escolhida, e a proposta é o último mês com plantões
 * antes do destino. Tudo o que aparece aqui veio do servidor (`GET
 * /escalas/copia`), que usa a MESMA regra para gravar — o web não refaz a
 * regra, só guarda o que a pessoa desmarcou.
 *
 * Nada em âmbar nem vermelho: nota de prévia é informação, não aviso.
 */
export function CopiarEscalaModal({
  destino,
  origemInicial,
  onClose,
  onSalvo,
}: {
  /** "AAAA-MM" do mês aberto na tela; `null` fecha. */
  destino: string | null;
  origemInicial: string;
  onClose: () => void;
  onSalvo: () => void;
}) {
  if (!destino) return null;
  return <FolhaDaCopia key={destino} destino={destino} origemInicial={origemInicial} onClose={onClose} onSalvo={onSalvo} />;
}

function FolhaDaCopia({
  destino, origemInicial, onClose, onSalvo,
}: {
  destino: string;
  origemInicial: string;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [origem, setOrigem] = useState(origemInicial);
  // A proposta só troca sozinha enquanto a pessoa não escolheu nada.
  const [escolheuOrigem, setEscolheuOrigem] = useState(false);
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const foraRef = useRef<HTMLElement>(null);

  // Sob ['escalas']: o `invalidar` da página também refaz a prévia.
  const previa = useQuery({
    queryKey: ['escalas', 'copia', origem, destino],
    queryFn: () => preverCopia(origem, destino),
    // "Cannot GET" na janela do deploy não melhora tentando três vezes.
    retry: 1,
    staleTime: 0,
  });
  const dados: PreviaDaCopia | undefined = previa.data;

  // O palpite inicial (o mês anterior) pode estar vazio; a primeira resposta
  // traz os meses com plantões, e a folha passa para o mais recente antes do
  // destino. Uma vez só: depois que a pessoa escolhe, fica o que ela escolheu.
  useEffect(() => {
    if (!dados || escolheuOrigem) return;
    const atual = dados.mesesComPlantao.find((m) => m.mes === origem)?.plantoes ?? 0;
    if (atual > 0) return;
    const proposta = origemPadraoDaCopia(dados.mesesComPlantao, destino);
    if (proposta && proposta !== origem) setOrigem(proposta);
  }, [dados, escolheuOrigem, origem, destino]);

  const grupos = useMemo(() => agruparCopiaPorDia(dados?.criar ?? []), [dados]);
  const itens = useMemo(() => itensEscolhidosDaCopia(dados?.criar ?? [], escolhas), [dados, escolhas]);
  const qtd = itens.length;
  const nomeDestino = nomeDoMes(destino);

  const opcoesDeOrigem = useMemo(() => {
    const meses = (dados?.mesesComPlantao ?? []).filter((m) => m.mes !== destino && m.plantoes > 0);
    if (!meses.some((m) => m.mes === origem)) meses.push({ mes: origem, plantoes: 0 });
    return [...meses].sort((a, b) => (a.mes < b.mes ? 1 : -1));
  }, [dados, destino, origem]);

  const salvar = useMutation({
    mutationFn: () => copiarEscala({ origem, destino, itens }),
    onSuccess: (r) => {
      toast.success(`${contar(r.criadas, 'plantão criado', 'plantões criados')} em ${nomeDestino}.`);
      onSalvo();
      onClose();
    },
    onError: (e) => {
      if (ehConflito(e)) {
        setErro(null);
        setAviso(`A escala de ${nomeDestino} mudou enquanto você conferia. A prévia foi atualizada.`);
        void previa.refetch();
        return;
      }
      setErro(mensagemDoErro(e, 'Não foi possível copiar. Tente de novo.'));
    },
  });

  function mudarOrigem(mes: string) {
    setEscolheuOrigem(true);
    setEscolhas({});
    setAviso(null);
    setErro(null);
    setOrigem(mes);
  }
  function alternar(chave: string, atual: boolean) {
    setErro(null);
    setEscolhas((e) => ({ ...e, [chave]: !atual }));
  }
  function submeter() {
    if (qtd === 0) return;
    if (qtd > MAXIMO_DA_COPIA) {
      return setErro(`São ${qtd} plantões; o máximo por vez é ${MAXIMO_DA_COPIA}. Desmarque alguns e copie o resto depois.`);
    }
    setErro(null);
    setAviso(null);
    salvar.mutate();
  }

  const origemVazia = !!dados && dados.criar.length === 0 && dados.fora.length === 0;
  const avisoDestino = dados ? avisoDoDestinoPreenchido(dados.existentesNoDestino, destino) : null;
  const tituloId = `copiar-escala-${destino}`;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="flex h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <CopyPlus className="h-5 w-5 text-brand-800 dark:text-brand-400" />
            </div>
            <div className="min-w-0">
              <h3 id={tituloId} className="text-lg font-bold">Copiar escala para {nomeDestino}</h3>
              <p className="text-sm text-muted-foreground">Cada plantão vai para o mesmo dia da semana, na mesma semana do mês.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvar.isPending}
            aria-label="Fechar"
            className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 border-b px-5 py-4">
          <div className="space-y-1.5">
            <label htmlFor="copia-origem" className="text-sm font-medium">Copiar de</label>
            <select
              id="copia-origem"
              value={origem}
              disabled={salvar.isPending}
              onChange={(e) => mudarOrigem(e.target.value)}
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-11 md:text-sm"
            >
              {opcoesDeOrigem.map((m) => (
                <option key={m.mes} value={m.mes}>
                  {nomeDoMesComAno(m.mes)} · {m.plantoes > 0 ? contar(m.plantoes, 'plantão', 'plantões') : 'sem plantões'}
                </option>
              ))}
            </select>
          </div>
          {dados && !origemVazia && (
            <div className="space-y-0.5 text-sm" aria-live="polite">
              <p className="font-semibold">{resumoDaCopia(qtd, destino)}</p>
              {dados.fora.length > 0 && (
                <button
                  type="button"
                  onClick={() => foraRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="-mx-1 min-h-[44px] px-1 text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline md:min-h-0"
                >
                  {dados.fora.length === 1 ? '1 ficou de fora.' : `${dados.fora.length} ficaram de fora.`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {previa.isLoading ? (
            <Carregando texto="Montando a prévia…">
              <EsqueletoLinhas quantidade={7} altura={56} />
            </Carregando>
          ) : previa.isError && !dados ? (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <AlertCircle className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm">Não deu para montar a prévia.</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {mensagemDoErro(previa.error, 'Confira a conexão e tente de novo.')}
              </p>
              <Button variant="outline" onClick={() => void previa.refetch()} disabled={previa.isFetching}>
                {previa.isFetching && <Loader2 className="h-4 w-4 animate-spin" />} Tentar de novo
              </Button>
            </div>
          ) : origemVazia ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              {comMaiuscula(nomeDoMes(origem))} não tem plantões para copiar.
            </p>
          ) : dados ? (
            <div className="pb-4">
              {aviso && (
                <p role="status" className="mx-5 mt-4 rounded-md bg-muted/60 px-3 py-2 text-sm">{aviso}</p>
              )}
              <div className="space-y-1 px-5 pt-4 text-xs text-muted-foreground">
                {avisoDestino && <p>{avisoDestino}</p>}
                <p>Desmarque feriados e dias sem expediente. As observações não são copiadas.</p>
              </div>

              {grupos.map((g) => (
                <section key={g.data} aria-labelledby={`copia-dia-${g.data}`} className="mt-3">
                  <h4
                    id={`copia-dia-${g.data}`}
                    className="border-y bg-muted/40 px-5 py-1.5 text-xs font-semibold text-muted-foreground"
                  >
                    {rotuloCurtoDoDia(g.data)}
                  </h4>
                  <ul className="divide-y">
                    {g.itens.map((i) => {
                      const chave = chaveDaCopia(i);
                      const marcado = escolhas[chave] ?? i.marcado;
                      return (
                        <li key={chave}>
                          <label className="flex min-h-[56px] cursor-pointer items-center gap-3 px-5 py-2 active:bg-muted/40">
                            <input
                              type="checkbox"
                              checked={marcado}
                              disabled={salvar.isPending}
                              onChange={() => alternar(chave, marcado)}
                              className="h-5 w-5 shrink-0 accent-brand-700"
                            />
                            <span className="min-w-0 flex-1">
                              <span className={cn('block truncate text-sm font-medium', !marcado && 'text-muted-foreground')}>
                                {nomeDeExibicao(i.advogado)} · <span className="tabular-nums">{faixaDoPlantao(i)}</span>
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {i.nota?.texto ?? `de ${rotuloCurtoDoDia(i.origemData)}`}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}

              {dados.criar.length === 0 && (
                <p className="px-5 pt-4 text-sm text-muted-foreground">Nenhum plantão de {nomeDoMes(origem)} cabe em {nomeDestino}.</p>
              )}

              {dados.fora.length > 0 && (
                <section ref={foraRef} aria-labelledby="copia-fora" className="mt-5 scroll-mt-2">
                  <h4 id="copia-fora" className="border-y bg-muted/40 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
                    Ficaram de fora
                  </h4>
                  <ul className="divide-y">
                    {dados.fora.map((f) => (
                      <li key={`${f.origemId}-${f.motivo}`} className="px-5 py-2.5 text-sm text-muted-foreground">
                        {rotuloCurtoDoDia(f.origemData)} · {nomeDeExibicao(f.advogado)} — {f.texto}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : null}
        </div>

        {erro && (
          <p role="alert" className="mx-5 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {erro}
          </p>
        )}

        <div className="flex gap-2 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button
            className="flex-1 sm:flex-none"
            onClick={submeter}
            disabled={salvar.isPending || previa.isFetching || !dados || qtd === 0}
          >
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {rotuloDoBotaoDaCopia(qtd)}
          </Button>
        </div>
      </div>
    </div>
  );
}
