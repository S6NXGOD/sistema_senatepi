import { tenant } from '@/tenant.config';
import { chaveLocal } from './armazenamento';
import { corDasIniciais, iniciaisDe } from './iniciais';
import { PERFIL_LABEL } from './permissoes';
import {
  abrirMedidorDeDocumento, baixarDocumento, type BlocoDoPdf, type CaixaDoPdf, type CapaDoDocumento, type DesenhoDoDocumento,
  type DiaDaGrade, type GradeDoPdf, type LinhaDaCaixa, type MedidorDeDocumento, type Serie,
} from './pdf-documento';
import { CASA, agruparResto, numero, rotulosDosMeses } from './pdf-graficos';
import {
  periodoPorExtenso, presetValido, rotuloCurtoDoPeriodo, rotuloDoPeriodo, rotulosDasColunas,
  type Periodo, type PresetDoPeriodo,
} from './periodo-do-pdf';
import {
  DECIDIDAS_NAO_MEDIDAS, DIAS_PARA_NOTAR_AUSENCIA, GRUPO_DO_PERFIL, LEGENDA_DO_USO, O_QUE_NAO_MEDE, TITULO_DO_BLOCO,
  ausente, blocosDaPessoa, caiNoFimDeSemana, comparaDecididas, dataEHoraEmTeresina, diaEMes, diaEmTeresina,
  diaMesEAno, diasDeSemana, diasMedidosDasDecididas, diasSemAcesso, gruposPorPerfil, medicaoDasDecididas,
  segundaFeiraDe, semanasDosDias, textoDoUltimoAcesso,
  type Bloco, type ChaveDaLegenda, type LinhaDeUso, type MesDeUso, type Produtividade, type SemanaDeUso,
  type TipoConcluido,
} from './produtividade';

/**
 * O PDF DO USO DO SISTEMA — "mensal, anual, personalizado, por advogado".
 * Pedido de 12/09/2026; redesenhado em 14/09/2026 (D19).
 *
 * O MESMO RETRATO DA ABA, NO PAPEL, com as mesmas decisões:
 *
 *  · SEM POSIÇÃO. Por perfil e depois por nome, na ordem da API. O gráfico é
 *    do TEMPO da pessoa (semana a semana ou mês a mês), nunca de gente contra
 *    gente: barra por pessoa é pódio desenhado;
 *  · O AVISO ABRE O DOCUMENTO. O que estes números não medem vem antes de
 *    qualquer número, e não é opção — o papel sai da sala sem quem explicaria;
 *  · DUAS ZONAS COM NOME. "No período" é o que se compara; "Agora" é o
 *    retrato da hora em que o PDF foi gerado, e é o único lugar com âmbar;
 *  · A COMPARAÇÃO É UMA COLUNA, com as datas do período anterior no
 *    cabeçalho e só o número na célula. "antes 0 · +18" era críptico e, para
 *    quem nem tinha conta, falso;
 *  · A LEGENDA É A COLUNA "O QUE CONTA", na linha do próprio número. O
 *    glossário do fim ocupava ~1,3 das 2 folhas do documento de uma pessoa.
 *
 * Com isso o documento de uma pessoa cabe em UMA folha — provado com o jsPDF
 * real para 31 dias, 90 dias e um ano (`paginas-dos-pdfs.spec.ts`).
 *
 * O recorte (um perfil, uma pessoa) é feito aqui, sobre a lista que a API já
 * decidiu que quem emite pode ver.
 */

export type QuemNoPdf = 'TODOS' | `PERFIL:${string}` | `PESSOA:${string}`;

/** O detalhe de cada pessoa, quando o PDF é de um grupo. */
export type DetalheDasPessoas = 'TABELA' | 'PAGINAS' | 'NENHUM';

export interface EscolhasDaProdutividade {
  quem: QuemNoPdf;
  detalhe: DetalheDasPessoas;
  graficos: boolean;
  /**
   * Foto do perfil no topo do documento de uma pessoa ou na página de cada
   * pessoa. Nunca na tabela "uma linha por pessoa" nem em "só os totais":
   * quinze rostos ao lado de números é mural.
   */
  fotos?: boolean;
}

export interface AnteriorDaProdutividade {
  dados: Produtividade;
  periodo: Periodo;
}

/**
 * ATÉ 13 SEMANAS, SEMANA A SEMANA; ACIMA, MÊS A MÊS. Medido em 13–14/09/2026:
 * no máximo 8 concluídas por pessoa por semana — o semanal ainda se lê até
 * um trimestre; num ano, 53 colunas de 0 a 2 viram ruído.
 */
export const SEMANAS_NO_GRAFICO = 13;

/** Quantos tipos de atividade a linha "por tipo" nomeia antes de somar o resto. */
export const TIPOS_NA_LINHA = 3;

/** As barras "Por tipo de atividade" da equipe: só com 3 tipos ou mais, e até 6. */
export const TIPOS_NAS_BARRAS = { minimo: 3, maximo: 6 };

/** As linhas da grade que levam nome; sábado e domingo ficam sem, como no calendário de parede. */
export const LINHAS_DA_GRADE = ['seg', '', 'qua', '', 'sex', '', ''];

export const PE_DO_AGORA = 'Como estava na hora em que o PDF foi gerado. Não depende do período.';

/** Janela de troca: a API de antes não manda `porSemana`. */
export const SEMANA_INDISPONIVEL = 'Semana a semana indisponível nesta versão.';

/** Quanto a folha de uma pessoa se aperta para caber. */
export interface ApertoDaFolha {
  /** Altura do desenho das colunas, em mm. */
  alturaDoGrafico: number;
  /** A observação de quem emitiu sai numa linha cinza, sem a caixa. */
  observacaoSemCaixa: boolean;
  /** O tempo da pessoa sai na tabela semanal compacta, e não em colunas. */
  graficoEmTabela: boolean;
}

/**
 * OS DEGRAUS DA FOLHA DE UMA PESSOA, do mais folgado ao mais apertado.
 *
 * Medido com o jsPDF real em 14/09/2026, nos dois sindicatos: a folha
 * passava para a página 2 com os 5 blocos, com Filiados como bloco a mais em
 * 90 dias, e com uma observação de UMA linha já nos três blocos da advogada (a
 * caixa custa 18,5 mm). O documento aperta nesta ordem, e só até caber:
 *  1. o gráfico fica mais baixo;
 *  2. a observação vira uma linha cinza, sem caixa;
 *  3. o gráfico vira a tabela semanal compacta.
 * Nenhum degrau tira número, linha da tabela nem a coluna "O que conta".
 */
export const APERTOS_DA_FOLHA: readonly ApertoDaFolha[] = [
  { alturaDoGrafico: 22, observacaoSemCaixa: false, graficoEmTabela: false },
  { alturaDoGrafico: 16, observacaoSemCaixa: false, graficoEmTabela: false },
  { alturaDoGrafico: 12, observacaoSemCaixa: false, graficoEmTabela: false },
  { alturaDoGrafico: 12, observacaoSemCaixa: true, graficoEmTabela: false },
  { alturaDoGrafico: 12, observacaoSemCaixa: true, graficoEmTabela: true },
];

/**
 * A OBSERVAÇÃO NO PDF DE UMA PESSOA vai até 240 caracteres, e não os 600 dos
 * outros PDFs. Medido em 14/09/2026 no pior caso (os 5 blocos, 31 e 90 dias,
 * no último degrau): 260 ainda cabiam, 280 já passavam para a folha 2.
 */
export const OBSERVACAO_NA_FOLHA_DA_PESSOA = 240;

