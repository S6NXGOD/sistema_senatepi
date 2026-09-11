'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowUpDown, CircleHelp, FileDown, HandCoins, Landmark, Link2, Loader2, RefreshCw, Scale, Search,
  Users, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import { UFS } from '@/lib/endereco';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { baixarPdf } from '@/lib/pdf';
import { GuiaRapido, type PassoDoGuia } from '@/components/guia-rapido';
import { useGuiaDePrimeiroAcesso } from '@/lib/guias';
import { MunicipioDrawer } from '@/components/municipios/municipio-drawer';
import { PendenciasDeLigacao } from '@/components/municipios/pendencias-de-ligacao';
import {
  casarCadastrosComIBGE, CHIP_SITUACAO, destaquesDeEntes, frasesDaPresenca, listarMunicipios,
  numeroBR, ORDENS_LISTA, pendenciasDeMunicipio, percentualBR, PESO_SITUACAO, presencaDe,
  rotuloDoEscopo, SITUACAO_FISCAL, sincronizarSiconfi,
  type EscopoLista, type FiltroSituacao, type MunicipioLinha, type OrdemLista, type PaginaMunicipios,
} from '@/lib/municipios';

/**
 * CONTAS PÚBLICAS (rota `/municipios`, módulo `municipios`).
 *
 * PARA QUE SERVE, na frase que abre a tela: conferir, antes de sentar à mesa,
 * se a prefeitura ou o Governo do Estado pode dar aumento — com os números que
 * o próprio ente declarou ao Tesouro. O nome antigo ("Municípios") dizia o que
 * a tela LISTA; ninguém procura "catálogo do IBGE" no menu quando quer saber se
 * a Prefeitura de Timon está no limite prudencial.
 *
 * ABRE EM "ONDE ATUAMOS": 64 municípios onde há filiado morando, gente
 * trabalhando para a prefeitura, ação contra ela ou organização cadastrada. A
 * comarca NÃO põe ninguém na lista — Brasília entrava por 12 ações que só
 * tramitam lá. O estado inteiro e o Brasil ficam a um toque.
 *
 * O FILTRO É DE UM TOQUE, e mostra quanto há em cada opção antes de apertar.
 * A versão anterior tinha duas caixas de marcar, um seletor com 27 estados e
 * um botão "Buscar" — três controles de ritmos diferentes para uma pergunta só.
 */

const PASSOS: PassoDoGuia[] = [
  {
    icone: HandCoins,
    titulo: 'Para que serve esta tela',
    texto: (
      <>
        <p>
          Antes de negociar com uma prefeitura ou com o Governo do Estado, confira aqui se a lei deixa
          dar aumento — e quanto a folha ainda pode crescer.
        </p>
        <p>Os números são o que o próprio governo declarou ao Tesouro Nacional. É difícil ele desmentir.</p>
      </>
    ),
  },
  {
    icone: Scale,
    titulo: 'A cor responde: pode dar aumento?',
    texto: (
      <>
        <p>
          <strong className="text-foreground">Verde</strong>: dentro do limite — a Lei de
          Responsabilidade Fiscal não impede. <strong className="text-foreground">Amarelo</strong>: em
          alerta, mas ainda pode.
        </p>
        <p>
          <strong className="text-foreground">Laranja ou vermelho</strong>: proibido de dar aumento —
          mas a revisão geral anual e o que vem de sentença ou de lei continuam permitidos.{' '}
          <strong className="text-foreground">Cinza</strong>: não há número para levar à mesa.
        </p>
      </>
    ),
  },
  {
    icone: Users,
    titulo: '"Nossa presença" diz o que temos ali',
    texto: (
      <>
        <p>
          <strong className="text-foreground">Moram</strong>: filiados com endereço no município.{' '}
          <strong className="text-foreground">Trabalham</strong>: filiados com vínculo num órgão daquele
          governo. <strong className="text-foreground">Ações contra</strong>: processos do sindicato em
          que ele é réu.
        </p>
        <p>Na ficha, cada número abre a lista de pessoas ou de processos.</p>
      </>
    ),
  },
  {
    icone: Search,
    titulo: 'Filtre com um toque',
    texto: (
      <p>
        A tela abre em <strong className="text-foreground">Onde atuamos</strong>; troque para o estado
        inteiro ou o Brasil quando precisar. Os botões de situação mostram, por exemplo, só quem está
        proibido de dar aumento — com a quantidade ao lado.
      </p>
    ),
  },
  {
    icone: FileDown,
    titulo: 'Leve para a reunião',
    texto: (
      <>
        <p>
          Na ficha de cada governo há a <strong className="text-foreground">ficha para negociação</strong>{' '}
          em PDF: a resposta da lei, quanto a folha pode crescer e como ele está perto dos vizinhos.
        </p>
        <p>
          Para rever este guia, toque em <strong className="text-foreground">Como ler</strong>, no alto
          da tela.
        </p>
      </>
    ),
  },
];

