'use client';

import { useMemo, useState } from 'react';
import { formatDataPura } from '@/lib/data-pura';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, ChevronDown, ExternalLink, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatData } from '@/lib/agenda';
import { MOTIVO_SEM_TAREFA } from '@/lib/djen';
import type { GrupoDePublicacoes } from '@/lib/publicacoes-irmas';
import { listarAdvogadosDisponiveis, type AdvogadoDisponivel } from '@/lib/processos';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { separarTimbre } from '@/lib/timbre-do-tribunal';

/**
 * O cartão de UMA publicação do DJEN — o mesmo na gaveta da atividade e na aba
 * do processo, para que o advogado leia a mesma coisa do mesmo jeito nos dois
 * lugares.
 *
 * Duas decisões de tela, as duas por medição:
 *
 * 1. O TEOR VEM DOBRADO. A maior publicação da produção tem 22.380 caracteres
 *    — um acórdão inteiro. Aberto, ele empurra o resto da gaveta para fora da
 *    tela e, no celular, vira rolagem infinita. Fica em seis linhas com "Ler
 *    tudo"; quem precisa do inteiro teor abre.
 * 2. AS CÓPIAS VIRAM UMA LINHA. Ver `publicacoes-irmas.ts`.
 */

export interface PublicacaoExibivel {
  id: string;
  texto: string;
  dataDisponibilizacao: string;
  link?: string | null;
  tipoComunicacao?: string | null;
  nomeOrgao?: string | null;
  prazoMencionadoDias?: number | null;
  /** POR QUE o robô não criou tarefa — `NOTICIA_VELHA`, `ORDEM_DA_OUTRA_PARTE`. */
  tarefaDispensadaMotivo?: string | null;
  /** A ordem do ato é nossa? Calculado na leitura; `null` = indefinido. */
  ordemEhNossa?: boolean | null;
  compromissoId?: string | null;
  advogados?: { nome: string | null; numeroOab: string | null; ufOab: string | null }[] | null;
  /** Quem o tribunal intimou, com o polo — vem dentro da própria publicação. */
  destinatarios?: { nome: string | null; polo: string | null }[] | null;
  /** As partes principais do processo, para o confronto "Autor × Réu". */
  partesDoProcesso?: { nome: string; polo: string }[] | null;
}

/** O DJEN manda 'A' para ativo e 'P' para passivo. */
const POLO_LABEL: Record<string, string> = {
  A: 'polo ativo', ATIVO: 'polo ativo',
  P: 'polo passivo', PASSIVO: 'polo passivo',
  T: 'terceiro', TERCEIRO: 'terceiro',
};

/**
 * "Fulano × Município" e "Intimado: SENATEPI (polo ativo)".
 *
 * Fica em UMA linha cada, truncando: quem está varrendo a lista precisa
 * reconhecer, não ler por extenso — o nome inteiro está a um clique, na ficha
 * do processo.
 */
