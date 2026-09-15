'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CopyPlus, Info, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Carregando, Esqueleto, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { cn } from '@/lib/utils';
import { useDialogo } from './use-dialogo';
import {
  CopiaFeita, ItemDaCopia, PreviaDaCopia, agruparCopiaPorDia, avisoDoDestinoPreenchido, chaveDaCopia, comMaiuscula,
  contar, copiarEscala, destinoJaTemAEscala, ehConflito, escolhasDoDia, faixaDoPlantao, fraseDoDestinoComEscala,
  fraseDosDiasSemNinguem, hojeBR, itensEscolhidosDaCopia, linhaDoFora, marcadosNoDia, mensagemDoErro, mesesDaOrigem,
  mesesDoDestino, nomeDeExibicao, nomeDoMes, nomeDoMesComAno, padraoDaCopia, preverCopia, resumoDaCopia,
  rotuloCurtoDoDia, rotuloDoBotaoDaCopia, MAXIMO_DA_COPIA,
} from '@/lib/escalas';

/** A proposta com que a folha abre; `decidido` quando a página já leu os meses com plantões. */
export interface InicioDaCopia {
  origem: string;
  destino: string;
  decidido: boolean;
}

/**
 * COPIAR A ESCALA DE UM MÊS PARA OUTRO (D15, 14/09/2026; De e Para em 15/09/2026).
 *
 * "Copiar do mês anterior" como botão fixo errava em janeiro e julho de
 * recesso, e o destino preso ao mês da tela errava no mês já preenchido (V1:
 * setembro com 16 plantões abria "Criar 0 plantões"). Agora a folha tem De e
 * Para, e abre com a proposta de `padraoDaCopia`. Tudo o que aparece veio do
 * servidor (`GET /escalas/copia`), que usa a MESMA regra para gravar — o web
 * não refaz a regra, só guarda o que a pessoa desmarcou.
 *
 * Nada em âmbar nem vermelho: nota de prévia é informação, não aviso.
 */
export function CopiarEscalaModal({
  inicio,
  mesDaTela,
  onClose,
  onCopiada,
}: {
  /** `null` fecha. */
  inicio: InicioDaCopia | null;
  /** "AAAA-MM" do mês aberto na tela: é dele que sai a proposta quando a página não decidiu. */
  mesDaTela: string;
  onClose: () => void;
  onCopiada: (feita: { resposta: CopiaFeita; origem: string; destino: string }) => void;
}) {
  if (!inicio) return null;
  return (
    <FolhaDaCopia
      key={`${inicio.origem}|${inicio.destino}`}
      inicio={inicio}
      mesDaTela={mesDaTela}
      onClose={onClose}
      onCopiada={onCopiada}
    />
  );
}