const ESCOPOS: EscopoLista[] = ['atuacao', 'uf', 'brasil'];

export default function ContasPublicasPage() {
  const { user } = useAuth();
  const podeMexer = podeEditar(user?.role, user?.permissoes, 'municipios');
  const qc = useQueryClient();
  const guia = useGuiaDePrimeiroAcesso('contas-publicas');

  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [escopo, setEscopo] = useState<EscopoLista>('atuacao');
  const [uf, setUf] = useState('');
  const [situacao, setSituacao] = useState<FiltroSituacao | ''>('');
  const [ordem, setOrdem] = useState<OrdemLista>('presenca');
  const [page, setPage] = useState(1);
  const [abrindo, setAbrindo] = useState<MunicipioLinha | null>(null);
  const [trabalhando, setTrabalhando] = useState<'siconfi' | 'casar' | 'pdf' | null>(null);

  /*
    A BUSCA ANDA SOZINHA, com 300 ms de respiro — sem botão "Buscar". O botão
    era um terceiro controle com ritmo próprio: quem digitava "picos" e mudava
    o estado via a lista antiga até lembrar de apertar.
  */
  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['municipios', 'lista', escopo, uf, situacao, ordem, buscaAplicada, page],
    queryFn: () =>
      listarMunicipios({
        escopo,
        uf: escopo === 'brasil' ? uf : undefined,
        situacao,
        ordem,
        busca: buscaAplicada,
        page,
        pageSize: 25,
      }),
    placeholderData: (anterior) => anterior,
  });

  /* A faixa de pendências é trabalho de quem pode editar — não se busca para quem só consulta. */
  const { data: pend } = useQuery({
    queryKey: ['municipios', 'pendencias'],
    queryFn: pendenciasDeMunicipio,
    enabled: podeMexer,
  });

  const { data: destaques } = useQuery({
    queryKey: ['municipios', 'destaques'],
    queryFn: destaquesDeEntes,
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ['municipios'] });
  const mudar = (f: () => void) => {
    f();
    setPage(1);
  };

  const ufDaCasa = data?.ufDaCasa ?? pend?.ufDaCasa ?? '';
  const nomeDaUF = UFS.find((u) => u.sigla === ufDaCasa)?.nome ?? ufDaCasa;
  const contagens = data?.contagens;
  const itens = data?.items ?? [];
  const temFiltro = !!buscaAplicada || !!situacao || escopo !== 'atuacao';

  async function atualizarDoTesouro() {
    setTrabalhando('siconfi');
    try {
      const r = await sincronizarSiconfi();
      toast.success(
        r.municipios === 0
          ? 'Todos os números já estavam atualizados.'
          : `${r.municipios} consultados: ${r.comPessoal} com despesa de pessoal, ${r.semPublicacao} não publicaram no período.`,
      );
      recarregar();
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível falar com o Tesouro Nacional.');
    } finally {
      setTrabalhando(null);
    }
  }

  async function casarCadastros() {
    setTrabalhando('casar');
    try {
      const r = await casarCadastrosComIBGE();
      toast.success(
        `${r.filiados.ligados} filiados e ${r.organizacoes.ligados} organizações ligados ao IBGE.` +
          (r.filiados.semResolver ? ` ${r.filiados.semResolver} ficaram para conferência.` : ''),
      );
      recarregar();
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível ligar os cadastros.');
    } finally {
      setTrabalhando(null);
    }
  }

  async function baixarRelatorio() {
    setTrabalhando('pdf');
    try {
      await baixarPdf('/municipios/relatorio.pdf', 'contas-publicas.pdf');
    } catch {
      toast.error('Não foi possível gerar o relatório.');
    } finally {
      setTrabalhando(null);
    }
  }

  function limparFiltros() {
    setBusca('');
    setBuscaAplicada('');
    setSituacao('');
    setEscopo('atuacao');
    setUf('');
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HandCoins className="h-6 w-6 shrink-0 text-brand-800 dark:text-brand-400" />
            Contas Públicas
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Quanto cada prefeitura e o Governo do Estado gastam com pessoal — e se a lei deixa dar
            aumento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={guia.abrir}>
            <CircleHelp className="h-4 w-4" /> Como ler
          </Button>
          {/*
            O PDF É PARA QUEM NÃO TEM LOGIN: a diretoria discute em reunião, o
            advogado leva a pasta, a assembleia recebe cópia. `GET`, e basta
            VISUALIZAR — quem consulta precisa poder imprimir.
          */}
          <Button
            variant="outline"
            onClick={baixarRelatorio}
            disabled={trabalhando !== null}
            title="Uma folha com a legenda em português, a tabela de onde atuamos e as ressalvas."
          >
            {trabalhando === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Relatório em PDF
          </Button>
        </div>
      </div>

      {/* -------------------------------------------- pendências (editores) */}
      {podeMexer && pend && !pend.jaRodou && pend.totalComCidade > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm dark:border-sky-900 dark:bg-sky-950/30">
          <Link2 className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <span className="min-w-0">
            Os cadastros ainda não foram ligados ao catálogo do IBGE.{' '}
            <span className="text-muted-foreground">
              {numeroBR(pend.totalComCidade)} filiados têm cidade preenchida e estão esperando.
            </span>
          </span>
          <button
            type="button"
            onClick={casarCadastros}
            disabled={trabalhando !== null}
            className="inline-flex min-h-9 items-center font-semibold text-sky-800 underline underline-offset-2 hover:no-underline disabled:opacity-50 dark:text-sky-300"
          >
            ligar agora
          </button>
        </div>
      )}
      {podeMexer && pend && <PendenciasDeLigacao pend={pend} onMudou={recarregar} />}

      {/* ------------------------------------------ o Governo do Estado */}
      {destaques?.map((e) => (
        <button
          key={e.codigo}
          type="button"
          onClick={() => setAbrindo(e)}
          className="flex w-full flex-col gap-2 rounded-xl border bg-card p-3 text-left transition hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
              <Landmark className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Governo do Estado — {e.nome}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <SeloFiscal m={e} />
                {/*
                  O TETO DO ESTADO É OUTRO (49% da receita, contra 54% do
                  município). Sem dizer isso, quem comparasse os dois números
                  lado a lado tiraria a conclusão errada.
                */}
                {e.fiscal.limiteMaximo != null && (
                  <span className="text-[11px] text-muted-foreground">
                    teto estadual de {percentualBR(e.fiscal.limiteMaximo)} — o municipal é outro
                  </span>
                )}
              </div>
              {/*
                O SELO VERDE NÃO BASTA NO FIM DO MANDATO. Em setembro de 2026 o
                Governo do Piauí estava em 37% — e, desde julho, qualquer aumento
                seria nulo pelo art. 21 da LRF. O cartão diz isso na cara.
              */}
              {e.calendario && (
                <p className="mt-1.5 text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-300">
                  {e.calendario.fimDeMandato
                    ? 'Fim de mandato: aumento concedido agora é nulo pela LRF (art. 21), mesmo dentro do limite.'
                    : 'Ano de eleição: a revisão geral não pode passar da inflação do ano.'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pl-[52px] text-xs sm:block sm:pl-0 sm:text-right">
            <Presenca m={e} />
            <span className="font-medium text-brand-800 dark:text-brand-400 sm:mt-0.5 sm:block">ver ficha →</span>
          </div>
        </button>
      ))}

      {/* --------------------------------------------------------- filtros */}
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar município…"
              aria-label="Buscar município"
              enterKeyHint="search"
              className="pl-9 pr-11"
            />
            {busca && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setBusca('')}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/*
            ONDE PROCURAR — três opções, com a quantidade de cada uma. Com busca,
            a quantidade é do que a busca achou ali: "Onde atuamos 0 · Piauí 2 ·
            Brasil 54" diz onde está o que se procura sem precisar adivinhar.
          */}
          <div role="group" aria-label="Onde procurar" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {ESCOPOS.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={escopo === e}
                onClick={() => mudar(() => setEscopo(e))}
                className={cn(
                  'min-h-11 rounded-md px-1.5 py-1 text-sm font-medium leading-tight transition',
                  escopo === e
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="block truncate">{rotuloDoEscopo(e, nomeDaUF)}</span>
                {contagens && (
                  <span className="block text-[11px] font-normal tabular-nums text-muted-foreground">
                    {numeroBR(contagens.escopos[e])}
                  </span>
                )}
              </button>
            ))}
          </div>

          {escopo === 'brasil' && (
            <select
              value={uf}
              onChange={(e) => mudar(() => setUf(e.target.value))}
              aria-label="Estado"
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
            >
              <option value="">Todos os estados</option>
              {UFS.map((u) => (
                <option key={u.sigla} value={u.sigla}>
                  {u.sigla} — {u.nome}
                </option>
              ))}
            </select>
          )}

          {/*
            A SITUAÇÃO, em português de quem negocia. Rola de lado no celular em
            vez de quebrar em três linhas; tocar de novo no chip ativo desliga.
          */}
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
            <ChipSituacao
              ativo={situacao === ''}
              rotulo="Todas"
              n={contagens?.situacao.todas}
              onClick={() => mudar(() => setSituacao(''))}
            />
            {(Object.keys(CHIP_SITUACAO) as FiltroSituacao[]).map((k) => (
              <ChipSituacao
                key={k}
                ativo={situacao === k}
                rotulo={CHIP_SITUACAO[k].rotulo}
                ponto={CHIP_SITUACAO[k].ponto}
                titulo={CHIP_SITUACAO[k].ajuda}
                n={contagens?.situacao[k]}
                onClick={() => mudar(() => setSituacao(situacao === k ? '' : k))}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              {data && (
                <span>
                  <strong className="text-foreground">{numeroBR(data.total)}</strong>{' '}
                  {data.total === 1 ? 'município' : 'municípios'}
                </span>
              )}
              {isFetching && !isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Atualizando" />}
            </p>
            <label className="relative">
              <span className="sr-only">Ordenar</span>
              <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={ordem}
                onChange={(e) => mudar(() => setOrdem(e.target.value as OrdemLista))}
                className="h-11 rounded-md border border-input bg-background pl-9 pr-3 text-sm md:h-9"
              >
                {ORDENS_LISTA.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- lista */}
      {error ? (
        <FalhaAoCarregar erro={error} onTentarDeNovo={refetch} oQue="as contas públicas" />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-brand-800 dark:text-brand-400" />
        </div>
      ) : itens.length === 0 ? (
        <Vazio
          escopo={escopo}
          busca={buscaAplicada}
          contagens={contagens}
          temFiltro={temFiltro}
          nomeDaUF={nomeDaUF}
          onEscopo={(e) => mudar(() => setEscopo(e))}
          onLimpar={limparFiltros}
        />
      ) : (
        <Card>
          {/* ------ desktop ------ */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Município</th>
                  <th className="px-3 py-2 font-semibold">Gasto com pessoal</th>
                  <th className="px-3 py-2 font-semibold">Saúde</th>
                  <th className="px-3 py-2 text-right font-semibold">Nossa presença</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((m) => (
                  <tr key={m.codigo} onClick={() => setAbrindo(m)} className="cursor-pointer transition hover:bg-muted/40">
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setAbrindo(m)} className="text-left font-medium hover:underline">
                        {m.nome}
                        <SiglaDeFora m={m} />
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {m.populacao ? `${numeroBR(m.populacao)} hab.` : `IBGE ${m.codigo}`}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <SeloFiscal m={m} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {m.saude?.percentualDespesa != null ? (
                        percentualBR(m.saude.percentualDespesa)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Presenca m={m} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ------ mobile ------ */}
          <ul className="divide-y md:hidden">
            {itens.map((m) => (
              <li key={m.codigo}>
                <button
                  type="button"
                  onClick={() => setAbrindo(m)}
                  className="w-full px-3 py-3 text-left transition hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {m.nome}
                        <SiglaDeFora m={m} />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.populacao ? `${numeroBR(m.populacao)} hab.` : `IBGE ${m.codigo}`}
                        {m.saude?.percentualDespesa != null
                          ? ` · saúde ${percentualBR(m.saude.percentualDespesa)}`
                          : ''}
                      </p>
                    </div>
                    <SeloFiscal m={m} />
                  </div>
                  <div className="mt-1.5 text-xs">
                    <Presenca m={m} />
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* ------ paginação ------ */}
          {data && data.totalPaginas > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
              <span className="text-muted-foreground">
                página {data.page} de {data.totalPaginas}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPaginas}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/*
        A LEGENDA EXPLICA O QUE ESTÁ NA TELA, e só isso — mesma regra do
        calendário da agenda. Listar as sete situações sempre ensinaria a
        ignorar a faixa; listar as que aparecem faz dela uma resposta.
      */}
      {itens.length > 0 && <LegendaDoQueEstaNaTela itens={itens} />}

      {/*
        MANUTENÇÃO NO FIM, e não no cabeçalho. Os dois botões rodam sozinhos
        toda madrugada; no topo, eles eram três quartos das ações da tela e a
        coisa menos usada dela.
      */}
      {podeMexer && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            <strong className="font-medium text-foreground">Os números se atualizam sozinhos</strong> toda
            madrugada: a consulta ao Tesouro e a ligação dos cadastros. Use os botões só se precisar agora.
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={casarCadastros}
              disabled={trabalhando !== null}
              title="Reconhece o município por trás da cidade digitada no cadastro"
            >
              {trabalhando === 'casar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Ligar cadastros
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={atualizarDoTesouro}
              disabled={trabalhando !== null}
              title="Busca no Tesouro os números de onde o sindicato atua. Leva alguns minutos."
            >
              {trabalhando === 'siconfi' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Atualizar do Tesouro
            </Button>
          </div>
        </div>
      )}

      {abrindo && <MunicipioDrawer municipio={abrindo} onFechar={() => setAbrindo(null)} />}
      <GuiaRapido titulo="Guia rápido" passos={PASSOS} aberto={guia.aberto} onFechar={guia.fechar} />
    </div>
  );
}

/** A UF só aparece para quem é de FORA do estado da casa — "Teresina PI" 64 vezes é ruído. */
function SiglaDeFora({ m }: { m: MunicipioLinha }) {
  if (!m.foraDaUF) return null;
  return (
    <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold text-muted-foreground">
      {m.uf}
    </span>
  );
}

function ChipSituacao({
  ativo,
  rotulo,
  n,
  ponto,
  titulo,
  onClick,
}: {
  ativo: boolean;
  rotulo: string;
  n?: number;
  ponto?: string;
  titulo?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      title={titulo}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
        ativo
          ? 'border-brand-800 bg-brand-800 text-white dark:border-brand-400 dark:bg-brand-400 dark:text-brand-900'
          : 'bg-background hover:bg-muted',
      )}
    >
      {ponto && <span className={cn('h-2 w-2 rounded-full', ponto)} aria-hidden />}
      {rotulo}
      {n != null && (
        <span className={cn('tabular-nums', ativo ? 'opacity-80' : 'text-muted-foreground')}>{numeroBR(n)}</span>
      )}
    </button>
  );
}

function Vazio({
  escopo,
  busca,
  contagens,
  temFiltro,
  nomeDaUF,
  onEscopo,
  onLimpar,
}: {
  escopo: EscopoLista;
  busca: string;
  contagens: PaginaMunicipios['contagens'];
  temFiltro: boolean;
  nomeDaUF: string;
  onEscopo: (e: EscopoLista) => void;
  onLimpar: () => void;
}) {
  /* A busca achou algo em outro recorte? Então a resposta é um botão, não "nada encontrado". */
  const outros = busca && contagens ? ESCOPOS.filter((e) => e !== escopo && contagens.escopos[e] > 0) : [];
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-sm text-muted-foreground">
          {busca
            ? `Nada com "${busca}" em ${rotuloDoEscopo(escopo, nomeDaUF)}.`
            : temFiltro
              ? 'Nenhum município com esses filtros.'
              : 'O catálogo do IBGE ainda não foi carregado nesta instalação.'}
        </p>
        {outros.length > 0 && contagens && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {outros.map((e) => (
              <Button key={e} variant="outline" size="sm" onClick={() => onEscopo(e)}>
                Ver {numeroBR(contagens.escopos[e])} em {rotuloDoEscopo(e, nomeDaUF)}
              </Button>
            ))}
          </div>
        )}
        {temFiltro && (
          <Button variant="ghost" className="mt-2" onClick={onLimpar}>
            Limpar filtros
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * O SELO diz o percentual E o que ele significa. Só o número obrigaria quem lê
 * a lembrar de cor que o teto é 54% e o prudencial 51,3% — e esses limites
 * mudam conforme o poder e a esfera.
 */
function SeloFiscal({ m }: { m: MunicipioLinha }) {
  const est = SITUACAO_FISCAL[m.fiscal.situacao];
  const temNumero = m.fiscal.percentualRcl != null && m.fiscal.situacao !== 'INCONSISTENTE';
  return (
    <span
      /*
        A EXPLICAÇÃO VIAJA COM O SELO. `title=` é o tooltip deste projeto —
        mesmo padrão de `STATUS_PROCESSO_AJUDA` na tela de Processos.
      */
      title={est.ajuda}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold',
        est.cor,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', est.ponto)} aria-hidden />
      {temNumero ? (
        <>
          <span className="tabular-nums">{percentualBR(m.fiscal.percentualRcl)}</span>
          <span className="font-normal">· {est.curto}</span>
        </>
      ) : (
        est.curto
      )}
    </span>
  );
}

/**
 * NOSSA PRESENÇA, POR EXTENSO — "2.632 moram · 8 ações contra".
 *
 * Substitui a coluna "O sindicato ali", que mostrava três ícones com números.
 * Ícone com número não diz o que conta: o martelo com "114" no cartão do Estado
 * foi lido como "114 processos contra o Estado", e eram os que tramitam em
 * qualquer fórum do Piauí.
 */
function Presenca({ m }: { m: MunicipioLinha }) {
  const frases = frasesDaPresenca(presencaDe(m));
  if (!frases.length) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className="text-xs text-muted-foreground">{frases.join(' · ')}</span>;
}

/**
 * A LEGENDA — uma faixa, colada no bloco, só com o que está na tela.
 *
 * O sindicato tem gente que nunca ouviu "limite prudencial", e o selo sozinho
 * ("52,33% · prudencial") não ensina nada. Aqui a palavra ganha a CONSEQUÊNCIA,
 * que é o que muda a conversa.
 */
function LegendaDoQueEstaNaTela({ itens }: { itens: MunicipioLinha[] }) {
  const presentes = [...new Set(itens.map((m) => m.fiscal.situacao))].sort(
    (a, b) => PESO_SITUACAO[a] - PESO_SITUACAO[b],
  );
  if (presentes.length < 2) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        O que cada marca quer dizer
      </p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {presentes.map((sit) => (
          <div key={sit} className="flex gap-2">
            <span
              className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', SITUACAO_FISCAL[sit].ponto)}
              aria-hidden
            />
            <div className="min-w-0">
              <dt className="text-xs font-semibold">{SITUACAO_FISCAL[sit].rotulo}</dt>
              <dd className="text-[11px] leading-snug text-muted-foreground">
                {SITUACAO_FISCAL[sit].ajuda}
              </dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="font-semibold">Gasto com pessoal</strong> é quanto da receita do ente vai para a
        folha, do Relatório de Gestão Fiscal (RGF).{' '}
        <strong className="font-semibold">Saúde</strong> é a fatia da despesa que caiu nessa função, do
        Relatório Resumido da Execução Orçamentária (RREO) — não é o mínimo constitucional de 15%.{' '}
        <strong className="font-semibold">Nossa presença</strong>: <em>moram</em> são filiados com endereço no
        município; <em>trabalham</em>, com vínculo num órgão daquele governo; <em>ações contra</em>, processos
        do sindicato em que ele é réu. Ação que só tramita no fórum da cidade não conta.
      </p>
    </div>
  );
}
