'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2, ExternalLink, FileDown, Gavel, HeartPulse, Landmark, Loader2, RefreshCw, Scale, Users, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar, podeVer } from '@/lib/permissoes';
import { baixarPdf } from '@/lib/pdf';
import { Button } from '@/components/ui/button';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import {
  acumuladoAte, dinheiroCurto, getMunicipio, numeroBR, percentualBR, periodoRGF, periodoRREO,
  presencaDe, sincronizarSiconfi, SITUACAO_FISCAL,
  type Folga, type MunicipioDetalhe, type MunicipioLinha,
} from '@/lib/municipios';

/**
 * A FICHA DO ENTE — o que se precisa saber antes de sentar à mesa.
 *
 * Três blocos, nesta ordem, porque é a ordem das perguntas reais:
 *
 *  1. A LEI DEIXA DAR AUMENTO? A resposta é a Lei de Responsabilidade Fiscal,
 *     e vem primeiro porque é a alegação que a prefeitura faz antes de qualquer
 *     outra. Junto: QUANTO CABE até o limite prudencial, e como o ente está
 *     perto dos vizinhos.
 *  2. QUANTO VAI PARA A SAÚDE — interesse direto de um sindicato da saúde.
 *  3. NOSSA PRESENÇA — quem mora, quem trabalha para ele, e as ações contra
 *     ele. Cada número abre a lista.
 *
 * Gaveta, e não rota, seguindo Organizações: quem está varrendo uma lista quer
 * abrir, olhar e voltar sem perder a posição nem os filtros.
 */
