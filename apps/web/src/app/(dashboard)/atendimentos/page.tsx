'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Search, Plus, Headset, ChevronLeft, ChevronRight, Inbox, MoreVertical,
  Eye, Gavel, CheckCircle2, XCircle, RotateCcw, Trash2, AlertTriangle, RotateCw, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Carregando, Esqueleto, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo, podeExcluir } from '@/lib/permissoes';
import { useAbrirPorUrl, useFiltroPorUrl } from '@/lib/use-abrir-por-url';
import { NovoAtendimentoDrawer } from '@/components/atendimentos/novo-atendimento-drawer';
import { AtendimentoDrawer } from '@/components/atendimentos/atendimento-drawer';
import { RegistrarDesfechoModal, AtendimentoParaDesfecho } from '@/components/atendimentos/registrar-desfecho-modal';
import { ChipEncaminhamento } from '@/components/atendimentos/estado-do-encaminhamento';
import { FecharAtendimentoModal, ReabrirAtendimentoDialog } from '@/components/atendimentos/fechar-atendimento-modal';
import {
  listarAtendimentos, concluirAtendimento, excluirAtendimento,
  CanalAtendimento, DesfechoAtendimento, StatusAtendimento, AtendimentoLista, FiltroDaUrl, AcaoDeFechar,
  CANAIS, CANAL_LABEL, DESFECHO_LABEL, DESFECHO_COR, OPCOES_DO_SELETOR_DE_STATUS, formatDataHora,
  corDoStatus, faltaConcluir, filtroDaUrl, filtroDoSeletorDeStatus, mensagemDaFalha, rotuloDoAssunto,
  rotuloDoConcluirNoMenu, rotuloDoStatus, urlTemFiltro, valorDoSeletorDeStatus, vazioDaLista,
  type FilaDoAtendimento, type ValorDoSeletorDeStatus,
} from '@/lib/atendimentos';
import { ASSUNTO_LABEL, ASSUNTOS } from '@/lib/relatorios';
import { V } from '@/lib/vocabulario';

const PAGE_SIZE = 20;
const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:w-auto sm:text-sm';

/** Suspense obrigatório por causa do `useSearchParams` (ver useAbrirPorUrl). */
export default function AtendimentosPage() {
  return (
    <Suspense fallback={<EsqueletoDaLista />}>
      <ListaAtendimentos />
    </Suspense>
  );
}

function EsqueletoDaLista() {
  return (
    <Carregando texto="Carregando os atendimentos">
      <div className="space-y-3 md:hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border bg-card p-4">
            <Esqueleto className="h-4 w-1/2" />
            <Esqueleto className="h-3 w-4/5" />
            <Esqueleto className="h-5 w-2/3" />
          </div>
        ))}
      </div>
      <Card className="hidden overflow-hidden p-0 md:block">
        <EsqueletoLinhas quantidade={8} altura={57} />
      </Card>
    </Carregando>
  );
}

