'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle, ArrowLeft, CalendarClock, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, HelpCircle, Keyboard, List, Merge, Search, Send, Trash2, Undo2, UserMinus, Users, X,
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
  CAMPOS_COMPARADOS, CAMPOS_DE_ULTIMO_RECURSO, CONFIANCA_COR, CONFIANCA_EXPLICACAO, CONFIANCA_LABEL, frasesDaRiqueza,
  agruparDescartes, avisoDaConsolidacao, fraseDoDescarte, fundirDuplicados, fundirGrupoDuplicados,
  listarDescartados, listarDuplicados, marcarDistintos, marcarForaDoGrupo, marcarGrupoDistinto,
  descartarGrupoVazio, grupoSoTemLinhaVazia,
  planejarConsolidacao, quantosDados, resumoDoCadastro, rotuloDoConsolidar,
  estadoDaFila, separarDecidiveis, soDigitosDoCpf, temValor, veredictoDoCpf, voltarParaFila,
  type AnaliseDeCpf, type VeredictoDoCpf,
  type CandidatoDuplicata, type Confianca, type GrupoDuplicata,
} from '@/lib/duplicidade';
import { DURACAO_DO_DESFAZER_MS } from '@/lib/acao-rapida';
import { EnviarLinkModal } from '@/components/filiados/enviar-link-modal';
import { V } from '@/lib/vocabulario';

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
  /**
   * 'ESPERANDO' não é um quarto nível de confiança: é o balde do que NINGUÉM
   * tem como decidir. Fica fora da fileira de abas de propósito — ver o rodapé.
   */
  const [aba, setAba] = useState<Confianca | 'ESPERANDO'>('ALTA');
  const [fundindo, setFundindo] = useState<{ grupo: GrupoDuplicata; manter: CandidatoDuplicata } | null>(null);
  const [executando, setExecutando] = useState(false);
  /*
    QUAL CPF FICA, quando os dois divergem — ver `veredictoDoCpf`.

    Reposto toda vez que o diálogo abre, com a escolha que o sistema já sabe
    fazer (o único que passa no dígito verificador). Deixar de repor faria a
    escolha do grupo anterior vazar para o próximo, e este é o campo que decide
    qual CPF sobrevive.
  */
  const [cpfQueFica, setCpfQueFica] = useState<string | null>(null);
  const conflitoDeCpf = fundindo?.grupo.cpfEmConflito ?? null;
  const veredictoCpf = conflitoDeCpf ? veredictoDoCpf(conflitoDeCpf) : null;
  /*
    A ESCOLHA PADRÃO VEM DO SISTEMA, e é reposta aqui em vez de em cada lugar
    que abre o diálogo — são três, e um quarto esqueceria. Sem conflito de CPF
    isto zera, que é o estado normal.
  */
  useEffect(() => {
    setCpfQueFica(veredictoCpf?.escolhaPadrao ?? null);
    // A dependência é a ABERTURA do diálogo, não o objeto derivado dela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundindo]);
  /** Falta escolher, ou os dois CPFs são válidos: não dá para confirmar. */
  const fusaoTravada = !!conflitoDeCpf && (!veredictoCpf?.liberado || !cpfQueFica);
  /** Escolha do operador quando ele discorda do sugerido (ou não há sugestão). */
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  /**
   * Foco: um grupo por vez, comandado pelo teclado. Rolar uma lista de 1.400
   * cartões e mirar botões com o mouse é o que tornava a revisão exaustiva —
   * aqui a mão não sai do teclado e cada decisão é uma tecla.
   */
  /*
    UM POR VEZ É O PADRÃO (18/09/2026).

    O modo foco existia desde o começo e NINGUÉM o encontrou: era um botão de
    12 px encostado na direita da fileira de abas, e a lista abria por padrão.
    Construí o antídoto do tédio e deixei desligado atrás de uma nota de rodapé
    — daí "não notei diferença".

    Uma fila de 600 grupos é trabalho de triagem: um por vez, decidido pelo
    teclado, é a ferramenta certa. A lista continua a um clique, para quem
    quer varrer o todo com o olho.
  */
  const [modo, setModo] = useState<'lista' | 'foco'>('foco');
  const [indice, setIndice] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['duplicados'],
    queryFn: listarDuplicados,
    enabled: !!user,
    // A varredura percorre a base inteira: não vale refazer a cada foco.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  /*
    A FILA É SÓ O QUE ALGUÉM CONSEGUE DECIDIR (18/09/2026). Ver `separarDecidiveis`:
    na produção, 255 dos 389 grupos não têm um dado sequer em nenhum dos
    cadastros. Pedir julgamento neles é pedir sorteio, e é o que fazia a fila
    parecer interminável. Continuam a um clique, no rodapé.
  */
  const { decidiveis, esperando } = useMemo(() => separarDecidiveis(data ?? []), [data]);

  const porNivel = useMemo(() => {
    const mapa: Record<Confianca, GrupoDuplicata[]> = { ALTA: [], MEDIA: [], BAIXA: [] };
    for (const g of decidiveis) mapa[g.confianca].push(g);
    return mapa;
  }, [decidiveis]);

  const grupos = aba === 'ESPERANDO' ? esperando : porNivel[aba];
  /** O que dizer quando a aba está vazia — ver `estadoDaFila`. */
  const estadoVazio = estadoDaFila({
    nestaAba: grupos.length,
    decidiveis: decidiveis.length,
    esperando: esperando.length,
  });

  /**
   * DESCARTAR O GRUPO VAZIO — 22/09/2026.
   *
   * É o oposto da consolidação, e por isso tem confirmação própria: consolidar
   * escolhe QUEM FICA; aqui não fica ninguém, porque não há ninguém. Quatro
   * fichas chamadas "0", sem um dado sequer, sem um atendimento sequer.
   *
   * As travas são do servidor. Se qualquer ficha do grupo tiver um dado ou um
   * histórico, NADA é apagado e a mensagem diz qual e por quê — é ela que
   * aparece no toast, sem tradução.
   */
  const [descartando, setDescartando] = useState<GrupoDuplicata | null>(null);

  async function confirmarDescarte() {
    if (!descartando) return;
    setExecutando(true);
    try {
      const r = await descartarGrupoVazio(descartando.candidatos.map((c) => c.id));
      toast.success(`${r.removidos} ficha(s) vazia(s) removida(s): ${r.matriculas.join(', ')}.`);
      setDescartando(null);
      setResolvidos((n) => n + 1);
      qc.invalidateQueries({ queryKey: ['duplicados'] });
      qc.invalidateQueries({ queryKey: ['filiados'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível remover.');
    } finally {
      setExecutando(false);
    }
  }

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
        ? await fundirDuplicados(fundindo.manter.id, descartar[0].id, cpfQueFica ?? undefined)
        : await fundirGrupoDuplicados(fundindo.manter.id, descartar.map((c) => c.id));
      const aviso = avisoDaConsolidacao(r ?? {});
      if (aviso.tom === 'ok') toast.success(aviso.texto);
      else toast.warning(aviso.texto);
      setFundindo(null);
      setResolvidos((n) => n + 1);
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

  /**
   * QUANTOS VOCÊ JÁ RESOLVEU NESTA SESSÃO (18/09/2026).
   *
   * "Não tem como deixar menos tedioso esse processo que é tão chato?" Tem, e a
   * resposta honesta NÃO é ponto nem medalha — é mostrar que a fila anda. São
   * 1.174 grupos: sem nenhuma marca de progresso, cada decisão parece a primeira
   * e a pilha parece infinita.
   *
   * O número mora só na memória da aba de propósito: é "quanto eu andei agora",
   * não uma estatística de produtividade. Gravar isso no servidor viraria
   * medida de desempenho de pessoa, que é outra conversa e não é esta.
   */
  const [resolvidos, setResolvidos] = useState(0);

  async function confirmarSeparacao() {
    if (!separar) return;
    setSeparando(true);
    try {
      const ok = separar.tipo === 'grupo'
        ? await naoDuplicado(separar.grupo)
        : await foraDoGrupo(separar.grupo, separar.candidato);
      // Fechar mesmo com erro faria a falha parecer sucesso: só fecha no ok.
      if (ok) { setSeparar(null); setResolvidos((n) => n + 1); }
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
            mantido o que só existe no outro, preserva a filiação mais antiga e só então
            remove o duplicado.
          </p>
        </div>
      </div>

      <ComoFunciona />
      <PlacarDaFila resolvidos={resolvidos} restantes={decidiveis.length} />

      {/* Consolidação em lote — só a fatia em que o removido não tem dado a copiar. */}
      {podeDecidir ? (
        <LoteDuplicados gruposNaFila={(data ?? []).length} />
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
        {/*
          O BALDE VIROU ABA DE VERDADE — 22/09/2026.

          Em 18/09 ele só aparecia quando você já estava dentro, para a fileira
          não exibir "397 pendências" que ninguém decide. A escolha não estava
          errada; ficou velha. Com as três confianças em ZERO, o único balde com
          conteúdo era o escondido, e a tela inteira parecia resolvida — o dono
          abriu, viu um ✓ verde e disse "aqui não aparece nada pra fazer".

          Continua TRACEJADO e continua fora da conta de pendências: não é
          trabalho atrasado, é trabalho que depende de um dado chegar. Mas está
          na fileira, com o número, do lado das outras.
        */}
        {esperando.length > 0 && (
          <button
            type="button"
            onClick={() => setAba('ESPERANDO')}
            className={cn(
              'rounded-lg border border-dashed px-3 py-2 text-sm transition',
              aba === 'ESPERANDO'
                ? 'border-brand-800 bg-brand-50 font-semibold dark:bg-brand-900/30'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            Sem dado para decidir
            <span className="ml-2 rounded-full bg-muted px-1.5 text-xs">{esperando.length}</span>
          </button>
        )}
        {/*
          O SELETOR TINHA TAMANHO DE LEGENDA e ninguém o via. Agora tem a mesma
          altura das abas, texto legível e rótulo que diz o que faz — "Um por
          vez" e "Lista", não "Foco", que só significa algo para quem já sabe.
        */}
        <div className="ml-auto flex gap-1 rounded-lg border p-1" role="group" aria-label="Como revisar">
          <button
            type="button"
            onClick={() => setModo('foco')}
            aria-pressed={modo === 'foco'}
            className={cn(
              'flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition',
              modo === 'foco' ? 'bg-brand-800 font-semibold text-white' : 'hover:bg-muted',
            )}
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" /> Um por vez
          </button>
          <button
            type="button"
            onClick={() => setModo('lista')}
            aria-pressed={modo === 'lista'}
            className={cn(
              'flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition',
              modo === 'lista' ? 'bg-brand-800 font-semibold text-white' : 'hover:bg-muted',
            )}
          >
            <List className="h-4 w-4" aria-hidden="true" /> Lista
          </button>
        </div>
      </div>
      {/*
        A EXPLICAÇÃO DO BALDE PRECISA DIZER O QUE FAZER — 22/09/2026.

        Ela dizia só o que falta ("não há como afirmar..."), e parava aí. Quem
        chega precisa saber que sobram três fatos para olhar e que existe um
        caminho para conseguir o dado que resolve. E precisa saber o resultado
        que MEDIMOS: nos 3 grupos da base em que havia como saber, os CPFs eram
        diferentes — eram pessoas diferentes nos 3.
      */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {aba === 'ESPERANDO' ? (
          <>
            Nenhuma ficha destes grupos tem CPF, COREN, nascimento ou contato — o sistema não
            consegue afirmar que são a mesma pessoa <strong>nem</strong> que são diferentes. Sobram
            a matrícula e as datas. Nos 3 grupos desta base em que deu para conferir, os CPFs eram{' '}
            <strong>diferentes</strong>: eram pessoas diferentes nos três. Peça o CPF pelo link e o
            grupo se resolve sozinho.
          </>
        ) : (
          CONFIANCA_EXPLICACAO[aba]
        )}
      </p>

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

      {/*
        O ✓ VERDE SÓ QUANDO ACABOU MESMO — 22/09/2026.

        Ele dizia "Nada pendente nesta confiança" com 148 grupos do outro lado
        de um link cinza no rodapé. ✓ verde quer dizer "acabou", e não tinha
        acabado. Ver `estadoDaFila`.
      */}
      {!isLoading && !isError && grupos.length === 0 && (
        <Card><CardContent className="flex flex-col items-center gap-2.5 py-12 text-center">
          {estadoVazio === 'TUDO_RESOLVIDO' ? (
            <>
              <CheckCircle2 className="h-8 w-8 text-brand-700 dark:text-brand-400" />
              <p className="text-sm font-medium">Nenhum cadastro duplicado na fila</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Os grupos resolvidos não voltam a aparecer.
              </p>
            </>
          ) : estadoVazio === 'SO_ESPERANDO' ? (
            <>
              <Search className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nada a decidir com o que o cadastro tem hoje</p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                Há <strong className="font-semibold text-foreground">{esperando.length}</strong> grupos
                de nome igual em que <strong>nenhuma</strong> das fichas tem CPF, contato ou
                nascimento — não dá para afirmar que são a mesma pessoa. Dá para olhar mesmo assim,
                pela matrícula e pelas datas, ou pedir o dado ao {V.filiado} pelo link de
                recadastramento.
              </p>
              <Button className="mt-1" onClick={() => setAba('ESPERANDO')}>
                Ver os {esperando.length} grupos
              </Button>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-8 w-8 text-brand-700 dark:text-brand-400" />
              <p className="text-sm font-medium">
                {aba === 'ESPERANDO' ? 'Nenhum grupo sem dado' : 'Nada pendente nesta confiança'}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Ainda há grupos em outra confiança — toque nas abas acima.
              </p>
            </>
          )}
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
            onDescartarVazio={() => setDescartando(atual)}
            onForaDoGrupo={(c) => setSeparar({ tipo: 'um', grupo: atual, candidato: c })}
          />

          {/* A legenda dos atalhos também é só de quem tem teclado. */}
          <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground md:flex">
            <span className="font-medium">Atalhos:</span>
            {podeDecidir && (
              <>
                {/*
                  DOIS ENTER, e a legenda diz isso: o primeiro abre a pergunta,
                  o segundo confirma. Escrever só "consolidar" fazia parecer que
                  uma tecla apaga o cadastro.
                */}
                <Atalho tecla="Enter" acao="consolidar (2×)" />
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
              onDescartarVazio={() => setDescartando(g)}
              onForaDoGrupo={(c) => setSeparar({ tipo: 'um', grupo: g, candidato: c })}
            />
          ))}
        </div>
      )}

      <MarcadosComoDiferentes onDevolver={devolver} podeDecidir={podeDecidir} />

      {/*
        A PERGUNTA DAS DUAS SAÍDAS. Âmbar, e não vermelha: nada é apagado aqui —
        o par sai da fila e volta pelo "Desfazer" do aviso ou pela lista do fim
        da página. Enter confirma porque tem volta — e, desde 18/09/2026, o
        diálogo de consolidar também confirma com Enter, por decisão do dono:
        ver o comentário lá embaixo.
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

      {/*
        SEM ATALHO DE ENTER AQUI, e é deliberado. O Enter foi ligado na
        consolidação porque quem decide centenas paga caro por largar o teclado.
        Este caso é raro (um grupo na base inteira) e apaga sem escolher quem
        fica — não há rotina para acelerar, e há um erro possível para evitar.
      */}
      <ConfirmDialog
        open={!!descartando}
        variant="destructive"
        title="Remover as fichas vazias?"
        confirmLabel={`Remover ${descartando?.candidatos.length ?? 0} fichas`}
        loading={executando}
        onConfirm={confirmarDescarte}
        onClose={() => setDescartando(null)}
        description={
          descartando ? (
            <div className="space-y-2 text-sm">
              <p>
                Estas {descartando.candidatos.length} fichas não têm nome de gente, nenhum dado
                cadastrado e nenhum histórico — são linhas que entraram em branco na importação.
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {descartando.candidatos.map((c) => c.matricula).join(', ')}
              </p>
              <p className="text-xs text-muted-foreground">
                Se alguma delas tiver qualquer dado ou histórico, nada é apagado e o sistema diz
                qual. Não há desfazer.
              </p>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!fundindo}
        variant="destructive"
        title="Consolidar os cadastros?"
        confirmLabel="Consolidar e remover"
        /*
          ENTER CONFIRMA TAMBÉM AQUI — decisão do dono (18/09/2026).

          Este diálogo era o único da fila SEM o atalho, de propósito: consolidar
          apaga cadastro e não tem desfazer. O dono usou a fila e pediu o
          contrário — "só apertar enter de novo para confirmar" —, porque quem
          decide centenas de duplicatas paga caro por largar o teclado em cada
          uma. Com o atalho ligado o botão de cancelar sai: Enter confirma, Esc
          volta, e o X do canto atende o telefone, que não tem nenhuma das duas.
        */
        confirmarComEnter
        loading={executando}
        /*
          COM CPFs DIVERGENTES O ENTER NÃO CONFIRMA SOZINHO. `confirmDisabled`
          trava o botão E o atalho: quem decide precisa ler o que os dígitos
          verificadores dizem antes de apagar um cadastro. Com os dois CPFs
          válidos, nada libera.
        */
        confirmDisabled={fusaoTravada}
        onConfirm={confirmarFusao}
        onClose={() => (executando ? null : setFundindo(null))}
        description={
          fundindo ? (
            <ResumoFusao
              manter={fundindo.manter}
              descartar={fundindo.grupo.candidatos.filter((c) => c.id !== fundindo.manter.id)}
              conflitoDeCpf={conflitoDeCpf}
              veredicto={veredictoCpf}
              cpfQueFica={cpfQueFica}
              onEscolherCpf={setCpfQueFica}
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
  onDescartarVazio,
}: {
  grupo: GrupoDuplicata;
  podeDecidir: boolean;
  onForaDoGrupo: (c: CandidatoDuplicata) => void;
  escolhidoId: string | null;
  onEscolher: (id: string) => void;
  onFundir: (manter: CandidatoDuplicata) => void;
  onNaoDuplicado: () => void;
  /** Só chamado quando o grupo é linha vazia de importação. */
  onDescartarVazio: () => void;
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

  /*
    SÓ AS LINHAS QUE ALGUÉM PREENCHEU (18/09/2026).

    "Ainda acho muito igual a antes e extremamente chato." Estava certo, e o
    motivo é aritmético: medido no acervo, a tela desenhava 20.920 células nos
    1.174 grupos e só 6.557 tinham conteúdo — **69% de traço**. Em 533 grupos há
    UM campo preenchido no grupo inteiro; em 143, nenhum. O olho varria oito
    linhas por cartão para achar uma.

    Escondendo o que ninguém tem, o cartão de um grupo comum cai de oito linhas
    para duas, e a comparação deixa de ser leitura e vira olhada.
  */
  /*
    NOS GRUPOS SEM DADO, A DATA DA FICHA ENTRA — 22/09/2026.

    Ali os cartões mostravam nome, matrícula e "Nenhum outro dado cadastrado", e
    a pessoa tinha de decidir com isso. `createdAt` é o fato que separa "duas
    fichas criadas no mesmo dia, matrículas consecutivas" (que na produção deu
    DUAS PESSOAS, com CPFs distintos) de "uma de 2014 e outra da carga de 2026".
    Não prova nada sozinho, e a frase abaixo dos cartões diz isso — mas decidir
    com três fatos é decidir; com zero é sortear.

    Só nesse balde: num grupo que já tem CPF ou contato, a data da ficha é ruído.
  */
  const campos = useMemo(() => {
    const lista: ReadonlyArray<{ chave: string; rotulo: string }> =
      grupo.esperandoDado === true
        ? [...CAMPOS_COMPARADOS, ...CAMPOS_DE_ULTIMO_RECURSO]
        : CAMPOS_COMPARADOS;
    const vistos = new Set<string>();
    return lista.filter(({ chave }) => {
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return grupo.candidatos.some((c) => temValor(c[chave as keyof CandidatoDuplicata]));
    });
  }, [grupo]);
  const mostrarVinculos = useMemo(
    () => grupo.candidatos.some((c) => c.vinculos > 0),
    [grupo],
  );
  /**
   * NINGUÉM NO GRUPO TEM DADO QUE IDENTIFIQUE — é o balde "sem dado para
   * decidir". Só aqui aparece o botão de pedir o CPF: num grupo que já tem o
   * dado, pedir de novo é ruído.
   */
  const semDadoNenhum = grupo.esperandoDado === true;
  /**
   * Grupo que não tem ninguém para consolidar — ver `grupoSoTemLinhaVazia`.
   * Aqui só decide o que a tela oferece; quem apaga confere de novo.
   */
  const soLinhaVazia = useMemo(() => grupoSoTemLinhaVazia(grupo), [grupo]);
  const [pedindoDado, setPedindoDado] = useState<{ id: string; nome: string } | null>(null);
  /**
   * O cadastro com mais dados — e SÓ quando ele é único. Com empate não existe
   * "o mais completo", e fingir que existe é o mesmo que sortear.
   */
  const idMaisRico = useMemo(() => {
    const contagens = grupo.candidatos.map((c) => ({
      id: c.id,
      n: quantosDados(c as unknown as Record<string, unknown>),
    }));
    const maior = Math.max(...contagens.map((x) => x.n));
    const lideres = contagens.filter((x) => x.n === maior);
    return maior > 0 && lideres.length === 1 ? lideres[0].id : null;
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
          {grupo.candidatos.map((c) => {
            const eleEscolhido = c.id === escolhidoId;
            /*
              A SAÍDA DE UM SÓ MORA DENTRO DO CARTÃO (18/09/2026).

              Terceira tentativa, e a queixa mudou: "tô achando o botão grande e
              o card pequeno, não me parece ter harmonia". Estava certo — era um
              Button de 44 px e largura cheia, pendurado ABAIXO de um cartão de
              três linhas, repetido três vezes no mesmo grupo. O controle pesava
              mais que a informação que ele comanda.

              As duas tentativas anteriores trataram CONTRASTE; o problema desta
              vez é HIERARQUIA. A ação pertence ao cartão, então mora nele: a
              borda passou para o invólucro e o controle virou o RODAPÉ do
              cartão — mesma largura, mesmo canto, separado por um fio. Continua
              alvo de dedo no celular (44 px) e encolhe no desktop, onde o
              ponteiro não precisa de tanto.

              O cartão inteiro é um <button> ("manter este"), e botão dentro de
              botão não existe em HTML — por isso são dois irmãos dentro de um
              invólucro, e não um dentro do outro.
            */
            const podeTirarDoGrupo = podeDecidir && grupo.candidatos.length > 2;
            return (
              <div
                key={c.id}
                className={cn(
                  'flex flex-col overflow-hidden rounded-xl border transition',
                  eleEscolhido
                    ? 'border-brand-700 ring-1 ring-brand-700'
                    : 'hover:border-foreground/20',
                )}
              >
                <CandidatoCard
                  c={c}
                  escolhido={eleEscolhido}
                  divergentes={divergentes}
                  campos={campos}
                  mostrarVinculos={mostrarVinculos}
                  maisRico={c.id === idMaisRico}
                  onEscolher={() => onEscolher(c.id)}
                />
                {/*
                  PEDIR O DADO É A ÚNICA SAÍDA QUE RESOLVE — 22/09/2026.

                  Nestes grupos ninguém tem CPF, e é o CPF que decide: se as
                  duas fichas receberem o MESMO, o sistema recusa a segunda por
                  unicidade — e isso PROVA que são a mesma pessoa. Se vierem
                  diferentes, o grupo se resolve sozinho como pessoas
                  diferentes, que foi o que aconteceu nos 3 grupos da base em
                  que havia como saber.

                  Antes de 22/09 este botão não existiria: ficha em branco não
                  gerava link. Agora gera, e é ela quem preenche.
                */}
                {semDadoNenhum && (
                  <button
                    type="button"
                    onClick={() => setPedindoDado({ id: c.id, nome: c.nomeCompleto })}
                    aria-label={`Pedir o CPF a ${c.matricula} pelo link de recadastramento`}
                    className={cn(
                      'flex min-h-11 w-full items-center justify-center gap-1.5 border-t',
                      'text-xs font-medium text-brand-800 transition md:h-9 md:min-h-0',
                      'hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30',
                    )}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    Pedir o CPF a esta pessoa
                  </button>
                )}
                {podeTirarDoGrupo && (
                  <button
                    type="button"
                    onClick={() => onForaDoGrupo(c)}
                    aria-label={`Tirar ${c.matricula} do grupo: não é a mesma pessoa`}
                    className={cn(
                      'flex min-h-11 w-full items-center justify-center gap-1.5 border-t',
                      'text-xs text-muted-foreground transition md:h-9 md:min-h-0',
                      'hover:bg-rose-50 hover:text-rose-700',
                      'dark:hover:bg-rose-950/30 dark:hover:text-rose-300',
                    )}
                  >
                    <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
                    Tirar do grupo
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {pedindoDado && (
          <EnviarLinkModal
            filiadoId={pedindoDado.id}
            nome={pedindoDado.nome}
            open
            onClose={() => setPedindoDado(null)}
          />
        )}

        {/*
          NÃO HÁ NINGUÉM PARA CONSOLIDAR — 22/09/2026.

          O dono topou com QUATRO fichas chamadas "0" e a única saída era
          "Consolidar 4 mantendo 3067" — que deixa de pé uma ficha chamada "0".
          A frase dele: *"esse aí não serve para nada. Como posso remover
          todos?"*.

          Quando o grupo é só linha vazia de importação, o consolidar SAI de
          cena e entra o descarte das N fichas. Não é o caminho da fila comum: é
          o oposto dela. Na fila, o risco é apagar gente; aqui não há gente —
          nome que não é nome, zero dado, zero histórico, e o servidor confere
          as três de novo antes de apagar.
        */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {podeDecidir && !soLinhaVazia && (
            <Button variant="outline" size="sm" onClick={onNaoDuplicado}>
              <X className="h-4 w-4" /> Não é duplicado
            </Button>
          )}
          {podeFundir && !soLinhaVazia && (
            <Button size="sm" onClick={() => onFundir(escolhido!)}>
              <Merge className="h-4 w-4" /> {rotuloDoConsolidar(grupo.candidatos.length, escolhido!.matricula)}
            </Button>
          )}
          {/*
            NÃO DEPENDE DE ESCOLHER QUEM FICA — e foi assim que o botão não
            apareceu na primeira conferência de tela. `podeFundir` exige um
            cadastro escolhido, porque consolidar precisa saber quem sobra.
            Aqui não sobra ninguém: a condição é só poder decidir.
          */}
          {podeDecidir && soLinhaVazia && (
            <Button size="sm" variant="destructive" onClick={onDescartarVazio}>
              <Trash2 className="h-4 w-4" /> Excluir as {grupo.candidatos.length} fichas vazias
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CandidatoCard({
  c, escolhido, divergentes, campos, mostrarVinculos, maisRico, onEscolher,
}: {
  c: CandidatoDuplicata;
  escolhido: boolean;
  divergentes: Set<string>;
  /** Só os campos que ALGUÉM do grupo preencheu — ver `camposComAlgumValor`. */
  /*
    Lista aberta, e não `typeof CAMPOS_COMPARADOS[number][]`: no balde "sem
    dado para decidir" entra também "Ficha criada em", que não pertence à lista
    fixa. Ver `CAMPOS_DE_ULTIMO_RECURSO`.
  */
  campos: ReadonlyArray<{ chave: string; rotulo: string }>;
  mostrarVinculos: boolean;
  /** Este cartão é o que carrega mais dados, sozinho? */
  maisRico: boolean;
  onEscolher: () => void;
}) {
  const dados = quantosDados(c as unknown as Record<string, unknown>);
  return (
    <button
      type="button"
      onClick={onEscolher}
      className={cn(
        // A borda e o anel moram no invólucro — ver o comentário em GrupoCard.
        'flex-1 p-3 text-left transition',
        escolhido ? 'bg-brand-50/60 dark:bg-brand-900/20' : 'hover:bg-muted/50',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{c.matricula}</span>
        <span className={cn('text-xs font-semibold', escolhido ? 'text-brand-800 dark:text-brand-300' : 'text-muted-foreground')}>
          {escolhido ? 'MANTER' : 'remover'}
        </span>
      </div>
      <p className="truncate text-sm font-medium">{c.nomeCompleto}</p>
      {/*
        QUANTOS DADOS, ANTES DE LER QUALQUER CAMPO (18/09/2026).

        "Queria uma dica para deixar o que está mais rico de dados." O sistema já
        sugeria, mas a razão morava numa frase acima dos cartões. Aqui o número
        fica em cima de cada um: a comparação vira "3 dados contra 1" de relance,
        e nos 143 grupos em que ninguém tem nada ele diz isso de uma vez.
      */}
      <p className="mb-2 mt-0.5 flex items-center gap-1 text-[11px]">
        <span className={cn(dados === 0 ? 'text-muted-foreground/70' : 'font-medium text-foreground/70')}>
          {frasesDaRiqueza(dados)}
        </span>
        {maisRico && (
          <span className="rounded-full bg-brand-100 px-1.5 font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
            o mais completo
          </span>
        )}
      </p>
      <dl className="space-y-1 text-xs">
        {campos.map(({ chave, rotulo }) => {
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
        {mostrarVinculos && (
        <div className="flex justify-between gap-2 border-t pt-1">
          <dt className="text-muted-foreground">Locais de trabalho</dt>
          <dd className={cn('text-right', c.vinculos === 0 && 'text-muted-foreground/40')}>
            {c.vinculos}
          </dd>
        </div>
        )}
      </dl>
      {/*
        E QUANDO NÃO SOBRA CAMPO NENHUM, a ausência é dita com palavra — um
        cartão com só o nome e a data deixaria a pessoa procurando o que não
        existe. São 143 grupos assim no acervo.
      */}
      {campos.length <= 1 && !mostrarVinculos && (
        <p className="mt-1 text-[11px] italic text-muted-foreground">
          Nenhum outro dado cadastrado.
        </p>
      )}
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

function ResumoFusao({
  manter, descartar, conflitoDeCpf, veredicto, cpfQueFica, onEscolherCpf,
}: {
  manter: CandidatoDuplicata;
  descartar: CandidatoDuplicata[];
  conflitoDeCpf?: AnaliseDeCpf | null;
  veredicto?: VeredictoDoCpf | null;
  cpfQueFica?: string | null;
  onEscolherCpf?: (cpf: string) => void;
}) {
  const valor = (c: CandidatoDuplicata, chave: string) => c[chave as keyof CandidatoDuplicata];
  /*
    A PRÉVIA LÊ A MESMA REGRA (18/09/2026). Este resumo recalculava o efeito da
    fusão por conta própria e mostrava só metade: o que seria COPIADO. A conta
    inteira — o que se copia, o que se APAGA por divergência e a filiação mais
    antiga que é preservada — mora em `planejarConsolidacao`, testada sozinha.
  */
  const { absorvidos, perdidos, filiacaoPreservada } = planejarConsolidacao(
    manter,
    descartar,
    cpfQueFica,
  );
  const vinculos = descartar.reduce((n, d) => n + d.vinculos, 0);
  const matriculas = descartar.map((d) => d.matricula);
  const varios = descartar.length > 1;

  return (
    <div className="space-y-3 text-sm">
      <p>
        Mantém <strong>{manter.matricula}</strong> e remove <strong>{matriculas.join(', ')}</strong>{' '}
        permanentemente{varios ? ` — ${descartar.length} cadastros` : ''}.
      </p>

      {/*
        CPFs QUE DIVERGEM — ver `veredictoDoCpf` (18/09/2026).

        Vem antes de tudo porque é o único ponto do diálogo em que a decisão
        pode estar ERRADA de um jeito que ninguém percebe depois: o CPF que a
        tela mantinha era o do cadastro escolhido, e no caso que abriu isto ele
        era justamente o inválido.
      */}
      {conflitoDeCpf && veredicto && (
        <div
          className={cn(
            'space-y-2 rounded-lg border p-2.5',
            veredicto.liberado
              ? 'border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20'
              : 'border-rose-300 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20',
          )}
        >
          <p className="font-semibold">{veredicto.titulo}</p>
          <p className="text-xs leading-snug text-muted-foreground">{veredicto.recado}</p>
          {veredicto.liberado && (
            <ul className="space-y-1">
              {conflitoDeCpf.porCadastro.map((c) => {
                const digitos = soDigitosDoCpf(c.cpf);
                const marcado = cpfQueFica === digitos;
                return (
                  <li key={c.id}>
                    <label
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5',
                        marcado ? 'border-foreground/40 bg-background' : 'border-transparent',
                      )}
                    >
                      <input
                        type="radio"
                        name="cpf-que-fica"
                        className="h-4 w-4 shrink-0"
                        checked={marcado}
                        onChange={() => onEscolherCpf?.(digitos)}
                      />
                      {/* O CPF em UMA linha: quebrado no meio ("840.053.869-
34")
                          ele deixa de ser um número e vira dois. O veredito desce
                          para a segunda linha no telefone. */}
                      <span className="min-w-0 flex-1">
                        <span className="block whitespace-nowrap font-mono text-xs">
                          {mascararCpf(c.cpf)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          matrícula {c.matricula}
                          <span
                            className={cn(
                              'ml-1.5 font-medium',
                              c.valido
                                ? 'text-brand-800 dark:text-brand-300'
                                : 'text-muted-foreground',
                            )}
                          >
                            · {c.valido ? 'válido' : 'dígito não bate'}
                          </span>
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
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
      {filiacaoPreservada && (
        <p className="flex items-start gap-1.5 rounded-lg bg-brand-50 p-2.5 text-xs text-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {/*
            DUAS FRASES, PORQUE SÃO DUAS SITUAÇÕES. Quando o mantido não tem data,
            não há "mais antiga" — há UMA, e ela vem do cadastro que sai. Dizer
            "a mais antiga é preservada" com um só valor na tela faz o operador
            procurar a outra.
          */}
          <span>
            {manter.dataFiliacao ? (
              <>
                A filiação <strong>mais antiga</strong> é preservada:{' '}
                <strong>{formatarCampo('dataFiliacao', filiacaoPreservada.dataFiliacao)}</strong>, do
                cadastro removido — o mantido dizia{' '}
                {formatarCampo('dataFiliacao', manter.dataFiliacao)}. O tempo de sindicato não se
                perde na consolidação.
              </>
            ) : (
              <>
                A data de filiação vem do cadastro removido:{' '}
                <strong>{formatarCampo('dataFiliacao', filiacaoPreservada.dataFiliacao)}</strong>. O
                mantido não tinha nenhuma.
              </>
            )}
          </span>
        </p>
      )}
      {perdidos.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Será apagado junto com o cadastro
          </p>
          <ul className="space-y-0.5 text-xs text-amber-900 dark:text-amber-200">
            {perdidos.map(({ chave, rotulo, de }) => (
              <li key={`${chave}-${de.id}`}>
                {rotulo}: <strong>{formatarCampo(chave, valor(de, chave))}</strong>
                {varios && <span className="opacity-80"> (de {de.matricula})</span>}
                <span className="opacity-80">
                  {' '}— o mantido tem {formatarCampo(chave, valor(manter, chave))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-300">
            Fica registrado no histórico. Se o valor certo for esse, escolha o outro cadastro
            para manter.
          </p>
        </div>
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
  if (chave === 'dataNascimento' || chave === 'dataFiliacao' || chave === 'createdAt') {
    return formatarData(String(v));
  }
  return String(v);
}

/**
 * COMO FUNCIONA — porque a tela pede três decisões e não explicava nenhuma.
 *
 * "Queria que também houvesse uma explicação em algum lugar de como funciona
 * esse processo de remover duplicados e consolidar." Quem abre esta fila pela
 * primeira vez encontra três botões com verbos parecidos — consolidar, não é
 * duplicado, não é a mesma pessoa — e nenhum lugar dizendo o que cada um faz
 * com o cadastro. A dúvida mais cara é a que ninguém faz em voz alta: "isto
 * apaga o dado da pessoa?".
 *
 * Fica RECOLHIDO por padrão: quem já sabe não precisa passar por cima dele todo
 * dia, e quem não sabe acha pelo rótulo. Aberto, cabe numa tela de celular.
 */
function ComoFunciona() {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
      >
        <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Como funciona esta fila
        <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition', aberto && 'rotate-180')} />
      </button>
      {aberto && (
        <div className="space-y-3 border-t px-4 py-4 text-sm">
          <p className="text-muted-foreground">
            O sistema junta cadastros que <strong>parecem</strong> ser da mesma pessoa. Ele nunca
            decide sozinho: cada grupo espera alguém dizer o que é.
          </p>

          <dl className="space-y-3">
            <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-900 dark:bg-brand-950/20">
              <dt className="flex items-center gap-1.5 font-medium">
                <Merge className="h-4 w-4 text-brand-800 dark:text-brand-400" aria-hidden="true" />
                Consolidar
              </dt>
              <dd className="mt-1 space-y-1.5 text-muted-foreground">
                <span className="block">
                  É a mesma pessoa. O cadastro marcado como <strong>MANTER</strong> fica, e tudo o
                  que só existia nos outros — CPF, telefone, endereço, processos, mensalidades — é
                  copiado para ele <em>antes</em> de os duplicados saírem. A matrícula removida fica
                  no histórico.
                </span>
                <span className="block">
                  Quando o mesmo campo está preenchido <strong>diferente</strong> nos dois, vale o do
                  mantido — e o outro valor fica escrito no histórico, nunca some calado. A tela de
                  confirmação lista o que será copiado <em>e</em> o que será apagado.
                </span>
                <span className="block">
                  A <strong>data de filiação</strong> é exceção: prevalece sempre a mais antiga, mesmo
                  que esteja no cadastro que vai sair. Tempo de sindicato não se perde aqui.
                </span>
              </dd>
            </div>

            <div className="rounded-lg border p-3">
              <dt className="flex items-center gap-1.5 font-medium">
                <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Não é duplicado
              </dt>
              <dd className="mt-1 text-muted-foreground">
                São pessoas diferentes que por acaso têm o mesmo nome. O grupo sai da fila e não
                volta a aparecer — <strong>nada é apagado</strong>. Dá para desfazer no aviso, ou em
                &ldquo;Marcados como pessoas diferentes&rdquo;, no fim desta página.
              </dd>
            </div>

            <div className="rounded-lg border p-3">
              <dt className="flex items-center gap-1.5 font-medium">
                <UserMinus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Tirar do grupo
              </dt>
              <dd className="mt-1 text-muted-foreground">
                No rodapé de cada cartão, em grupo de três ou mais: marca que <strong>aquele</strong>
                {' '}cadastro não é a mesma pessoa dos outros e o tira do grupo, deixando o resto
                para decidir. Serve quando quatro nomes iguais são, na verdade, três da mesma
                pessoa e um de outra. <strong>Nada é apagado</strong>, e também dá para desfazer.
              </dd>
            </div>
          </dl>

          {/*
            A DICA QUE O DONO PEDIU — e que o número em cada cartão agora mostra.
          */}
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="font-medium">Na dúvida, qual manter?</p>
            <p className="mt-1 text-muted-foreground">
              O que tem <strong>mais dados</strong> — é o que aparece marcado, com a etiqueta
              &ldquo;o mais completo&rdquo;. Cada cartão mostra quantos dados carrega, então dá para
              comparar de relance. Se os dois estiverem igualmente vazios, o sistema diz isso e
              qualquer um serve: a consolidação copia o que faltar de um para o outro de qualquer
              forma. Quando houver <strong>CPF em um só</strong>, mantenha esse.
            </p>
            <p className="mt-2 text-muted-foreground">
              E a escolha pesa menos do que parece: a <strong>filiação mais antiga fica de
              qualquer jeito</strong>, e o que for divergente vai para o histórico. No empate,
              escolher errado não custa caro — custa caro é o grupo continuar aqui.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * O PLACAR DA FILA — "quanto eu andei" e "quanto falta", numa linha.
 *
 * "Não tem como deixar menos tedioso esse processo que é tão chato?" Tem, e a
 * resposta não é medalha: são 1.174 grupos, e sem nenhuma marca de progresso
 * cada decisão parece a primeira. Duas informações bastam — o que você acabou
 * de resolver e o que sobrou — porque juntas elas mostram a pilha diminuindo.
 *
 * Some quando não há nada resolvido: um placar zerado é só mais uma linha.
 */
/**
 * O TAMANHO DA TAREFA, DESDE A PRIMEIRA TELA (18/09/2026).
 *
 * "Não notei diferença na UI e nem gamificação alguma." A razão é literal: este
 * placar tinha `if (resolvidos === 0) return null` — só nascia DEPOIS da
 * primeira decisão. Quem chega vê a pilha e nada dizendo que ela acaba; quem
 * chega e desiste antes do primeiro clique nunca viu progresso nenhum.
 *
 * O que tira o tédio de uma fila não é ponto nem medalha: é ela TER FIM À
 * VISTA. Aqui isso é dito de cara — quantos faltam, quanto saiu nesta sessão, a
 * barra andando. Ponto e medalha seriam piores que inúteis: isto apaga cadastro
 * de gente, e premiar velocidade é convidar ao clique rápido.
 */
/**
 * O QUE NÃO É TRABALHO DE NINGUÉM — uma linha, no rodapé (18/09/2026).
 *
 * São grupos em que nenhum cadastro tem um dado sequer. Três decisões possíveis
 * e nenhuma honesta: consolidar é juntar desconhecidos, "não é duplicado" é
 * chutar, e deixar na fila é cobrar 255 vezes uma resposta que não existe.
 *
 * Por que NÃO é uma quarta aba: ao lado das três confianças, um "Esperando dado
 * 255" domina a tela e recria a sensação de fila infinita que o lote acabou de
 * resolver. E por que não some de vez: alguém da Coordenação pode
 * reconhecer os nomes e decidir por conhecimento próprio — a porta fica aberta,
 * só não fica no caminho.
 */
function EsperandoDado({
  quantos, aberto, onAbrir, onFechar,
}: { quantos: number; aberto: boolean; onAbrir: () => void; onFechar: () => void }) {
  if (quantos === 0) return null;
  if (aberto) {
    return (
      <button
        type="button"
        onClick={onFechar}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-muted"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Voltar para a fila de decisões
      </button>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 px-1 text-xs text-muted-foreground">
      <span>
        Outros <strong className="font-semibold">{quantos.toLocaleString('pt-BR')}</strong> grupos
        esperam um dado para poderem ser decididos — nenhum dos cadastros tem CPF, contato ou
        nascimento.
      </span>
      <button type="button" onClick={onAbrir} className="underline underline-offset-2 hover:text-foreground">
        Ver assim mesmo
      </button>
    </p>
  );
}

function PlacarDaFila({ resolvidos, restantes }: { resolvidos: number; restantes: number }) {
  const total = resolvidos + restantes;
  if (total === 0) return null;
  const pct = Math.min(100, Math.round((resolvidos / Math.max(1, total)) * 100));
  const acabou = restantes === 0;
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/20">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <p className="font-medium text-brand-900 dark:text-brand-200">
          {acabou
            ? 'A fila acabou.'
            : `${restantes.toLocaleString('pt-BR')} ${restantes === 1 ? 'grupo para revisar' : 'grupos para revisar'}`}
        </p>
        <p className="text-muted-foreground">
          {resolvidos === 0
            ? 'Nenhum resolvido nesta sessão'
            : resolvidos === 1
              ? '1 resolvido nesta sessão'
              : `${resolvidos} resolvidos nesta sessão`}
        </p>
      </div>
      {/* Barra fina: o progresso é da SESSÃO, não da vida — por isso discreta. */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900/50">
        <div
          className="h-full rounded-full bg-brand-700 transition-all duration-500 dark:bg-brand-500"
          style={{ width: `${resolvidos === 0 ? 0 : Math.max(2, pct)}%` }}
        />
      </div>
      {/* Teclado não existe no celular: a dica some lá em vez de virar ruído. */}
      {!acabou && (
        <p className="mt-2 hidden text-xs text-muted-foreground md:block">
          Um por vez costuma ser mais rápido: o teclado decide sem tirar a mão —
          <strong className="font-medium"> Enter</strong> consolida,
          <strong className="font-medium"> N</strong> separa,
          <strong className="font-medium"> →</strong> pula.
        </p>
      )}
    </div>
  );
}
