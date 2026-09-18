'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, HelpCircle,
  Keyboard, List, Merge, Undo2, UserMinus, Users, X,
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
  agruparDescartes, avisoDaConsolidacao, fraseDoDescarte, fundirDuplicados, fundirGrupoDuplicados,
  listarDescartados, listarDuplicados, marcarDistintos, marcarForaDoGrupo, marcarGrupoDistinto,
  resumoDoCadastro, rotuloDoConsolidar, voltarParaFila,
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
    const descartar = fundindo.grupo.candidatos.filter((c) => c.id !== fundindo.manter.id);
    if (!descartar.length) return;
    setExecutando(true);
    try {
      /*
        GRUPO DE TRÊS OU MAIS TAMBÉM CONSOLIDA (17/09/2026). Antes o botão nem
        aparecia nesses grupos — eram 228 na produção, 724 cadastros parados. A
        rota do grupo confere os CPFs antes de apagar e devolve o que não deu.
      */
      const r = descartar.length === 1
        ? await fundirDuplicados(fundindo.manter.id, descartar[0].id)
        : await fundirGrupoDuplicados(fundindo.manter.id, descartar.map((c) => c.id));
      const aviso = avisoDaConsolidacao(r ?? {});
      if (aviso.tom === 'ok') toast.success(aviso.texto);
      else toast.warning(aviso.texto);
      setFundindo(null);
      qc.invalidateQueries({ queryKey: ['duplicados'] });
      qc.invalidateQueries({ queryKey: ['filiados'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível consolidar.');
    } finally {
      setExecutando(false);
    }
  }

  /**
   * Devolve à fila o que foi marcado como pessoas diferentes — pelo aviso ou pela
   * lista. Um grupo de três gera três decisões, e desfazer tem de trazer as três.
   */
  const devolver = useCallback(
    async (decisao: string | string[]) => {
      const ids = Array.isArray(decisao) ? decisao : [decisao];
      try {
        for (const id of ids) await voltarParaFila(id);
        toast.success(ids.length > 1 ? 'O grupo voltou para a fila.' : 'O par voltou para a fila.');
        qc.invalidateQueries({ queryKey: ['duplicados'] });
        qc.invalidateQueries({ queryKey: ['duplicados-descartados'] });
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? 'Não foi possível devolver para a fila.');
      }
    },
    [qc],
  );

  /**
   * TIRA UM CADASTRO DO GRUPO (17/09/2026).
   *
   * "Num grupo de cinco, e se um deles eu não concordo que é duplicata?" Antes
   * era tudo ou nada. Aqui ele sai como pessoa diferente dos outros, e o resto
   * do grupo continua na fila para decidir.
   */
  const foraDoGrupo = useCallback(
    async (g: GrupoDuplicata, c: CandidatoDuplicata): Promise<boolean> => {
      const outros = g.candidatos.filter((x) => x.id !== c.id).map((x) => x.id);
      try {
        const r = await marcarForaDoGrupo(c.id, outros);
        toast.success(`${c.matricula} saiu do grupo — não é a mesma pessoa.`, r.ids?.length
          ? { duration: DURACAO_DO_DESFAZER_MS, action: { label: 'Desfazer', onClick: () => void devolver(r.ids) } }
          : undefined);
        qc.invalidateQueries({ queryKey: ['duplicados'] });
        qc.invalidateQueries({ queryKey: ['duplicados-descartados'] });
        return true;
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? 'Não foi possível tirar do grupo.');
        return false;
      }
    },
    [qc, devolver],
  );

  const naoDuplicado = useCallback(
    async (g: GrupoDuplicata): Promise<boolean> => {
      const ids = g.candidatos.map((c) => c.id);
      try {
        /*
          NUM GRUPO DE TRÊS, MARCAR SÓ O PRIMEIRO PAR NÃO RESOLVIA (17/09/2026):
          a decisão é gravada por par, e o grupo voltava na varredura seguinte.
        */
        const r = ids.length > 2 ? await marcarGrupoDistinto(ids) : await marcarDistintos(ids[0], ids[1]);
        const decisoes = 'ids' in r ? r.ids : r?.id ? [r.id] : [];
        /*
          O DESCARTE TEM VOLTA (15/09/2026). O aviso dizia "não aparecerá de novo",
          e era verdade: MARIA DA CRUZ DE SOUSA (3520 × 3746) saiu assim da fila e
          ninguém mais a viu. Agora há "Desfazer" aqui e a lista no fim da página.
        */
        toast.success(
          ids.length > 2 ? `Os ${ids.length} saíram da fila como pessoas diferentes.` : 'Saiu da fila como pessoas diferentes.',
          decisoes.length
            ? { duration: DURACAO_DO_DESFAZER_MS, action: { label: 'Desfazer', onClick: () => void devolver(decisoes) } }
            : undefined,
        );
        qc.invalidateQueries({ queryKey: ['duplicados'] });
        qc.invalidateQueries({ queryKey: ['duplicados-descartados'] });
        return true;
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? 'Não foi possível registrar.');
        return false;
      }
    },
    [qc, devolver],
  );

  /**
   * NADA SAI DA FILA SEM PERGUNTAR (18/09/2026).
   *
   * "Está praticamente invisível e ao clicar vai diretamente executando a ação."
   * Era verdade nas DUAS saídas: "não é duplicado" e "não é a mesma pessoa"
   * gravavam no primeiro toque, e a tecla N também. Num trabalho de dezenas de
   * grupos seguidos, um clique de raspão tirava da fila um par que ninguém
   * olhou — e a fila é justamente onde o erro se esconde melhor, porque o que
   * sai dela não volta a aparecer sozinho.
   *
   * A pergunta é rápida de propósito: Enter confirma, Esc desiste, e o texto diz
   * QUEM sai e que dá para voltar. Confirmar é um toque a mais; errar em
   * silêncio custava um cadastro perdido.
   */
  const [separar, setSeparar] = useState<
    | { tipo: 'grupo'; grupo: GrupoDuplicata }
    | { tipo: 'um'; grupo: GrupoDuplicata; candidato: CandidatoDuplicata }
    | null
  >(null);
  const [separando, setSeparando] = useState(false);

  async function confirmarSeparacao() {
    if (!separar) return;
    setSeparando(true);
    try {
      const ok = separar.tipo === 'grupo'
        ? await naoDuplicado(separar.grupo)
        : await foraDoGrupo(separar.grupo, separar.candidato);
      // Fechar mesmo com erro faria a falha parecer sucesso: só fecha no ok.
      if (ok) setSeparar(null);
    } finally {
      setSeparando(false);
    }
  }

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
      /*
        COM UMA PERGUNTA NA TELA, O TECLADO É DELA. O diálogo já para o Enter e
        o Esc na captura, mas as setas continuavam chegando aqui — e trocar o
        grupo ATRÁS do diálogo faria a confirmação valer para outro par.
      */
      if (fundindo || separar) return;
      const g = atual!;

      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        setIndice((i) => Math.min(i + 1, grupos.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndice((i) => Math.max(i - 1, 0));
      // 1 a 9: em grupo de três ou mais, as duas primeiras teclas não bastavam (17/09/2026).
      } else if (podeDecidir && /^[1-9]$/.test(e.key)) {
        const c = g.candidatos[Number(e.key) - 1];
        if (c) setEscolha((x) => ({ ...x, [g.chave]: c.id }));
      } else if (podeDecidir && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        // Abre a pergunta, como o botão — a tecla não pode decidir sozinha.
        setSeparar({ tipo: 'grupo', grupo: g });
      } else if (podeDecidir && e.key === 'Enter') {
        e.preventDefault();
        const manter = g.candidatos.find((c) => c.id === escolhidoDoAtual);
        if (manter) setFundindo({ grupo: g, manter });
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [modo, atual, grupos.length, escolhidoDoAtual, podeDecidir, fundindo, separar]);

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
            onNaoDuplicado={() => setSeparar({ tipo: 'grupo', grupo: atual })}
            onForaDoGrupo={(c) => setSeparar({ tipo: 'um', grupo: atual, candidato: c })}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium">Atalhos:</span>
            {podeDecidir && (
              <>
                <Atalho tecla="Enter" acao="consolidar" />
                <Atalho tecla="N" acao="não é duplicado" />
                <Atalho tecla="1…9" acao="escolher qual fica" />
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
              onNaoDuplicado={() => setSeparar({ tipo: 'grupo', grupo: g })}
              onForaDoGrupo={(c) => setSeparar({ tipo: 'um', grupo: g, candidato: c })}
            />
          ))}
        </div>
      )}

      <MarcadosComoDiferentes onDevolver={devolver} podeDecidir={podeDecidir} />

      {/*
        A PERGUNTA DAS DUAS SAÍDAS. Âmbar, e não vermelha: nada é apagado aqui —
        o par sai da fila e volta pelo "Desfazer" do aviso ou pela lista do fim
        da página. Enter confirma porque tem volta; o diálogo de consolidar, que
        apaga cadastro, não ganha esse atalho de propósito.
      */}
      <ConfirmDialog
        open={!!separar}
        title={separar?.tipo === 'um' ? 'Tirar este cadastro do grupo?' : 'São pessoas diferentes?'}
        confirmLabel={separar?.tipo === 'um' ? 'Tirar do grupo' : 'Sim, são diferentes'}
        cancelLabel="Voltar"
        confirmarComEnter
        loading={separando}
        icon={<UserMinus className="h-6 w-6" />}
        onConfirm={confirmarSeparacao}
        onClose={() => (separando ? null : setSeparar(null))}
        description={separar ? <ResumoSeparacao alvo={separar} /> : null}
      />

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
              descartar={fundindo.grupo.candidatos.filter((c) => c.id !== fundindo.manter.id)}
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
  onDevolver: (decisao: string | string[]) => Promise<void>;
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
  /*
    UMA LINHA POR DECISÃO, não por par (17/09/2026). Marcar um grupo de três
    grava três pares e tirar um de um grupo de cinco grava quatro — a lista
    repetia os mesmos nomes em linhas seguidas.
  */
  const itens = useMemo(() => agruparDescartes(data ?? []), [data]);

  if (!itens.length) return null;

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
          <span className="ml-2 rounded-full bg-muted px-1.5 text-xs">{itens.length}</span>
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
          {itens.map((item) => (
            <li key={item.chave} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                {item.cadastros.map((c) => (
                  <p key={c.id} className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{c.matricula}</span>{' '}
                    <span className="font-medium">{c.nomeCompleto}</span>
                    <span className="block text-xs text-muted-foreground sm:ml-2 sm:inline">{resumoDoCadastro(c)}</span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  {fraseDoDescarte(item)}
                  {item.cadastros.length > 2 && ` · ${item.cadastros.length} cadastros`}
                </p>
              </div>
              {podeDecidir && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0 sm:min-h-9"
                  disabled={devolvendo === item.chave}
                  onClick={async () => {
                    setDevolvendo(item.chave);
                    await onDevolver(item.ids);
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
  grupo, podeDecidir, escolhidoId, onEscolher, onFundir, onNaoDuplicado, onForaDoGrupo,
}: {
  grupo: GrupoDuplicata;
  podeDecidir: boolean;
  onForaDoGrupo: (c: CandidatoDuplicata) => void;
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
  // Grupo de três ou mais também consolida (17/09/2026): mantém o escolhido, remove os outros.
  const podeFundir = podeDecidir && grupo.candidatos.length >= 2 && !!escolhido;

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

        {/*
          TRÊS CABEM NUMA LINHA (18/09/2026). Com duas colunas fixas, o grupo de
          três desenhava dois cartões em cima, um embaixo e meia tela vazia à
          direita — e comparar o terceiro exigia o olho descer e voltar. O
          trabalho aqui É comparar lado a lado; a grade acompanha o tamanho do
          grupo, e no celular continua um embaixo do outro.
        */}
        <div
          className={cn(
            'grid gap-3 md:grid-cols-2',
            grupo.candidatos.length >= 3 && 'lg:grid-cols-3',
          )}
        >
          {grupo.candidatos.map((c) => (
            <div key={c.id} className="space-y-1">
              <CandidatoCard
                c={c}
                escolhido={c.id === escolhidoId}
                divergentes={divergentes}
                onEscolher={() => onEscolher(c.id)}
              />
              {/*
                A SAÍDA DE UM SÓ (17/09/2026). Fora do cartão de propósito: o
                cartão inteiro já é o botão de "manter este", e botão dentro de
                botão não existe em HTML. Só aparece em grupo de três ou mais —
                em grupo de dois, tirar um é o "Não é duplicado" de sempre.
              */}
              {podeDecidir && grupo.candidatos.length > 2 && (
                /*
                  ELE PRECISA PARECER UM BOTÃO (18/09/2026). Era texto cinza sem
                  borda, do tamanho de uma legenda: "está praticamente
                  invisível". A borda TRACEJADA é a metáfora certa — este
                  controle destaca um cadastro do grupo, não apaga nada — e o
                  rosa só no hover diz "isto tira algo daqui" sem pintar de
                  alerta um cartão que ainda não foi decidido.

                  44 px de altura: é alvo de dedo, e a tela é usada no celular.
                */
                <button
                  type="button"
                  onClick={() => onForaDoGrupo(c)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed',
                    'border-muted-foreground/40 text-[13px] font-medium text-muted-foreground transition',
                    'hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700',
                    'dark:hover:border-rose-900 dark:hover:bg-rose-950/30 dark:hover:text-rose-300',
                  )}
                >
                  <UserMinus className="h-4 w-4" aria-hidden="true" />
                  Não é a mesma pessoa
                </button>
              )}
            </div>
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
              <Merge className="h-4 w-4" /> {rotuloDoConsolidar(grupo.candidatos.length, escolhido!.matricula)}
            </Button>
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

/**
 * O que exatamente vai acontecer — antes de acontecer. Serve para um cadastro
 * removido ou para o grupo inteiro: cada campo vazio do mantido diz DE ONDE vai
 * ser preenchido, e as matrículas removidas aparecem uma a uma.
 */
/**
 * O QUE A PERGUNTA MOSTRA — nome e matrícula, não uma frase genérica.
 *
 * "Tem certeza?" não ajuda ninguém a decidir: numa fila de 228 grupos, o que
 * a pessoa precisa confirmar é QUEM ela está separando. A matrícula é o que
 * distingue dois cadastros com o mesmo nome — que é o caso inteiro desta tela.
 */
function ResumoSeparacao({
  alvo,
}: {
  alvo:
    | { tipo: 'grupo'; grupo: GrupoDuplicata }
    | { tipo: 'um'; grupo: GrupoDuplicata; candidato: CandidatoDuplicata };
}) {
  const fica = alvo.tipo === 'um'
    ? alvo.grupo.candidatos.filter((c) => c.id !== alvo.candidato.id)
    : [];

  return (
    <div className="space-y-3 text-sm">
      {alvo.tipo === 'um' ? (
        <>
          <p>
            <strong>{alvo.candidato.matricula}</strong> ({alvo.candidato.nomeCompleto}) sai do grupo
            como pessoa diferente dos outros {fica.length}.
          </p>
          <div className="rounded-lg bg-muted/60 p-2.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Continuam na fila, juntos
            </p>
            <p className="text-xs">{fica.map((c) => c.matricula).join(', ')}</p>
          </div>
        </>
      ) : (
        <>
          <p>
            {alvo.grupo.candidatos.length > 2
              ? `Os ${alvo.grupo.candidatos.length} cadastros saem da fila como pessoas diferentes entre si.`
              : 'Os dois cadastros saem da fila como pessoas diferentes.'}
          </p>
          <div className="rounded-lg bg-muted/60 p-2.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {alvo.grupo.candidatos[0].nomeCompleto}
            </p>
            <p className="text-xs">{alvo.grupo.candidatos.map((c) => c.matricula).join(', ')}</p>
          </div>
        </>
      )}
      {/* Dizer que tem volta é o que permite decidir rápido sem medo. */}
      <p className="text-xs">
        Nada é apagado. Dá para desfazer no aviso que aparece em seguida, ou em
        &ldquo;Marcados como pessoas diferentes&rdquo;, no fim desta página.
      </p>
    </div>
  );
}

function ResumoFusao({ manter, descartar }: { manter: CandidatoDuplicata; descartar: CandidatoDuplicata[] }) {
  const valor = (c: CandidatoDuplicata, chave: string) => c[chave as keyof CandidatoDuplicata];
  const temValor = (v: unknown) => v !== null && v !== undefined && v !== '';
  const absorvidos = CAMPOS_COMPARADOS.map(({ chave, rotulo }) => {
    if (temValor(valor(manter, chave))) return null;
    const fonte = descartar.find((d) => temValor(valor(d, chave)));
    return fonte ? { chave, rotulo, de: fonte } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  const vinculos = descartar.reduce((n, d) => n + d.vinculos, 0);
  const matriculas = descartar.map((d) => d.matricula);
  const varios = descartar.length > 1;

  return (
    <div className="space-y-3 text-sm">
      <p>
        Mantém <strong>{manter.matricula}</strong> e remove <strong>{matriculas.join(', ')}</strong>{' '}
        permanentemente{varios ? ` — ${descartar.length} cadastros` : ''}.
      </p>
      {absorvidos.length > 0 ? (
        <div className="rounded-lg bg-muted/60 p-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Será copiado para o cadastro mantido
          </p>
          <ul className="space-y-0.5 text-xs">
            {absorvidos.map(({ chave, rotulo, de }) => (
              <li key={chave}>
                {rotulo}: <strong>{formatarCampo(chave, valor(de, chave))}</strong>
                {varios && <span className="text-muted-foreground"> (de {de.matricula})</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {varios ? 'Os cadastros removidos não têm' : 'O cadastro removido não tem'} nenhum dado que o mantido já não tenha.
        </p>
      )}
      {vinculos > 0 && (
        <p className="text-xs">
          {vinculos} local(is) de trabalho serão transferidos.
        </p>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {varios
          ? `As matrículas ${matriculas.join(', ')} ficarão registradas`
          : `A matrícula ${matriculas[0]} ficará registrada`}{' '}
        no histórico do cadastro mantido.
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