function FolhaDaCopia({
  inicio, mesDaTela, onClose, onCopiada,
}: {
  inicio: InicioDaCopia;
  mesDaTela: string;
  onClose: () => void;
  onCopiada: (feita: { resposta: CopiaFeita; origem: string; destino: string }) => void;
}) {
  const qc = useQueryClient();
  const [origem, setOrigem] = useState(inicio.origem);
  const [destino, setDestino] = useState(inicio.destino);
  // A proposta só troca sozinha uma vez, e só quando a página abriu sem saber
  // os meses (a sonda dela falhou). Depois vale o que está na tela.
  const [decidida, setDecidida] = useState(inicio.decidido);
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const foraRef = useRef<HTMLElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  // Sob ['escalas']: o `invalidar` da página também refaz a prévia.
  const previa = useQuery({
    queryKey: ['escalas', 'copia', origem, destino],
    queryFn: () => preverCopia(origem, destino),
    // "Cannot GET" na janela do deploy não melhora tentando três vezes.
    retry: 1,
    staleTime: 0,
    // Trocar De ou Para mantinha a folha sem dados até a resposta: o seletor
    // encolhia para uma opção e o resumo sumia (auditoria de 14/09/2026). A
    // prévia anterior fica, apagada, e nada dela vale para enviar.
    placeholderData: keepPreviousData,
  });
  const dados: PreviaDaCopia | undefined = previa.data;
  const atualizada = !!dados && !previa.isPlaceholderData && dados.origem === origem && dados.destino === destino;

  useEffect(() => {
    if (decidida || !atualizada || !dados) return;
    setDecidida(true);
    const proposta = padraoDaCopia(dados.mesesComPlantao, mesDaTela);
    if (proposta && (proposta.origem !== origem || proposta.destino !== destino)) {
      setOrigem(proposta.origem);
      setDestino(proposta.destino);
    }
  }, [decidida, atualizada, dados, mesDaTela, origem, destino]);

  const salvar = useMutation({
    mutationFn: (itens: { origemId: string; data: string }[]) => copiarEscala({ origem, destino, itens }),
    onSuccess: (resposta) => {
      // Sem isto a prévia desta folha seria refeita pelo `invalidar` da página
      // logo antes de a folha fechar: uma ida ao servidor para nada.
      qc.removeQueries({ queryKey: ['escalas', 'copia', origem, destino], exact: true });
      onCopiada({ resposta, origem, destino });
      onClose();
    },
    onError: (e) => {
      if (ehConflito(e)) {
        setErro(null);
        setAviso(`A escala de ${nomeDoMes(destino)} mudou enquanto você conferia. A prévia foi atualizada.`);
        void previa.refetch();
        return;
      }
      setErro(mensagemDoErro(e, 'Não foi possível copiar. Tente de novo.'));
    },
  });

  useDialogo({ painel: painelRef, ocupado: salvar.isPending, onFechar: onClose });

  const criar = useMemo(() => (atualizada && dados ? dados.criar : []), [atualizada, dados]);
  const grupos = useMemo(() => agruparCopiaPorDia(criar), [criar]);
  const itens = useMemo(() => itensEscolhidosDaCopia(criar, escolhas), [criar, escolhas]);
  const qtd = itens.length;
  const nomeDestino = nomeDoMes(destino);
  const meses = dados?.mesesComPlantao ?? [];
  const mesAtual = hojeBR().slice(0, 7);

  const opcoesDeOrigem = useMemo(() => mesesDaOrigem(meses, origem, destino), [meses, origem, destino]);
  const opcoesDeDestino = useMemo(() => mesesDoDestino(meses, mesAtual, origem, destino), [meses, mesAtual, origem, destino]);
  // Antes da primeira resposta não se sabe quantos plantões cada mês tem: sem
  // contagem, em vez de "sem plantões" num mês que tem 16.
  const rotuloDoMes = (m: { mes: string; plantoes: number }) =>
    !dados
      ? nomeDoMesComAno(m.mes)
      : `${nomeDoMesComAno(m.mes)} · ${m.plantoes > 0 ? contar(m.plantoes, 'plantão', 'plantões') : 'sem plantões'}`;

  function recomecar() {
    setDecidida(true);
    setEscolhas({});
    setAviso(null);
    setErro(null);
  }
  function mudarOrigem(mes: string) {
    recomecar();
    setOrigem(mes);
  }
  function mudarDestino(mes: string) {
    recomecar();
    setDestino(mes);
  }
  function alternar(chave: string, atual: boolean) {
    setErro(null);
    setEscolhas((e) => ({ ...e, [chave]: !atual }));
  }
  function alternarDia(doDia: ItemDaCopia[], marcar: boolean) {
    setErro(null);
    setEscolhas((e) => escolhasDoDia(doDia, e, marcar));
  }
  function submeter() {
    if (qtd === 0) return;
    if (qtd > MAXIMO_DA_COPIA) {
      return setErro(`São ${qtd} plantões; o máximo por vez é ${MAXIMO_DA_COPIA}. Desmarque alguns e copie o resto depois.`);
    }
    setErro(null);
    setAviso(null);
    salvar.mutate(itens);
  }

  // "Não tem plantões para copiar" só depois de a proposta assentar: antes, a
  // primeira resposta podia ser a do palpite vazio e piscar na tela.
  const pronta = atualizada && decidida;
  const origemVazia = pronta && !!dados && dados.criar.length === 0 && dados.fora.length === 0;
  const jaTemAEscala = pronta && !!dados && !origemVazia && destinoJaTemAEscala(dados);
  const avisoDestino = pronta && dados && !jaTemAEscala ? avisoDoDestinoPreenchido(dados.existentesNoDestino, destino) : null;
  const semNinguem = pronta && dados && !jaTemAEscala ? fraseDosDiasSemNinguem(dados.diasSemNinguem, destino) : null;
  const tituloId = `copiar-escala-${inicio.origem}-${inicio.destino}`;
  const trocando = !!dados && !pronta;

  const lista = dados && (
    <>
      {grupos.map((g) => {
        const marcados = marcadosNoDia(g.itens, escolhas);
        const rotulo = rotuloCurtoDoDia(g.data);
        return (
          <section key={g.data} aria-labelledby={`copia-dia-${g.data}`} className="mt-3">
            <div className="flex items-center justify-between gap-2 border-y bg-muted/40 pl-5 pr-2">
              <h4 id={`copia-dia-${g.data}`} className="py-1.5 text-xs font-semibold text-muted-foreground">
                {rotulo}
              </h4>
              <button
                type="button"
                onClick={() => alternarDia(g.itens, marcados === 0)}
                disabled={salvar.isPending}
                aria-label={`${marcados > 0 ? 'Desmarcar' : 'Marcar'} o dia ${rotulo}`}
                className="flex min-h-[44px] items-center px-3 text-xs font-medium text-brand-800 hover:underline disabled:opacity-50 dark:text-brand-400 md:min-h-[32px]"
              >
                {marcados > 0 ? 'Desmarcar o dia' : 'Marcar o dia'}
              </button>
            </div>
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
        );
      })}

      {pronta && dados.criar.length === 0 && !jaTemAEscala && (
        <p className="px-5 pt-4 text-sm text-muted-foreground">Nenhum plantão de {nomeDoMes(origem)} cabe em {nomeDestino}.</p>
      )}

      {dados.fora.length > 0 && (
        <section ref={foraRef} aria-labelledby="copia-fora" className="mt-5 scroll-mt-2">
          <h4 id="copia-fora" className="border-y bg-muted/40 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
            Ficaram de fora
          </h4>
          <ul className="divide-y">
            {dados.fora.map((f) => {
              const linha = linhaDoFora(f);
              return (
                <li key={`${f.origemId}-${f.data ?? ''}-${f.motivo}`} className="px-5 py-2.5 text-sm text-muted-foreground">
                  <span className="block">{linha.dia} · {nomeDeExibicao(f.advogado)} — {f.texto}</span>
                  {linha.apoio && <span className="block text-xs">{linha.apoio}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        ref={painelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        // dvh: no celular, 92vh conta a barra do navegador e o rodapé com o
        // botão podia ficar escondido atrás dela.
        className="flex h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl outline-none supports-[height:100dvh]:h-[92dvh] sm:h-auto sm:max-h-[92vh] sm:rounded-2xl sm:supports-[height:100dvh]:h-auto sm:supports-[height:100dvh]:max-h-[92dvh]"
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="copia-origem" className="text-sm font-medium">De</label>
              <select
                id="copia-origem"
                value={origem}
                disabled={salvar.isPending}
                onChange={(e) => mudarOrigem(e.target.value)}
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-11 md:text-sm"
              >
                {opcoesDeOrigem.map((m) => (
                  <option key={m.mes} value={m.mes}>{rotuloDoMes(m)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="copia-destino" className="text-sm font-medium">Para</label>
              <select
                id="copia-destino"
                value={destino}
                disabled={salvar.isPending}
                onChange={(e) => mudarDestino(e.target.value)}
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-11 md:text-sm"
              >
                {opcoesDeDestino.map((m) => (
                  <option key={m.mes} value={m.mes}>{rotuloDoMes(m)}</option>
                ))}
              </select>
            </div>
          </div>
          {trocando && !previa.isError ? (
            <div className="space-y-1.5" aria-hidden>
              <Esqueleto className="h-4 w-56 max-w-full" />
              <Esqueleto className="h-3 w-32" />
            </div>
          ) : pronta && dados && !origemVazia ? (
            <div className="space-y-0.5 text-sm" aria-live="polite">
              {jaTemAEscala ? (
                <>
                  <p className="font-semibold">{fraseDoDestinoComEscala(origem, destino)}</p>
                  <p className="text-muted-foreground">Para copiar para outro mês, escolha em Para.</p>
                </>
              ) : (
                <>
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
                  {semNinguem && (
                    <p className="flex items-start gap-1.5 text-muted-foreground">
                      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> {semNinguem}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto">
          {previa.isLoading ? (
            <Carregando texto="Montando a prévia…">
              <EsqueletoLinhas quantidade={7} altura={56} />
            </Carregando>
          ) : previa.isError && !atualizada ? (
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
          ) : trocando ? (
            <Carregando texto="Montando a prévia…">
              <EsqueletoLinhas quantidade={7} altura={56} />
            </Carregando>
          ) : origemVazia ? (
            <p className="animate-surgir px-5 py-12 text-center text-sm text-muted-foreground">
              {comMaiuscula(nomeDoMes(origem))} não tem plantões para copiar.
            </p>
          ) : dados ? (
            <div className="animate-surgir pb-4">
              {aviso && (
                <p role="status" className="mx-5 mt-4 rounded-md bg-muted/60 px-3 py-2 text-sm">{aviso}</p>
              )}
              {jaTemAEscala ? (
                <details className="group">
                  <summary className="mx-5 mt-3 flex min-h-[44px] cursor-pointer items-center text-sm text-muted-foreground hover:text-foreground">
                    Ver plantão por plantão
                  </summary>
                  {lista}
                </details>
              ) : (
                <>
                  <div className="space-y-1 px-5 pt-4 text-xs text-muted-foreground">
                    {avisoDestino && <p>{avisoDestino}</p>}
                    <p>Desmarque feriados e dias sem expediente. As observações não são copiadas.</p>
                  </div>
                  {lista}
                </>
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
            disabled={salvar.isPending || previa.isFetching || !pronta || qtd === 0}
          >
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {rotuloDoBotaoDaCopia(qtd)}
          </Button>
        </div>
      </div>
    </div>
  );
}
