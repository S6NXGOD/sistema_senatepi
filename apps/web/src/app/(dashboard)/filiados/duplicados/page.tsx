'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, HelpCircle,
  Keyboard, List, Merge, Undo2, Users, X,
} from 'lucide-react';
import { LoteDuplicados } from '@/components/filiados/lote-duplicados';
import { Card, CardContent } from '@/components/ui/card';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import { cn, formatarData, mascararCpf } from '@/lib/utils';
import {
  CAMPOS_COMPARADOS, CONFIANCA_COR, CONFIANCA_EXPLICACAO, CONFIANCA_LABEL,
  fraseDoDescarte, fundirDuplicados, listarDescartados, listarDuplicados, marcarDistintos,
  resumoDoCadastro, voltarParaFila,
  type CandidatoDuplicata, type Confianca, type GrupoDuplicata,
} from '@/lib/duplicidade';
import { DURACAO_DO_DESFAZER_MS } from '@/lib/acao-rapida';

const NIVEIS: Confianca[] = ['ALTA', 'MEDIA', 'BAIXA'];

export default function DuplicadosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  /*
    QUEM DECIDE É QUEM O ADMINISTRADOR LIBEROU (15/09/2026). A rota já exige ao
    menos VISUALIZAR em "Cadastros duplicados" (gate da rota). Com VISUALIZAR a
    pessoa acompanha; com EDITAR, consolida, descarta e devolve à fila.
  */
  const podeDecidir = podeEditar(user?.role, user?.permissoes, 'duplicados');
  const [aba, setAba] = useState<Confianca>('ALTA');
  const [fundindo, setFundindo] = useState<{ grupo: GrupoDuplicata; manter: CandidatoDuplicata } | null>(null);
  const [executando, setExecutando] = useState(false);
  /** Escolha do operador quando ele discorda do sugerido (ou não há sugestão). */
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  /**
   * Foco: um grupo por vez, comandado pelo teclado. Rolar uma lista de 1.400
   * cartões e mirar botões com o mouse é o que tornava a revisão exaustiva —
   * aqui a mão não sai do teclado e cada decisão é uma tecla.
   */
  const [modo, setModo] = useState<'lista' | 'foco'>('lista');
  const [indice, setIndice] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['duplicados'],
    queryFn: listarDuplicados,
    enabled: !!user,
    // A varredura percorre a base inteira: não vale refazer a cada foco.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const porNivel = useMemo(() => {
    const mapa: Record<Confianca, GrupoDuplicata[]> = { ALTA: [], MEDIA: [], BAIXA: [] };
    for (const g of data ?? []) mapa[g.confianca].push(g);
    return mapa;
  }, [data]);

  const grupos = porNivel[aba];

  async function confirmarFusao() {
    if (!fundindo) return;
    const descartar = fundindo.grupo.candidatos.find((c) => c.id !== fundindo.manter.id);
    if (!descartar) return;
    setExecutando(true);
    try {
      const r = await fundirDuplicados(fundindo.manter.id, descartar.id);
      toast.success(
        r.camposAbsorvidos?.length
          ? `Consolidado. Aproveitados: ${r.camposAbsorvidos.join(', ')}.`
          : 'Cadastros consolidados.',
      );
      setFundindo(null);
      qc.invalidateQueries({ queryKey: ['duplicados'] });
      qc.invalidateQueries({ queryKey: ['filiados'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível consolidar.');
    } finally {
      setExecutando(false);
    }
  }

  /** Devolve à fila um par marcado como pessoas diferentes — pelo aviso ou pela lista. */
  const devolver = useCallback(
    async (decisaoId: string) => {
      try {
        await voltarParaFila(decisaoId);
        toast.success('O par voltou para a fila.');
        qc.invalidateQueries({ queryKey: ['duplicados'] });
        qc.invalidateQueries({ queryKey: ['duplicados-descartados'] });
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? 'Não foi possível devolver o par à fila.');
      }
    },
    [qc],
  );

  const naoDuplicado = useCallback(
    async (g: GrupoDuplicata) => {
      const [a, b] = g.candidatos;
      try {
        const r = await marcarDistintos(a.id, b.id);
        /*
          O DESCARTE TEM VOLTA (15/09/2026). O aviso dizia "não aparecerá de novo",
          e era verdade: MARIA DA CRUZ DE SOUSA (3520 × 3746) saiu assim da fila e
          ninguém mais a viu. Agora há "Desfazer" aqui e a lista no fim da página.
        */
        const id = r?.id;
        toast.success(
          'Saiu da fila como pessoas diferentes.',
          id ? { duration: DURACAO_DO_DESFAZER_MS, action: { label: 'Desfazer', onClick: () => void devolver(id) } } : undefined,
        );
        qc.invalidateQueries({ queryKey: ['duplicados'] });
        qc.invalidateQueries({ queryKey: ['duplicados-descartados'] });
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? 'Não foi possível registrar.');
      }
    },
    [qc, devolver],
  );

  const atual = grupos[Math.min(indice, Math.max(0, grupos.length - 1))];
  const escolhidoDoAtual = atual
    ? escolha[atual.chave] ?? atual.candidatos.find((c) => c.sugerido)?.id ?? null
    : null;

  /**
   * Atalhos do modo foco.
   *
   * Enter confirma o que está marcado, N descarta o par, setas navegam e 1/2
   * trocam qual cadastro fica. Escrito com `useEffect` no window porque os
   * botões não têm foco: a intenção é justamente não precisar clicar em nada.
   */
  useEffect(() => {
    if (modo !== 'foco' || !atual) return;
    function aoTeclar(e: KeyboardEvent) {
      // Não sequestra o teclado enquanto se digita em algum campo.
      const alvo = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) return;
      const g = atual!;

      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setIndice((i) => Math.min(i + 1, grupos.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndice((i) => Math.max(i - 1, 0));
      } else if (podeDecidir && (e.key === '1' || e.key === '2')) {
        const c = g.candidatos[Number(e.key) - 1];
        if (c) setEscolha((x) => ({ ...x, [g.chave]: c.id }));
      } else if (podeDecidir && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void naoDuplicado(g);
      } else if (podeDecidir && e.key === 'Enter') {
        e.preventDefault();
        const manter = g.candidatos.find((c) => c.id === escolhidoDoAtual);
        if (manter && g.candidatos.length === 2) setFundindo({ grupo: g, manter });
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [modo, atual, grupos.length, escolhidoDoAtual, naoDuplicado, podeDecidir]);

  // Trocar de aba recomeça a fila.
  useEffect(() => { setIndice(0); }, [aba]);

  if (!user) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/filiados" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Filiados
          </Link>
          <h2 className="text-2xl font-bold">Possíveis cadastros duplicados</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A mesma pessoa cadastrada mais de uma vez. Consolidar copia para o registro
            mantido o que só existe no outro, e só então remove o duplicado — nenhum dado
            se perde.
          </p>
        </div>
      </div>

      {/* Consolidação em lote — só a fatia sem nada a perder. */}
      {podeDecidir ? (
        <LoteDuplicados />
      ) : (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          Você acompanha a fila. Consolidar e marcar &ldquo;não é duplicado&rdquo; ficam com quem tem edição em
          &ldquo;Cadastros duplicados&rdquo;, liberada pelo Administrador.
        </p>
      )}

      {/* Abas por confiança */}
      <div className="flex flex-wrap items-center gap-2">
        {NIVEIS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setAba(n)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm transition',
              aba === n ? 'border-brand-800 bg-brand-50 font-semibold dark:bg-brand-900/30' : 'hover:bg-muted',
            )}
          >
            Confiança {CONFIANCA_LABEL[n]}
            <span className="ml-2 rounded-full bg-muted px-1.5 text-xs">{porNivel[n].length}</span>
          </button>
        ))}
        <div className="ml-auto flex gap-1 rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => setModo('lista')}
            className={cn('flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs', modo === 'lista' && 'bg-muted font-semibold')}
          >
            <List className="h-3.5 w-3.5" /> Lista
          </button>
          <button
            type="button"
            onClick={() => setModo('foco')}
            className={cn('flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs', modo === 'foco' && 'bg-muted font-semibold')}
          >
            <Keyboard className="h-3.5 w-3.5" /> Foco
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{CONFIANCA_EXPLICACAO[aba]}</p>

      {isLoading && (
        <Card><CardContent className="p-4">
          <Carregando texto="Comparando os 7 mil cadastros…" mostrarTexto>
            <EsqueletoLinhas quantidade={4} altura={64} className="-mx-4" />
          </Carregando>
        </CardContent></Card>
      )}

      {isError && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Não foi possível carregar. A ferramenta pode ter sido desligada.
        </CardContent></Card>
      )}

      {!isLoading && !isError && grupos.length === 0 && (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-brand-700 dark:text-brand-400" />
          <p className="text-sm font-medium">Nada pendente nesta confiança</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Os grupos resolvidos não voltam a aparecer.
          </p>
        </CardContent></Card>
      )}

      {modo === 'foco' && atual && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={indice === 0} onClick={() => setIndice((i) => i - 1)}>
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              {Math.min(indice + 1, grupos.length)} de {grupos.length}
            </span>
            <Button variant="outline" size="sm" disabled={indice >= grupos.length - 1} onClick={() => setIndice((i) => i + 1)}>
              Pular <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <GrupoCard
            grupo={atual}
            podeDecidir={podeDecidir}
            escolhidoId={escolhidoDoAtual}
            onEscolher={(id) => setEscolha((e) => ({ ...e, [atual.chave]: id }))}
            onFundir={(manter) => setFundindo({ grupo: atual, manter })}
            onNaoDuplicado={() => naoDuplicado(atual)}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium">Atalhos:</span>
            {podeDecidir && (
              <>
                <Atalho tecla="Enter" acao="consolidar" />
                <Atalho tecla="N" acao="não é duplicado" />
                <Atalho tecla="1 / 2" acao="escolher qual fica" />
              </>
            )}
            <Atalho tecla="→ ou Espaço" acao="pular" />
            <Atalho tecla="←" acao="voltar" />
          </div>
        </div>
      )}

      {modo === 'lista' && (
        <div className="space-y-4">
          {grupos.map((g) => (
            <GrupoCard
              key={g.chave}
              grupo={g}
              podeDecidir={podeDecidir}
              escolhidoId={escolha[g.chave] ?? g.candidatos.find((c) => c.sugerido)?.id ?? null}
              onEscolher={(id) => setEscolha((e) => ({ ...e, [g.chave]: id }))}
              onFundir={(manter) => setFundindo({ grupo: g, manter })}
              onNaoDuplicado={() => naoDuplicado(g)}
            />
          ))}
        </div>
      )}

      <MarcadosComoDiferentes onDevolver={devolver} podeDecidir={podeDecidir} />

      <ConfirmDialog
        open={!!fundindo}
        variant="destructive"
        title="Consolidar os cadastros?"
        confirmLabel="Consolidar e remover"
        loading={executando}
        onConfirm={confirmarFusao}
        onClose={() => (executando ? null : setFundindo(null))}
        description={
          fundindo ? (
            <ResumoFusao
              manter={fundindo.manter}
              descartar={fundindo.grupo.candidatos.find((c) => c.id !== fundindo.manter.id)!}
            />
          ) : null
        }
      />
    </div>
  );
}

