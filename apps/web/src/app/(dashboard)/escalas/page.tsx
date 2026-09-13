'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDataPura } from '@/lib/data-pura';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle, ArrowLeftRight, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, ClipboardList, Download,
  List, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Carregando, Esqueleto, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar as podeEditarModulo, podeExcluir } from '@/lib/permissoes';
import { NovaEscalaModal } from '@/components/escalas/nova-escala-modal';
import { EditarEscalaModal, ModoDaEdicao } from '@/components/escalas/editar-escala-modal';
import { AcoesDoPlantao, PlantaoCartao } from '@/components/escalas/plantao-cartao';
import { SeletorDePessoa } from '@/components/escalas/seletor-de-pessoa';
import { useTelaLarga } from '@/components/escalas/use-tela-larga';
import { exportarEscalasPdf } from '@/lib/escalas-pdf';
import {
  AdvogadoEscala, CorAdvogado, Escala, agruparPorDia, chaveDoDia, chaveMes, contar, diaDaEscala, excluirEscala,
  faixaDoPlantao, hojeBR, listarAdvogadosEscala, listarEscalas, mensagemDoErro, montarCoresDaTela,
  nomeDeExibicao, posicaoDoPopover, rotuloDoPlantao, rotuloMes,
} from '@/lib/escalas';

type Visao = 'calendario' | 'lista';
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CINZA = 'bg-slate-500';
const LARGURA_DO_POPOVER = 288;
const ALTURA_DO_POPOVER = 220;

/** "Dra. Shérad em seg., 15/09 (09:00–12:00)" — a data é `@db.Date`, pela regra única. */
const descreverPlantao = (e: Escala) =>
  `${nomeDeExibicao(e.advogado)} em ${formatDataPura(e.data, { weekday: 'short', day: '2-digit', month: '2-digit' })} (${faixaDoPlantao(e)})`;

/** Mês de referência inicial: o de Teresina, não o do aparelho. */
function mesDeHoje(): Date {
  const [ano, mes] = hojeBR().split('-').map(Number);
  return new Date(ano, mes - 1, 1);
}