export function MunicipioDrawer({
  municipio,
  onFechar,
}: {
  municipio: MunicipioLinha;
  onFechar: () => void;
}) {
  const ehEstado = municipio.esfera === 'E';
  const ehMunicipio = municipio.esfera === 'M';
  /**
   * COMO SE REFERIR A ESTE ENTE numa frase. A ficha do Governo do Piauí dizia
   * "O município não publicou o Relatório de Gestão Fiscal" — duas coisas
   * erradas de uma vez: ele não é município e tinha publicado 37,00%.
   */
  const comoChamar = ehMunicipio ? 'O município' : ehEstado ? 'O Estado' : 'A União';
  const esteEnte = ehMunicipio ? 'deste município' : ehEstado ? 'deste Estado' : 'da União';
  const nomeCompleto = ehMunicipio
    ? `Prefeitura de ${municipio.nome}`
    : ehEstado
      ? `Governo do Estado — ${municipio.nome}`
      : municipio.nome;

  /*
    OS LINKS RESPEITAM A MATRIZ DE CADA MÓDULO. A Triagem vê Contas Públicas
    mas não vê Processos: um "8 ações contra" clicável a levaria a uma tela de
    acesso negado. O número continua; só deixa de ser porta.
  */
  const { user } = useAuth();
  const podeMexer = podeEditar(user?.role, user?.permissoes, 'municipios');
  const verFiliados = podeVer(user?.role, user?.permissoes, 'filiados');
  const verProcessos = podeVer(user?.role, user?.permissoes, 'processos');
  const qc = useQueryClient();
  const [baixando, setBaixando] = useState(false);
  const [buscando, setBuscando] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['municipio', municipio.codigo],
    queryFn: () => getMunicipio(municipio.codigo),
  });

  /* Esc fecha, como em toda gaveta do sistema — sem isso, teclado fica preso. */
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar]);

  async function baixarFicha() {
    setBaixando(true);
    try {
      await baixarPdf(`/municipios/${municipio.codigo}/ficha.pdf`, `ficha-de-negociacao-${municipio.codigo}.pdf`);
    } catch {
      toast.error('Não foi possível gerar a ficha.');
    } finally {
      setBaixando(false);
    }
  }

  /*
    UM ENTE SÓ, NA HORA. Quem abre Agricolândia e vê "a consultar" não precisa
    esperar a madrugada nem mandar o sistema consultar os 64 de uma vez: são
    dois pedidos ao Tesouro e poucos segundos.
  */
  async function buscarAgora() {
    setBuscando(true);
    try {
      const r = await sincronizarSiconfi([municipio.codigo]);
      toast.success(
        r.comPessoal || r.comSaude
          ? 'Números atualizados com o Tesouro Nacional.'
          : `${comoChamar} não tem relatório publicado no Tesouro para o período.`,
      );
      qc.invalidateQueries({ queryKey: ['municipio', municipio.codigo] });
      qc.invalidateQueries({ queryKey: ['municipios'] });
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível falar com o Tesouro Nacional.');
    } finally {
      setBuscando(false);
    }
  }

  const p = data ? presencaDe(data) : null;
  const enc = encodeURIComponent;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={nomeCompleto}
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---------------------------------------------------- cabeçalho */}
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b bg-card px-4 py-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
            <Landmark className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold leading-tight">
              {ehEstado ? `Governo do Estado — ${municipio.nome}` : municipio.nome}
              {ehMunicipio && (
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">{municipio.uf}</span>
              )}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {/* Estado e União não têm "código IBGE" no sentido municipal: é o id do ente no SICONFI. */}
              {ehMunicipio ? `Código IBGE ${municipio.codigo}` : `Ente ${municipio.codigo}`}
              {data?.regiaoImediata ? ` · Região de ${data.regiaoImediata}` : ''}
              {data?.populacao ? ` · ${numeroBR(data.populacao)} habitantes` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted sm:h-9 sm:w-9"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-brand-800 dark:text-brand-400" />
          </div>
        ) : error ? (
          <div className="p-4">
            <FalhaAoCarregar erro={error} onTentarDeNovo={refetch} oQue="a ficha" />
          </div>
        ) : !data || !p ? null : (
          <div className="space-y-5 p-4">
            {/* --------------------------------------------------- ações */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={baixarFicha}
                disabled={baixando}
                title="Uma página para levar à mesa: a resposta da lei, quanto cabe e como está perto dos vizinhos."
              >
                {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                Ficha para negociação (PDF)
              </Button>
              {podeMexer && (data.fiscal.situacao === 'NAO_CONSULTADO' || data.fiscal.situacao === 'SEM_DADO') && (
                <Button variant="outline" size="sm" onClick={buscarAgora} disabled={buscando}>
                  {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {data.consultadoEm ? 'Consultar o Tesouro de novo' : 'Buscar agora no Tesouro'}
                </Button>
              )}
            </div>

            {/* -------------------------------------- 1. pode dar aumento? */}
            <Secao titulo="A lei deixa dar aumento?" icone={Scale}>
              <MedidorFiscal d={data} />
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{data.fiscal.explicacao}</p>
              {/*
                O CALENDÁRIO MANDA MAIS QUE O PERCENTUAL. No fim do mandato, o
                art. 21 da LRF anula o aumento mesmo dentro do limite — a ficha
                do Governo do Piauí dizia "não há impedimento" em setembro de
                2026, com 37%. A frase e as datas vêm do servidor.
              */}
              {data.calendario && (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs font-medium leading-relaxed text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {data.calendario.texto}
                </p>
              )}
              {data.fiscal.folga && data.fiscal.situacao !== 'INCONSISTENTE' && (
                <CaixaDaFolga folga={data.fiscal.folga} />
              )}
              {data.fiscal.percentualRcl != null && data.fiscal.situacao !== 'INCONSISTENTE' && (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Numero rotulo="Folha (12 meses)" valor={dinheiroCurto(data.fiscal.despesaPessoal)} />
                  <Numero rotulo="Receita corrente líquida" valor={dinheiroCurto(data.fiscal.receitaCorrenteLiquida)} />
                </dl>
              )}
              <Comparacao d={data} />
              {data.seriePessoal.length > 1 && (
                <div className="mt-3 border-t pt-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Quadrimestres anteriores
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {data.seriePessoal.slice(1, 6).map((i) => (
                      <li
                        key={`${i.exercicio}-${i.quadrimestre}`}
                        className={cn('rounded-md px-1.5 py-1 text-[11px] tabular-nums', SITUACAO_FISCAL[i.situacao].cor)}
                      >
                        {i.quadrimestre}º/{String(i.exercicio).slice(2)} · {percentualBR(i.percentualRcl)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Secao>

            {/* -------------------------------------------- 2. saúde */}
            <Secao titulo="Orçamento da saúde" icone={HeartPulse}>
              {!data.saude ? (
                /*
                  DUAS AUSÊNCIAS DIFERENTES. Dizer que um ente não publicou quando
                  ninguém perguntou é acusá-lo de uma falha que é nossa.
                */
                <p className="text-sm text-muted-foreground">
                  {data.consultadoEm
                    ? `${comoChamar} não publicou o Relatório Resumido da Execução Orçamentária no período consultado.`
                    : `Os indicadores ${esteEnte} ainda não foram buscados no Tesouro Nacional.`}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-2xl font-semibold tabular-nums">
                      {percentualBR(data.saude.percentualDespesa)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      da despesa liquidada · {periodoRREO(data.saude.exercicio, data.saude.bimestre)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <Numero
                      rotulo="Gasto em saúde"
                      valor={dinheiroCurto(data.saude.despesaLiquidada)}
                      nota={acumuladoAte(data.saude.exercicio, data.saude.bimestre)}
                    />
                    {data.saudePorHabitante != null && (
                      <Numero
                        rotulo="Por habitante"
                        valor={`R$ ${numeroBR(data.saudePorHabitante, 2)}`}
                        nota={acumuladoAte(data.saude.exercicio, data.saude.bimestre)}
                      />
                    )}
                  </dl>
                  {/*
                    O RREO é acumulado dentro do ano: o 3º bimestre traz seis meses
                    e o 6º traz doze. Sem o aviso, um município medido em junho
                    parece gastar metade de um medido em dezembro.
                  */}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Só compare estes valores em reais entre entes no{' '}
                    <strong className="font-semibold">mesmo bimestre</strong> — o relatório é acumulado no ano.
                    O percentual acima pode ser comparado livremente.
                  </p>
                  {/*
                    ESTA RESSALVA NÃO É RODAPÉ JURÍDICO — é o que impede alguém de
                    ir para uma negociação afirmando algo que a outra parte
                    desmente em trinta segundos.
                  */}
                  <p className="mt-2.5 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                    É a fatia da despesa total que caiu na função Saúde.{' '}
                    <strong className="font-semibold">Não é o mínimo constitucional de 15%</strong>, que é calculado
                    sobre a receita de impostos e sai em outro anexo, não publicado nesta API.
                  </p>
                </>
              )}
            </Secao>

            {/* ----------------------------------------- 3. nossa presença */}
            <Secao titulo="Nossa presença" icone={Users}>
              {data.ligacaoJaRodou === false && (
                <p className="mb-2 rounded-md bg-sky-50 p-2 text-[11px] leading-relaxed text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                  Os cadastros ainda não foram ligados ao catálogo do IBGE, então estes contadores ainda não
                  valem. Use <strong className="font-semibold">Ligar cadastros</strong>, no fim da tela de Contas
                  Públicas.
                </p>
              )}
              {/*
                CADA NÚMERO RESPONDE UMA PERGUNTA, e o rótulo diz qual. Antes eram
                "filiados · organizações · processos", e no Estado isso somava
                quem MORA no Piauí (3.077) e o que TRAMITA em comarca do Piauí
                (114). Quem trabalha para o Estado são 16; o Estado é réu em 8.
              */}
              <div className="grid grid-cols-3 gap-2">
                {ehMunicipio ? (
                  <Kpi
                    icone={Users}
                    n={p.moram}
                    rotulo={p.moram === 1 ? 'mora aqui' : 'moram aqui'}
                    href={
                      verFiliados
                        ? `/filiados?municipio=${data.codigo}&municipioNome=${enc(data.nome)}&situacao=ATIVO`
                        : undefined
                    }
                  />
                ) : (
                  <Kpi icone={Building2} n={p.organizacoes} rotulo={p.organizacoes === 1 ? 'órgão no cadastro' : 'órgãos no cadastro'} />
                )}
                <Kpi
                  icone={Building2}
                  n={p.trabalham}
                  rotulo={
                    ehMunicipio
                      ? p.trabalham === 1 ? 'trabalha na prefeitura' : 'trabalham na prefeitura'
                      : ehEstado
                        ? p.trabalham === 1 ? 'trabalha para o Estado' : 'trabalham para o Estado'
                        : p.trabalham === 1 ? 'trabalha para a União' : 'trabalham para a União'
                  }
                  href={
                    verFiliados
                      ? `/filiados?ente=${data.codigo}&enteNome=${enc(nomeCompleto)}&situacao=ATIVO`
                      : undefined
                  }
                />
                <Kpi
                  icone={Gavel}
                  n={p.acoesContra}
                  rotulo={p.acoesContra === 1 ? 'ação contra' : 'ações contra'}
                  href={verProcessos ? `/processos?enteContra=${data.codigo}&enteNome=${enc(nomeCompleto)}` : undefined}
                />
              </div>

              {/*
                A COMARCA FICA À PARTE, e dita pelo que é: o fórum da cidade. A
                ação contra o Município de Ilha Grande tramita em Parnaíba — contar
                o fórum como presença na prefeitura foi o erro que fez o Estado
                aparecer com 114 processos.
              */}
              {ehMunicipio && p.naComarca > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  À parte: {p.naComarca}{' '}
                  {p.naComarca === 1 ? 'ação do sindicato tramita' : 'ações do sindicato tramitam'} no fórum de{' '}
                  {data.nome}, contra quem quer que seja.{' '}
                  {verProcessos && (
                    <Link
                      href={`/processos?comarca=${data.codigo}&comarcaNome=${enc(data.nome)}`}
                      className="font-medium underline underline-offset-2 hover:text-foreground"
                    >
                      ver essas ações
                    </Link>
                  )}
                </p>
              )}

              {data.organizacoes.length > 0 && (
                <ul className="mt-3 divide-y rounded-lg border">
                  {data.organizacoes.map((o) => (
                    <li key={o.id} className="flex items-center gap-2 px-2.5 py-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{o.nomeFantasia || o.nome}</span>
                      {o.institucional && (
                        <span className="shrink-0 rounded-full bg-brand-800 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          nós
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/*
                O DENOMINADOR. "16 trabalham para o Estado" parece pouco — e é
                pouco por falta de cadastro, não de gente: só 119 dos 7.309
                filiados ativos têm o local de trabalho ligado a uma organização,
                e o HGV ainda não diz que é do Estado. Esconder isso faria o
                número parecer defeito, ou pior, parecer verdade.
              */}
              {data.cobertura && data.cobertura.ativos > 0 && (
                <p className="mt-2.5 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {ehMunicipio && (
                    <>
                      &quot;Moram&quot; conta só quem tem cidade no cadastro —{' '}
                      {numeroBR(data.cobertura.ativos - data.cobertura.semCidade)} de{' '}
                      {numeroBR(data.cobertura.ativos)} filiados ativos.{' '}
                    </>
                  )}
                  &quot;Trabalham&quot; conta quem tem o local de trabalho ligado a um órgão deste governo — hoje
                  só {numeroBR(data.cobertura.comLocalDeTrabalho)} filiados têm o local de trabalho ligado a uma
                  organização do cadastro.
                  {!ehMunicipio && data.orgaosPublicosSemGoverno && data.orgaosPublicosSemGoverno.total > 0 && (
                    <>
                      {' '}
                      {data.orgaosPublicosSemGoverno.exemplos.join(', ')}
                      {data.orgaosPublicosSemGoverno.total > data.orgaosPublicosSemGoverno.exemplos.length
                        ? ' e outros'
                        : ''}{' '}
                      ainda não dizem de qual governo são; quem trabalha lá não entra nesta conta.
                      {podeMexer ? ' Resolva na faixa "Ajude a contar certo", no alto da tela.' : ''}
                    </>
                  )}
                </p>
              )}
            </Secao>

            <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
              Fontes: {data.fonte.catalogo}; {data.fonte.indicadores}.{' '}
              <Link
                href="https://siconfi.tesouro.gov.br/siconfi/pages/public/consulta_finbra/finbraList.jsf"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
              >
                Conferir no Tesouro <ExternalLink className="h-3 w-3" />
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * QUANTO CABE — a pergunta seguinte a "pode?". A folga é medida até o LIMITE
 * PRUDENCIAL, não até o teto: é a partir do prudencial que o aumento fica
 * proibido. A conta é do servidor (`folgaAtePrudencial`); a tela só diz.
 */
function CaixaDaFolga({ folga }: { folga: Folga }) {
  if (folga.valor >= 0) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
        <p>
          A folha pode crescer{' '}
          <strong className="tabular-nums">{numeroBR(folga.percentualDaFolha, 1)}%</strong> antes de chegar ao
          limite prudencial — cerca de <strong>{dinheiroCurto(folga.valor)}</strong> em 12 meses.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Com a receita dos últimos 12 meses. Um reajuste só da categoria pesa bem menos que o da folha
          inteira. É espaço na lei, não dinheiro em caixa.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <p>
        Passou do prudencial: a folha teria de cair{' '}
        <strong className="tabular-nums">{numeroBR(-folga.percentualDaFolha, 1)}%</strong> (
        {dinheiroCurto(-folga.valor)} em 12 meses) para sair da proibição.
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Mesmo assim, a revisão geral anual (art. 37, X, da Constituição) e o que vem de sentença ou de lei
        continuam permitidos.
      </p>
    </div>
  );
}

/**
 * COMO ESTÁ PERTO DOS VIZINHOS. "43,29%" solto na mesa não diz nada; "1,7
 * ponto abaixo da mediana do Piauí" diz que a prefeitura está mais folgada que
 * o município típico do estado. A tela sempre diz com quantos se comparou.
 */
function Comparacao({ d }: { d: MunicipioDetalhe }) {
  const c = d.comparacao;
  const pct = d.fiscal.percentualRcl;
  if (!c?.uf || c.uf.mediana == null || pct == null || d.fiscal.situacao === 'INCONSISTENTE') return null;
  const dif = pct - c.uf.mediana;
  const distancia = Math.abs(dif);
  const lado =
    distancia < 0.05
      ? 'na mediana'
      : `${numeroBR(distancia, 1)} ${distancia >= 1.95 ? 'pontos' : 'ponto'} ${dif < 0 ? 'abaixo' : 'acima'} da mediana`;
  return (
    <div className="mt-3 rounded-lg border px-2.5 py-2 text-xs">
      <p>
        <strong className="font-semibold">{d.nome}</strong> está {lado} dos municípios do {c.uf.uf} (
        {percentualBR(c.uf.mediana)}, {c.uf.n} com dado).
      </p>
      {c.regiao?.mediana != null && (
        <p className="mt-0.5 text-muted-foreground">
          Na região de {c.regiao.nome}: mediana de {percentualBR(c.regiao.mediana)} ({c.regiao.n} municípios).
        </p>
      )}
    </div>
  );
}

/**
 * O MEDIDOR — a posição do ente entre os três limites da LRF.
 *
 * A escala vai até o teto, e não até 100%: o que importa é a distância para o
 * limite. Uma barra 0–100 esmagaria toda a faixa útil (43% a 56%) no meio.
 */
function MedidorFiscal({ d }: { d: MunicipioDetalhe }) {
  const f = d.fiscal;
  const est = SITUACAO_FISCAL[f.situacao];

  if (f.percentualRcl == null) {
    return (
      <span className={cn('inline-block rounded-full px-2 py-1 text-xs font-semibold', est.cor)}>{est.rotulo}</span>
    );
  }

  /* Declaração impossível não ganha medidor: medir um número inválido o legitima. */
  if (f.situacao === 'INCONSISTENTE') {
    return (
      <div className="rounded-lg border border-dashed p-3">
        <span className={cn('inline-block rounded-full px-2 py-1 text-xs font-semibold', est.cor)}>{est.rotulo}</span>
        <p className="mt-2 text-sm">
          Foram declarados <strong className="tabular-nums">{percentualBR(f.percentualRcl)}</strong> da receita em
          folha — mais que a própria receita do período.
        </p>
      </div>
    );
  }

  const teto = f.limiteMaximo ?? 54;
  /* Um pouco de folga acima do teto para o marcador de quem o estourou caber. */
  const escala = Math.max(teto * 1.15, f.percentualRcl * 1.05);
  const pos = (v: number) => `${Math.min(100, (v / escala) * 100)}%`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{percentualBR(f.percentualRcl)}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', est.cor)}>{est.rotulo}</span>
        <span className="text-xs text-muted-foreground">{periodoRGF(f.exercicio, f.quadrimestre)}</span>
      </div>

      <div className="relative mt-3 h-3 w-full rounded-full bg-muted">
        <div className={cn('absolute inset-y-0 left-0 rounded-full', est.ponto)} style={{ width: pos(f.percentualRcl) }} />
        {[
          { v: f.limiteAlerta, rotulo: 'alerta' },
          { v: f.limitePrudencial, rotulo: 'prudencial' },
          { v: f.limiteMaximo, rotulo: 'teto' },
        ]
          .filter((m): m is { v: number; rotulo: string } => m.v != null)
          .map((m) => (
            <span
              key={m.rotulo}
              className="absolute -top-0.5 h-4 w-0.5 bg-foreground/50"
              style={{ left: pos(m.v) }}
              title={`${m.rotulo}: ${percentualBR(m.v)}`}
              aria-hidden
            />
          ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>alerta {percentualBR(f.limiteAlerta)}</span>
        <span>prudencial {percentualBR(f.limitePrudencial)}</span>
        <span>teto {percentualBR(f.limiteMaximo)}</span>
      </div>
    </div>
  );
}

function Secao({
  titulo,
  icone: Icone,
  children,
}: {
  titulo: string;
  icone: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icone className="h-4 w-4 text-muted-foreground" />
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
}: {
  rotulo: string;
  valor: string;
  /** O período do acumulado. Valor em reais sem período convida a comparar errado. */
  nota?: string;
}) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5">
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="font-semibold tabular-nums">{valor}</dd>
      {nota && <dd className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{nota}</dd>}
    </div>
  );
}

function Kpi({
  icone: Icone,
  n,
  rotulo,
  href,
}: {
  icone: typeof Users;
  n: number;
  rotulo: string;
  href?: string;
}) {
  const corpo = (
    <>
      <Icone className="h-4 w-4 text-muted-foreground" />
      <span className="text-xl font-semibold tabular-nums">{numeroBR(n)}</span>
      <span className="text-[11px] leading-tight text-muted-foreground">{rotulo}</span>
    </>
  );
  const classe = 'flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-center transition';
  /* Zero não vira link: clicar para chegar numa lista vazia é um passo perdido. */
  return href && n > 0 ? (
    <Link href={href} className={cn(classe, 'hover:bg-muted/50')}>
      {corpo}
    </Link>
  ) : (
    <div className={classe}>{corpo}</div>
  );
}