function IdentificacaoDoCaso({ pub }: { pub: PublicacaoExibivel }) {
  const partes = pub.partesDoProcesso ?? [];
  const autor = partes.find((x) => x.polo === 'ATIVO')?.nome;
  const reu = partes.find((x) => x.polo === 'PASSIVO')?.nome;

  /*
    O ATO COSTUMA TER MAIS DE UM DESTINATÁRIO — o tribunal intima os dois lados
    no mesmo despacho. Cabem dois nomes na linha; o resto vira contagem, porque
    cortar em silêncio faria a tela afirmar que só duas pessoas foram intimadas.
  */
  const todos = (pub.destinatarios ?? []).filter((d) => d.nome);

  /*
    A MESMA INFORMAÇÃO DUAS VEZES OCUPAVA DUAS LINHAS.

    A linha de baixo enumerava "Intimado: Instituto Saúde e Cidadania - Isac
    (polo passivo), Sindicato dos Enfermeiros, Auxiliares e Técnicos Em
    Enfermagem do Estado do Piauí - Senatepi (polo ativo)" — os MESMOS dois
    nomes da linha de cima, em outra grafia, truncados no meio. Duas linhas para
    dizer o que uma já dizia.

    Medido nas 1.420 publicações: 92% intimam os DOIS polos. Nesses casos a
    enumeração não informa nada — "os dois lados" informa igual e cabe. Casar
    por NOME não servia: só 1% dos destinatários bate com o nome do cadastro,
    porque o tribunal escreve de outro jeito (é o mesmo motivo de a detecção de
    ação nossa ser pela sigla). O POLO é confiável.

    A minoria é o caso que importa: quando o tribunal intimou UM lado só, isso
    muda a leitura do ato — e aí o nome aparece.
  */
  const polos = new Set(todos.map((d) => (d.polo ?? '').trim().toUpperCase()));
  const dosDoisLados = polos.has('A') && polos.has('P');
  const resumoDosIntimados = !todos.length
    ? null
    : dosDoisLados
      ? `Intimados: os dois lados${polos.has('T') ? ' e terceiro' : ''}`
      : `Intimado: ${todos
          .slice(0, 2)
          .map((d) => capitalizar(d.nome as string))
          .join(', ')}${todos.length > 2 ? ` e mais ${todos.length - 2}` : ''}${
          polos.size === 1 && POLO_LABEL[[...polos][0]]
            ? ` (${POLO_LABEL[[...polos][0]]})`
            : ''
        }`;

  if (!autor && !reu && !todos.length) return null;

  return (
    <div className="mb-1.5 space-y-0.5">
      {(autor || reu) && (
        <p className="truncate text-[11px] font-medium">
          <span className="text-foreground">{autor ? capitalizar(autor) : 'Autor não cadastrado'}</span>
          <span className="mx-1 text-muted-foreground">×</span>
          <span className="text-foreground">{reu ? capitalizar(reu) : 'Réu não cadastrado'}</span>
        </p>
      )}
      {resumoDosIntimados && (
        <p className="truncate text-[11px] text-muted-foreground">{resumoDosIntimados}</p>
      )}
    </div>
  );
}

/** Nome próprio em CAIXA ALTA cansa de ler; o tribunal manda tudo assim. */
function capitalizar(nome: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1),
    )
    .join(' ');
}

/**
 * QUAL DOS NOSSOS ADVOGADOS FOI INTIMADO — pelo rosto, antes da leitura.
 *
 * A publicação traz de quatro a oito advogados, e quase todos são da outra
 * parte. Os nossos estavam a um clique de distância, dentro de uma lista
 * fechada de nomes em caixa alta — para descobrir se a intimação era da Dra.
 * Shérad ou do Dr. Murilo era preciso abrir e ler. Numa lista de 1.408 atos
 * isso é o trabalho inteiro.
 *
 * O CASAMENTO É PELA OAB, NUNCA PELO NOME. O DJEN manda "ICARO SOL ALMONDES
 * SANTOS" e o cadastro tem "Ícaro Sol Almondes Santos": casar por texto perderia
 * todo mundo com acento e ainda arriscaria confundir homônimos. Número + UF é
 * exato. Medido em 07/09/2026: **1.381 das 1.408 publicações** têm um advogado
 * nosso identificado assim, e os oito do quadro têm foto.
 */
const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** Chave de casamento: "PI-9226". */
const chaveOab = (numero: string | null | undefined, uf: string | null | undefined) =>
  `${(uf ?? '').trim().toUpperCase()}-${soDigitos(numero)}`;

function RostosDosNossos({
  advogados,
}: {
  advogados: { nome: string | null; numeroOab: string | null; ufOab: string | null }[];
}) {
  /*
    A MESMA CHAVE DE CACHE do painel de filtros: o React Query serve as duas
    telas com UMA requisição, mesmo com dezenas destes cartões na página.
  */
  const equipe = useQuery({
    queryKey: ['processos', 'advogados-disponiveis'],
    queryFn: listarAdvogadosDisponiveis,
    staleTime: 5 * 60_000,
  });

  const nossos = useMemo(() => {
    const porOab = new Map<string, AdvogadoDisponivel>();
    for (const a of equipe.data ?? []) {
      if (a.oab) porOab.set(chaveOab(a.oab, a.oabUf), a);
    }
    // `Map` pela OAB também deduplica: o mesmo advogado citado duas vezes na
    // publicação (acontece) não pode virar dois rostos iguais lado a lado.
    const achados = new Map<string, AdvogadoDisponivel>();
    for (const a of advogados) {
      const k = chaveOab(a.numeroOab, a.ufOab);
      const nosso = porOab.get(k);
      if (nosso) achados.set(k, nosso);
    }
    return [...achados.values()];
  }, [equipe.data, advogados]);

  if (!nossos.length) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {/*
        ATÉ TRÊS ROSTOS, e o resto vira contagem. Mais que isso empurra a data
        para fora da linha no celular — e três já cobre todos os casos reais:
        o máximo medido no acervo é dois advogados nossos na mesma publicação.
      */}
      <span className="flex -space-x-1.5">
        {nossos.slice(0, 3).map((a) => (
          <AvatarPessoa
            key={a.id}
            nome={a.nomeExibicao || a.nome}
            url={a.avatarUrl}
            titulo={`${a.nome} — OAB ${a.oab}/${a.oabUf ?? ''}`}
            tamanho="xs"
            className="ring-2 ring-indigo-50 dark:ring-indigo-950"
          />
        ))}
      </span>
      {/*
        O NOME SÓ QUANDO É UM. Com dois rostos o nome de um só mentiria por
        omissão, e os dois não cabem; aí o rosto basta e a lista completa
        continua no expansor abaixo.
      */}
      {nossos.length === 1 ? (
        <span className="hidden truncate text-[11px] font-medium text-muted-foreground sm:inline">
          {nossos[0].nomeExibicao || nossos[0].nome}
        </span>
      ) : (
        <span className="text-[11px] font-medium text-muted-foreground">
          {nossos.length > 3 ? `+${nossos.length - 3}` : null}
        </span>
      )}
    </span>
  );
}

