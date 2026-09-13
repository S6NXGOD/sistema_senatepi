'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  ArrowRight, BarChart3, Bot, CalendarClock, Download, FileText, Gavel, Loader2, MessagesSquare,
  Newspaper, Users, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { Button } from '@/components/ui/button';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { tenant } from '@/tenant.config';
import {
  ASSUNTO_LABEL, ATALHOS, RESULTADO_LABEL, baixarCsvDaEquipe, carregarRelatorio, comoData,
  dataCurta, dataDoInput, diaCurto, duracao, fraseDasSentencas, horaDoItem, hrefDaComarca,
  hrefDaParteContraria, hrefDoAssunto, totalDoAno,
  type AjuizadasDoAno, type Contagem, type ItemDaAgenda, type Justica, type Proximos,
  type Publicacoes, type Relatorio, type ResultadoSentenca, type Robo, type SentencasDoAno,
} from '@/lib/relatorios';
import {
  ESCOLHAS_PADRAO, OPCOES_PADRAO, SECOES_DO_PDF, gerarPdfDoRelatorio, guardarEscolhas, guardarOpcoes,
  lerEscolhas, lerOpcoes, secaoDisponivel, type EscolhasDoPdf, type RotulosDoPdf, type SecaoDoPdf,
} from '@/lib/relatorio-pdf';
import {
  hojeComoTexto, periodoAnterior, periodoDoPreset, periodoValido, type Periodo, type PresetDoPeriodo,
} from '@/lib/periodo-do-pdf';
import { DESFECHO_LABEL, listarTiposEvento, rotuloTipo } from '@/lib/agenda';
import {
  CANAL_LABEL, SETOR_LABEL, type CanalAtendimento, type SetorAtendimento,
} from '@/lib/atendimentos';
import { AREAS_JURIDICAS } from '@/lib/areas-juridicas';
import { formatNPU } from '@/lib/processos';
import { baixarCsvDaProdutividade } from '@/lib/produtividade';
import { UsoEProdutividade } from '@/components/relatorios/uso-e-produtividade';
import { PdfDaProdutividade } from '@/components/relatorios/pdf-da-produtividade';
import {
  DialogoDoPdf, EscolhaDoPeriodo, Opcao, ParteDoDialogo, TituloEObservacao, campoCls,
} from '@/components/relatorios/partes-do-pdf';

/**
 * RELATÓRIOS — o que a equipe entregou, o que ficou, e como o sindicato está na
 * Justiça.
 *
 * SEM RANKING, e a decisão é do serviço, não da tela: a lista vem em ordem
 * alfabética e inclui quem fechou zero. Zero pode ser férias, pode ser um mês
 * dentro de uma ação civil pública que não gera "atividade concluída" — é a
 * linha que pede conversa, não a que pede sumiço.
 *
 * A METADE NOVA (12/09/2026) é a que um sindicato leva para a assembleia:
 * sentenças por ano e para que lado, ações ajuizadas, contra quem e onde, o que
 * vem nos próximos trinta dias. E o PDF, com as seções que a pessoa marca —
 * porque o papel da diretoria não é a planilha da coordenação.
 *
 * O advogado vê a própria linha; quem coordena vê todas. A API é que recorta.
 */

const inputCls =
  'h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ' +
  'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring';

const TOM_DO_RESULTADO: Record<ResultadoSentenca, string> = {
  PROCEDENTE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  PARCIAL: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
  IMPROCEDENTE: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
};

type Aba = 'sindicato' | 'uso';

const ABAS: { id: Aba; texto: string }[] = [
  { id: 'sindicato', texto: 'O sindicato' },
  { id: 'uso', texto: 'Uso e produtividade' },
];