export default function EscalasPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  /**
   * A API barra de verdade (`@Modulo('escalas')`). O gate da tela existe para
   * ninguém preencher um formulário inteiro e levar 403 no fim.
   *
   * Clicar no dia para cadastrar seguia `ehAdmin` enquanto o botão seguia
   * `podeEditar`: a Coordenação só cadastrava pelo botão. Agora tudo que
   * escreve segue `podeEditar`; só EXCLUIR é do Administrador (regra global).
   */
  const podeEditar = podeEditarModulo(user?.role, user?.permissoes, 'escalas');
  const ehAdmin = podeExcluir(user?.role);
  const temAcoes = podeEditar || ehAdmin;

  const telaLarga = useTelaLarga();
  const [mes, setMes] = useState(mesDeHoje);
  // No celular a escala abre na LISTA por dia: o calendário de 7 colunas a
  // 400 px truncava o nome em "Shé…". Quem escolhe uma visão fica com ela.
  const [visaoEscolhida, setVisaoEscolhida] = useState<Visao | null>(null);
  const visao: Visao = visaoEscolhida ?? (telaLarga ? 'calendario' : 'lista');
  const [advogadoFiltro, setAdvogadoFiltro] = useState('');

  const [novaOpen, setNovaOpen] = useState(false);
  const [dataPre, setDataPre] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<{ escala: Escala; modo: ModoDaEdicao } | null>(null);
  const [aExcluir, setAExcluir] = useState<Escala | null>(null);
  const [popover, setPopover] = useState<{ escala: Escala; pos: ReturnType<typeof posicaoDoPopover> } | null>(null);
  const [folhaDia, setFolhaDia] = useState<string | null>(null);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const mesKey = chaveMes(mes);
  const nomeDoMes = rotuloMes(mes).split(' ')[0].toLowerCase();
  const advogadosQ = useQuery({ queryKey: ['escalas-advogados'], queryFn: listarAdvogadosEscala });
  const escalasQ = useQuery({
    queryKey: ['escalas', mesKey, advogadoFiltro],
    queryFn: () => listarEscalas(mesKey, advogadoFiltro || undefined),
  });
  const escalas = useMemo(() => escalasQ.data ?? [], [escalasQ.data]);
  // A cor depende da equipe inteira: esperar por ela evita a cor trocar na cara
  // de quem acabou de abrir. Se a equipe não carregar, a escala aparece mesmo assim.
  const carregando = escalasQ.isLoading || advogadosQ.isLoading;

  const invalidar = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['escalas'] });
    // O cartão "Equipe disponível hoje" do painel lê a mesma escala.
    void qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
  }, [qc]);

  const remover = useMutation({
    mutationFn: (id: string) => excluirEscala(id),
    onSuccess: () => {
      toast.success('Plantão excluído.');
      setAExcluir(null);
      invalidar();
    },
    onError: (e) => toast.error(mensagemDoErro(e, 'Não foi possível excluir. Tente de novo.')),
  });

  // Pessoas escaladas no mês, em ordem alfabética (legenda — não é ranking).
  const escalados = useMemo(() => {
    const mapa = new Map<string, AdvogadoEscala>();
    for (const e of escalas) if (!mapa.has(e.advogado.id)) mapa.set(e.advogado.id, e.advogado);
    return [...mapa.values()].sort((a, b) => nomeDeExibicao(a).localeCompare(nomeDeExibicao(b), 'pt-BR'));
  }, [escalas]);
  const cores = useMemo(() => montarCoresDaTela(advogadosQ.data ?? [], escalados), [advogadosQ.data, escalados]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Escala[]>();
    for (const e of escalas) {
      const dia = diaDaEscala(e.data);
      const lista = mapa.get(dia);
      if (lista) lista.push(e);
      else mapa.set(dia, [e]);
    }
    return mapa;
  }, [escalas]);

  // Grade do mês (42 células), montada localmente.
  const celulas = useMemo(() => {
    const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const ini = new Date(primeiro);
    ini.setDate(1 - primeiro.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(ini); d.setDate(ini.getDate() + i); return d; });
  }, [mes]);

  const hoje = hojeBR();
  const grupos = useMemo(() => agruparPorDia(escalas, hoje), [escalas, hoje]);

  // O cartão do calendário é `fixed`: rolar ou redimensionar o deixaria longe
  // da barra. Fecha, em vez de flutuar solto.
  useEffect(() => {
    if (!popover) return;
    const fechar = () => setPopover(null);
    const tecla = (ev: KeyboardEvent) => { if (ev.key === 'Escape') fechar(); };
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    document.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
      document.removeEventListener('keydown', tecla);
    };
  }, [popover]);

  const fecharFolha = useCallback(() => setFolhaAberta(false), []);

  function mudarMes(delta: number) {
    setPopover(null);
    setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }
  function novaEm(dia?: string) {
    setDataPre(dia ?? null);
    setNovaOpen(true);
  }
  function abrirFolha(dia: string) {
    setFolhaDia(dia);
    setFolhaAberta(true);
  }
  /** Toque no dia do calendário estreito: com plantão, abre o dia; vazio, cadastra. */
  function tocarDia(dia: string) {
    if (porDia.get(dia)?.length) abrirFolha(dia);
    else if (podeEditar) novaEm(dia);
  }
  function abrirPopover(ev: React.MouseEvent, escala: Escala) {
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = posicaoDoPopover(
      r,
      { largura: window.innerWidth, altura: window.innerHeight },
      { largura: LARGURA_DO_POPOVER, altura: ALTURA_DO_POPOVER },
    );
    setPopover({ escala, pos });
  }

  // As ações fecham o que estiver aberto (popover ou folha) antes de abrir o modal.
  const acoes: AcoesDoPlantao = {
    podeEditar,
    podeExcluir: ehAdmin,
    onEditar: (e) => { setPopover(null); setFolhaAberta(false); setEdicao({ escala: e, modo: 'editar' }); },
    onTrocar: (e) => { setPopover(null); setFolhaAberta(false); setEdicao({ escala: e, modo: 'trocar' }); },
    onExcluir: (e) => { setPopover(null); setFolhaAberta(false); setAExcluir(e); },
  };

  async function exportar() {
    if (escalas.length === 0) return toast.error('Não há plantões para exportar neste mês.');
    setGerandoPdf(true);
    try { await exportarEscalasPdf(rotuloMes(mes), escalas); } catch { toast.error('Falha ao gerar o PDF.'); } finally { setGerandoPdf(false); }
  }

  const botaoVisao = (valor: Visao, rotulo: string, Icone: typeof List) => (
    <button
      type="button"
      aria-pressed={visao === valor}
      onClick={() => { setVisaoEscolhida(valor); setPopover(null); }}
      className={cn(
        'flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors md:min-h-[32px] md:flex-none',
        visao === valor ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <Icone className="h-4 w-4" /> {rotulo}
    </button>
  );

  const itensDaFolha = folhaDia ? porDia.get(folhaDia) ?? [] : [];

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <ClipboardList className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">Escalas dos Advogados</h2>
            <p className="text-sm text-muted-foreground">Quem está de plantão em cada dia</p>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={exportar} disabled={gerandoPdf || carregando || escalasQ.isError}>
            {gerandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar PDF
          </Button>
          {podeEditar && (
            <Button className="flex-1 sm:flex-none" onClick={() => novaEm()}>
              <Plus className="h-4 w-4" /> Cadastrar plantões
            </Button>
          )}
        </div>
      </div>

      {/* Mês + filtro + visão */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center justify-between rounded-lg border border-input bg-card">
            <button type="button" onClick={() => mudarMes(-1)} className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground md:h-9 md:w-9" aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[140px] px-2 text-center text-sm font-semibold" aria-live="polite">{rotuloMes(mes)}</span>
            <button type="button" onClick={() => mudarMes(1)} className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground md:h-9 md:w-9" aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <SeletorDePessoa
            value={advogadoFiltro}
            onChange={(v) => { setPopover(null); setAdvogadoFiltro(v); }}
            pessoas={advogadosQ.data ?? []}
            carregando={advogadosQ.isLoading}
            placeholder="Todas as pessoas"
            ariaLabel="Mostrar a escala de"
            className="h-11 sm:w-64 md:h-9"
          />
        </div>
        <div role="group" aria-label="Visão" className="flex rounded-lg border border-input bg-card p-1">
          {botaoVisao('calendario', 'Calendário', CalendarDays)}
          {botaoVisao('lista', 'Lista', List)}
        </div>
      </div>

      {/* Legenda + contagem */}
      {!carregando && !escalasQ.isError && (
        <div className="space-y-2">
          {escalados.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {escalados.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 text-sm">
                  <span aria-hidden className={cn('h-3 w-3 rounded-full', cores[a.id]?.dot ?? CINZA)} /> {nomeDeExibicao(a)}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {contar(escalas.length, 'plantão', 'plantões')} em {nomeDoMes}
            {escalados.length > 0 && <> · {contar(escalados.length, 'pessoa escalada', 'pessoas escaladas')}</>}
          </p>
        </div>
      )}

      {/* Conteúdo */}
      {escalasQ.isError ? (
        <Card className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
          <p className="text-sm">Não deu para carregar a escala de {nomeDoMes}.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {mensagemDoErro(escalasQ.error, 'Confira a conexão e tente de novo.')}
          </p>
          <Button variant="outline" onClick={() => void escalasQ.refetch()} disabled={escalasQ.isFetching}>
            {escalasQ.isFetching && <Loader2 className="h-4 w-4 animate-spin" />} Tentar de novo
          </Button>
        </Card>
      ) : carregando ? (
        <Carregando texto="Carregando a escala…">
          {visao === 'calendario' ? <EsqueletoCalendario /> : (
            <Card className="overflow-hidden p-0"><EsqueletoLinhas quantidade={6} altura={56} /></Card>
          )}
        </Carregando>
      ) : visao === 'calendario' ? (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
            {DIAS.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {celulas.map((dia) => {
              const chave = chaveDoDia(dia);
              const foraDoMes = dia.getMonth() !== mes.getMonth();
              const ehHoje = chave === hoje;
              const itens = porDia.get(chave) ?? [];
              const podeCadastrarAqui = podeEditar && !foraDoMes;
              const numero = (
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                    ehHoje ? 'bg-brand-800 font-bold text-white' : foraDoMes ? 'text-muted-foreground/40' : 'text-muted-foreground',
                  )}
                >
                  {dia.getDate()}
                </span>
              );
              return (
                <div key={chave} className="border-b border-r [&:nth-child(7n)]:border-r-0">
                  {/* Celular: número e pontos coloridos; o toque abre o dia inteiro. */}
                  <button
                    type="button"
                    onClick={() => tocarDia(chave)}
                    disabled={foraDoMes || (itens.length === 0 && !podeEditar)}
                    aria-label={
                      itens.length
                        ? `${dia.getDate()}: ${contar(itens.length, 'plantão', 'plantões')}`
                        : `${dia.getDate()}: sem plantão${podeCadastrarAqui ? ', cadastrar' : ''}`
                    }
                    className={cn(
                      'flex min-h-[56px] w-full flex-col items-center gap-1 py-1.5 md:hidden',
                      foraDoMes ? 'bg-muted/20' : 'active:bg-muted/40',
                    )}
                  >
                    {numero}
                    {itens.length > 0 && (
                      <span aria-hidden className="flex max-w-full flex-wrap items-center justify-center gap-0.5 px-0.5">
                        {itens.slice(0, 3).map((e) => (
                          <span key={e.id} className={cn('h-2 w-2 rounded-full', cores[e.advogado.id]?.dot ?? CINZA)} />
                        ))}
                        {itens.length > 3 && <span className="text-[10px] leading-none text-muted-foreground">+{itens.length - 3}</span>}
                      </span>
                    )}
                  </button>

                  {/* Computador: barras com nome e faixa; o espaço vazio cadastra. */}
                  <div
                    onClick={() => podeCadastrarAqui && novaEm(chave)}
                    title={podeCadastrarAqui ? 'Cadastrar plantão neste dia' : undefined}
                    className={cn(
                      'hidden min-h-[104px] p-1 md:block',
                      foraDoMes ? 'bg-muted/20' : podeCadastrarAqui && 'cursor-pointer hover:bg-muted/30',
                    )}
                  >
                    <div className="mb-1">{numero}</div>
                    <div className="space-y-0.5">
                      {itens.slice(0, 4).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={(ev) => abrirPopover(ev, e)}
                          title={`${descreverPlantao(e)}${e.observacao ? ` · ${e.observacao}` : ''}`}
                          className={cn(
                            'block min-h-[22px] w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium tabular-nums text-white',
                            cores[e.advogado.id]?.bg ?? CINZA,
                          )}
                        >
                          {rotuloDoPlantao(e)}
                        </button>
                      ))}
                      {itens.length > 4 && (
                        <button
                          type="button"
                          onClick={(ev) => { ev.stopPropagation(); abrirFolha(chave); }}
                          className="px-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                        >
                          mais {itens.length - 4}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {escalas.length === 0 && (
            <p className="border-t px-4 py-3 text-center text-sm text-muted-foreground">
              Nenhum plantão em {nomeDoMes}.{podeEditar && ' Toque num dia para cadastrar.'}
            </p>
          )}
        </Card>
      ) : escalas.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-4 py-14 text-center">
          <p className="text-sm text-muted-foreground">Nenhum plantão em {nomeDoMes}.</p>
          {podeEditar && (
            <Button variant="outline" onClick={() => novaEm()}>
              <CalendarPlus className="h-4 w-4" /> Cadastrar plantões
            </Button>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {grupos.map((g, i) => {
            const primeiroPassado = g.quando === 'passado' && grupos[i - 1]?.quando !== 'passado';
            return (
              <section key={g.data} aria-labelledby={`dia-${g.data}`}>
                {primeiroPassado && (
                  <p className="border-t bg-muted/20 px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">Já passaram</p>
                )}
                <h3
                  id={`dia-${g.data}`}
                  className={cn(
                    'flex items-center gap-2 border-y bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground',
                    i === 0 && 'border-t-0',
                  )}
                >
                  {g.quando === 'hoje' && (
                    <span className="rounded bg-brand-800 px-1.5 py-0.5 text-[11px] font-semibold text-white">Hoje</span>
                  )}
                  <span className="first-letter:uppercase">
                    {formatDataPura(g.data, { weekday: 'long', day: '2-digit', month: '2-digit' })}
                  </span>
                </h3>
                <ul className="divide-y">
                  {g.itens.map((e) => (
                    <LinhaDoPlantao
                      key={e.id}
                      escala={e}
                      cor={cores[e.advogado.id]}
                      acoes={acoes}
                      temAcoes={temAcoes}
                      onAbrir={() => abrirFolha(g.data)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </Card>
      )}

      {/* Cartão do plantão (clique numa barra do calendário, computador) */}
      {popover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
          <div
            role="dialog"
            aria-label={`Plantão de ${descreverPlantao(popover.escala)}`}
            className="fixed z-50 w-72 max-w-[calc(100vw-16px)] animate-surgir-leve rounded-xl border bg-card p-4 shadow-xl"
            style={popover.pos}
          >
            <PlantaoCartao escala={popover.escala} cor={cores[popover.escala.advogado.id]} acoes={acoes} compacto mostrarDia />
          </div>
        </>
      )}

      {/* O dia inteiro (celular, ou "mais N" no calendário) */}
      <Sheet open={folhaAberta} onClose={fecharFolha} side="bottom">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h3 className="font-semibold first-letter:uppercase">
            {folhaDia ? formatDataPura(folhaDia, { weekday: 'long', day: '2-digit', month: '2-digit' }) : ''}
          </h3>
          <button
            type="button"
            onClick={fecharFolha}
            aria-label="Fechar"
            className="-mr-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 divide-y overflow-y-auto px-5">
          {itensDaFolha.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Nenhum plantão neste dia.</p>
          ) : (
            itensDaFolha.map((e) => (
              <div key={e.id} className="py-4">
                <PlantaoCartao escala={e} cor={cores[e.advogado.id]} acoes={acoes} />
              </div>
            ))
          )}
        </div>
        {podeEditar && folhaDia && (
          <div className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { const dia = folhaDia; setFolhaAberta(false); novaEm(dia); }}
            >
              <CalendarPlus className="h-4 w-4" /> Cadastrar plantão neste dia
            </Button>
          </div>
        )}
      </Sheet>

      <NovaEscalaModal open={novaOpen} onClose={() => setNovaOpen(false)} onSalvo={invalidar} dataPre={dataPre} />
      <EditarEscalaModal
        alvo={edicao}
        pessoas={advogadosQ.data ?? []}
        carregandoPessoas={advogadosQ.isLoading}
        onClose={() => setEdicao(null)}
        onSalvo={invalidar}
      />
      <ConfirmDialog
        open={!!aExcluir}
        variant="destructive"
        icon={<Trash2 className="h-6 w-6" />}
        title="Excluir este plantão?"
        description={
          aExcluir && (
            <>
              <p>{descreverPlantao(aExcluir)}.</p>
              <p className="mt-1">Se for troca entre colegas, use Trocar com… e o histórico fica certo.</p>
            </>
          )
        }
        confirmLabel="Excluir"
        loading={remover.isPending}
        onConfirm={() => aExcluir && remover.mutate(aExcluir.id)}
        onClose={() => setAExcluir(null)}
      />
    </div>
  );
}

/**
 * Uma linha da lista por dia. No celular a linha inteira é o toque (56 px) que
 * abre o dia com os botões grandes; no computador as ações ficam na linha.
 */
function LinhaDoPlantao({
  escala: e, cor, acoes, temAcoes, onAbrir,
}: {
  escala: Escala;
  cor?: CorAdvogado;
  acoes: AcoesDoPlantao;
  temAcoes: boolean;
  onAbrir: () => void;
}) {
  const conteudo = (
    <>
      <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', cor?.dot ?? CINZA)} />
      <span className="min-w-0 flex-1 md:flex md:items-center md:gap-4">
        <span className="block truncate font-medium md:w-56 md:shrink-0">{nomeDeExibicao(e.advogado)}</span>
        <span className="block text-sm tabular-nums text-muted-foreground md:w-28 md:shrink-0 md:text-foreground">{faixaDoPlantao(e)}</span>
        {e.observacao && (
          <span className="block break-words text-sm text-muted-foreground md:min-w-0 md:flex-1 md:truncate" title={e.observacao}>
            {e.observacao}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li>
      {temAcoes ? (
        <button
          type="button"
          onClick={onAbrir}
          aria-label={`${nomeDeExibicao(e.advogado)}, ${formatDataPura(e.data, { weekday: 'long', day: '2-digit', month: '2-digit' })}, ${faixaDoPlantao(e)}: ver ações`}
          className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:bg-muted/40 md:hidden"
        >
          {conteudo}
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-2 md:hidden">{conteudo}</div>
      )}

      <div className="hidden min-h-[52px] items-center gap-3 px-4 py-1.5 hover:bg-muted/30 md:flex">
        {conteudo}
        {temAcoes && (
          <span className="flex shrink-0 items-center gap-1">
            {acoes.podeEditar && (
              <>
                <Button variant="ghost" size="sm" onClick={() => acoes.onEditar(e)}>
                  <Pencil className="h-4 w-4" /> Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => acoes.onTrocar(e)}>
                  <ArrowLeftRight className="h-4 w-4" /> Trocar com…
                </Button>
              </>
            )}
            {acoes.podeExcluir && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Excluir o plantão de ${nomeDeExibicao(e.advogado)}`}
                title="Excluir"
                className="text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                onClick={() => acoes.onExcluir(e)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

/** A forma do calendário: cabeçalho de 7 dias e 6 semanas. */
function EsqueletoCalendario() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b py-2">
        {DIAS.map((d) => <Esqueleto key={d} className="mx-auto h-3 w-6" />)}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }).map((_, i) => (
          <div key={i} className="min-h-[56px] border-b border-r p-1.5 md:min-h-[104px] [&:nth-child(7n)]:border-r-0">
            <Esqueleto className="h-4 w-4 rounded-full" />
            {i % 7 > 0 && i % 7 < 6 && i % 3 !== 0 && <Esqueleto className="mt-2 hidden h-4 w-full md:block" />}
          </div>
        ))}
      </div>
    </Card>
  );
}