function ListaAtendimentos() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  /**
   * A API agora barra de verdade (`@Modulo` em todo controller). Mostrar o
   * botão a quem só tem leitura faria a pessoa preencher o formulário
   * inteiro para levar 403 no fim — o gate da tela existe para isso, não
   * para segurança.
   */
  const podeEditar = nivelEfetivo(user?.role, user?.permissoes, 'atendimentos') === 'EDITAR';
  const ehAdmin = podeExcluir(user?.role);

  /*
    O RECORTE VEM DA URL — `?assunto=OUTRO&dataInicio=…&dataFim=…`.
    Um número (do relatório, do painel) só pode virar link se a lista abrir o
    MESMO recorte que contou. O estado nasce já com o filtro (sem mostrar a
    lista inteira por um instante) e a URL é limpa em seguida, como nos outros
    atalhos do sistema.
  */
  const inicial = filtroDaUrl(searchParams);
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [status, setStatus] = useState<'' | StatusAtendimento>(inicial.status);
  const [fila, setFila] = useState<'' | FilaDoAtendimento>(inicial.fila);
  const [desfecho, setDesfecho] = useState<'' | DesfechoAtendimento>(inicial.desfecho);
  const [canal, setCanal] = useState<'' | CanalAtendimento>(inicial.canal);
  const [assunto, setAssunto] = useState(inicial.assunto);
  const [dataInicio, setDataInicio] = useState(inicial.dataInicio);
  const [dataFim, setDataFim] = useState(inicial.dataFim);
  /**
   * "Só os meus" (15/09/2026): chega pelo "Comigo, com a triagem" do painel,
   * que conta só os registrados pela pessoa. A URL é limpa, então o recorte
   * fica no estado e aparece como chip removível.
   */
  const [atendente, setAtendente] = useState<'' | 'me'>(inicial.atendente);
  const [page, setPage] = useState(1);

  function aplicarFiltro(f: FiltroDaUrl) {
    setBusca(''); setBuscaDeb('');
    setStatus(f.status); setFila(f.fila); setDesfecho(f.desfecho); setCanal(f.canal);
    setAssunto(f.assunto); setDataInicio(f.dataInicio); setDataFim(f.dataFim); setAtendente(f.atendente);
  }

  useEffect(() => {
    if (!urlTemFiltro(searchParams)) return;
    aplicarFiltro(filtroDaUrl(searchParams));
    router.replace('/atendimentos', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  const [novo, setNovo] = useState(false);
  // `?novo=1` abre a gaveta direto — é o atalho "Novo atendimento" do painel,
  // que é a ação mais repetida do balcão.
  useFiltroPorUrl('novo', () => setNovo(true), '/atendimentos');
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [desfechoAlvo, setDesfechoAlvo] = useState<AtendimentoParaDesfecho | null>(null);
  const [promptConcluir, setPromptConcluir] = useState<{ id: string } | null>(null);
  const [menu, setMenu] = useState<{ a: AtendimentoLista; top: number; left: number } | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<AtendimentoLista | null>(null);
  /*
    CONCLUIR, CANCELAR E REABRIR DA LISTA ABREM O MESMO DIÁLOGO DA GAVETA
    (14/09/2026). Eram toques únicos no cartão, na tabela e no menu; o #9 foi
    de cancelado a concluído seis vezes em quatro minutos.
  */
  const [fecharAlvo, setFecharAlvo] = useState<{ id: string; acao: AcaoDeFechar } | null>(null);
  const [reabrirAlvo, setReabrirAlvo] = useState<AtendimentoLista | null>(null);

  /** `?atendimento=<id>` abre a triagem direto — mesmo padrão da agenda. */
  useAbrirPorUrl('atendimento', setDetalheId, '/atendimentos');

  useEffect(() => {
    const t = setTimeout(() => { setBuscaDeb(busca.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => { setPage(1); }, [status, fila, desfecho, canal, assunto, dataInicio, dataFim, atendente]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['atendimentos', buscaDeb, status, fila, desfecho, canal, assunto, dataInicio, dataFim, atendente, page],
    queryFn: () => listarAtendimentos({
      busca: buscaDeb || undefined, status: status || undefined, fila: fila || undefined, desfecho: desfecho || undefined,
      atendente: atendente || undefined, canal: canal || undefined, assunto: assunto || undefined,
      dataInicio: dataInicio || undefined, dataFim: dataFim || undefined,
      page, pageSize: PAGE_SIZE,
    }),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['atendimentos'] });
    qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
  };
  const itens = data?.items ?? [];
  const totalPaginas = data?.totalPaginas ?? 1;
  const filtrando = !!(buscaDeb || status || fila || desfecho || canal || assunto || dataInicio || dataFim || atendente);
  const vazio = vazioDaLista({ status, fila, atendente, filtrando });

  /**
   * O "Concluir agora?" logo depois do resolvido no ato: a rota nova, sem nota.
   * Resolvido no ato não tem consulta, e o plano não pede decisão nem nota.
   */
  const concluirAgora = useMutation({
    mutationFn: (id: string) => concluirAtendimento(id, {}),
    onSuccess: (_r, id) => {
      invalidar();
      qc.invalidateQueries({ queryKey: ['atendimento', id] });
      toast.success('Atendimento concluído.');
      setPromptConcluir(null);
    },
    onError: (e: any) => {
      toast.error(mensagemDaFalha(e, 'Não foi possível concluir.'));
      setPromptConcluir(null);
    },
  });
  const excluir = useMutation({
    mutationFn: (id: string) => excluirAtendimento(id),
    onSuccess: () => { toast.success('Atendimento excluído.'); setExcluirAlvo(null); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  function paraDesfecho(a: {
    id: string; numero: number; descricao: string; assunto?: string | null; assuntoOutro?: string | null;
    filiado: { id: string; nomeCompleto: string };
  }): AtendimentoParaDesfecho {
    return {
      id: a.id, numero: a.numero, descricao: a.descricao,
      assunto: a.assunto ?? null, assuntoOutro: a.assuntoOutro ?? null,
      filiado: { id: a.filiado.id, nomeCompleto: a.filiado.nomeCompleto },
    };
  }
  function abrirDesfecho(a: AtendimentoLista) {
    setMenu(null);
    setDesfechoAlvo(paraDesfecho(a));
  }
  function abrirMenu(e: React.MouseEvent, a: AtendimentoLista) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const altura = 260;
    const top = r.bottom + altura > window.innerHeight ? Math.max(8, r.top - altura) : r.bottom + 4;
    setMenu({ a, top, left: Math.max(8, Math.min(r.right - 224, window.innerWidth - 232)) });
  }
  function limparFiltros() {
    setBusca('');
    aplicarFiltro({ status: '', fila: '', desfecho: '', canal: '', assunto: '', dataInicio: '', dataFim: '', atendente: '' });
  }

  /** Resultado: o estado do encaminhamento vale mais que o "Encaminhado" genérico. */
  const ResultadoCel = ({ a }: { a: AtendimentoLista }) =>
    a.encaminhamento ? (
      <ChipEncaminhamento encaminhamento={a.encaminhamento} statusAtendimento={a.status} fila={a.fila} />
    ) : a.desfecho ? (
      <Badge className={DESFECHO_COR[a.desfecho]}>{DESFECHO_LABEL[a.desfecho]}</Badge>
    ) : (
      <span className="text-sm italic text-muted-foreground">Sem desfecho</span>
    );

  const menuItem = 'flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted';

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <Headset className="h-5 w-5 text-brand-800 dark:text-brand-400" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Triagem / Atendimento</h2>
            <p className="text-sm text-muted-foreground">Registre e acompanhe os atendimentos realizados</p>
          </div>
        </div>
        {podeEditar && (
          <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo atendimento</Button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-9" placeholder={`Buscar por ${V.filiado} ou descrição…`} value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
          {isFetching && !isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {/*
            UM SELECT SÓ PARA STATUS E FILA (15/09/2026): "Com a triagem" e
            "Aguardando a consulta" são recortes dos pendentes.
          */}
          <select
            className={inputCls}
            value={valorDoSeletorDeStatus(status, fila)}
            onChange={(e) => {
              const f = filtroDoSeletorDeStatus(e.target.value as ValorDoSeletorDeStatus);
              setStatus(f.status);
              setFila(f.fila);
            }}
            aria-label="Status"
          >
            {OPCOES_DO_SELETOR_DE_STATUS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
          <select className={inputCls} value={assunto} onChange={(e) => setAssunto(e.target.value)} aria-label="Assunto">
            <option value="">Todos os assuntos</option>
            {ASSUNTOS.map((a) => <option key={a} value={a}>{ASSUNTO_LABEL[a]}</option>)}
          </select>
          <select className={inputCls} value={canal} onChange={(e) => setCanal(e.target.value as any)} aria-label="Canal">
            <option value="">Todos os canais</option>
            {CANAIS.map((c) => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}
          </select>
          <select className={inputCls} value={desfecho} onChange={(e) => setDesfecho(e.target.value as any)} aria-label="Desfecho">
            <option value="">Todos os desfechos</option>
            <option value="RESOLVIDO_ATO">{DESFECHO_LABEL.RESOLVIDO_ATO}</option>
            <option value="ENCAMINHADO">{DESFECHO_LABEL.ENCAMINHADO}</option>
          </select>
          <label className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-1">De
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className={inputCls} />
          </label>
          <label className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-1">até
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className={inputCls} />
          </label>
          {atendente === 'me' && (
            <Button variant="outline" className="col-span-2 sm:col-span-1 sm:h-10" onClick={() => setAtendente('')} aria-label="Tirar o filtro Só os meus">
              Só os meus <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          {filtrando && (
            <Button variant="ghost" className="col-span-2 sm:col-span-1 sm:h-10" onClick={limparFiltros}>
              <X className="h-4 w-4" /> Limpar filtros
            </Button>
          )}
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-600" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Não deu para carregar os atendimentos.</p>
            <Button variant="outline" onClick={() => refetch()}><RotateCw className="h-4 w-4" /> Tentar de novo</Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <EsqueletoDaLista />
      ) : itens.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-40" aria-hidden="true" />
            <p className="font-medium text-foreground/80">{vazio.titulo}</p>
            {vazio.detalhe && <p className="max-w-sm text-sm">{vazio.detalhe}</p>}
            {vazio.acao && (
              <Button variant="outline" className="mt-2" onClick={() => setFila(vazio.acao!.fila)}>
                {vazio.acao.rotulo}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {itens.map((a) => {
              const rotulo = rotuloDoAssunto(a.assunto, a.assuntoOutro);
              return (
                <div key={a.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => setDetalheId(a.id)} className="min-w-0 flex-1 text-left">
                      <p className="truncate font-semibold">{a.filiado.nomeCompleto}</p>
                      {rotulo && <p className="truncate text-xs text-muted-foreground">{rotulo}</p>}
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.descricao}</p>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => abrirMenu(e, a)}
                      aria-label={`Ações do atendimento de ${a.filiado.nomeCompleto}`}
                      className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <Badge className="bg-muted text-muted-foreground">{CANAL_LABEL[a.canal]}</Badge>
                    <ResultadoCel a={a} />
                    <Badge className={corDoStatus(a)}>{rotuloDoStatus(a)}</Badge>
                    <span className="text-muted-foreground">{formatDataHora(a.createdAt)}</span>
                  </div>
                  {podeEditar && faltaConcluir(a) && (
                    <Button
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => setFecharAlvo({ id: a.id, acao: 'CONCLUIR' })}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Concluir atendimento
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">{V.Filiado}</th>
                    <th className="px-4 py-3 font-medium">Canal</th>
                    <th className="px-4 py-3 font-medium">Resultado</th>
                    <th className="px-4 py-3 font-medium">Demanda</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {itens.map((a) => {
                    const rotulo = rotuloDoAssunto(a.assunto, a.assuntoOutro);
                    return (
                      <tr key={a.id} onClick={() => setDetalheId(a.id)} className="cursor-pointer transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3 font-medium">{a.filiado.nomeCompleto}</td>
                        <td className="px-4 py-3 text-muted-foreground">{CANAL_LABEL[a.canal]}</td>
                        <td className="px-4 py-3"><ResultadoCel a={a} /></td>
                        <td className="max-w-[280px] px-4 py-3">
                          {rotulo && <span className="block truncate text-xs font-medium text-foreground/80">{rotulo}</span>}
                          <span className="line-clamp-1 text-muted-foreground">{a.descricao}</span>
                        </td>
                        <td className="px-4 py-3"><Badge className={`whitespace-nowrap ${corDoStatus(a)}`}>{rotuloDoStatus(a)}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{formatDataHora(a.createdAt)}</td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* 44 px também no computador (15/09/2026): o `sm` tinha 36. */}
                            {podeEditar && faltaConcluir(a) && (
                              <Button
                                variant="outline"
                                className="md:h-11"
                                onClick={(e) => { e.stopPropagation(); setFecharAlvo({ id: a.id, acao: 'CONCLUIR' }); }}
                              >
                                <CheckCircle2 className="h-4 w-4" /> Concluir
                              </Button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => abrirMenu(e, a)}
                              aria-label={`Ações do atendimento de ${a.filiado.nomeCompleto}`}
                              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-sm text-muted-foreground">{data?.total ?? 0} atendimento(s) · página {data?.page ?? 1} de {totalPaginas}</p>
            <div className="flex gap-2">
              <Button variant="outline" className="md:h-9" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
              <Button variant="outline" className="md:h-9" disabled={page >= totalPaginas || isFetching} onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}>Próxima <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}

      {/* Menu de ações (…) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            role="menu"
            className="fixed z-50 w-56 animate-surgir-leve overflow-hidden rounded-lg border bg-card py-1 shadow-xl"
            style={{ top: menu.top, left: menu.left }}
          >
            <button type="button" role="menuitem" onClick={() => { setDetalheId(menu.a.id); setMenu(null); }} className={menuItem}><Eye className="h-4 w-4 text-muted-foreground" /> Ver detalhes</button>
            {podeEditar && (
              <>
                {!menu.a.desfecho && (
                  <button type="button" role="menuitem" onClick={() => abrirDesfecho(menu.a)} className={menuItem}><Gavel className="h-4 w-4 text-brand-700 dark:text-brand-400" /> Registrar desfecho</button>
                )}
                {menu.a.desfecho && menu.a.status === 'PENDENTE' && (
                  <button type="button" role="menuitem" onClick={() => { setFecharAlvo({ id: menu.a.id, acao: 'CONCLUIR' }); setMenu(null); }} className={menuItem}><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {rotuloDoConcluirNoMenu(menu.a)}</button>
                )}
                {menu.a.status !== 'PENDENTE' && (
                  <button type="button" role="menuitem" onClick={() => { setReabrirAlvo(menu.a); setMenu(null); }} className={menuItem}><RotateCcw className="h-4 w-4 text-muted-foreground" /> Reabrir</button>
                )}
                {/* Concluído não vira cancelado direto: reabre antes. */}
                {menu.a.status === 'PENDENTE' && (
                  <button type="button" role="menuitem" onClick={() => { setFecharAlvo({ id: menu.a.id, acao: 'CANCELAR' }); setMenu(null); }} className={`${menuItem} text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20`}><XCircle className="h-4 w-4" /> Cancelar atendimento</button>
                )}
              </>
            )}
            {ehAdmin && (
              <button type="button" role="menuitem" onClick={() => { setExcluirAlvo(menu.a); setMenu(null); }} className={`${menuItem} border-t text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30`}><Trash2 className="h-4 w-4" /> Excluir atendimento</button>
            )}
          </div>
        </>
      )}

      {/* Modais / gavetas */}
      <NovoAtendimentoDrawer open={novo} onClose={() => setNovo(false)} onCriado={invalidar} />
      <AtendimentoDrawer
        atendimentoId={detalheId}
        open={!!detalheId}
        onClose={() => setDetalheId(null)}
        onMudou={invalidar}
        onRegistrarDesfecho={(a) => { setDetalheId(null); setDesfechoAlvo(a); }}
      />
      <RegistrarDesfechoModal
        open={!!desfechoAlvo}
        atendimento={desfechoAlvo}
        onClose={() => setDesfechoAlvo(null)}
        onRegistrado={(resultado) => {
          invalidar();
          /*
            SÓ O RESOLVIDO NO ATO PERGUNTA "CONCLUIR AGORA?". O encaminhado ainda
            não terminou: a demanda acaba quando a consulta for registrada, e
            desde 15/09/2026 o atendimento fecha junto com ela.
          */
          if (desfechoAlvo && resultado === 'RESOLVIDO_ATO') setPromptConcluir({ id: desfechoAlvo.id });
        }}
      />

      {/* Prompt: concluir agora? */}
      <ConfirmDialog
        open={!!promptConcluir}
        title="Desfecho registrado"
        icon={<CheckCircle2 className="h-6 w-6" />}
        description={
          <>O atendimento foi resolvido no ato. Quer marcar como <strong>concluído</strong> agora? Se ainda falta algo, deixe pendente.</>
        }
        confirmLabel="Concluir agora"
        cancelLabel="Deixar pendente"
        loading={concluirAgora.isPending}
        onConfirm={() => { if (promptConcluir) concluirAgora.mutate(promptConcluir.id); }}
        onClose={() => setPromptConcluir(null)}
      />

      <FecharAtendimentoModal
        atendimentoId={fecharAlvo?.id ?? null}
        acao={fecharAlvo?.acao ?? null}
        onClose={() => setFecharAlvo(null)}
        onFechado={invalidar}
      />
      <ReabrirAtendimentoDialog
        alvo={reabrirAlvo ? { id: reabrirAlvo.id, numero: reabrirAlvo.numero, status: reabrirAlvo.status } : null}
        onClose={() => setReabrirAlvo(null)}
        onReaberto={invalidar}
      />

      {/* Excluir atendimento (Administrador) */}
      <ConfirmDialog
        open={!!excluirAlvo}
        variant="destructive"
        title="Excluir atendimento"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          <>
            Excluir o atendimento <strong>#{excluirAlvo?.numero}</strong> de <strong>{excluirAlvo?.filiado.nomeCompleto}</strong>?
            Os <strong>anexos</strong> serão removidos; eventuais <strong>consultas já criadas na Agenda</strong> permanecem
            (apenas perdem o vínculo com esta triagem). Esta ação é <strong>irreversível</strong>.
          </>
        }
        confirmLabel="Excluir atendimento"
        loading={excluir.isPending}
        onConfirm={() => excluirAlvo && excluir.mutate(excluirAlvo.id)}
        onClose={() => setExcluirAlvo(null)}
      />
    </div>
  );
}