export default function RelatoriosPage() {
  const { user } = useAuth();
  const hoje = useMemo(() => new Date(), []);
  const [de, setDe] = useState(() => comoData(new Date(hoje.getTime() - 30 * 86_400_000)));
  const [ate, setAte] = useState(() => comoData(hoje));
  const [baixando, setBaixando] = useState(false);
  const [pdfAberto, setPdfAberto] = useState(false);
  /**
   * ESPELHO DE UMA PESSOA — para conversar com ela, não para publicar um pódio.
   * A lista continua alfabética e completa; isto é um recorte que se escolhe,
   * não uma ordenação que se impõe.
   */
  const [foco, setFoco] = useState('');
  /**
   * DUAS PERGUNTAS, DUAS ABAS. "Como o sindicato está" é o documento da
   * diretoria; "quem usa o sistema e o que registra" é ferramenta de quem
   * coordena. Na mesma rolagem, uma afogaria a outra.
   */
  const [aba, setAba] = useState<Aba>('sindicato');

  const {
    data: relatorio, isLoading, isFetching, isError: falhou, error, refetch,
  } = useQuery({
    queryKey: ['relatorio', de, ate, foco],
    queryFn: () => carregarRelatorio(de, ate, foco || undefined),
    placeholderData: keepPreviousData,
    // Na aba de uso, as somas do sindicato não são pedidas: ninguém está olhando.
    enabled: aba === 'sindicato',
  });
  /*
    O RELATÓRIO DO SINDICATO SÓ EXISTE NA ABA DELE. Com o dado em cache, trocar
    de aba deixaria os cartões desenhados embaixo do uso do sistema.
  */
  const data = aba === 'sindicato' ? relatorio : undefined;
  const isError = aba === 'sindicato' && falhou;

  /* O tipo de atividade é cadastrável: o nome vem do catálogo, não de um mapa. */
  const { data: tiposEvento } = useQuery({
    queryKey: ['tipos-evento'],
    queryFn: () => listarTiposEvento(true),
    staleTime: 300_000,
  });

  /*
    AS PESSOAS DO SELETOR VÊM DA ÚLTIMA VISÃO DA EQUIPE INTEIRA.

    Com o foco em alguém, a API devolve só a linha dessa pessoa — e o seletor,
    que se montava dessa mesma lista, sumia junto: não havia como voltar para
    "Toda a equipe" sem recarregar a página.
  */
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    if (data && data.escopo === 'GLOBAL' && !data.focoUsuario) {
      setPessoas(data.equipe.map((l) => ({ id: l.usuarioId, nome: l.nome })));
    }
  }, [data]);

  const rotulos: RotulosDoPdf = useMemo(
    () => ({
      tipo: (slug) => rotuloTipo(slug, tiposEvento),
      area: (slug) => AREAS_JURIDICAS.find((a) => a.slug === slug)?.nome ?? slug,
      canal: (slug) => CANAL_LABEL[slug as CanalAtendimento] ?? slug,
      assunto: (slug) => ASSUNTO_LABEL[slug] ?? slug,
      setor: (slug) => SETOR_LABEL[slug as SetorAtendimento] ?? slug,
    }),
    [tiposEvento],
  );

  function aplicarAtalho(inicio: (hoje: Date) => Date) {
    const agora = new Date();
    setDe(comoData(inicio(agora)));
    setAte(comoData(agora));
  }

  async function baixarPlanilha() {
    setBaixando(true);
    try {
      if (aba === 'uso') await baixarCsvDaProdutividade(de, ate);
      else await baixarCsvDaEquipe(de, ate, foco || undefined);
    } catch {
      toast.error('Não foi possível gerar a planilha agora.');
    } finally {
      setBaixando(false);
    }
  }

  const pessoal = data?.escopo === 'PESSOAL';
  const anoCorrente = hoje.getFullYear();

  const secoesDaPagina = data
    ? [
        { id: 'resumo', texto: 'Resumo', mostrar: true },
        { id: 'justica', texto: 'Justiça', mostrar: !!data.justica },
        { id: 'proximos', texto: 'Próximos dias', mostrar: !!data.proximos },
        { id: 'equipe', texto: pessoal ? 'Seus números' : 'Equipe', mostrar: true },
        { id: 'publicacoes', texto: 'Publicações', mostrar: !!(data.publicacoes || data.robo) },
        { id: 'atendimento', texto: 'Atendimento', mostrar: true },
      ].filter((s) => s.mostrar)
    : [];

  return (
    <div className="space-y-5 p-4 pb-24 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
            <BarChart3 className="h-5 w-5 text-brand-700 dark:text-brand-400" />
            Relatórios
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {aba === 'uso'
              ? 'Quem usa o sistema e o que cada pessoa registrou nele, por perfil. Sem posição e sem nota.'
              : pessoal
                ? 'Os seus números no período, e como o sindicato está na Justiça.'
                : data?.focoUsuario
                  ? `Os números de ${data.focoUsuario.nome} no período.`
                  : 'O que a equipe entregou, o que continua aberto e como o sindicato está na Justiça. Sem posição e sem nota — os casos não são comparáveis entre si.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={baixarPlanilha}
            disabled={baixando || (aba === 'sindicato' && !data)}
          >
            {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Planilha
          </Button>
          {/*
            UM PDF POR ABA. O do sindicato é o documento da diretoria; o do uso é
            ferramenta da coordenação — do mês, do ano, de um perfil ou de uma
            pessoa. Cada um abre a própria escolha.
          */}
          <Button
            onClick={() => setPdfAberto(true)}
            disabled={aba === 'sindicato' && (!data || isError)}
          >
            <FileText className="h-4 w-4" />
            Baixar PDF
          </Button>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Que relatório ver"
        className="grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1 sm:inline-grid"
      >
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition',
              aba === a.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {a.texto}
          </button>
        ))}
      </div>

      {/* PERÍODO: atalhos primeiro, datas depois. Quem quer "o mês" clica uma
          vez; quem quer um intervalo específico digita. */}
      <Card className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap gap-1.5">
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => aplicarAtalho(a.inicio)}
              className="rounded-full border px-3 py-1 text-xs font-medium transition hover:bg-muted"
            >
              {a.rotulo === 'Este ano' ? a.rotulo : `Últimos ${a.rotulo}`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1 sm:flex-none">
            <span className="block text-xs font-medium text-muted-foreground">De</span>
            <input
              type="date"
              value={de}
              max={ate}
              onChange={(e) => setDe(e.target.value)}
              className={cn(inputCls, 'w-full sm:w-auto')}
            />
          </label>
          <label className="flex-1 space-y-1 sm:flex-none">
            <span className="block text-xs font-medium text-muted-foreground">Até</span>
            <input
              type="date"
              value={ate}
              min={de}
              onChange={(e) => setAte(e.target.value)}
              className={cn(inputCls, 'w-full sm:w-auto')}
            />
          </label>
          {/*
            O SELETOR SÓ EXISTE PARA QUEM VÊ A EQUIPE. Para o advogado o
            relatório já é o dele — mostrar um seletor de pessoas que a API
            ignora seria prometer o espelho do colega.
          */}
          {aba === 'sindicato' && !pessoal && pessoas.length > 1 && (
            <label className="w-full space-y-1 sm:w-auto">
              <span className="block text-xs font-medium text-muted-foreground">Pessoa</span>
              <select
                value={foco}
                onChange={(e) => setFoco(e.target.value)}
                className={cn(inputCls, 'w-full sm:w-56')}
              >
                <option value="">Toda a equipe</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </label>
          )}
          {isFetching && !isLoading && (
            <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </Card>

      {aba === 'uso' && <UsoEProdutividade de={de} ate={ate} />}

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Somando o período…</p>
      )}

      {/*
        NÚMERO ERRADO É PIOR QUE NÚMERO NENHUM — e um relatório que falhou e
        mostra os cartões zerados afirma que a equipe não entregou nada.
      */}
      {isError && (
        <Card className="p-2">
          <FalhaAoCarregar erro={error} oQue="o relatório" onTentarDeNovo={() => refetch()} />
        </Card>
      )}

      {data && !isError && (
        <>
          {/* No celular a página é longa: os atalhos levam direto a cada parte. */}
          <nav
            aria-label="Partes do relatório"
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
          >
            {secoesDaPagina.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="shrink-0 rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {s.texto}
              </a>
            ))}
          </nav>

          <section id="resumo" className="grid scroll-mt-20 grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero
              titulo="Atividades concluídas"
              valor={data.atividades.concluidas}
              nota={
                data.atividades.concluidas
                  ? `${data.atividades.automaticas} do robô · ${data.atividades.manuais} de pessoas`
                  : undefined
              }
            />
            {/*
              "ATRASADA", e nunca "prazo vencido": o sistema conhece a data que
              alguém marcou na agenda, não o prazo processual. É a acusação mais
              grave que se pode fazer a um advogado, e não há dado que a sustente.
            */}
            <Numero
              titulo="Em aberto agora"
              valor={data.atividades.abertas}
              nota={
                data.atividades.atrasadas
                  ? `${data.atividades.atrasadas} ${data.atividades.atrasadas === 1 ? 'atrasada' : 'atrasadas'}, de dia anterior`
                  : 'nenhuma atrasada'
              }
              alerta={data.atividades.atrasadas > 0}
            />
            {data.publicacoes ? (
              <Numero
                titulo="Publicações recebidas"
                valor={data.publicacoes.recebidas}
                nota={`${data.publicacoes.viraramTarefa} viraram tarefa`}
              />
            ) : (
              <Numero
                titulo="Processos ativos"
                valor={data.processos.ativos}
                nota={`${data.processos.encerrados} encerrados no acervo`}
              />
            )}
            <Numero
              titulo="Atendimentos"
              valor={data.atendimentos.registrados}
              nota={
                data.atendimentos.filiadosAtendidos !== undefined
                  ? `${data.atendimentos.filiadosAtendidos} ${data.atendimentos.filiadosAtendidos === 1 ? 'pessoa' : 'pessoas diferentes'}`
                  : undefined
              }
            />
          </section>

          {data.justica && <SecaoJustica r={data} j={data.justica} anoCorrente={anoCorrente} />}

          {data.proximos && <SecaoProximos p={data.proximos} />}

          <section id="equipe" className="scroll-mt-20 space-y-3">
            <TituloDeSecao
              icone={Users}
              titulo={pessoal ? 'Os seus números' : data.focoUsuario ? data.focoUsuario.nome : 'Equipe'}
              texto="Em ordem alfabética. “Concluídas” conta quem fechou a atividade; “em aberto” e “atrasadas” contam quem é responsável por ela."
            />
            <Card className="overflow-hidden">
              {/* A tabela rola no celular em vez de espremer cinco colunas. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Pessoa</th>
                      <th className="px-3 py-2 text-right font-medium">Concluídas</th>
                      <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                      <th className="px-3 py-2 text-right font-medium">Atrasadas</th>
                      <th className="px-4 py-2 text-right font-medium">Tempo mediano</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.equipe.map((l) => (
                      <tr key={l.usuarioId} className="hover:bg-muted/30">
                        <td className="px-4 py-2">{l.nome}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.concluidas}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.abertas}</td>
                        <td
                          className={cn(
                            'px-3 py-2 text-right tabular-nums',
                            l.atrasadas > 0 && 'font-semibold text-amber-700 dark:text-amber-400',
                          )}
                        >
                          {l.atrasadas}
                        </td>
                        {/*
                          A BASE VAI JUNTO DA MEDIANA. "16 min" sobre duas
                          atividades e sobre quarenta são coisas diferentes, e o
                          número sozinho não distingue.
                        */}
                        <td className="px-4 py-2 text-right tabular-nums">
                          {duracao(l.medianaMinutos)}
                          {l.cronometradas > 0 && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              ({l.cronometradas})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t px-4 py-2 text-[11px] leading-snug text-muted-foreground">
                O tempo mediano só considera atividades em que alguém usou o cronômetro — o número
                entre parênteses é quantas foram. Ele mede quanto tempo a atividade ficou aberta, e
                não o esforço que ela deu.
              </p>
            </Card>

            {/*
              QUE TIPO DE TRABALHO FOI FEITO. "Concluiu 15" não diz se foram
              quinze audiências ou quinze telefonemas, e a diferença é o dia
              inteiro de alguém.
            */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Lista
                titulo="Tipo de atividade concluída"
                itens={data.atividades.porTipo}
                rotular={(r) => rotuloTipo(r, tiposEvento)}
                vazio="Nenhuma atividade concluída no período."
              />
              <Lista
                titulo="Como as atividades terminaram"
                itens={data.atividades.porDesfecho}
                rotular={(r) => DESFECHO_LABEL[r] ?? r}
                vazio="Nenhuma atividade concluída no período."
              />
            </div>
          </section>

          {(data.publicacoes || data.robo) && (
            <SecaoPublicacoes publicacoes={data.publicacoes} robo={data.robo} />
          )}

          {/*
            POR QUE O FILIADO PROCUROU — a pergunta que a diretoria faz.

            O campo é opcional: os registros anteriores a ele e os que ficaram
            em branco entram como "não informado", à vista. Sem esse número,
            três atendimentos classificados virariam "100% progressão de nível".
          */}
          <section id="atendimento" className="scroll-mt-20 space-y-3">
            <TituloDeSecao
              icone={MessagesSquare}
              titulo="Atendimento ao filiado"
              texto="O que foi registrado no período. Atendimento que não é registrado não aparece aqui."
            />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Lista
                titulo="Por que procuraram o sindicato"
                itens={data.atendimentos.porAssunto}
                rotular={(r) => ASSUNTO_LABEL[r] ?? r}
                vazio="Nenhum atendimento classificado no período."
                nota={
                  data.atendimentos.assuntoNaoInformado > 0
                    ? `${data.atendimentos.assuntoNaoInformado} ${data.atendimentos.assuntoNaoInformado === 1 ? 'atendimento ficou' : 'atendimentos ficaram'} sem assunto informado.`
                    : undefined
                }
              />
              <Lista
                titulo="Por setor"
                itens={data.atendimentos.porSetor}
                rotular={(r) => SETOR_LABEL[r as SetorAtendimento] ?? r}
                vazio="Nenhum atendimento no período."
              />
              {!pessoal && (
                <>
                  <Lista
                    titulo="Por canal"
                    itens={data.atendimentos.porCanal}
                    rotular={(r) => CANAL_LABEL[r as CanalAtendimento] ?? r}
                    vazio="Nenhum atendimento no período."
                  />
                  <Lista
                    titulo="Por atendente"
                    itens={data.atendimentos.porAtendente}
                    vazio="Nenhum atendimento no período."
                  />
                </>
              )}
            </div>
          </section>

          <p className="text-[11px] leading-snug text-muted-foreground">
            Acervo hoje: {data.processos.ativos} processos ativos e {data.processos.encerrados}{' '}
            encerrados. {data.processos.cadastrados} entraram no sistema no período — cadastrar não
            é ajuizar, e o acervo antigo entrou de uma vez na migração.
          </p>
        </>
      )}

      {data && pdfAberto && (
        <EscolherPdf
          relatorio={data}
          rotulos={rotulos}
          de={de}
          ate={ate}
          foco={foco}
          pessoas={pessoas}
          emitidoPor={user?.nomeExibicao || user?.nome || tenant.sigla}
          onFechar={() => setPdfAberto(false)}
        />
      )}
      {aba === 'uso' && pdfAberto && (
        <PdfDaProdutividade
          de={de}
          ate={ate}
          emitidoPor={user?.nomeExibicao || user?.nome || tenant.sigla}
          onFechar={() => setPdfAberto(false)}
        />
      )}
    </div>
  );
}

