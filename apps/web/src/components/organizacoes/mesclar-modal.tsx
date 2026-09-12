'use client';

import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, ArrowUpDown, CheckCircle2, GitMerge, Loader2, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { cn } from '@/lib/utils';
import { contar } from '@/lib/plural';
import {
  TIPO_PARTE_LABEL, compararOrganizacoes, formatDocumento, listarPartesExternas, mesclarOrganizacoes,
  type LadoDaComparacao, type ParteExterna,
} from '@/lib/partes';
import {
  ROTULO_DO_CAMPO, camposDaEscolha, camposEmConflito, herdadosSemPerguntar, ladoInicial,
  oQueEstaPreso, opcaoEscolhida, recusaDoSentido,
  type Escolhas, type Fonte,
} from '@/lib/mesclagem';

/**
 * JUNTAR DUAS ORGANIZAÇÕES QUE SÃO A MESMA.
 *
 * A primeira versão só deixava escolher QUAL some — e, quando as duas tinham
 * valores diferentes, valia sempre o da que fica. "Sem perder dado" virava
 * "ficar com o nome e o tipo errados de quem sobrou". Agora são dois passos:
 *
 * 1. ESCOLHER A OUTRA — a busca já vem com a sigla (ou a primeira palavra) da
 *    organização aberta, porque é quase sempre por ali que a duplicata se
 *    parece.
 *
 * 2. AS DUAS LADO A LADO — quem continua e quem deixa de existir, em cor e por
 *    extenso; o que está preso a cada uma; quem já tinha dito que eram
 *    diferentes; o que a Receita diz do CNPJ; e, SÓ ONDE AS DUAS DISCORDAM, a
 *    escolha do valor que fica. O que estava em branco vem sozinho, e a tela
 *    mostra o quê.
 *
 * As recusas (o sindicato sumiria, dossiê patronal dos dois lados, CNPJs
 * diferentes) vêm da API pela mesma regra que recusa a mesclagem: a tela só as
 * mostra antes do clique.
 */
