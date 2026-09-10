'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Building2, ExternalLink, Gavel, HeartPulse, Landmark, Loader2, Scale, Users, X,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import {
  dinheiroCurto, getMunicipio, numeroBR, percentualBR, periodoRGF, periodoRREO,
  SITUACAO_FISCAL, type MunicipioLinha,
} from '@/lib/municipios';

/**
 * A FICHA DO MUNICÍPIO — o que se precisa saber antes de sentar à mesa.
 *
 * Três blocos, nesta ordem, porque é a ordem das perguntas reais:
 *
 *  1. PODE CONCEDER AUMENTO? A resposta é a Lei de Responsabilidade Fiscal, e
 *     ela vem primeiro porque é a alegação que a prefeitura faz antes de
 *     qualquer outra. O medidor mostra os TRÊS limites — alerta, prudencial e
 *     teto —, porque a consequência de cada um é diferente e quem negocia
 *     precisa saber em qual deles o município está.
 *
 *  2. QUANTO VAI PARA A SAÚDE. Um sindicato da enfermagem tem interesse direto
 *     nessa fatia, e o valor por habitante é o que permite comparar Teresina
 *     com Joca Marques.
 *
 *  3. O QUE TEMOS ALI. Filiados, organizações e processos daquele município —
 *     é o que transforma um número público em assunto do sindicato.
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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['municipio', municipio.codigo],
    queryFn: () => getMunicipio(municipio.codigo),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onFechar}
      role="presentation"
    >
      <div
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
              {!ehEstado && (
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {municipio.uf}
                </span>
              )}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {/* Estado e União não são "código do IBGE" no sentido municipal: o
                  número é o id do ente no SICONFI, e chamá-lo de IBGE seria impreciso. */}
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
            <FalhaAoCarregar erro={error} onTentarDeNovo={refetch} oQue="a ficha do município" />
          </div>
        ) : !data ? null : (
          <div className="space-y-5 p-4">
            {/* -------------------------------------- 1. pode dar aumento? */}
            <Secao titulo="Despesa com pessoal" icone={Scale}>
              <MedidorFiscal d={data} />
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                {data.fiscal.explicacao}
              </p>
              {data.fiscal.percentualRcl != null && data.fiscal.situacao !== 'INCONSISTENTE' && (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Numero rotulo="Folha (12 meses)" valor={dinheiroCurto(data.fiscal.despesaPessoal)} />
                  <Numero
                    rotulo="Receita corrente líquida"
                    valor={dinheiroCurto(data.fiscal.receitaCorrenteLiquida)}
                  />
                </dl>
              )}
              {data.seriePessoal.length > 1 && (
                <div className="mt-3 border-t pt-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Quadrimestres anteriores
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {data.seriePessoal.slice(1, 6).map((i) => (
                      <li
                        key={`${i.exercicio}-${i.quadrimestre}`}
                        className={cn(
                          'rounded-md px-1.5 py-1 text-[11px] tabular-nums',
                          SITUACAO_FISCAL[i.situacao].cor,
                        )}
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
                <p className="text-sm text-muted-foreground">
                  O município não publicou o Relatório Resumido da Execução Orçamentária no período
                  consultado.
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
                    <Numero rotulo="Gasto em saúde" valor={dinheiroCurto(data.saude.despesaLiquidada)} />
                    {data.saudePorHabitante != null && (
                      <Numero
                        rotulo="Por habitante"
                        valor={`R$ ${numeroBR(data.saudePorHabitante, 2)}`}
                      />
                    )}
                  </dl>
                  {/*
                    ESTA RESSALVA NÃO É RODAPÉ JURÍDICO — é o que impede alguém de
                    ir para uma negociação afirmando algo que a outra parte
                    desmente em trinta segundos. A fatia da despesa na função
                    Saúde e o mínimo constitucional de 15% têm bases diferentes.
                  */}
                  <p className="mt-2.5 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                    É a fatia da despesa total que caiu na função Saúde.{' '}
                    <strong className="font-semibold">Não é o mínimo constitucional de 15%</strong>,
                    que é calculado sobre a receita de impostos e sai em outro anexo, não publicado
                    nesta API.
                  </p>
                </>
              )}
            </Secao>

            {/* ------------------------------- 3. o sindicato neste município */}
            <Secao
              titulo={ehEstado ? `O sindicato no ${data.nome}` : `O sindicato em ${data.nome}`}
              icone={Users}
            >
              <div className="grid grid-cols-3 gap-2">
                <Kpi
                  icone={Users}
                  n={data.vinculos.filiados}
                  rotulo="filiados"
                  /*
                    O LINK SÓ FAZ SENTIDO PARA MUNICÍPIO: o filtro de Filiados é
                    por cidade, e "Piauí" não é cidade de ninguém. Para o Estado
                    o número continua aparecendo, sem virar um clique que levaria
                    a uma lista vazia.
                  */
                  href={ehMunicipio ? `/filiados?cidade=${encodeURIComponent(data.nome)}` : undefined}
                />
                <Kpi icone={Building2} n={data.vinculos.organizacoes} rotulo="organizações" />
                <Kpi icone={Gavel} n={data.vinculos.processos} rotulo="processos" />
              </div>

              {data.organizacoes.length > 0 && (
                <ul className="mt-3 divide-y rounded-lg border">
                  {data.organizacoes.map((o) => (
                    <li key={o.id} className="flex items-center gap-2 px-2.5 py-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {o.nomeFantasia || o.nome}
                      </span>
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
                O CONTADOR DE PROCESSOS conta o que TRAMITA naquela comarca, e
                isso não é o mesmo que "processos contra aquela prefeitura". O
                DataJud grava o município do ÓRGÃO JULGADOR: medido na produção,
                a ação contra o Município de Ilha Grande tramita em Parnaíba, e
                a contra Coronel José Dias em São Raimundo Nonato. Escrever isso
                aqui é mais barato que deixar alguém concluir errado.
              */}
              {data.contagemPorUF ? (
                /*
                  NO ESTADO, OS NÚMEROS SÃO DA UF INTEIRA — e a tela tem de dizer,
                  senão alguém somaria estes com os dos municípios e contaria o
                  mesmo filiado duas vezes. Contar de outro jeito também não
                  serviria: filiado se liga a município, e a ficha do Governo do
                  Piauí mostraria "0 filiados" havendo 2.639 só em Teresina.
                */
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Filiados e processos de <strong className="font-semibold">todo o estado</strong>;
                  organizações são só as que o Estado responde diretamente.
                </p>
              ) : (
                data.vinculos.processos > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Processos que <strong className="font-semibold">tramitam</strong> nesta comarca
                    — a parte contrária pode ser de outro município.
                  </p>
                )
              )}
            </Secao>

            <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
              Fontes: {data.fonte.catalogo}; {data.fonte.indicadores}.{' '}
              <Link
                href={`https://siconfi.tesouro.gov.br/siconfi/pages/public/consulta_finbra/finbraList.jsf`}
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
 * O MEDIDOR — a posição do município entre os três limites da LRF.
 *
 * A escala vai até o teto, e não até 100%: o que importa é a distância para o
 * limite, não para um número redondo. Uma barra 0–100 esmagaria toda a faixa
 * útil (43% a 56%) no meio e deixaria metade do desenho vazio.
 */
function MedidorFiscal({
  d,
}: {
  d: {
    fiscal: {
      situacao: keyof typeof SITUACAO_FISCAL;
      percentualRcl?: number | null;
      limiteMaximo?: number | null;
      limitePrudencial?: number | null;
      limiteAlerta?: number | null;
      exercicio?: number;
      quadrimestre?: number;
    };
  };
}) {
  const f = d.fiscal;
  const est = SITUACAO_FISCAL[f.situacao];

  if (f.percentualRcl == null) {
    return (
      <span className={cn('inline-block rounded-full px-2 py-1 text-xs font-semibold', est.cor)}>
        {est.rotulo}
      </span>
    );
  }

  /* Declaração impossível não ganha medidor: medir um número inválido o legitima. */
  if (f.situacao === 'INCONSISTENTE') {
    return (
      <div className="rounded-lg border border-dashed p-3">
        <span className={cn('inline-block rounded-full px-2 py-1 text-xs font-semibold', est.cor)}>
          {est.rotulo}
        </span>
        <p className="mt-2 text-sm">
          O município declarou{' '}
          <strong className="tabular-nums">{percentualBR(f.percentualRcl)}</strong> da receita em
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
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', est.cor)}>
          {est.rotulo}
        </span>
        <span className="text-xs text-muted-foreground">
          {periodoRGF(f.exercicio, f.quadrimestre)}
        </span>
      </div>

      <div className="relative mt-3 h-3 w-full rounded-full bg-muted">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', est.ponto)}
          style={{ width: pos(f.percentualRcl) }}
        />
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

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5">
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="font-semibold tabular-nums">{valor}</dd>
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
      <span className="text-xl font-semibold tabular-nums">{n}</span>
      <span className="text-[11px] text-muted-foreground">{rotulo}</span>
    </>
  );
  const classe =
    'flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-center transition';
  /* Zero não vira link: clicar para chegar numa lista vazia é um passo perdido. */
  return href && n > 0 ? (
    <Link href={href} className={cn(classe, 'hover:bg-muted/50')}>
      {corpo}
    </Link>
  ) : (
    <div className={classe}>{corpo}</div>
  );
}