function TituloDeSecao({ icone: Icone, titulo, texto }: { icone: LucideIcon; titulo: string; texto?: string }) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icone className="h-4 w-4 text-brand-700 dark:text-brand-400" />
        {titulo}
      </h2>
      {texto && <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{texto}</p>}
    </div>
  );
}

function Numero({
  titulo,
  valor,
  nota,
  alerta,
}: {
  titulo: string;
  valor: number;
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
      {nota && (
        <p
          className={cn(
            'mt-0.5 text-[11px]',
            alerta ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {nota}
        </p>
      )}
    </Card>
  );
}

/**
 * O SINDICATO NA JUSTIÇA.
 *
 * Não muda com o seletor de pessoa, e a tela diz isso quando há foco: recortar
 * sentença por advogado seria publicar taxa de vitória de colega.
 */
function SecaoJustica({ r, j, anoCorrente }: { r: Relatorio; j: Justica; anoCorrente: number }) {
  const frase = fraseDasSentencas(j.sentencasPorAno, anoCorrente);
  const semData = r.processos.semDataDeDistribuicao ?? 0;

  return (
    <section id="justica" className="scroll-mt-20 space-y-3">
      <TituloDeSecao
        icone={Gavel}
        titulo="O sindicato na Justiça"
        texto={
          r.focoUsuario
            ? 'Do sindicato inteiro — esta parte não muda com o filtro de pessoa.'
            : 'Contado pelo registro do tribunal. Clique numa linha para abrir os processos.'
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Processos ativos</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{r.processos.ativos}</p>
          <ul className="mt-3 space-y-1 text-sm">
            <LinhaDoAcervo
              rotulo={`${tenant.sigla} é o autor`}
              valor={j.nossoPapel.autor}
              href="/processos?nossoPapel=AUTOR&status=ATIVO"
            />
            <LinhaDoAcervo
              rotulo="Representando o filiado"
              valor={j.nossoPapel.representando}
              href="/processos?nossoPapel=REPRESENTANDO&status=ATIVO"
            />
            <LinhaDoAcervo
              rotulo={`${tenant.sigla} é réu`}
              valor={j.nossoPapel.reu}
              href="/processos?nossoPapel=REU&status=ATIVO"
            />
          </ul>
          <p className="mt-3 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
            {j.institucionais} coletivas ou institucionais · {j.individuais} individuais ·{' '}
            {r.processos.encerrados} encerrados no acervo
          </p>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold">Sentenças por ano</h3>
          {frase && <p className="mt-1 text-sm">{frase}</p>}
          <SentencasPorAno serie={j.sentencasPorAno} anoCorrente={anoCorrente} />
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            O CNJ costuma levar cerca de dois meses para registrar um julgamento: os meses mais
            recentes aparecem incompletos.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Ações ajuizadas por ano</h3>
          <AjuizadasPorAno serie={j.ajuizadasPorAno} anoCorrente={anoCorrente} />
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {r.processos.distribuidos} no período escolhido.
            {semData > 0 &&
              ` ${semData} ${semData === 1 ? 'processo ativo está' : 'processos ativos estão'} sem data de distribuição no CNJ e ${semData === 1 ? 'fica' : 'ficam'} fora desta conta.`}
          </p>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <SentencasDoPeriodo j={j} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Lista
          titulo="Contra quem"
          itens={j.adversarios}
          href={hrefDaParteContraria}
          vazio="Nenhuma parte contrária cadastrada."
          nota="Processos ativos, pela parte contrária principal."
        />
        <Lista
          titulo="Onde tramitam"
          itens={j.comarcas}
          href={hrefDaComarca}
          vazio="Nenhum processo com comarca identificada."
        />
        <Lista
          titulo="Sobre o quê"
          itens={j.temas}
          href={hrefDoAssunto}
          vazio="Nenhum assunto registrado."
          nota="Os nomes são os que o tribunal registrou."
        />
        <Lista
          titulo="Por área"
          itens={r.processos.porArea}
          rotular={(slug) => AREAS_JURIDICAS.find((a) => a.slug === slug)?.nome ?? slug}
          vazio="Nenhum processo ativo."
        />
        <Lista titulo="Por tribunal" itens={r.processos.porTribunal} vazio="Nenhum processo ativo." />
      </div>
    </section>
  );
}

function LinhaDoAcervo({ rotulo, valor, href }: { rotulo: string; valor: number; href: string }) {
  return (
    <li>
      <Link
        href={href}
        className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 transition hover:bg-muted/60"
      >
        <span className="truncate">{rotulo}</span>
        <span className="shrink-0 font-semibold tabular-nums">{valor}</span>
      </Link>
    </li>
  );
}

/**
 * SENTENÇAS POR ANO — uma barra por ano, nas três cores do Panorama.
 *
 * O comprimento é o volume do ano, comparado ao maior da série; as cores são a
 * proporção. Improcedente é ÂMBAR, e não vermelho: perder um pedido é resultado
 * normal de litígio, não erro do escritório. O ano corrente vem marcado — ele
 * não terminou e não se compara a um ano fechado.
 */
function SentencasPorAno({ serie, anoCorrente }: { serie: SentencasDoAno[]; anoCorrente: number }) {
  if (!serie.some((a) => totalDoAno(a) > 0)) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Nenhuma sentença registrada nos últimos {serie.length} anos.
      </p>
    );
  }
  const maior = Math.max(1, ...serie.map(totalDoAno));
  const legenda = [
    { cor: 'bg-emerald-600', nome: 'procedente' },
    { cor: 'bg-teal-500', nome: 'procedente em parte' },
    { cor: 'bg-amber-500', nome: 'improcedente' },
  ];

  return (
    <div className="mt-3">
      <ul className="space-y-2">
        {serie.map((a) => {
          const total = totalDoAno(a);
          const faixas = [
            { n: a.procedentes, cor: 'bg-emerald-600', nome: 'procedentes' },
            { n: a.parciais, cor: 'bg-teal-500', nome: 'em parte' },
            { n: a.improcedentes, cor: 'bg-amber-500', nome: 'improcedentes' },
          ].filter((f) => f.n > 0);
          const corrente = a.ano === anoCorrente;
          return (
            <li key={a.ano} className="flex items-center gap-2 text-xs">
              <span className={cn('w-9 shrink-0 tabular-nums', corrente && 'text-muted-foreground')}>
                {a.ano}
              </span>
              <div
                className="h-3 flex-1 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${a.ano}: ${a.procedentes} procedentes, ${a.parciais} procedentes em parte, ${a.improcedentes} improcedentes`}
              >
                <div className="flex h-full" style={{ width: `${(total / maior) * 100}%` }}>
                  {faixas.map((f) => (
                    <div
                      key={f.nome}
                      className={f.cor}
                      style={{ width: `${(f.n / total) * 100}%` }}
                      title={`${f.n} ${f.nome}`}
                    />
                  ))}
                </div>
              </div>
              <span className="w-[4.5rem] shrink-0 text-right tabular-nums text-muted-foreground">
                {total ? (corrente ? `${total} até agora` : total) : '—'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {legenda.map((l) => (
          <span key={l.nome} className="inline-flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', l.cor)} aria-hidden />
            {l.nome}
          </span>
        ))}
      </p>
    </div>
  );
}

/** Colunas simples, com o ano corrente esmaecido — ele ainda não terminou. */
function AjuizadasPorAno({ serie, anoCorrente }: { serie: AjuizadasDoAno[]; anoCorrente: number }) {
  const maior = Math.max(1, ...serie.map((a) => a.processos));
  return (
    <div className="mt-3">
      <div className="flex h-24 items-end gap-1.5">
        {serie.map((a) => (
          <div key={a.ano} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] leading-none tabular-nums text-muted-foreground">
              {a.processos || ''}
            </span>
            <div
              className={cn(
                'w-full rounded-sm',
                a.ano === anoCorrente ? 'bg-brand-300 dark:bg-brand-800' : 'bg-brand-600',
              )}
              // Piso de 2px: o ano zerado ocupa espaço para se ver que existiu.
              style={{ height: `${Math.max(Math.round((a.processos / maior) * 72), 2)}px` }}
              title={`${a.ano}: ${a.processos}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {serie.map((a) => (
          <span key={a.ano} className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground">
            {String(a.ano).slice(2)}
          </span>
        ))}
      </div>
    </div>
  );
}

function SentencasDoPeriodo({ j }: { j: Justica }) {
  const visiveis = j.sentencasNoPeriodo.slice(0, 8);
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Sentenças no período</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{j.totalSentencasNoPeriodo}</span>
      </div>
      {visiveis.length === 0 ? (
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          Nenhuma sentença registrada no período. Se o período é recente, lembre do atraso do CNJ.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {visiveis.map((s) => (
            <li key={s.processoId}>
              <Link
                href={`/processos?processo=${s.processoId}`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-muted/50"
              >
                <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {dataCurta(s.data).slice(0, 5)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {s.adversario ?? 'Parte contrária não identificada'}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {formatNPU(s.numeroCNJ)}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    TOM_DO_RESULTADO[s.resultado],
                  )}
                >
                  {RESULTADO_LABEL[s.resultado]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {j.totalSentencasNoPeriodo > visiveis.length && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Mostrando {visiveis.length} de {j.totalSentencasNoPeriodo}. O PDF detalhado traz a lista.
        </p>
      )}
    </>
  );
}

/**
 * OS PRÓXIMOS TRINTA DIAS — o que o relatório de trás para frente não mostrava.
 *
 * "Prazo" aqui é a data que alguém marcou na agenda, e a tela diz isso: o
 * sistema não calcula prazo processual, e fingir que calcula seria a pior
 * promessa que ele poderia fazer.
 */
function SecaoProximos({ p }: { p: Proximos }) {
  return (
    <section id="proximos" className="scroll-mt-20 space-y-3">
      <TituloDeSecao
        icone={CalendarClock}
        titulo={`Próximos ${p.dias} dias`}
        texto="Audiências, perícias e prazos marcados na agenda. Prazo, aqui, é a data que alguém marcou — não o prazo processual."
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ListaDaAgenda
          titulo="Audiências e perícias"
          itens={p.audiencias}
          total={p.totalAudiencias}
          vazio="Nenhuma audiência ou perícia marcada."
        />
        <ListaDaAgenda titulo="Prazos" itens={p.prazos} total={p.totalPrazos} vazio="Nenhum prazo marcado." />
      </div>
    </section>
  );
}

function ListaDaAgenda({
  titulo, itens, total, vazio,
}: {
  titulo: string;
  itens: ItemDaAgenda[];
  total: number;
  vazio: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{total}</span>
      </div>
      {itens.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-2 divide-y">
          {itens.map((c) => (
            <li key={c.id}>
              <Link
                href={`/agenda?compromisso=${c.id}`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-muted/50"
              >
                <span className="w-16 shrink-0 text-xs leading-tight">
                  <span className="block font-medium">{diaCurto(c.inicio)}</span>
                  <span className="block tabular-nums text-muted-foreground">{horaDoItem(c.inicio)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.titulo}</span>
                  {c.processo?.numeroCNJ && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {formatNPU(c.processo.numeroCNJ)}
                    </span>
                  )}
                </span>
                {c.responsavel && (
                  <AvatarPessoa
                    nome={c.responsavel.nomeExibicao || c.responsavel.nome}
                    url={c.responsavel.avatarUrl}
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > itens.length && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Mais {total - itens.length} na agenda.
        </p>
      )}
    </Card>
  );
}

/**
 * PUBLICAÇÕES E ROBÔ — o que chegou do Diário e o que se fez com isso.
 *
 * O número que importa é "esperando decisão", e ele é de HOJE, sem corte de
 * data: o que espera desde antes do período continua esperando. Leva direto à
 * fila, pela mesma regra que a busca de publicações usa.
 */
function SecaoPublicacoes({
  publicacoes, robo,
}: {
  publicacoes?: Publicacoes | null;
  robo?: Robo | null;
}) {
  return (
    <section id="publicacoes" className="scroll-mt-20 space-y-3">
      <TituloDeSecao
        icone={Newspaper}
        titulo="Publicações e robô"
        texto="O que chegou do Diário no período e o que se fez com isso."
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {publicacoes && (
          <Card className="p-4">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
              <MiniNumero rotulo="Recebidas" valor={publicacoes.recebidas} />
              <MiniNumero rotulo="Viraram tarefa" valor={publicacoes.viraramTarefa} />
              <MiniNumero rotulo="Dispensadas com motivo" valor={publicacoes.dispensadas} />
              <MiniNumero
                rotulo="Esperando decisão hoje"
                valor={publicacoes.esperandoDecisao}
                destaque={publicacoes.esperandoDecisao > 0}
              />
            </dl>
            {publicacoes.esperandoDecisao > 0 && (
              <Link
                href="/publicacoes?situacao=SEM_DECISAO"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
              >
                Ver as que esperam decisão <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Esperando decisão: pede providência, não virou tarefa e ninguém dispensou.
            </p>
          </Card>
        )}
        {robo && (
          <Card className="p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Bot className="h-4 w-4 text-muted-foreground" />
              Tarefas criadas pelo robô
            </h3>
            {robo.criadas === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Nenhuma no período.</p>
            ) : (
              <>
                <p className="mt-2 text-sm">
                  {robo.criadas} no período: {robo.concluidas} concluídas, {robo.abertas} em aberto e{' '}
                  {robo.canceladasPeloRobo + robo.canceladasPorPessoas} canceladas.
                </p>
                <p className="mt-2 text-xs leading-snug text-muted-foreground">
                  Das canceladas, {robo.canceladasPeloRobo} foram pelo próprio robô, ao achar
                  duplicidade ou perda de objeto, e {robo.canceladasPorPessoas} por pessoas da
                  equipe — só estas deram trabalho a alguém.
                </p>
              </>
            )}
          </Card>
        )}
      </div>
    </section>
  );
}

function MiniNumero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd
        className={cn(
          'text-xl font-bold tabular-nums',
          destaque && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {valor}
      </dd>
    </div>
  );
}

/**
 * Uma distribuição, em barras proporcionais. Sem biblioteca de gráfico: são
 * poucas linhas, e um motor de gráfico traria eixo, grade e tooltip que
 * ninguém pediu. Com `href`, cada linha abre a lista já filtrada.
 */
function Lista<T extends Contagem>({
  titulo,
  itens,
  rotular,
  vazio,
  nota,
  href,
}: {
  titulo: string;
  itens: T[];
  rotular?: (r: string) => string;
  vazio: string;
  /** Ressalva que o número sozinho esconderia (base, não informados). */
  nota?: string;
  href?: (item: T) => string;
}) {
  const maior = Math.max(...itens.map((i) => i.total), 1);
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {itens.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {itens.slice(0, 8).map((i) => {
            const conteudo = (
              <>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">{rotular ? rotular(i.rotulo) : i.rotulo}</span>
                  <span className="shrink-0 font-medium tabular-nums">{i.total}</span>
                </div>
                <div className="mt-0.5 h-1 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{ width: `${(i.total / maior) * 100}%` }}
                  />
                </div>
              </>
            );
            const destino = href?.(i);
            const chave = (i as Contagem & { chave?: string }).chave ?? i.rotulo;
            return (
              <li key={chave}>
                {destino ? (
                  <Link href={destino} className="-mx-1.5 block rounded px-1.5 py-1 transition hover:bg-muted/60">
                    {conteudo}
                  </Link>
                ) : (
                  <div className="py-1">{conteudo}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {nota && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{nota}</p>}
    </Card>
  );
}

/**
 * O QUE VAI NO PDF — o período, de quem, as seções (incluir e detalhar) e como
 * sai: com gráficos, comparado com o período anterior, com título e observação.
 *
 * O resumo sempre entra. Seções, período e opções ficam guardados no navegador:
 * quem gera o PDF da diretoria todo mês não remarca tudo. Título e observação
 * não ficam.
 */
function EscolherPdf({
  relatorio, rotulos, de, ate, foco, pessoas, emitidoPor, onFechar,
}: {
  relatorio: Relatorio;
  rotulos: RotulosDoPdf;
  de: string;
  ate: string;
  foco: string;
  pessoas: { id: string; nome: string }[];
  emitidoPor: string;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [escolhas, setEscolhas] = useState<EscolhasDoPdf>(() => lerEscolhas());
  const [opcoes] = useState(() => lerOpcoes());
  const [preset, setPreset] = useState<PresetDoPeriodo>(opcoes.preset);
  const [datas, setDatas] = useState<Periodo>({ de, ate });
  const [comparar, setComparar] = useState(opcoes.comparar);
  const [graficos, setGraficos] = useState(opcoes.graficos);
  const [recorte, setRecorte] = useState(foco);
  const [titulo, setTitulo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [gerando, setGerando] = useState(false);
  const secoes = SECOES_DO_PDF.filter((s) => secaoDisponivel(relatorio, s.chave));
  const pessoal = relatorio.escopo === 'PESSOAL';

  function alternar(chave: SecaoDoPdf, campo: 'incluir' | 'detalhar') {
    setEscolhas((atual) => ({ ...atual, [chave]: { ...atual[chave], [campo]: !atual[chave][campo] } }));
  }

  function voltarAoPadrao() {
    setEscolhas(ESCOLHAS_PADRAO);
    setPreset(OPCOES_PADRAO.preset);
    setComparar(OPCOES_PADRAO.comparar);
    setGraficos(OPCOES_PADRAO.graficos);
  }

  async function gerar() {
    const periodo = periodoDoPreset(preset, hojeComoTexto(new Date()), { de, ate }, datas);
    /* O relatório da tela já está na mão; outro período ou outra pessoa, a API soma de novo. */
    const buscar = (p: Periodo) =>
      p.de === de && p.ate === ate && recorte === foco
        ? Promise.resolve(relatorio)
        : qc.fetchQuery({
            queryKey: ['relatorio', p.de, p.ate, recorte],
            queryFn: () => carregarRelatorio(p.de, p.ate, recorte || undefined),
            staleTime: 60_000,
          });
    setGerando(true);
    try {
      guardarEscolhas(escolhas);
      guardarOpcoes({ preset, comparar, graficos });
      const atual = await buscar(periodo);
      const antes = comparar ? periodoAnterior(periodo, preset) : null;
      const anterior = antes ? { relatorio: await buscar(antes), periodo: antes } : null;
      await gerarPdfDoRelatorio(
        atual,
        escolhas,
        rotulos,
        { ...periodo, emitidoPor, titulo, observacao },
        { graficos, anterior },
      );
      onFechar();
    } catch {
      toast.error('Não foi possível gerar o PDF agora.');
    } finally {
      setGerando(false);
    }
  }

  return (
    <DialogoDoPdf
      titulo="O que vai no PDF"
      subtitulo="O resumo sempre entra. O resto, você escolhe."
      gerando={gerando}
      onFechar={onFechar}
      rodape={
        <>
          <button
            type="button"
            onClick={voltarAoPadrao}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Voltar ao padrão
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={gerando}>
              Cancelar
            </Button>
            <Button
              onClick={gerar}
              disabled={gerando || (preset === 'PERSONALIZADO' && !periodoValido(datas))}
            >
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Gerar PDF
            </Button>
          </div>
        </>
      }
    >
      <EscolhaDoPeriodo
        preset={preset}
        onPreset={setPreset}
        datas={datas}
        onDatas={setDatas}
        tela={{ de, ate }}
        comparar={comparar}
        onComparar={setComparar}
      />

      {/* O recorte de uma pessoa é o mesmo espelho da tela: para conversar com ela, não para pódio. */}
      {!pessoal && pessoas.length > 1 && (
        <ParteDoDialogo titulo="De quem">
          <select value={recorte} onChange={(e) => setRecorte(e.target.value)} className={campoCls}>
            <option value="">Toda a equipe</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </ParteDoDialogo>
      )}

      <ParteDoDialogo titulo="Seções">
        <ul className="divide-y rounded-lg border">
          {secoes.map((s) => {
            const escolha = escolhas[s.chave];
            return (
              <li key={s.chave} className="p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={escolha.incluir}
                    onChange={() => alternar(s.chave, 'incluir')}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{s.resumo}</span>
                  </span>
                </label>
                <label
                  className={cn(
                    'ml-7 mt-2 flex cursor-pointer items-start gap-2 text-xs',
                    !escolha.incluir && 'pointer-events-none opacity-40',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={escolha.incluir && escolha.detalhar}
                    disabled={!escolha.incluir}
                    onChange={() => alternar(s.chave, 'detalhar')}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-700"
                  />
                  <span>
                    <span className="font-medium">Detalhar:</span> {s.detalhe}
                    {s.cuidado && (
                      <span
                        className={cn(
                          'mt-1 block leading-snug',
                          escolha.detalhar
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground',
                        )}
                      >
                        {s.cuidado}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </ParteDoDialogo>

      <ParteDoDialogo titulo="Como sai">
        <Opcao
          marcada={graficos}
          onMudar={setGraficos}
          titulo="Com gráficos"
          texto="Sentenças, ações por ano e contagens em barras. Listas de pessoas continuam em tabela — pessoa não vira barra."
        />
      </ParteDoDialogo>

      <TituloEObservacao
        titulo={titulo}
        onTitulo={setTitulo}
        observacao={observacao}
        onObservacao={setObservacao}
        tituloPadrao={`Relatório do ${tenant.sigla}`}
      />
    </DialogoDoPdf>
  );
}