export function PublicacaoDjenCard({
  grupo,
  rotulo,
  chips,
  acoes,
  destacada,
  como: Tag = 'div',
  className,
}: {
  grupo: GrupoDePublicacoes<PublicacaoExibivel>;
  /**
   * Rótulo antes dos selos. A gaveta da atividade usa ("Teor da publicação"),
   * porque ali o texto do tribunal aparece dentro de uma TAREFA e precisa se
   * apresentar; a aba Publicações não usa, porque seria dizer o óbvio.
   */
  rotulo?: string;
  /** Selos extras da tela (providência, tribunal), ao lado do tipo. */
  chips?: React.ReactNode;
  /** Links de navegação que variam por tela (ver no processo, ver andamento). */
  acoes?: React.ReactNode;
  /** Id da publicação que a navegação está apontando — cópia também vale. */
  destacada?: string | null;
  como?: 'div' | 'li';
  className?: string;
}) {
  const [inteiro, setInteiro] = useState(false);
  const [verAdvogados, setVerAdvogados] = useState(false);
  const pub = grupo.principal;
  const copias = grupo.copias.length;
  const advogados = (pub.advogados ?? []).filter((a) => a.nome);
  const apontada =
    !!destacada && (destacada === pub.id || grupo.copias.some((c) => c.id === destacada));

  /*
    O TIMBRE DO TRIBUNAL SAI DO RESUMO.

    Medido nas 1.420 publicações da produção: 1.185 (83%) começam com o mesmo
    cabeçalho institucional — "PODER JUDICIÁRIO … TRIBUNAL … VARA … AUTOR: …
    RÉU: …" — de 302 caracteres em média. O cartão mostra ~600 antes do "Ler
    tudo", então METADE do que se lia numa lista de 1.420 atos era órgão,
    número e partes que este mesmo cartão já exibe acima, estruturado e com os
    nomes capitalizados.

    Ele não é jogado fora: "Ler tudo" mostra o documento inteiro, timbre
    incluído, porque é o texto oficial e alguém pode precisar conferir a vara.
  */
  const { timbre, corpo } = useMemo(() => separarTimbre(pub.texto), [pub.texto]);
  const textoVisivel = inteiro ? pub.texto : corpo;

  // Seis linhas cabem sem empurrar o resto da tela; ~90 caracteres por linha
  // no desktop, menos no celular — por isso o corte é generoso. Mede o CORPO:
  // com o timbre fora, um ato de 700 caracteres pode caber sem "Ler tudo".
  const longo = corpo.length > 600 || !!timbre;

  return (
    <Tag
      id={`pub-${pub.id}`}
      className={cn(
        'rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 transition-colors dark:border-indigo-900/40 dark:bg-indigo-950/10',
        apontada && 'bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-950/30',
        className,
      )}
    >
      {/*
        Âncoras das CÓPIAS. Vir de outra tela apontando para a cópia (é o id que
        o andamento guarda) tem de chegar ao cartão que a contém, e não a um
        elemento que o agrupamento removeu do DOM.
      */}
      {grupo.copias.map((c) => (
        <span key={c.id} id={`pub-${c.id}`} aria-hidden className="block h-0" />
      ))}

      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {rotulo && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {rotulo}
            </span>
          )}
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
            {pub.tipoComunicacao ?? 'Publicação'}
          </span>
          {chips}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {/*
            O ROSTO ANTES DA DATA, na mesma linha do topo: é por esta coluna que
            o olho desce quando a pessoa procura "as minhas publicações".
          */}
          <RostosDosNossos advogados={advogados} />
          {/*
            QUÃO RECENTE, e a data por baixo.

            Numa lista de 1.420 atos a pergunta é "isto é de ontem ou de
            março?", e "03/09/2026" obriga a fazer a subtração de cabeça, uma
            vez por cartão. O relativo responde de imediato; a data exata
            continua ali no `title` e, no desktop, ao lado — porque para citar
            num pedido o que serve é ela.

            Para de contar em 60 dias: "há 214 dias" não é mais informação que
            "12/02/2026", é menos.
          */}
          <span
            className="whitespace-nowrap text-xs text-muted-foreground"
            title={formatDataPura(pub.dataDisponibilizacao)}
          >
            {quandoSaiu(pub.dataDisponibilizacao)}
          </span>
        </span>
      </div>

      {pub.nomeOrgao && (
        <p className="mb-1 text-[11px] text-muted-foreground">{pub.nomeOrgao}</p>
      )}

      {/*
        DE QUEM É ESTE PROCESSO — antes da parede de texto.

        A lista mostrava tipo, tribunal, órgão e o teor. Para reconhecer o caso
        era preciso LER o cabeçalho do acórdão, e são 984 atos no acervo. O
        confronto vem do cadastro de partes (curado) e o "intimado" vem da
        própria publicação, que é quem sabe a quem o tribunal se dirigiu — não
        são a mesma informação: numa intimação de recurso o intimado somos nós,
        mesmo sendo o autor.
      */}
      <IdentificacaoDoCaso pub={pub} />

      <div className="relative">
        <p
          className={cn(
            'whitespace-pre-wrap break-words text-sm leading-snug',
            longo && !inteiro && 'line-clamp-6',
          )}
        >
          {textoVisivel}
        </p>
        {longo && !inteiro && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-indigo-50/90 to-transparent dark:from-indigo-950/30"
          />
        )}
      </div>
      {longo && (
        <button
          type="button"
          onClick={() => setInteiro((v) => !v)}
          className="mt-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
        >
          {/*
            O NÚMERO DE CARACTERES SAIU DAQUI.

            Já foi "Ler tudo (822 caracteres)", que se lia como "há mais 822";
            depois "(822 no total)", que consertava a frase e não o problema —
            ninguém decide abrir um documento pelo tamanho dele. Agora o botão
            diz O QUE está escondido, e só passou a haver o que dizer porque o
            resumo perdeu o timbre do tribunal.
          */}
          {inteiro
            ? 'Recolher'
            : timbre
              ? /*
                  DIZ O QUE ESTÁ ESCONDIDO, e não quantos caracteres tem.

                  "Ler tudo (2.476 caracteres no total)" é uma métrica de
                  desenvolvedor: ninguém decide abrir um documento por causa do
                  tamanho dele. Com o timbre fora, dá para dizer o que falta em
                  português — o cabeçalho do tribunal e o resto do ato.
                */
                'Ler o documento inteiro, com o cabeçalho do tribunal'
              : 'Ler o documento inteiro'}
        </button>
      )}

      {/*
        O prazo é o que o TEXTO diz — não um vencimento calculado. A contagem
        oficial depende de dias úteis forenses, feriado da comarca e forma de
        intimação, e o sistema não os conhece.
      */}
      {/*
        DE QUEM É O PRAZO — a pergunta que faltava.

        O aviso dizia "o texto menciona prazo de 15 dias" e parava aí. Só que o
        tribunal publica o MESMO ato para todos os intimados, e a ordem costuma
        ser de um lado só: no 0000978-59.2022.5.22.0004 o teor manda a
        RECLAMADA recolher em 15 dias, e o robô criou "Elaborar manifestação"
        na agenda de um advogado nosso. Cinco das quatorze tarefas que ele criou
        já tinham sido canceladas à mão.

        Quando o robô conclui que a ordem é da outra parte, o aviso muda de cor
        e de frase: continua informando o prazo (saber que o adversário tem 15
        dias é útil), mas para de sugerir que alguém aqui precisa agir.
      */}
      {pub.prazoMencionadoDias != null &&
        (/*
          O CAMPO CALCULADO MANDA; o carimbo do robô é reforço.

          `tarefaDispensadaMotivo` só existe nas publicações que o robô
          processou DEPOIS da regra. As 1.433 do acervo vieram antes, e
          carimbá-las agora reescreveria a decisão dele. `ordemEhNossa` é
          derivado na leitura e vale para todas.
        */
        pub.ordemEhNossa === false || pub.tarefaDispensadaMotivo === 'ORDEM_DA_OUTRA_PARTE' ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-slate-100 px-2 py-1.5 text-[11px] leading-snug text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <Bot className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              Prazo de <strong>{pub.prazoMencionadoDias} dias</strong> dirigido à{' '}
              <strong>parte contrária</strong> — nenhuma tarefa foi criada. Se discordar, crie a
              atividade à mão na Agenda.
            </span>
          </p>
        ) : (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              O texto menciona prazo de <strong>{pub.prazoMencionadoDias} dias</strong>. Confira a
              contagem oficial — o sistema não calcula vencimento.
            </span>
          </p>
        ))}

      {/*
        E quando NÃO há prazo no texto, a ausência de tarefa continua precisando
        de explicação — "sem tarefa" calado se lê como falha da automação.
      */}
      {pub.prazoMencionadoDias == null &&
        !pub.compromissoId &&
        pub.tarefaDispensadaMotivo &&
        MOTIVO_SEM_TAREFA[pub.tarefaDispensadaMotivo] && (
          <p
            className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
            title={MOTIVO_SEM_TAREFA[pub.tarefaDispensadaMotivo].ajuda}
          >
            <Bot className="mt-px h-3.5 w-3.5 shrink-0 opacity-60" />
            <span>Sem tarefa · {MOTIVO_SEM_TAREFA[pub.tarefaDispensadaMotivo].curto}</span>
          </p>
        )}

      {(copias > 0 || advogados.length > 0) && (
        <div className="mt-2 border-t border-indigo-200/70 pt-2 dark:border-indigo-900/40">
          <button
            type="button"
            onClick={() => setVerAdvogados((v) => !v)}
            disabled={!advogados.length}
            className="flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground disabled:cursor-default"
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              {copias > 0 ? (
                <>
                  Mesma publicação, enviada a <strong>{copias + 1} destinatários</strong>
                </>
              ) : (
                <>
                  <strong>{advogados.length}</strong>{' '}
                  {advogados.length === 1 ? 'advogado intimado' : 'advogados intimados'}
                </>
              )}
            </span>
            {advogados.length > 0 && (
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform', verAdvogados && 'rotate-180')}
              />
            )}
          </button>
          {verAdvogados && advogados.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {advogados.map((a, i) => (
                <li key={`${a.numeroOab}-${i}`} className="text-[11px] leading-snug text-muted-foreground">
                  {capitalizar(a.nome ?? '')}
                  {a.numeroOab && (
                    <span className="text-muted-foreground/70">
                      {' '}
                      · OAB {a.numeroOab}
                      {a.ufOab ? `/${a.ufOab}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {acoes}
        {pub.link && (
          <a
            href={pub.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
          >
            <ExternalLink className="h-3 w-3" /> Documento no tribunal
          </a>
        )}
      </div>
    </Tag>
  );
}

/**
 * "ontem", "há 4 dias", ou a data quando já é história.
 *
 * `dataDisponibilizacao` é coluna DATE: chega como meia-noite UTC. Contar por
 * milissegundo contra `Date.now()` faria a publicação de hoje aparecer como
 * "há 0 dias" à tarde e "ontem" à noite — o mesmo erro de fuso que já mordeu o
 * robô de cobranças. Compara-se DIA de calendário com DIA de calendário.
 */
function quandoSaiu(iso: string): string {
  const dia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const publicada = new Date(iso);
  const agoraBR = new Date(Date.now() - 3 * 3_600_000);
  const dias = Math.round((dia(agoraBR) - dia(publicada)) / 86_400_000);

  /*
    A CONTA acima já estava certa (`getUTC*` dos dois lados). Os FALLBACKS não:
    caíam em `formatData`, que constrói o instante e escorrega um dia para trás
    num fuso negativo. Só apareciam na data futura e na publicação com mais de
    60 dias — os dois cantos que ninguém olha.
  */
  if (dias < 0) return formatDataPura(iso); // data futura: mostra o que veio
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias <= 60) return `há ${dias} dias`;
  return formatDataPura(iso);
}