export function MesclarModal({
  fica,
  sugerida,
  onFechar,
  onMesclado,
}: {
  /** A organização aberta — a comparação começa por ela. */
  fica: ParteExterna;
  /** A outra, quando já vem escolhida pela fila de duplicatas. */
  sugerida?: ParteExterna;
  onFechar: () => void;
  onMesclado: () => void | Promise<void>;
}) {
  const [outra, setOutra] = useState<ParteExterna | null>(sugerida ?? null);
  const [mesclando, setMesclando] = useState(false);

  useEffect(() => {
    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !mesclando) onFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [mesclando, onFechar]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={mesclando ? undefined : onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-da-mesclagem"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <GitMerge className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            </span>
            <div className="min-w-0">
              <h2 id="titulo-da-mesclagem" className="font-semibold">
                Juntar organizações duplicadas
              </h2>
              <p className="text-xs text-muted-foreground">
                {outra
                  ? 'Uma continua e a outra deixa de existir. Nada preso a ela se perde.'
                  : `Qual cadastro é o mesmo que ${fica.nomeFantasia || fica.nome}?`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={mesclando}
            aria-label="Fechar"
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {outra ? (
          <Comparacao
            aberta={fica}
            outra={outra}
            mesclando={mesclando}
            setMesclando={setMesclando}
            onEscolherOutra={() => setOutra(null)}
            onFechar={onFechar}
            onMesclado={onMesclado}
          />
        ) : (
          <EscolherOutra fica={fica} onEscolher={setOutra} />
        )}
      </div>
    </div>
  );
}

/** A sigla, ou a primeira palavra que diga alguma coisa: é por onde a duplicata se parece. */
function termoInicial(p: ParteExterna): string {
  const primeira = (t: string | null) => (t ?? '').split(/[\s/().,-]+/).find((x) => x.length >= 3) ?? '';
  return primeira(p.nomeFantasia) || primeira(p.nome);
}

function EscolherOutra({ fica, onEscolher }: { fica: ParteExterna; onEscolher: (p: ParteExterna) => void }) {
  const [busca, setBusca] = useState(() => termoInicial(fica));
  const [termo, setTermo] = useState(() => termoInicial(fica));
  const { data, isFetching, isError } = useQuery({
    queryKey: ['organizacoes', 'para-juntar', termo],
    queryFn: () => listarPartesExternas({ busca: termo, pageSize: 20 }),
    enabled: termo.length >= 2,
  });
  // A aberta nunca aparece como candidata a ser juntada a si mesma.
  const resultados = (data?.items ?? []).filter((p) => p.id !== fica.id);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTermo(busca.trim());
        }}
      >
        <Input
          autoFocus
          placeholder="Nome, sigla ou CNPJ da outra"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Button type="submit" variant="outline" aria-label="Procurar">
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>

      {isError && <p className="text-xs text-red-700 dark:text-red-400">Não foi possível procurar agora.</p>}

      {termo.length >= 2 && !isFetching && !isError && resultados.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma outra organização com “{termo}”. Tente a sigla, outra palavra do nome ou o CNPJ.
        </p>
      )}

      {resultados.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onEscolher(p)}
                className="flex w-full items-center justify-between gap-2 p-3 text-left transition hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {p.nomeFantasia ? `${p.nomeFantasia} · ` : ''}
                    {p.nome}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {TIPO_PARTE_LABEL[p.tipo]}
                    {p.documento ? ` · ${formatDocumento(p.documento)}` : ''}
                    {p.cidade ? ` · ${p.cidade}` : ''}
                    {p._count ? ` · ${contar(p._count.participacoes, 'processo', 'processos')}` : ''}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        Escolhida a outra, as duas aparecem lado a lado — e é lá que se decide qual continua.
      </p>
    </div>
  );
}

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function Comparacao({
  aberta, outra, mesclando, setMesclando, onEscolherOutra, onFechar, onMesclado,
}: {
  aberta: ParteExterna;
  outra: ParteExterna;
  mesclando: boolean;
  setMesclando: (v: boolean) => void;
  onEscolherOutra: () => void;
  onFechar: () => void;
  onMesclado: () => void | Promise<void>;
}) {
  const { data: c, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['organizacoes', 'comparar', aberta.id, outra.id],
    queryFn: () => compararOrganizacoes(aberta.id, outra.id),
  });
  const [ficaEscolhida, setFicaEscolhida] = useState<string | null>(null);
  const [escolhas, setEscolhas] = useState<Escolhas>({});

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Comparando as duas…
      </div>
    );
  }
  if (isError || !c) {
    return (
      <div className="p-4">
        <FalhaAoCarregar erro={error} oQue="a comparação" onTentarDeNovo={() => refetch()} />
      </div>
    );
  }

  const ficaId = ficaEscolhida ?? ladoInicial(c);
  const continua = ficaId === c.a.id ? c.a : c.b;
  const some = ficaId === c.a.id ? c.b : c.a;
  const recusa = recusaDoSentido(c, ficaId);
  const recusaAoInverter = recusaDoSentido(c, some.id);
  const conflitos = camposEmConflito(c, ficaId);
  const herdados = herdadosSemPerguntar(c, ficaId);
  const campos = camposDaEscolha(c, ficaId, escolhas);
  const nomeFinal = campos.nome ?? continua.nome;
  const presos = oQueEstaPreso(some);

  const papelDaFonte = (f: Fonte): 'continua' | 'some' | 'receita' =>
    f === 'receita' ? 'receita' : (f === 'a' ? c.a.id : c.b.id) === continua.id ? 'continua' : 'some';

  async function juntar() {
    if (recusa || mesclando) return;
    setMesclando(true);
    try {
      const r = await mesclarOrganizacoes(continua.id, some.id, campos);
      const partes = [
        r.processosRepontados ? contar(r.processosRepontados, 'processo transferido', 'processos transferidos') : null,
        r.participacoesAbsorvidas
          ? contar(r.participacoesAbsorvidas, 'participação absorvida', 'participações absorvidas')
          : null,
        r.vinculosMovidos ? contar(r.vinculosMovidos, 'vínculo de trabalho', 'vínculos de trabalho') : null,
        r.dossiePatronalMovido ? 'dossiê patronal' : null,
        r.camposEscolhidos?.length ? contar(r.camposEscolhidos.length, 'campo escolhido', 'campos escolhidos') : null,
      ].filter(Boolean);
      toast.success(`"${r.removida.nome}" foi juntada a "${nomeFinal}".`, {
        description: partes.length ? partes.join(' · ') : 'Nada estava preso à duplicada.',
      });
      await onMesclado();
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      // As recusas da API são longas de propósito: explicam o que fazer antes.
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível juntar.', { duration: 9000 });
    } finally {
      setMesclando(false);
    }
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/*
          O DESCARTE ANTIGO APARECE ANTES DE TUDO. Foi ele que escondeu a FMS da
          fila: alguém marcou "não são a mesma" e a varredura obedeceu. Quem
          chega aqui pela linha da organização precisa saber disso — pode ser
          um engano a desfazer, ou um motivo que ela não conhecia.
        */}
        {c.descartada && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-snug text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {c.descartada.por ?? 'Alguém'} marcou estas duas como organizações diferentes em{' '}
              {dataCurta(c.descartada.em)} — por isso o par não aparecia na fila de duplicatas. Se
              forem mesmo a mesma, pode juntar: a marca some junto.
            </span>
          </p>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Lado lado={continua} papel="continua" sugerida={c.sugestaoFica === continua.id} />
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setFicaEscolhida(some.id)}
              disabled={!!recusaAoInverter || mesclando}
              title={recusaAoInverter ?? 'Manter a outra e apagar esta'}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9 sm:justify-center sm:p-0"
            >
              <ArrowUpDown className="h-3.5 w-3.5 sm:hidden" />
              <ArrowLeftRight className="hidden h-4 w-4 sm:block" />
              <span className="sm:sr-only">Inverter</span>
            </button>
          </div>
          <Lado lado={some} papel="some" sugerida={c.sugestaoFica === some.id} />
        </div>
        {recusaAoInverter && !recusa && (
          <p className="text-[11px] leading-snug text-muted-foreground">Não dá para inverter: {recusaAoInverter}</p>
        )}

        {conflitos.length > 0 && (
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Onde as duas discordam</h3>
              <p className="text-xs text-muted-foreground">
                Marque o valor que fica. Sem mexer, vale o da que continua.
              </p>
            </div>
            {conflitos.map(({ campo, opcoes }) => {
              const marcada = opcaoEscolhida(opcoes, escolhas[campo]);
              return (
                <fieldset key={campo} className="space-y-1.5">
                  <legend className="mb-1 text-xs font-medium text-muted-foreground">
                    {ROTULO_DO_CAMPO[campo]}
                  </legend>
                  {opcoes.map((o) => {
                    const papel = papelDaFonte(o.fonte);
                    return (
                      <label
                        key={o.fonte}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition',
                          marcada === o
                            ? 'border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/20'
                            : 'hover:bg-muted/50',
                        )}
                      >
                        <input
                          type="radio"
                          name={`campo-${campo}`}
                          checked={marcada === o}
                          onChange={() => setEscolhas((atual) => ({ ...atual, [campo]: o.fonte }))}
                          disabled={mesclando}
                          className="mt-1 h-3.5 w-3.5 shrink-0 accent-brand-700"
                        />
                        <span className="min-w-0 flex-1 break-words">{o.texto}</span>
                        <span
                          className={cn(
                            'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            papel === 'continua' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                            papel === 'some' && 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
                            papel === 'receita' && 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
                          )}
                        >
                          {papel === 'receita' ? 'Receita' : papel}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
          </section>
        )}

        {herdados.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold">Vem da outra sozinho</h3>
            <p className="text-xs text-muted-foreground">Estava em branco na que continua.</p>
            <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
              {herdados.map((h) => (
                <Fragment key={h.campo}>
                  <dt className="text-muted-foreground">{ROTULO_DO_CAMPO[h.campo]}</dt>
                  <dd className="break-words">{h.texto}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        )}

        {c.receita ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              Na Receita, o CNPJ {formatDocumento(c.receita.cnpj)} é de{' '}
              <strong className="font-medium text-foreground">{c.receita.razaoSocial}</strong>
              {c.receita.naturezaJuridica ? ` — ${c.receita.naturezaJuridica}` : ''}
              {c.receita.ativaNaReceita ? '.' : ', e a inscrição não está ativa.'}
            </span>
          </p>
        ) : c.receitaFalhou ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            A Receita não respondeu agora. Dá para juntar assim mesmo e conferir o CNPJ depois, no cadastro.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 border-t bg-muted/30 p-4">
        {recusa ? (
          <p className="flex items-start gap-1.5 text-xs leading-snug text-red-700 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{recusa}</span>
          </p>
        ) : (
          <p className="text-xs leading-snug text-muted-foreground">
            <strong className="font-medium text-foreground">{some.nome}</strong> deixa de existir.{' '}
            {presos ? (
              <>
                Tudo que está nela ({presos}) passa para{' '}
                <strong className="font-medium text-foreground">{nomeFinal}</strong>.
              </>
            ) : (
              <>
                Continua <strong className="font-medium text-foreground">{nomeFinal}</strong>.
              </>
            )}{' '}
            As anotações das duas ficam juntas. Não há desfazer nesta tela — o retrato do que sumiu fica
            na auditoria.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onEscolherOutra}
            disabled={mesclando}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            Escolher outra organização
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={mesclando}>
              Cancelar
            </Button>
            <Button
              onClick={juntar}
              disabled={!!recusa || mesclando}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {mesclando ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              Juntar as duas
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Cada lado: o papel em cor e por extenso, a identidade, e o custo de errar — o que está preso nela. */
function Lado({
  lado, papel, sugerida,
}: {
  lado: LadoDaComparacao;
  papel: 'continua' | 'some';
  sugerida: boolean;
}) {
  const presos = oQueEstaPreso(lado);
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border p-3',
        papel === 'continua'
          ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/20'
          : 'border-dashed border-rose-300 dark:border-rose-900',
      )}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            papel === 'continua'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
          )}
        >
          {papel === 'continua' ? 'Continua' : 'Deixa de existir'}
        </span>
        {sugerida && <span className="text-[10px] text-muted-foreground">sugerida pelo sistema</span>}
      </p>
      <p
        className={cn(
          'mt-1.5 break-words text-sm font-semibold leading-snug',
          papel === 'some' && 'text-muted-foreground',
        )}
      >
        {lado.nome}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {[
          lado.nomeFantasia,
          TIPO_PARTE_LABEL[lado.tipo],
          lado.documento ? formatDocumento(lado.documento) : 'sem CPF/CNPJ',
          lado.cidade,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="mt-2 text-xs">{presos ?? 'nada preso a ela'}</p>
      {lado.ente && <p className="text-[11px] text-muted-foreground">Ente: {lado.ente.nome}</p>}
    </div>
  );
}