const n = numero;
const perfilDe = (perfil: string) => (PERFIL_LABEL as Record<string, string>)[perfil] ?? perfil;
const qtd = (v: number, um: string, varios: string) => `${n(v)} ${v === 1 ? um : varios}`;
const legendaDe = (chave: ChaveDaLegenda) => LEGENDA_DO_USO.find((l) => l.chave === chave)!;
const fimDoMes = (dia: string) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate() === d;
};
const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
/** "de 14/07 a 13/08", "em julho", "em 2025". */
const deOuEm = (rotulo: string) => (rotulo.includes(' a ') ? `de ${rotulo}` : `em ${rotulo}`);

export function pessoasDoRecorte(p: Produtividade, quem: QuemNoPdf): LinhaDeUso[] {
  if (p.escopo === 'PESSOAL' || quem === 'TODOS') return p.pessoas;
  if (quem.startsWith('PERFIL:')) {
    const perfil = quem.slice('PERFIL:'.length);
    return p.pessoas.filter((l) => l.perfil === perfil);
  }
  const id = quem.slice('PESSOA:'.length);
  return p.pessoas.filter((l) => l.usuarioId === id);
}

/** O nome do recorte — na capa e no nome do arquivo. */
export function nomeDoRecorte(p: Produtividade, quem: QuemNoPdf): string {
  if (p.escopo === 'PESSOAL') return p.pessoas[0]?.nome ?? 'Uso pessoal';
  if (quem === 'TODOS') return 'Toda a equipe';
  if (quem.startsWith('PERFIL:')) {
    const perfil = quem.slice('PERFIL:'.length);
    return GRUPO_DO_PERFIL[perfil] ?? perfil;
  }
  return pessoasDoRecorte(p, quem)[0]?.nome ?? 'Uma pessoa';
}

/** O período dos dados, em AAAA-MM-DD de Teresina. `dias` é a fonte; a API sem dias cai no intervalo. */
function periodoDosDados(p: Produtividade): Periodo {
  if (p.dias.length) return { de: p.dias[0], ate: p.dias[p.dias.length - 1] };
  const ate = new Date(new Date(p.periodo.ate).getTime() - 1).toISOString();
  return { de: diaEmTeresina(p.periodo.de), ate: diaEmTeresina(ate) };
}

interface Contexto {
  p: Produtividade;
  agora: Date;
  periodo: Periodo;
  anterior: AnteriorDaProdutividade | null;
  /** Os cabeçalhos das colunas de número: o deste período e o do anterior. */
  rotuloAtual: string;
  rotuloAnterior: string;
  graficos: boolean;
  segundas: string[];
}

/* ------------------------------------------------------------------ grade */

/**
 * A GRADE DOS DIAS — colunas são semanas (segunda a domingo), linhas são dias.
 * Um desenho só para qualquer período. Sai de `dias` + `diasAtivos`, que as
 * duas versões da API mandam; `semanas` da API, quando vem, garante as mesmas
 * colunas do gráfico. Dia fora do período fica nulo e não se desenha.
 *
 * Até 13 semanas cada coluna leva a segunda-feira ("10/08"); acima, só a
 * primeira semana de cada mês leva o mês ("ago").
 */