/** O que saiu da fila como "pessoas diferentes", com a volta ao alcance de quem decide. */
function MarcadosComoDiferentes({
  onDevolver, podeDecidir,
}: {
  onDevolver: (decisaoId: string) => Promise<void>;
  podeDecidir: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['duplicados-descartados'],
    queryFn: listarDescartados,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [aberto, setAberto] = useState(false);
  const [devolvendo, setDevolvendo] = useState<string | null>(null);

  if (!data?.length) return null;

  return (
    <section className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setAberto((x) => !x)}
        aria-expanded={aberto}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="text-sm font-medium">Marcados como pessoas diferentes</span>
          <span className="ml-2 rounded-full bg-muted px-1.5 text-xs">{data.length}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {podeDecidir
              ? 'Saíram da fila. Se algum foi engano, devolva para revisar de novo.'
              : 'Saíram da fila por decisão de quem revisa.'}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition', aberto && 'rotate-180')} aria-hidden="true" />
      </button>
      {aberto && (
        <ul className="divide-y border-t">
          {data.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                {p.cadastros.map((c) => (
                  <p key={c.id} className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{c.matricula}</span>{' '}
                    <span className="font-medium">{c.nomeCompleto}</span>
                    <span className="block text-xs text-muted-foreground sm:ml-2 sm:inline">{resumoDoCadastro(c)}</span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">{fraseDoDescarte(p)}</p>
              </div>
              {podeDecidir && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0 sm:min-h-9"
                  disabled={devolvendo === p.id}
                  onClick={async () => {
                    setDevolvendo(p.id);
                    await onDevolver(p.id);
                    setDevolvendo(null);
                  }}
                >
                  <Undo2 className="h-4 w-4" /> Voltar para a fila
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Atalho({ tecla, acao }: { tecla: string; acao: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] shadow-sm">{tecla}</kbd>
      {acao}
    </span>
  );
}

function GrupoCard({
  grupo, podeDecidir, escolhidoId, onEscolher, onFundir, onNaoDuplicado,
}: {
  grupo: GrupoDuplicata;
  podeDecidir: boolean;
  escolhidoId: string | null;
  onEscolher: (id: string) => void;
  onFundir: (manter: CandidatoDuplicata) => void;
  onNaoDuplicado: () => void;
}) {
  /**
   * Um campo só é "divergente" quando os dois lados têm valor e diferem.
   * Vazio de um lado não é divergência — é justamente o padrão do cadastro
   * duplicado incompleto, e destacá-lo afogaria o que importa em amarelo.
   */
  const divergentes = useMemo(() => {
    const set = new Set<string>();
    for (const { chave } of CAMPOS_COMPARADOS) {
      const valores = grupo.candidatos
        .map((c) => normalizarValor(c[chave as keyof CandidatoDuplicata]))
        .filter((v) => v !== '');
      if (new Set(valores).size > 1) set.add(chave);
    }
    return set;
  }, [grupo]);

  const escolhido = grupo.candidatos.find((c) => c.id === escolhidoId) ?? null;
  const podeFundir = podeDecidir && grupo.candidatos.length === 2 && !!escolhido;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{grupo.candidatos[0].nomeCompleto}</p>
            <p className="text-xs text-muted-foreground">{grupo.criterio}</p>
          </div>
          <div className="flex items-center gap-2">
            {grupo.contradicoes.length > 0 && (
              <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
                <AlertCircle className="mr-1 h-3 w-3" />
                {grupo.contradicoes.join(', ')} divergem
              </Badge>
            )}
            <Badge className={CONFIANCA_COR[grupo.confianca]}>
              {CONFIANCA_LABEL[grupo.confianca]}
            </Badge>
          </div>
        </div>

        {/* Quando o sistema não sabe escolher, ele DIZ isso. Fingir uma
            recomendação em 256 grupos empatados seria transformar sorteio em
            conselho. */}
        {!grupo.decidiu ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {grupo.contradicoes.length > 0
              ? 'Há campos que se contradizem — pode ser que sejam pessoas diferentes. O sistema não sugere nada aqui.'
              : 'Os cadastros estão igualmente preenchidos: não há critério técnico para escolher. A decisão é sua.'}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sugestão: manter o marcado. {grupo.motivoSugestao}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {grupo.candidatos.map((c) => (
            <CandidatoCard
              key={c.id}
              c={c}
              escolhido={c.id === escolhidoId}
              divergentes={divergentes}
              onEscolher={() => onEscolher(c.id)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {podeDecidir && (
            <Button variant="outline" size="sm" onClick={onNaoDuplicado}>
              <X className="h-4 w-4" /> Não é duplicado
            </Button>
          )}
          {podeFundir && (
            <Button size="sm" onClick={() => onFundir(escolhido!)}>
              <Merge className="h-4 w-4" /> Consolidar mantendo {escolhido!.matricula}
            </Button>
          )}
          {podeDecidir && grupo.candidatos.length > 2 && (
            <p className="text-xs text-muted-foreground">
              Grupo com {grupo.candidatos.length} cadastros — consolide dois de cada vez.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CandidatoCard({
  c, escolhido, divergentes, onEscolher,
}: {
  c: CandidatoDuplicata;
  escolhido: boolean;
  divergentes: Set<string>;
  onEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEscolher}
      className={cn(
        'rounded-xl border p-3 text-left transition',
        escolhido
          ? 'border-brand-700 bg-brand-50/60 ring-1 ring-brand-700 dark:bg-brand-900/20'
          : 'hover:bg-muted/50',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{c.matricula}</span>
        <span className={cn('text-xs font-semibold', escolhido ? 'text-brand-800 dark:text-brand-300' : 'text-muted-foreground')}>
          {escolhido ? 'MANTER' : 'remover'}
        </span>
      </div>
      <p className="mb-2 truncate text-sm font-medium">{c.nomeCompleto}</p>
      <dl className="space-y-1 text-xs">
        {CAMPOS_COMPARADOS.map(({ chave, rotulo }) => {
          const bruto = c[chave as keyof CandidatoDuplicata];
          const vazio = bruto === null || bruto === undefined || bruto === '';
          return (
            <div key={chave} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{rotulo}</dt>
              <dd
                className={cn(
                  'truncate text-right',
                  vazio && 'text-muted-foreground/40',
                  !vazio && divergentes.has(chave) && 'font-semibold text-amber-700 dark:text-amber-300',
                )}
              >
                {formatarCampo(chave, bruto)}
              </dd>
            </div>
          );
        })}
        <div className="flex justify-between gap-2 border-t pt-1">
          <dt className="text-muted-foreground">Locais de trabalho</dt>
          <dd className={cn('text-right', c.vinculos === 0 && 'text-muted-foreground/40')}>
            {c.vinculos}
          </dd>
        </div>
      </dl>
    </button>
  );
}

/** O que exatamente vai acontecer — antes de acontecer. */
function ResumoFusao({ manter, descartar }: { manter: CandidatoDuplicata; descartar: CandidatoDuplicata }) {
  const absorvidos = CAMPOS_COMPARADOS.filter(({ chave }) => {
    const meu = manter[chave as keyof CandidatoDuplicata];
    const dele = descartar[chave as keyof CandidatoDuplicata];
    return (meu === null || meu === undefined || meu === '') && dele !== null && dele !== undefined && dele !== '';
  });

  return (
    <div className="space-y-3 text-sm">
      <p>
        Mantém <strong>{manter.matricula}</strong> e remove <strong>{descartar.matricula}</strong>{' '}
        permanentemente.
      </p>
      {absorvidos.length > 0 ? (
        <div className="rounded-lg bg-muted/60 p-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Será copiado para o cadastro mantido
          </p>
          <ul className="space-y-0.5 text-xs">
            {absorvidos.map(({ chave, rotulo }) => (
              <li key={chave}>
                {rotulo}: <strong>{formatarCampo(chave, descartar[chave as keyof CandidatoDuplicata])}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          O cadastro removido não tem nenhum dado que o mantido já não tenha.
        </p>
      )}
      {descartar.vinculos > 0 && (
        <p className="text-xs">
          {descartar.vinculos} local(is) de trabalho serão transferidos.
        </p>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        A matrícula {descartar.matricula} ficará registrada no histórico do cadastro mantido.
      </p>
    </div>
  );
}

function normalizarValor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v).trim().toLowerCase();
}

function formatarCampo(chave: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (chave === 'cpf') return mascararCpf(String(v));
  if (chave === 'dataNascimento' || chave === 'dataFiliacao') return formatarData(String(v));
  return String(v);
}