export function gradeDoPdf(dias: string[], diasAtivos: string[], semanasDaApi?: string[]): GradeDoPdf {
  const segundas = [...new Set([...(semanasDaApi ?? []), ...semanasDosDias(dias)])].sort();
  const coluna = new Map(segundas.map((s, i) => [s, i]));
  const ativos = new Set(diasAtivos);
  const semanas = segundas.map(() => ({
    rotulo: '',
    dias: Array.from({ length: LINHAS_DA_GRADE.length }, (): DiaDaGrade | null => null),
  }));
  for (const dia of dias) {
    const i = coluna.get(segundaFeiraDe(dia));
    if (i === undefined) continue;
    const [a, m, d] = dia.split('-').map(Number);
    const linha = (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;
    semanas[i].dias[linha] = { dia: d, usou: ativos.has(dia), fimDeSemana: caiNoFimDeSemana(dia) };
  }
  const porMes = segundas.length > SEMANAS_NO_GRAFICO;
  let mesAnterior = '';
  segundas.forEach((segunda, i) => {
    if (!porMes) {
      semanas[i].rotulo = diaEMes(segunda);
      return;
    }
    // O mês da semana é o da quinta-feira dela; a primeira coluna leva o do primeiro dia do período.
    const [a, m, d] = segunda.split('-').map(Number);
    const quinta = new Date(Date.UTC(a, m - 1, d + 3)).toISOString().slice(0, 7);
    const mes = i === 0 && dias[0] ? dias[0].slice(0, 7) : quinta;
    if (mes !== mesAnterior) semanas[i].rotulo = rotulosDosMeses([mes])[0];
    mesAnterior = mes;
  });
  return { semanas, linhas: LINHAS_DA_GRADE };
}

/* ----------------------------------------------------------------- caixas */

/** A linha da comparação na caixa dos dias: "De 14/07 a 13/08: nenhum dia", ou a data da conta. */
function comparacaoDosDias(l: LinhaDeUso, antes: LinhaDeUso | null, ctx: Contexto): string | null {
  if (!ctx.anterior) return null;
  const criada = l.contaCriadaEm ? diaEmTeresina(l.contaCriadaEm) : null;
  if (criada && criada > ctx.anterior.periodo.de) return `A conta foi criada em ${diaMesEAno(criada)}`;
  const dias = antes?.diasComUso ?? 0;
  return `${maiuscula(deOuEm(ctx.rotuloAnterior))}: ${dias ? qtd(dias, 'dia', 'dias') : 'nenhum dia'}`;
}

/** NO PERÍODO · DIAS COM USO — a grade e o que ela diz, sem âmbar: o período não pede nada. */
function caixaDosDias(l: LinhaDeUso, antes: LinhaDeUso | null, ctx: Contexto): CaixaDoPdf & { grade?: GradeDoPdf } {
  const rotulo = 'No período · dias com uso';
  if (!l.ultimoAcesso) return { rotulo, linhas: [{ tipo: 'texto', texto: 'Nunca entrou no sistema.' }] };
  const comparacao = comparacaoDosDias(l, antes, ctx);
  const pe: LinhaDaCaixa = { tipo: 'pe', texto: legendaDe('diasComUso').curta };
  // Zero dia com uso, mas já entrou antes: uma frase, e não uma grade toda cinza.
  if (!l.diasComUso) {
    return {
      rotulo,
      linhas: [
        { tipo: 'texto', texto: 'Nenhum dia com uso no período.' },
        ...(comparacao ? [{ tipo: 'texto' as const, texto: comparacao }] : []),
        pe,
      ],
    };
  }
  const doPeriodo = new Set(ctx.p.dias);
  const uteis = diasDeSemana(ctx.p.dias);
  const noFimDeSemana = l.diasAtivos.filter((d) => doPeriodo.has(d) && caiNoFimDeSemana(d)).length;
  return {
    rotulo,
    grade: gradeDoPdf(ctx.p.dias, l.diasAtivos, ctx.p.semanas),
    linhas: [
      { tipo: 'grande', texto: `${qtd(l.diasComUso, 'dia', 'dias')} com uso` },
      // "Dias de semana", nunca "dias úteis": não existe tabela de feriados (07/09 entra na conta).
      {
        tipo: 'texto',
        texto: uteis ? `o período tem ${qtd(uteis, 'dia de semana', 'dias de semana')}` : 'o período só tem sábado e domingo',
      },
      ...(noFimDeSemana
        ? [{ tipo: 'texto' as const, texto: `usou em ${qtd(noFimDeSemana, 'dia', 'dias')} de sábado ou domingo` }]
        : []),
      ...(comparacao ? [{ tipo: 'texto' as const, texto: comparacao }] : []),
      {
        tipo: 'chave',
        itens: [
          { texto: 'usou', cor: 'cheia' },
          { texto: 'não usou', cor: 'vazia' },
          { texto: 'sábado e domingo', cor: 'fimDeSemana' },
        ],
      },
      pe,
    ],
  };
}

/**
 * AGORA · 13/09/2026, 16:37 — o retrato da hora em que o PDF foi gerado. É o
 * ÚNICO lugar com âmbar no documento da pessoa. Nunca vermelho, nunca "vencido".
 */
function caixaDoAgora(l: LinhaDeUso, ctx: Contexto): CaixaDoPdf {
  const { abertas, atrasadas } = l.agenda;
  const { esperando } = l.publicacoes;
  return {
    rotulo: `Agora · ${dataEHoraEmTeresina(ctx.p.geradoEm)}`,
    fundo: true,
    linhas: [
      {
        tipo: 'par',
        rotulo: 'Último acesso',
        valor: l.ultimoAcesso ? textoDoUltimoAcesso(l.ultimoAcesso, ctx.agora) : 'nunca entrou',
        alerta: ausente(l.ultimoAcesso, ctx.agora),
      },
      {
        tipo: 'par',
        rotulo: 'Na agenda',
        valor: `${qtd(abertas, 'atividade', 'atividades')} em aberto`,
        ...(atrasadas ? { abaixo: { texto: qtd(atrasadas, 'atrasada', 'atrasadas'), alerta: true } } : {}),
      },
      // O Diário só para quem tem o bloco de publicações — a mesma regra do cartão da aba.
      ...(blocosDaPessoa(l).includes('publicacoes')
        ? [{
            tipo: 'par' as const,
            rotulo: 'Diário',
            valor: esperando
              ? `${qtd(esperando, 'proposta esperando', 'propostas esperando')} decisão`
              : 'nenhuma proposta esperando',
            alerta: esperando > 0,
          }]
        : []),
      { tipo: 'pe', texto: PE_DO_AGORA },
    ],
  };
}

/* -------------------------------------------------------------- registros */

type LinhaDoRegistro =
  | { tipo: 'numero'; rotulo: string; atual: number; antes: number | null; conta: string }
  | { tipo: 'mesclada'; rotulo: string; texto: string };

/** O nome do grupo na tabela; no papel, "Publicações" sozinho não diz de onde. */
const GRUPO_NA_TABELA: Record<Bloco, string> = { ...TITULO_DO_BLOCO, publicacoes: 'Publicações do Diário' };

/** "O que conta" das decididas num período que atravessa 13/09/2026. */
export const DECIDIDAS_SO_DESDE = 'Propostas do Diário aceitas ou recusadas, só desde 13/09/2026.';
/** "O que conta" das decididas quando o período anterior começa antes de 13/09/2026: a célula dele fica vazia. */
export const DECIDIDAS_SEM_ANTES = 'Aceitas ou recusadas pela pessoa; antes de 13/09/2026 não se media.';

/** "Prazo: 8 · Audiência: 5 · Reunião: 3 · outros tipos: 2" — sem plural inventado para nome cadastrável. */
export function linhaDosTipos(tipos: TipoConcluido[] | undefined): string | null {
  if (!tipos?.length) return null;
  const primeiros = tipos.slice(0, TIPOS_NA_LINHA).map((t) => `${t.nome}: ${n(t.concluidas)}`);
  const resto = tipos.slice(TIPOS_NA_LINHA).reduce((soma, t) => soma + t.concluidas, 0);
  return [...primeiros, ...(resto ? [`outros tipos: ${n(resto)}`] : [])].join(' · ');
}

/**
 * AS LINHAS DE UM BLOCO NA TABELA "O QUE REGISTROU NO PERÍODO".
 *
 * Quando o número é zero (14/09/2026):
 *  · o bloco todo zerado nos dois períodos vira UMA linha — ele não some, zero
 *    ali é informação;
 *  · a linha zerada nos dois períodos some, menos a primeira do bloco;
 *  · zero agora com número antes aparece ("0 | 4").
 */
export function linhasDoBloco(
  bloco: Bloco,
  l: LinhaDeUso,
  antes: LinhaDeUso | null,
  periodo: Periodo,
  anterior: Periodo | null,
  dias: string[],
): LinhaDoRegistro[] {
  const comAntes = !!antes && !!anterior;
  const numeroDe = (rotulo: string, chave: ChaveDaLegenda, atual: number, deAntes: number | undefined) => ({
    tipo: 'numero' as const, rotulo, atual, antes: comAntes ? (deAntes ?? 0) : null, conta: legendaDe(chave).curta,
  });
  let linhas: LinhaDoRegistro[] = [];
  switch (bloco) {
    case 'agenda': {
      const a = l.agenda;
      const tipos = a.concluidas ? linhaDosTipos(a.porTipo) : null;
      linhas = [
        numeroDe('Atividades concluídas', 'concluidas', a.concluidas, antes?.agenda.concluidas),
        numeroDe('   no dia marcado', 'noDiaMarcado', a.noDiaMarcado, antes?.agenda.noDiaMarcado),
        ...(tipos ? [{ tipo: 'mesclada' as const, rotulo: '   por tipo', texto: tipos }] : []),
        numeroDe('Atividades criadas', 'criou', a.criadas, antes?.agenda.criadas),
      ];
      break;
    }
    case 'publicacoes': {
      /*
        DECIDIDAS NÃO MEDIDAS NÃO SÃO ZERO. Antes de 13/09/2026 ninguém gravava
        quem aceitou cada proposta: "0 decididas" num PDF de agosto dizia que a
        pessoa não decidiu nada.
      */
      const medicao = medicaoDasDecididas(periodo);
      const { decididas } = l.publicacoes;
      if (medicao === 'NAO_MEDIDO') {
        return [{ tipo: 'mesclada', rotulo: 'Publicações decididas', texto: DECIDIDAS_NAO_MEDIDAS }];
      }
      if (medicao === 'PARCIAL') {
        if (!decididas) {
          const medidos = diasMedidosDasDecididas(dias);
          return [{
            tipo: 'mesclada',
            rotulo: 'Publicações decididas',
            texto: `Só é gravado desde 13/09/2026. Neste período: ${qtd(medidos, 'dia medido', 'dias medidos')}, nenhuma decisão.`,
          }];
        }
        return [{ tipo: 'numero', rotulo: 'Publicações decididas', atual: decididas, antes: null, conta: DECIDIDAS_SO_DESDE }];
      }
      const comparavel = !!anterior && comparaDecididas(anterior.de);
      return [{
        tipo: 'numero',
        rotulo: 'Publicações decididas',
        atual: decididas,
        antes: comAntes && comparavel ? (antes?.publicacoes.decididas ?? 0) : null,
        conta: comAntes && !comparavel ? DECIDIDAS_SEM_ANTES : legendaDe('decididas').curta,
      }];
    }
    case 'processos': {
      const pr = l.processos;
      linhas = [
        numeroDe('Processos cadastrados', 'processosCadastrados', pr.cadastrados, antes?.processos.cadastrados),
        numeroDe('Documentos anexados', 'documentos', pr.documentos, antes?.processos.documentos),
        numeroDe('Andamentos internos', 'andamentos', pr.andamentos, antes?.processos.andamentos),
      ];
      break;
    }
    case 'filiados': {
      const f = l.filiados;
      linhas = [
        numeroDe('Filiados cadastrados', 'filiadosCadastrados', f.cadastrados, antes?.filiados.cadastrados),
        numeroDe('Alterações em fichas', 'alteracoesEmFichas', f.fichasAtualizadas, antes?.filiados.fichasAtualizadas),
      ];
      break;
    }
    case 'atendimentos':
      linhas = [numeroDe('Atendimentos registrados', 'atendimentos', l.atendimentos, antes?.atendimentos)];
      break;
  }
  const zerada = (linha: LinhaDoRegistro) => linha.tipo === 'numero' && !linha.atual && !linha.antes;
  if (linhas.every(zerada)) return [{ tipo: 'mesclada', rotulo: '', texto: 'Nada registrado no período.' }];
  return linhas.filter((linha, i) => i === 0 || !zerada(linha));
}

/** Por que a coluna do anterior some — ou nulo, quando ela fica. */
function semComparacao(l: LinhaDeUso | null, diasAntes: number, ctx: Contexto): string | null {
  if (!ctx.anterior) return null;
  const criada = l?.contaCriadaEm ? diaEmTeresina(l.contaCriadaEm) : null;
  if (criada && criada > ctx.anterior.periodo.de) return `Sem comparação: a conta foi criada em ${diaMesEAno(criada)}.`;
  if (!diasAntes) return `Sem comparação: nenhum uso do sistema ${deOuEm(ctx.rotuloAnterior)}.`;
  return null;
}

/**
 * "O QUE REGISTROU NO PERÍODO" — número, este período, o anterior (só com
 * "Comparar", e só o número: sem sinal, porcentagem, seta nem cor) e "O que
 * conta". Não há mais "número grande do bloco": 35 processos cadastrados não
 * ficam em letra miúda embaixo de 1 andamento.
 */
function tabelaDosRegistros(
  blocos: Bloco[],
  l: LinhaDeUso,
  antes: LinhaDeUso | null,
  ctx: Contexto,
  motivo: string | null,
): BlocoDoPdf[] {
  const comColuna = !!ctx.anterior && !motivo;
  const linhas: string[][] = [];
  const especiais: Record<number, { tipo: 'grupo' } | { tipo: 'mesclada'; de: number }> = {};
  for (const bloco of blocos) {
    especiais[linhas.length] = { tipo: 'grupo' };
    linhas.push([GRUPO_NA_TABELA[bloco]]);
    const registros = linhasDoBloco(
      bloco, l, comColuna ? antes : null, ctx.periodo, comColuna ? ctx.anterior!.periodo : null, ctx.p.dias,
    );
    for (const r of registros) {
      if (r.tipo === 'mesclada') {
        especiais[linhas.length] = { tipo: 'mesclada', de: 1 };
        linhas.push([r.rotulo, r.texto]);
      } else {
        linhas.push(
          comColuna
            ? [r.rotulo, n(r.atual), r.antes === null ? '' : n(r.antes), r.conta]
            : [r.rotulo, n(r.atual), r.conta],
        );
      }
    }
  }
  return [
    { tipo: 'secao', titulo: 'O que registrou no período', compacta: true },
    {
      tipo: 'tabela',
      cabecalho: comColuna
        ? ['Registro', ctx.rotuloAtual, ctx.rotuloAnterior, 'O que conta']
        : ['Registro', ctx.rotuloAtual, 'O que conta'],
      linhas,
      numericas: comColuna ? [1, 2] : [1],
      larguras: comColuna ? { 0: 44, 1: 22, 2: 22 } : { 0: 44, 1: 22 },
      estilos: comColuna
        ? { 1: { negrito: true }, 2: { cinza: true }, 3: { cinza: true, fonte: 7 } }
        : { 1: { negrito: true }, 2: { cinza: true, fonte: 7 } },
      especiais,
      // 0,9 mm: com um quarto bloco (a advogada que também atende), 1,1 mm já empurrava o gráfico de 90 dias para a folha 2.
      folga: 0.9,
      semListras: true,
    },
    ...(motivo ? [{ tipo: 'nota' as const, texto: motivo }] : []),
  ];
}

/* ---------------------------------------------------------------- gráfico */

type SerieDoTempo = 'CONCLUIDAS' | 'ATENDIMENTOS' | 'FILIADOS';

/** O que o gráfico da pessoa conta, pelo perfil: o trabalho que o perfil faz. */
export function serieDoPerfil(perfil: string): SerieDoTempo {
  if (perfil === 'TRIAGEM') return 'ATENDIMENTOS';
  if (perfil === 'ADMINISTRADOR') return 'FILIADOS';
  return 'CONCLUIDAS';
}

const NOME_DA_SERIE: Record<SerieDoTempo, string> = {
  CONCLUIDAS: 'Atividades concluídas',
  ATENDIMENTOS: 'Atendimentos registrados',
  FILIADOS: 'Filiados cadastrados',
};

const NADA_NA_SERIE: Record<SerieDoTempo, string> = {
  CONCLUIDAS: 'Nenhuma atividade concluída no período.',
  ATENDIMENTOS: 'Nenhum atendimento registrado no período.',
  FILIADOS: 'Nenhum filiado cadastrado no período.',
};

/** Semana ou mês, com o que o gráfico precisa; `undefined` num campo é API de antes. */
type Fatia = Pick<SemanaDeUso, 'diasComUso' | 'concluidas' | 'atendimentos'> &
  Partial<Pick<SemanaDeUso, 'noDiaMarcado' | 'filiadosCadastrados'>>;

/**
 * O GRÁFICO DO TEMPO — da própria pessoa (ou a soma da equipe), em colunas
 * EMPILHADAS: a base na cor da casa é "no dia marcado", o topo no tom claro é
 * "depois do dia marcado". Subconjunto por cor e ordem, nunca num segundo
 * gráfico; nunca média da equipe sobreposta.
 *
 * Janela de troca: sem `porSemana`, cai para o mês a mês de antes quando o
 * período passa de 31 dias; senão sai só a nota.
 */
function graficoDoTempo(
  l: LinhaDeUso,
  serie: SerieDoTempo,
  ctx: Contexto,
  equipe: LinhaDeUso[] | null,
  aperto: ApertoDaFolha = APERTOS_DA_FOLHA[0],
): BlocoDoPdf[] {
  const { p } = ctx;
  const semanal = ctx.segundas.length <= SEMANAS_NO_GRAFICO;
  const meses = p.meses ?? [];
  const nome = serie === 'CONCLUIDAS' && equipe ? 'Atividades concluídas da equipe' : NOME_DA_SERIE[serie];
  const primeiro = ctx.periodo.de;
  const ultimo = ctx.periodo.ate;

  let categorias: string[];
  let fatias: Fatia[];
  let titulo: string;
  let pontas = '';
  let embaixo: number[] | null = null;
  if (semanal && l.porSemana) {
    const vazia = (semana: string): SemanaDeUso => ({
      semana, diasNoPeriodo: 0, diasComUso: 0, concluidas: 0, noDiaMarcado: 0, andamentos: 0, atendimentos: 0,
      processosCadastrados: 0, documentos: 0, filiadosCadastrados: 0,
    });
    const daSemana = (linha: LinhaDeUso, s: string) => linha.porSemana?.find((x) => x.semana === s) ?? vazia(s);
    categorias = ctx.segundas.map(diaEMes);
    fatias = ctx.segundas.map((s) => daSemana(l, s));
    titulo = `${nome}, semana a semana`;
    const [a, m, d] = ctx.segundas[ctx.segundas.length - 1].split('-').map(Number);
    const domingo = new Date(Date.UTC(a, m - 1, d + 6)).toISOString().slice(0, 10);
    const comecaDepois = ctx.segundas[0] < primeiro;
    const terminaAntes = domingo > ultimo;
    // A semana de 3 dias ao lado de uma inteira parece queda: a nota avisa, na linha do título.
    pontas =
      comecaDepois && terminaAntes
        ? `a primeira semana começa em ${diaEMes(primeiro)} e a última termina em ${diaEMes(ultimo)}`
        : comecaDepois
          ? `a primeira semana começa em ${diaEMes(primeiro)}`
          : terminaAntes
            ? `a última semana termina em ${diaEMes(ultimo)}`
            : '';
    if (equipe) embaixo = ctx.segundas.map((s) => equipe.filter((e) => daSemana(e, s).diasComUso > 0).length);
  } else if ((!semanal || p.dias.length > 31) && meses.length >= 2 && l.porMes) {
    const vazio = (mes: string): MesDeUso => ({ mes, diasComUso: 0, concluidas: 0, andamentos: 0, atendimentos: 0 });
    const doMes = (linha: LinhaDeUso, mes: string) => linha.porMes?.find((x) => x.mes === mes) ?? vazio(mes);
    categorias = rotulosDosMeses(meses);
    fatias = meses.map((mes) => doMes(l, mes));
    titulo = `${nome}, mês a mês`;
    pontas =
      primeiro.endsWith('-01') && fimDoMes(ultimo) ? '' : 'o primeiro e o último mês contam só os dias do período';
    if (equipe) embaixo = meses.map((mes) => equipe.filter((e) => doMes(e, mes).diasComUso > 0).length);
  } else {
    return [{ tipo: 'nota', texto: SEMANA_INDISPONIVEL }];
  }

  const empilhada = serie === 'CONCLUIDAS' && fatias.every((f) => typeof f.noDiaMarcado === 'number');
  if (serie === 'FILIADOS' && !fatias.every((f) => typeof f.filiadosCadastrados === 'number')) {
    return [{ tipo: 'nota', texto: SEMANA_INDISPONIVEL }];
  }
  const series: (Serie & { valores: number[] })[] = empilhada
    ? [
        { nome: 'no dia marcado', cor: CASA.principal, valores: fatias.map((f) => f.noDiaMarcado ?? 0) },
        {
          nome: 'depois do dia marcado',
          cor: CASA.clara,
          valores: fatias.map((f) => Math.max(0, f.concluidas - (f.noDiaMarcado ?? 0))),
        },
      ]
    : [{
        nome: NOME_DA_SERIE[serie],
        cor: CASA.principal,
        valores: fatias.map((f) =>
          serie === 'ATENDIMENTOS' ? f.atendimentos : serie === 'FILIADOS' ? (f.filiadosCadastrados ?? 0) : f.concluidas,
        ),
      }];
  const detalhes = embaixo?.map((v) => qtd(v, 'pessoa', 'pessoas'));
  const notaDaEquipe: BlocoDoPdf[] = embaixo
    ? [{
        tipo: 'nota',
        texto: `Embaixo de cada ${semanal && l.porSemana ? 'semana' : 'mês'}, quantas pessoas usaram o sistema nele.`,
      }]
    : [];

  if (!ctx.graficos || aperto.graficoEmTabela) {
    const rotuloDaLinha = empilhada ? 'Concluídas' : NOME_DA_SERIE[serie];
    const totais = fatias.map((_, i) => series.reduce((soma, s) => soma + s.valores[i], 0));
    return [
      {
        tipo: 'tabela',
        titulo: `${titulo}${pontas ? ` (${pontas})` : ''}`,
        cabecalho: [semanal && l.porSemana ? 'Semana' : 'Mês', ...categorias],
        linhas: [
          [rotuloDaLinha, ...totais.map(n)],
          ...(empilhada ? [['No dia marcado', ...series[0].valores.map(n)]] : []),
          ...(detalhes ? [['Pessoas que usaram', ...(embaixo ?? []).map(n)]] : []),
        ],
        numericas: categorias.map((_, i) => i + 1),
        fonte: 7,
        // Compacta no último degrau da folha: os mesmos números, com menos ar em volta.
        folga: aperto.graficoEmTabela ? 0.6 : 1,
        semListras: true,
      },
    ];
  }
  return [
    {
      tipo: 'colunas',
      titulo,
      ...(pontas ? { unidade: pontas } : {}),
      series: series.map(({ nome: nomeDaSerie, cor }) => ({ nome: nomeDaSerie, cor })),
      categorias,
      valores: series.map((s) => s.valores),
      empilhar: true,
      // 22 mm, e não os 40 do PDF do sindicato: a folha da pessoa inteira mede ~266 dos 277 mm úteis.
      // Menos, só quando a folha não cabe (`APERTOS_DA_FOLHA`).
      altura: aperto.alturaDoGrafico,
      ...(detalhes ? { detalhes } : {}),
      vazio: NADA_NA_SERIE[serie],
    },
    ...notaDaEquipe,
  ];
}

/* ------------------------------------------------------------ as pessoas */

/** A folha de uma pessoa: as duas caixas, o que registrou e o tempo dela. */
function folhaDaPessoa(l: LinhaDeUso, antes: LinhaDeUso | null, ctx: Contexto, aperto: ApertoDaFolha): BlocoDoPdf[] {
  const motivo = semComparacao(l, antes?.diasComUso ?? 0, ctx);
  return [
    { tipo: 'caixas', esquerda: caixaDosDias(l, antes, ctx), direita: caixaDoAgora(l, ctx) },
    ...tabelaDosRegistros(blocosDaPessoa(l), l, antes, ctx, motivo),
    ...graficoDoTempo(l, serieDoPerfil(l.perfil), ctx, null, aperto),
  ];
}

/** O degrau de cada pessoa, pelo id; quem não está na lista fica no primeiro. */
export type ApertosDasPessoas = Record<string, number>;

const apertoDe = (apertos: ApertosDasPessoas, id: string) =>
  APERTOS_DA_FOLHA[Math.min(Math.max(0, apertos[id] ?? 0), APERTOS_DA_FOLHA.length - 1)];

/**
 * A SOMA DA EQUIPE, no formato de uma linha. EM ABERTO E ATRASADAS NÃO SE
 * SOMAM: a mesma atividade conta para cada pessoa da equipe dela
 * (`abertas-da-pessoa.util.ts`), e a soma dobraria. Ficam zeradas e o
 * documento da equipe não as mostra.
 */
export function somaDaEquipe(pessoas: LinhaDeUso[]): LinhaDeUso {
  const s = (f: (l: LinhaDeUso) => number) => pessoas.reduce((t, l) => t + f(l), 0);
  const todas = <T,>(f: (l: LinhaDeUso) => T | undefined): T[] | null => {
    const valores = pessoas.map(f);
    return valores.every((v) => v !== undefined) ? (valores as T[]) : null;
  };
  const opcional = (valores: (number | undefined)[]) =>
    valores.every((v) => typeof v === 'number') ? valores.reduce<number>((t, v) => t + (v ?? 0), 0) : undefined;

  const tiposDeCada = todas((l) => l.agenda.porTipo);
  const tipos = new Map<string, TipoConcluido>();
  for (const t of (tiposDeCada ?? []).flat()) {
    const soma = tipos.get(t.tipo) ?? { tipo: t.tipo, nome: t.nome, concluidas: 0, noDiaMarcado: 0 };
    soma.concluidas += t.concluidas;
    soma.noDiaMarcado += t.noDiaMarcado;
    tipos.set(t.tipo, soma);
  }
  const semanasDeCada = todas((l) => l.porSemana);
  const mesesDeCada = todas((l) => l.porMes);
  const chaves = <T,>(listas: T[][], chave: (x: T) => string) => [...new Set(listas.flat().map(chave))].sort();

  return {
    usuarioId: '', nome: '', perfil: '', avatarUrl: null, ultimoAcesso: null,
    diasComUso: s((l) => l.diasComUso),
    diasAtivos: [],
    agenda: {
      concluidas: s((l) => l.agenda.concluidas),
      noDiaMarcado: s((l) => l.agenda.noDiaMarcado),
      criadas: s((l) => l.agenda.criadas),
      abertas: 0,
      atrasadas: 0,
      ...(tiposDeCada
        ? {
            porTipo: [...tipos.values()].sort(
              (a, b) => b.concluidas - a.concluidas || a.nome.localeCompare(b.nome, 'pt-BR'),
            ),
          }
        : {}),
    },
    publicacoes: { decididas: s((l) => l.publicacoes.decididas), esperando: 0 },
    processos: {
      cadastrados: s((l) => l.processos.cadastrados),
      andamentos: s((l) => l.processos.andamentos),
      documentos: s((l) => l.processos.documentos),
    },
    filiados: {
      cadastrados: s((l) => l.filiados.cadastrados),
      fichasAtualizadas: s((l) => l.filiados.fichasAtualizadas),
    },
    atendimentos: s((l) => l.atendimentos),
    ...(semanasDeCada
      ? {
          porSemana: chaves(semanasDeCada, (x) => x.semana).map((semana) => {
            const doCada = semanasDeCada.flatMap((lista) => lista.filter((x) => x.semana === semana));
            const t = (f: (x: SemanaDeUso) => number) => doCada.reduce((soma, x) => soma + f(x), 0);
            return {
              semana,
              diasNoPeriodo: Math.max(0, ...doCada.map((x) => x.diasNoPeriodo)),
              diasComUso: t((x) => x.diasComUso),
              concluidas: t((x) => x.concluidas),
              noDiaMarcado: t((x) => x.noDiaMarcado),
              andamentos: t((x) => x.andamentos),
              atendimentos: t((x) => x.atendimentos),
              processosCadastrados: t((x) => x.processosCadastrados),
              documentos: t((x) => x.documentos),
              filiadosCadastrados: t((x) => x.filiadosCadastrados),
            };
          }),
        }
      : {}),
    ...(mesesDeCada
      ? {
          porMes: chaves(mesesDeCada, (x) => x.mes).map((mes) => {
            const doCada = mesesDeCada.flatMap((lista) => lista.filter((x) => x.mes === mes));
            const t = (f: (x: MesDeUso) => number) => doCada.reduce((soma, x) => soma + f(x), 0);
            const noDiaMarcado = opcional(doCada.map((x) => x.noDiaMarcado));
            const filiadosCadastrados = opcional(doCada.map((x) => x.filiadosCadastrados));
            return {
              mes,
              diasComUso: t((x) => x.diasComUso),
              concluidas: t((x) => x.concluidas),
              andamentos: t((x) => x.andamentos),
              atendimentos: t((x) => x.atendimentos),
              ...(noDiaMarcado !== undefined ? { noDiaMarcado } : {}),
              ...(filiadosCadastrados !== undefined ? { filiadosCadastrados } : {}),
            };
          }),
        }
      : {}),
  };
}

const TODOS_OS_BLOCOS: Bloco[] = ['agenda', 'publicacoes', 'processos', 'filiados', 'atendimentos'];

/** A página 1 do documento de um grupo: a equipe no período, o que registrou e o tempo dela. */
function resumoDaEquipe(pessoas: LinhaDeUso[], deAntes: LinhaDeUso[], ctx: Contexto): BlocoDoPdf[] {
  const grupos = gruposPorPerfil(pessoas);
  const linhasDoPerfil = grupos.map((g) => {
    const semAcesso = g.pessoas.filter(
      (l) => (diasSemAcesso(l.ultimoAcesso, ctx.agora) ?? -1) >= DIAS_PARA_NOTAR_AUSENCIA,
    ).length;
    return {
      linha: [
        GRUPO_DO_PERFIL[g.perfil] ?? g.perfil,
        n(g.pessoas.length),
        n(g.pessoas.filter((l) => l.diasComUso > 0).length),
        n(semAcesso),
        n(g.pessoas.filter((l) => !l.ultimoAcesso).length),
      ],
      semAcesso,
      nunca: g.pessoas.filter((l) => !l.ultimoAcesso).length,
    };
  });
  const soma = somaDaEquipe(pessoas);
  const somaAntes = ctx.anterior ? somaDaEquipe(deAntes) : null;
  const blocosDaEquipe = TODOS_OS_BLOCOS.filter((b) => pessoas.some((l) => blocosDaPessoa(l).includes(b)));
  const motivo = semComparacao(null, somaAntes?.diasComUso ?? 0, ctx);
  const tipos = soma.agenda.porTipo ?? [];

  return [
    { tipo: 'secao', titulo: 'A equipe no período' },
    {
      tipo: 'tabela',
      cabecalho: ['Perfil', 'Pessoas', 'Usaram o sistema', 'Sem entrar há 7 dias ou mais', 'Nunca entraram'],
      grupos: [
        { texto: '', colunas: 2 },
        { texto: 'No período', colunas: 1 },
        { texto: 'Agora', colunas: 2 },
      ],
      linhas: linhasDoPerfil.map((r) => r.linha),
      numericas: [1, 2, 3, 4],
      // Âmbar só nas colunas de agora, e só quando há alguém.
      alertas: linhasDoPerfil.flatMap((r, i) => [
        ...(r.semAcesso ? [[i, 3] as [number, number]] : []),
        ...(r.nunca ? [[i, 4] as [number, number]] : []),
      ]),
    },
    ...tabelaDosRegistros(blocosDaEquipe, soma, somaAntes, ctx, motivo).map((b) =>
      b.tipo === 'secao' ? { ...b, titulo: 'O que a equipe registrou', compacta: false } : b,
    ),
    ...graficoDoTempo(soma, 'CONCLUIDAS', ctx, pessoas),
    // Contagem de COISA pode ser barra; de gente, não.
    ...(tipos.length >= TIPOS_NAS_BARRAS.minimo
      ? [{
          tipo: 'barras' as const,
          titulo: 'Por tipo de atividade',
          unidade: 'atividades concluídas',
          series: [{ nome: 'Concluídas', cor: CASA.principal }],
          itens: agruparResto(
            tipos.map((t) => ({ rotulo: t.nome, total: t.concluidas })),
            TIPOS_NAS_BARRAS.maximo,
          ).map((i) => ({ rotulo: i.rotulo, partes: [i.total], texto: n(i.total) })),
        }]
      : []),
  ];
}

/**
 * PESSOA POR PESSOA — uma linha por pessoa, na ordem da API, sem foto. SEM
 * coluna do anterior: quinze linhas com "antes" viram placar de quem caiu.
 * Âmbar só nas células de "Agora".
 */
function pessoaPorPessoa(pessoas: LinhaDeUso[], ctx: Contexto): BlocoDoPdf[] {
  const medicao = medicaoDasDecididas(ctx.periodo);
  const comDecididas = medicao !== 'NAO_MEDIDO';
  const noPeriodo = comDecididas ? 6 : 5;
  const chaves: ChaveDaLegenda[] = [
    'diasComUso', 'concluidas', 'noDiaMarcado', 'andamentos', 'atendimentos',
    ...(comDecididas ? ['decididas' as const] : []),
    'ultimoAcesso', 'emAberto', 'atrasadas',
  ];
  const conta = (chave: ChaveDaLegenda) =>
    chave === 'decididas' && medicao === 'PARCIAL' ? DECIDIDAS_SO_DESDE : legendaDe(chave).curta;
  const legenda: string[][] = [];
  for (let i = 0; i < chaves.length; i += 2) {
    const [a, b] = [chaves[i], chaves[i + 1]];
    legenda.push([legendaDe(a).numero, conta(a), b ? legendaDe(b).numero : '', b ? conta(b) : '']);
  }
  const alguemDecide = pessoas.some((l) => blocosDaPessoa(l).includes('publicacoes'));
  return [
    {
      tipo: 'secao',
      titulo: 'Pessoa por pessoa',
      subtitulo: 'Por perfil e depois por nome, sem posição. "Agora" é de quando o PDF foi gerado.',
      novaPagina: true,
    },
    {
      tipo: 'tabela',
      cabecalho: [
        'Pessoa', 'Dias com uso', 'Concluídas', 'No dia marcado', 'Andamentos', 'Atendimentos',
        ...(comDecididas ? ['Decididas'] : []),
        'Último acesso', 'Em aberto', 'Atrasadas',
      ],
      grupos: [
        { texto: '', colunas: 1 },
        { texto: 'No período', colunas: noPeriodo },
        { texto: 'Agora', colunas: 3 },
      ],
      linhas: pessoas.map((l) => [
        `${l.nome}\n${perfilDe(l.perfil)}`,
        n(l.diasComUso),
        n(l.agenda.concluidas),
        n(l.agenda.noDiaMarcado),
        n(l.processos.andamentos),
        n(l.atendimentos),
        ...(comDecididas ? [n(l.publicacoes.decididas)] : []),
        l.ultimoAcesso ? textoDoUltimoAcesso(l.ultimoAcesso, ctx.agora) : 'nunca entrou',
        n(l.agenda.abertas),
        n(l.agenda.atrasadas),
      ]),
      numericas: [...Array.from({ length: noPeriodo }, (_, i) => i + 1), noPeriodo + 2, noPeriodo + 3],
      alertas: pessoas.flatMap((l, i) => [
        ...(ausente(l.ultimoAcesso, ctx.agora) ? [[i, noPeriodo + 1] as [number, number]] : []),
        ...(l.agenda.atrasadas ? [[i, noPeriodo + 3] as [number, number]] : []),
      ]),
      larguras: { 0: 36 },
      fonte: 7.5,
    },
    {
      tipo: 'tabela',
      cabecalho: ['', '', '', ''],
      linhas: legenda,
      semCabecalho: true,
      semListras: true,
      fonte: 7,
      folga: 0.9,
      larguras: { 0: 24, 2: 24 },
      estilos: { 0: { negrito: true }, 1: { cinza: true }, 2: { negrito: true }, 3: { cinza: true } },
    },
    ...(!comDecididas && alguemDecide
      ? [{ tipo: 'nota' as const, texto: `Sem a coluna de publicações decididas. ${DECIDIDAS_NAO_MEDIDAS}` }]
      : []),
  ];
}

/** O que entra no PDF do uso, na ordem em que entra. Nenhum desenho aqui. */
export function planoDaProdutividade(
  p: Produtividade,
  escolhas: EscolhasDaProdutividade,
  anterior?: AnteriorDaProdutividade | null,
  /** As miniaturas da API, por id. Só entram na página de cada pessoa, e só com `escolhas.fotos`. */
  rostos: Record<string, string> = {},
  /** O degrau de aperto da folha de cada pessoa — quem escolhe é `documentoQueCabe`, medindo. */
  apertos: ApertosDasPessoas = {},
): BlocoDoPdf[] {
  const pessoas = pessoasDoRecorte(p, escolhas.quem);
  // O "Antes de ler" continua abrindo o documento, sem mudar uma palavra.
  const blocos: BlocoDoPdf[] = [{ tipo: 'destaque', rotulo: 'Antes de ler', texto: O_QUE_NAO_MEDE, fonte: 8.5 }];
  if (!pessoas.length) {
    blocos.push({ tipo: 'texto', texto: 'Ninguém neste recorte no período.' });
    return blocos;
  }

  const periodo = periodoDosDados(p);
  const [rotuloAtual, rotuloAnterior] = anterior
    ? rotulosDasColunas(periodo, anterior.periodo)
    : [rotuloCurtoDoPeriodo(periodo), ''];
  const ctx: Contexto = {
    p,
    // "Agora" é o instante em que a API somou — foi contra ele que ela contou as ausências.
    agora: new Date(p.geradoEm),
    periodo,
    anterior: anterior ?? null,
    rotuloAtual,
    rotuloAnterior,
    graficos: escolhas.graficos,
    segundas: p.semanas?.length ? p.semanas : semanasDosDias(p.dias),
  };
  const deAntes = anterior ? pessoasDoRecorte(anterior.dados, escolhas.quem) : [];
  const antesDe = new Map(deAntes.map((l) => [l.usuarioId, l]));
  const antesDaPessoa = (l: LinhaDeUso) => (anterior ? antesDe.get(l.usuarioId) ?? null : null);

  // Uma pessoa só: o nome e o rosto já estão no topo (`capaDaProdutividade`).
  if (pessoas.length === 1) {
    blocos.push(...folhaDaPessoa(pessoas[0], antesDaPessoa(pessoas[0]), ctx, apertoDe(apertos, pessoas[0].usuarioId)));
    return blocos;
  }

  blocos.push(...resumoDaEquipe(pessoas, deAntes, ctx));
  if (escolhas.detalhe === 'TABELA') blocos.push(...pessoaPorPessoa(pessoas, ctx));
  if (escolhas.detalhe === 'PAGINAS') {
    for (const l of pessoas) {
      const cor = corDasIniciais(l.nome, tenant.paleta);
      const foto = escolhas.fotos ? rostos[l.usuarioId] : undefined;
      blocos.push({
        tipo: 'pessoa',
        nome: l.nome,
        // O período e quem emitiu já estão na faixa de cada página.
        linha: perfilDe(l.perfil),
        iniciais: iniciaisDe(l.nome),
        cor: { fundo: cor.fundo, texto: cor.texto },
        ...(foto ? { foto } : {}),
        novaPagina: true,
      });
      blocos.push(...folhaDaPessoa(l, antesDaPessoa(l), ctx, apertoDe(apertos, l.usuarioId)));
    }
  }
  return blocos;
}

/**
 * O TOPO DO DOCUMENTO. De uma pessoa: o círculo, o NOME como título, "Uso do
 * sistema de 14 de agosto a 13 de setembro de 2026" e "Advogado(a) · emitido
 * por João Pedro" — a data de emissão sai, porque o rodapé já traz. O título
 * digitado troca só o "Uso do sistema" da segunda linha.
 */
export function capaDaProdutividade(
  p: Produtividade,
  escolhas: EscolhasDaProdutividade,
  contexto: { de: string; ate: string; emitidoPor: string; titulo?: string; observacao?: string },
  rostos: Record<string, string> = {},
): CapaDoDocumento {
  const pessoas = pessoasDoRecorte(p, escolhas.quem);
  const extenso = periodoPorExtenso({ de: contexto.de, ate: contexto.ate });
  const digitado = contexto.titulo?.trim();
  const base = {
    faixa: `Uso do sistema · ${rotuloDoPeriodo({ de: contexto.de, ate: contexto.ate })}`,
    observacao: contexto.observacao?.trim() || undefined,
  };
  if (pessoas.length === 1) {
    const l = pessoas[0];
    const cor = corDasIniciais(l.nome, tenant.paleta);
    const foto = escolhas.fotos ? rostos[l.usuarioId] : undefined;
    return {
      ...base,
      titulo: l.nome,
      periodo: digitado ? `${digitado} · ${extenso}` : `Uso do sistema de ${extenso}`,
      apoio: `${perfilDe(l.perfil)} · emitido por ${contexto.emitidoPor}`,
      pessoa: { iniciais: iniciaisDe(l.nome), cor: { fundo: cor.fundo, texto: cor.texto }, ...(foto ? { foto } : {}) },
    };
  }
  return {
    ...base,
    titulo: digitado || (p.escopo === 'PESSOAL' ? 'O meu uso do sistema' : 'Uso e produtividade'),
    periodo: extenso,
    apoio: `${nomeDoRecorte(p, escolhas.quem)} · emitido por ${contexto.emitidoPor}`,
  };
}

export interface DocumentoDaProdutividade {
  capa: CapaDoDocumento;
  blocos: BlocoDoPdf[];
}

type ContextoDoDocumento = Parameters<typeof capaDaProdutividade>[2];

/**
 * O topo e o plano juntos, já no degrau de cada pessoa. No documento de UMA
 * pessoa, a partir do degrau da observação sem caixa, ela deixa o topo e vira
 * a primeira linha do plano: o mesmo lugar, em cinza, sem os 18,5 mm da caixa.
 */
export function documentoDaProdutividade(
  p: Produtividade,
  escolhas: EscolhasDaProdutividade,
  contexto: ContextoDoDocumento,
  anterior: AnteriorDaProdutividade | null = null,
  rostos: Record<string, string> = {},
  apertos: ApertosDasPessoas = {},
): DocumentoDaProdutividade {
  const capa = capaDaProdutividade(p, escolhas, contexto, rostos);
  const blocos = planoDaProdutividade(p, escolhas, anterior, rostos, apertos);
  const pessoas = pessoasDoRecorte(p, escolhas.quem);
  if (pessoas.length !== 1 || !capa.observacao || !apertoDe(apertos, pessoas[0].usuarioId).observacaoSemCaixa) {
    return { capa, blocos };
  }
  const { observacao, ...semObservacao } = capa;
  return { capa: semObservacao, blocos: [{ tipo: 'nota', texto: `Observação: ${observacao}` }, ...blocos] };
}

/**
 * Quem passou da própria folha, pelo desenho. De uma pessoa: o documento
 * inteiro é a folha dela. Com uma página por pessoa: a folha vai do cartão da
 * pessoa até o bloco antes do cartão seguinte.
 */
function quemTransbordou(
  pessoas: LinhaDeUso[],
  escolhas: EscolhasDaProdutividade,
  blocos: BlocoDoPdf[],
  desenho: { paginas: number; paginaDoBloco: number[] },
): string[] {
  if (pessoas.length === 1) return desenho.paginas > 1 ? [pessoas[0].usuarioId] : [];
  if (escolhas.detalhe !== 'PAGINAS') return [];
  const cartoes = blocos.flatMap((b, i) => (b.tipo === 'pessoa' ? [i] : []));
  return pessoas.filter((_, k) => {
    const cartao = cartoes[k];
    if (cartao === undefined) return false;
    const primeira = desenho.paginaDoBloco[cartao];
    const ultima = k + 1 < cartoes.length ? desenho.paginaDoBloco[cartoes[k + 1] - 1] : desenho.paginas;
    return ultima > primeira;
  }).map((l) => l.usuarioId);
}

/**
 * O DOCUMENTO QUE CABE — uma folha por pessoa, provada pelo desenho, e não
 * por estimativa. Desenha, vê quem passou da folha, sobe UM degrau só dessa
 * pessoa e desenha de novo. Parou de transbordar, ou acabaram os degraus, é
 * esse: no último degrau o documento sai mesmo que ainda passe — número
 * nenhum é cortado para caber.
 */
export function documentoQueCabe(
  p: Produtividade,
  escolhas: EscolhasDaProdutividade,
  contexto: ContextoDoDocumento,
  anterior: AnteriorDaProdutividade | null,
  rostos: Record<string, string>,
  medir: MedidorDeDocumento,
): DocumentoDaProdutividade & { apertos: ApertosDasPessoas; desenho: DesenhoDoDocumento | null } {
  const pessoas = pessoasDoRecorte(p, escolhas.quem);
  const apertos: ApertosDasPessoas = {};
  const ultimo = APERTOS_DA_FOLHA.length - 1;
  for (;;) {
    const documento = documentoDaProdutividade(p, escolhas, contexto, anterior, rostos, apertos);
    // Sem folha de pessoa (ninguém no recorte, ou a equipe sem uma página por pessoa), não há o que medir.
    if (!pessoas.length || (pessoas.length > 1 && escolhas.detalhe !== 'PAGINAS')) {
      return { ...documento, apertos, desenho: null };
    }
    const desenho = medir(documento.capa, documento.blocos);
    const subir = quemTransbordou(pessoas, escolhas, documento.blocos, desenho).filter(
      (id) => (apertos[id] ?? 0) < ultimo,
    );
    if (!subir.length) return { ...documento, apertos, desenho };
    for (const id of subir) apertos[id] = (apertos[id] ?? 0) + 1;
  }
}

/** Período, comparação, gráficos e detalhe da última vez. Quem, título e observação NÃO ficam. */
export interface OpcoesDaProdutividade {
  preset: PresetDoPeriodo;
  comparar: boolean;
  graficos: boolean;
  detalhe: DetalheDasPessoas;
  /** "Com a foto do perfil" — só vale onde há página de pessoa. */
  fotos: boolean;
}

export const OPCOES_DA_PRODUTIVIDADE: OpcoesDaProdutividade = {
  preset: 'TELA',
  comparar: true,
  graficos: true,
  detalhe: 'TABELA',
  fotos: true,
};

const CHAVE_DAS_OPCOES = chaveLocal('relatorio', 'pdf-uso-opcoes');
const DETALHES: DetalheDasPessoas[] = ['TABELA', 'PAGINAS', 'NENHUM'];

export function lerOpcoesDaProdutividade(): OpcoesDaProdutividade {
  const opcoes: OpcoesDaProdutividade = { ...OPCOES_DA_PRODUTIVIDADE };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DAS_OPCOES) ?? 'null') as
      | Partial<OpcoesDaProdutividade>
      | null;
    if (!salvo || typeof salvo !== 'object') return opcoes;
    if (presetValido(salvo.preset)) opcoes.preset = salvo.preset;
    if (typeof salvo.comparar === 'boolean') opcoes.comparar = salvo.comparar;
    if (typeof salvo.graficos === 'boolean') opcoes.graficos = salvo.graficos;
    if (salvo.detalhe && DETALHES.includes(salvo.detalhe)) opcoes.detalhe = salvo.detalhe;
    if (typeof salvo.fotos === 'boolean') opcoes.fotos = salvo.fotos;
  } catch {
    // Armazenamento bloqueado ou lixo antigo: vale o padrão.
  }
  return opcoes;
}

export function guardarOpcoesDaProdutividade(opcoes: OpcoesDaProdutividade): void {
  try {
    localStorage.setItem(CHAVE_DAS_OPCOES, JSON.stringify(opcoes));
  } catch {
    // Navegador sem armazenamento: vale só desta vez.
  }
}

/** "Dra. Conceição" vira "dra-conceicao": o acento sai pela decomposição, e não por lista de letras. */
const paraArquivo = (texto: string) =>
  [...texto.normalize('NFD')]
    .filter((c) => c.charCodeAt(0) < 0x300 || c.charCodeAt(0) > 0x36f)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'equipe';

export async function gerarPdfDaProdutividade(
  p: Produtividade,
  escolhas: EscolhasDaProdutividade,
  contexto: { de: string; ate: string; emitidoPor: string; titulo?: string; observacao?: string },
  anterior?: AnteriorDaProdutividade | null,
  /** De `carregarRostos()`; vazio quando a opção está desmarcada ou a rota falhou. */
  rostos: Record<string, string> = {},
): Promise<void> {
  const recorte = nomeDoRecorte(p, escolhas.quem);
  const { capa, blocos } = documentoQueCabe(p, escolhas, contexto, anterior ?? null, rostos, await abrirMedidorDeDocumento());
  await baixarDocumento(capa, blocos, `uso-do-sistema-${tenant.id}-${paraArquivo(recorte)}-${contexto.de}-a-${contexto.ate}.pdf`);
}
