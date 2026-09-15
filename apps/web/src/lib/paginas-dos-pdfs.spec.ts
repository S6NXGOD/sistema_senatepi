/**
 * @jest-environment node
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { montarDocumento, type BlocoDoPdf, type CapaDoDocumento, type MedidorDeDocumento } from './pdf-documento';
import { MARGEM } from './pdf-institucional';
import { capaDoPanorama, planoDoPanorama } from './panorama-pdf';
import { planoDoPdf } from './relatorio-pdf';
import {
  PANORAMA_TUDO_DETALHADO, RELATORIO_TUDO_DETALHADO, ROTULOS_DE_TESTE, panoramaCheio, relatorioCheio,
} from './fixtures-dos-pdfs';
import { periodoAnterior, type Periodo, type PresetDoPeriodo } from './periodo-do-pdf';
import {
  BLOCOS_DO_PERFIL, blocosDaPessoa, segundaFeiraDe, semanasDosDias,
  type Bloco, type LinhaDeUso, type Produtividade, type TipoConcluido,
} from './produtividade';
import {
  APERTOS_DO_RESUMO, OBSERVACAO_NA_FOLHA_DA_PESSOA, RESUMO_DA_EQUIPE, avisosDoPdf, capaDaProdutividade, documentoDaProdutividade,
  documentoQueCabe, linhaDosTipos, planoDaProdutividade,
  type AnteriorDaProdutividade, type EscolhasDaProdutividade,
} from './produtividade-pdf';
import { ATALHOS, comoData } from './relatorios';

/**
 * O QUE O PAPEL AGUENTA — com o jsPDF de produção, sem navegador.
 *
 * "Cabe em uma folha" era estimativa (~256 de 277 mm). Sem prova, o primeiro
 * nome comprido ou uma linha a mais devolve a página 2 em silêncio. Medido
 * em 14/09/2026, nos dois sindicatos: com os três blocos do perfil, o
 * conteúdo termina entre 255 e 258 mm; com um quarto bloco de UMA linha,
 * entre 265 e 268 mm. A revisão do mesmo dia achou a folha 2 no que essa
 * prova não cobria — Filiados como bloco a mais, os 5 blocos, uma observação
 * de uma linha —, e daí veio a matriz abaixo, passando por `documentoQueCabe`.
 * Na primeira medição, com a legenda do gráfico numa linha própria e
 * 1,1 mm de folga nas células, o quarto bloco em 90 dias ia para a folha 2. E os
 * blocos novos de `pdf-documento.ts` (14/09/2026) não podem mexer no PDF do
 * sindicato nem no do panorama: o número de páginas deles fica pinado aqui.
 *
 * A MATRIZ DE 15/09/2026. A de 14/09 passava e a folha 2 continuava no ar: ela
 * usava 13 semanas redondas (o atalho "Últimos 90 dias" gera 91 dias e 14
 * semanas), nenhum período entre 9 e 43 semanas ("este ano" em setembro tem
 * 38), só nomes curtos de tipo e só contas antigas. Agora os períodos são os
 * que os atalhos geram de verdade a partir de 14/09/2026, os tipos têm nome
 * cadastrado longo e metade das combinações tem a conta criada no meio do
 * período. Nomes inventados.
 */

function desenhar(capa: CapaDoDocumento, blocos: BlocoDoPdf[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const desenho = montarDocumento(doc, autoTable, capa, blocos, null);
  return { paginas: doc.getNumberOfPages(), saida: doc.output(), fim: desenho.fim, desenho };
}

const DIA_MS = 86_400_000;
const diasEntre = (de: string, ate: string) => {
  const dias: string[] = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += DIA_MS) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
};

const NOME_COMPRIDO = 'Dra. Maria da Conceição Albuquerque de Sousa Nogueira Castelo Branco';

const TIPOS_CURTOS: TipoConcluido[] = [
  { tipo: 'PRAZO', nome: 'Prazo', concluidas: 8, noDiaMarcado: 7 },
  { tipo: 'AUDIENCIA', nome: 'Audiência', concluidas: 5, noDiaMarcado: 5 },
  { tipo: 'REUNIAO', nome: 'Reunião', concluidas: 3, noDiaMarcado: 2 },
  { tipo: 'PERICIA', nome: 'Perícia', concluidas: 2, noDiaMarcado: 1 },
];

/** Seis tipos com o nome que a administração pode cadastrar: é a linha "por tipo" mais larga que se vê. */
const TIPOS_LONGOS: TipoConcluido[] = [
  { tipo: 'AIJ', nome: 'Audiência de instrução e julgamento na vara', concluidas: 80, noDiaMarcado: 70 },
  { tipo: 'LAUDO', nome: 'Prazo para manifestação sobre laudo pericial', concluidas: 50, noDiaMarcado: 45 },
  { tipo: 'DIRETORIA', nome: 'Reunião com a diretoria do sindicato', concluidas: 30, noDiaMarcado: 20 },
  { tipo: 'PERICIA', nome: 'Perícia médica no local de trabalho', concluidas: 4, noDiaMarcado: 3 },
  { tipo: 'DILIGENCIA', nome: 'Diligência na secretaria municipal', concluidas: 3, noDiaMarcado: 2 },
  { tipo: 'TELEFONEMA', nome: 'Telefonema ao filiado', concluidas: 2, noDiaMarcado: 2 },
];

const CONTA_ANTIGA = '2024-01-10T12:00:00.000Z';

/**
 * A pessoa mais alta que o documento desenha com os blocos pedidos: todos
 * cheios, a linha "por tipo", atrasada e proposta esperando (as duas linhas
 * extras da caixa "Agora"), comparação e o gráfico. Concluídas no teto
 * medido (8 por semana). Sem perfil nem blocos, é a advogada dos três blocos.
 */
function advogadaNoPeriodo(
  de: string,
  ate: string,
  fator = 1,
  perfil = 'ADVOGADO',
  blocos: readonly Bloco[] = BLOCOS_DO_PERFIL.ADVOGADO,
  extra: { tipos?: TipoConcluido[]; contaCriadaEm?: string; usuarioId?: string; nome?: string } = {},
): Produtividade {
  const tem = (bloco: Bloco) => blocos.includes(bloco);
  const dias = diasEntre(de, ate);
  const semanas = semanasDosDias(dias);
  const uteis = dias.filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const diasAtivos = uteis.filter((_, i) => i % 5 !== 4);
  const meses = [...new Set(dias.map((d) => d.slice(0, 7)))];
  const daSemana = (s: string) => dias.filter((d) => segundaFeiraDe(d) === s);
  const doMes = (m: string) => dias.filter((d) => d.startsWith(m));
  const concluidasEm = (lista: string[]) => Math.round(lista.filter((d) => diasAtivos.includes(d)).length * 1.6 * fator);
  const linha: LinhaDeUso = {
    usuarioId: extra.usuarioId ?? 'ana',
    nome: extra.nome ?? NOME_COMPRIDO,
    perfil,
    avatarUrl: null,
    ultimoAcesso: '2026-09-14T12:27:00.000Z',
    contaCriadaEm: extra.contaCriadaEm ?? CONTA_ANTIGA,
    diasComUso: diasAtivos.length,
    diasAtivos,
    agenda: {
      concluidas: concluidasEm(dias),
      noDiaMarcado: Math.round(concluidasEm(dias) * 0.75),
      criadas: 12 * fator,
      abertas: 8,
      atrasadas: 1,
      porTipo: extra.tipos ?? TIPOS_CURTOS,
    },
    publicacoes: tem('publicacoes') ? { decididas: 4 * fator, esperando: 2 } : { decididas: 0, esperando: 0 },
    processos: tem('processos')
      ? { cadastrados: 35 * fator, andamentos: 1 + fator, documentos: 31 * fator }
      : { cadastrados: 0, andamentos: 0, documentos: 0 },
    filiados: tem('filiados')
      ? { cadastrados: Math.round(14 * fator), fichasAtualizadas: Math.round(22 * fator) }
      : { cadastrados: 0, fichasAtualizadas: 0 },
    atendimentos: tem('atendimentos') ? Math.round(9 * fator) : 0,
    porSemana: semanas.map((semana) => ({
      semana,
      diasNoPeriodo: daSemana(semana).length,
      diasComUso: daSemana(semana).filter((d) => diasAtivos.includes(d)).length,
      concluidas: concluidasEm(daSemana(semana)),
      noDiaMarcado: Math.round(concluidasEm(daSemana(semana)) * 0.75),
      andamentos: 0, atendimentos: tem('atendimentos') ? 2 : 0, processosCadastrados: 3, documentos: 2,
      filiadosCadastrados: tem('filiados') ? 3 : 0,
    })),
    porMes: meses.map((mes) => ({
      mes,
      diasComUso: doMes(mes).filter((d) => diasAtivos.includes(d)).length,
      concluidas: concluidasEm(doMes(mes)),
      noDiaMarcado: Math.round(concluidasEm(doMes(mes)) * 0.75),
      andamentos: 1, atendimentos: tem('atendimentos') ? 4 : 0, processosCadastrados: 3, documentos: 2,
      filiadosCadastrados: tem('filiados') ? 5 : 0,
    })),
  };
  return {
    periodo: { de: `${de}T03:00:00.000Z`, ate: `${ate}T03:00:00.000Z` },
    escopo: 'GLOBAL',
    dias,
    meses,
    semanas,
    perfis: [{ perfil, pessoas: 1, usaram: 1, semAcessoRecente: 0, nuncaEntraram: 0 }],
    pessoas: [linha],
    geradoEm: '2026-09-14T19:37:00.000Z',
  };
}

const UMA_PESSOA: EscolhasDaProdutividade = { quem: 'PESSOA:ana', detalhe: 'PAGINAS', graficos: true, fotos: true };

/** Segunda, 14/09/2026, às 10h no fuso do jest — o dia em que os atalhos são apertados. */
const HOJE = new Date(2026, 8, 14, 10, 0);
const doAtalho = (rotulo: string): Periodo => ({
  de: comoData(ATALHOS.find((a) => a.rotulo === rotulo)!.inicio(HOJE)),
  ate: comoData(HOJE),
});
const periodo = (nome: string, p: Periodo, preset: PresetDoPeriodo, grafico: string) => ({
  nome, ...p, anterior: periodoAnterior(p, preset), grafico,
});

const PERIODOS = [
  periodo('últimos 30 dias', doAtalho('30 dias'), 'TELA', 'semana a semana'),
  periodo('últimos 90 dias', doAtalho('90 dias'), 'TELA', 'semana a semana'),
  periodo('este ano', doAtalho('Este ano'), 'ESTE_ANO', 'mês a mês'),
  periodo('um ano', { de: '2025-09-15', ate: '2026-09-14' }, 'TELA', 'mês a mês'),
];
const [TRINTA, NOVENTA] = PERIODOS;

/** O dia 20 do primeiro mês do período, às 12h de Teresina: a conta nasce com o período andando. */
const criadaNoMeio = (de: string) => `${de.slice(0, 8)}20T15:00:00.000Z`;

function folhaDaPessoa(de: string, ate: string, anterior: { de: string; ate: string }, escolhas = UMA_PESSOA) {
  const p = advogadaNoPeriodo(de, ate);
  const antes: AnteriorDaProdutividade = { dados: advogadaNoPeriodo(anterior.de, anterior.ate, 0.8), periodo: anterior };
  const plano = planoDaProdutividade(p, escolhas, antes);
  const capa = capaDaProdutividade(p, escolhas, { de, ate, emitidoPor: 'João Pedro' });
  return { plano, ...desenhar(capa, plano) };
}

/** O medidor com o jsPDF real; guarda o último documento para conferir o NaN sem desenhar de novo. */
function medidorReal() {
  const ultimo: { doc?: jsPDF } = {};
  const medir: MedidorDeDocumento = (capa, blocos) => {
    ultimo.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    return montarDocumento(ultimo.doc, autoTable, capa, blocos, null);
  };
  return { medir, saida: () => ultimo.doc?.output() ?? '' };
}

describe('os períodos da prova são os dos atalhos, apertados em 14/09/2026', () => {
  it('30 dias, 90 dias (91 dias e 14 semanas), este ano (38 semanas) e um ano', () => {
    const resumo = PERIODOS.map((p) => {
      const dias = diasEntre(p.de, p.ate);
      return [p.nome, p.de, p.ate, dias.length, semanasDosDias(dias).length];
    });
    expect(resumo).toEqual([
      // De sábado, 15/08, a segunda, 14/09: as duas pontas são semanas de 2 dias e de 1.
      ['últimos 30 dias', '2026-08-15', '2026-09-14', 31, 6],
      ['últimos 90 dias', '2026-06-16', '2026-09-14', 91, 14],
      ['este ano', '2026-01-01', '2026-09-14', 257, 38],
      ['um ano', '2025-09-15', '2026-09-14', 365, 53],
    ]);
    expect(PERIODOS.map((p) => p.anterior)).toEqual([
      { de: '2026-07-15', ate: '2026-08-14' },
      { de: '2026-03-17', ate: '2026-06-15' },
      { de: '2025-01-01', ate: '2025-09-14' },
      { de: '2024-09-15', ate: '2025-09-14' },
    ]);
  });
});

describe('o documento de uma pessoa cabe em UMA folha', () => {
  for (const caso of PERIODOS) {
    it(`${caso.nome}, com comparação, gráfico e nome comprido`, () => {
      const { plano, paginas, saida, fim } = folhaDaPessoa(caso.de, caso.ate, caso.anterior);
      // O que se quis provar está mesmo no plano: a coluna do anterior, o gráfico e a linha por tipo.
      const tabela = plano.find((b) => b.tipo === 'tabela' && b.cabecalho[0] === 'Registro') as Extract<BlocoDoPdf, { tipo: 'tabela' }>;
      expect(tabela.cabecalho).toHaveLength(4);
      expect(tabela.linhas.some((l) => l[0].trim() === 'por tipo')).toBe(true);
      expect(plano.find((b) => b.tipo === 'colunas')).toMatchObject({ titulo: `Atividades concluídas, ${caso.grafico}` });
      expect(plano.find((b) => b.tipo === 'caixas')).toBeDefined();

      expect(paginas).toBe(1);
      expect(fim).toBeLessThanOrEqual(277);
      expect(saida).not.toContain('NaN');
    });
  }

  it('sem gráficos, a semana a semana em tabela também cabe', () => {
    const { paginas, saida } = folhaDaPessoa(NOVENTA.de, NOVENTA.ate, NOVENTA.anterior, { ...UMA_PESSOA, graficos: false });
    expect(paginas).toBe(1);
    expect(saida).not.toContain('NaN');
  });

  /** "Uma página por pessoa": cada pessoa numa folha, e nenhuma transborda para a seguinte. */
  it('no PDF da equipe com uma página por pessoa, cada pessoa ocupa uma folha', () => {
    const base = advogadaNoPeriodo(NOVENTA.de, NOVENTA.ate);
    const pessoas = [0, 1, 2].map((i) => ({ ...base.pessoas[0], usuarioId: `p${i}`, nome: `${NOME_COMPRIDO} ${i}` }));
    const p: Produtividade = { ...base, pessoas };
    const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'PAGINAS', graficos: true };
    const plano = planoDaProdutividade(p, escolhas, null);
    const { paginas, saida } = desenhar(capaDaProdutividade(p, escolhas, { de: NOVENTA.de, ate: NOVENTA.ate, emitidoPor: 'Ana' }), plano);
    const resumo = desenhar(
      capaDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, { de: NOVENTA.de, ate: NOVENTA.ate, emitidoPor: 'Ana' }),
      planoDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, null),
    );
    expect(paginas).toBe(resumo.paginas + pessoas.length);
    expect(saida).not.toContain('NaN');
  });

  it('a tabela pessoa por pessoa, com o cabeçalho em duas linhas, desenha sem NaN', () => {
    const base = advogadaNoPeriodo(TRINTA.de, TRINTA.ate);
    const pessoas = Array.from({ length: 15 }, (_, i) => ({
      ...base.pessoas[0], usuarioId: `p${i}`, nome: `Pessoa ${i + 1}`, ultimoAcesso: i % 4 ? base.pessoas[0].ultimoAcesso : null,
    }));
    const p: Produtividade = { ...base, pessoas };
    const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'TABELA', graficos: true };
    const antes: AnteriorDaProdutividade = { dados: advogadaNoPeriodo(TRINTA.anterior.de, TRINTA.anterior.ate), periodo: TRINTA.anterior };
    const { paginas, saida } = desenhar(
      capaDaProdutividade(p, escolhas, { de: TRINTA.de, ate: TRINTA.ate, emitidoPor: 'Ana' }),
      planoDaProdutividade(p, escolhas, antes),
    );
    expect(paginas).toBeGreaterThanOrEqual(2);
    expect(saida).not.toContain('NaN');
    expect(saida).toContain('Pessoa por pessoa');
  });
});

/**
 * A MATRIZ DA FOLHA ÚNICA (14/09/2026, ampliada em 15/09/2026). Cada
 * combinação passa por `documentoQueCabe`, que aperta a folha em degraus
 * (`APERTOS_DA_FOLHA`), e o jsPDF real conta as páginas: 4 perfis × 3
 * conjuntos de blocos × 4 períodos × comparação × gráfico × 2 observações × 2
 * contas, sempre com o nome comprido, o título digitado e os tipos de nome
 * longo.
 *
 * O bloco a mais é o mais alto que o perfil ainda não tem: Filiados (duas
 * linhas) para advogado e coordenação; Processos (três) para a triagem, que
 * já tem Filiados; Publicações (uma linha, e o Diário a mais na caixa
 * "Agora") para o administrador, que já tem Filiados e Processos.
 */
describe('a folha de uma pessoa cabe em UMA folha em todas as combinações', () => {
  const BLOCO_A_MAIS: Record<string, Bloco[]> = {
    ADVOGADO: ['filiados'],
    COORDENACAO: ['filiados'],
    TRIAGEM: ['processos'],
    ADMINISTRADOR: ['publicacoes'],
  };
  const OS_CINCO: Bloco[] = ['agenda', 'publicacoes', 'processos', 'filiados', 'atendimentos'];
  const UMA_LINHA = 'Para a conversa de setembro.';
  const NO_MAXIMO = 'Conversa sobre o uso do sistema no período, com a coordenação e a própria pessoa. '
    .repeat(5)
    .slice(0, OBSERVACAO_NA_FOLHA_DA_PESSOA);
  const OBSERVACOES = [
    ['sem observação', ''],
    ['observação no máximo', NO_MAXIMO],
  ] as const;
  const TITULO = 'Conversa de setembro com a coordenação';
  const registrosDe = (blocos: BlocoDoPdf[]) =>
    JSON.stringify(blocos.find((b) => b.tipo === 'tabela' && b.cabecalho[0] === 'Registro'));

  for (const perfil of ['ADVOGADO', 'COORDENACAO', 'TRIAGEM', 'ADMINISTRADOR']) {
    const doPerfil = BLOCOS_DO_PERFIL[perfil];
    const conjuntos: [string, Bloco[]][] = [
      ['só os blocos do perfil', doPerfil],
      [`com o bloco a mais (${BLOCO_A_MAIS[perfil][0]})`, [...doPerfil, ...BLOCO_A_MAIS[perfil]]],
      ['com os 5 blocos', OS_CINCO],
    ];
    for (const [conjunto, blocos] of conjuntos) {
      it(`${perfil}, ${conjunto}: as 64 combinações saem em 1 página, sem NaN, sem cortar nada e sem aviso`, () => {
        // O que se quis provar está mesmo na pessoa: os blocos pedidos, e só eles.
        const amostra = advogadaNoPeriodo(TRINTA.de, TRINTA.ate, 1, perfil, blocos, { tipos: TIPOS_LONGOS });
        expect([...blocosDaPessoa(amostra.pessoas[0])].sort()).toEqual([...blocos].sort());

        const { medir, saida } = medidorReal();
        const falhas: string[] = [];
        let combinacoes = 0;
        for (const caso of PERIODOS) {
          for (const [comoConta, contaCriadaEm] of [['conta antiga', CONTA_ANTIGA], ['conta criada no meio', criadaNoMeio(caso.de)]]) {
            const extra = { tipos: TIPOS_LONGOS, contaCriadaEm };
            const p = advogadaNoPeriodo(caso.de, caso.ate, 1, perfil, blocos, extra);
            for (const comparar of [true, false]) {
              const anterior: AnteriorDaProdutividade | null = comparar
                ? { dados: advogadaNoPeriodo(caso.anterior.de, caso.anterior.ate, 0.8, perfil, blocos, extra), periodo: caso.anterior }
                : null;
              for (const graficos of [true, false]) {
                const escolhas: EscolhasDaProdutividade = { ...UMA_PESSOA, graficos };
                const semAperto = registrosDe(planoDaProdutividade(p, escolhas, anterior));
                for (const [comoObservacao, observacao] of OBSERVACOES) {
                  combinacoes += 1;
                  const contexto = { de: caso.de, ate: caso.ate, emitidoPor: 'João Pedro', titulo: TITULO, observacao };
                  const d = documentoQueCabe(p, escolhas, contexto, anterior, {}, medir);
                  const nome = [
                    caso.nome, comoConta, comparar ? 'com comparação' : 'sem comparação', graficos ? 'com gráfico' : 'sem gráfico',
                    comoObservacao, `degrau ${d.apertos.ana ?? 0}`,
                  ].join(', ');
                  if (d.desenho?.paginas !== 1) falhas.push(`${nome}: ${d.desenho?.paginas} páginas`);
                  // `fim` já soma os 6 mm de folga depois da última tabela (medido: 277,1 com o conteúdo em 271,1).
                  // O que não pode é chegar ao fio do rodapé, a 285 mm.
                  else if (d.desenho.fim > 285) falhas.push(`${nome}: termina em ${d.desenho.fim} mm, no rodapé`);
                  if (d.avisos.passaram.length) falhas.push(`${nome}: avisou que passou da folha`);
                  if (saida().includes('NaN')) falhas.push(`${nome}: NaN no PDF`);
                  // Nenhum degrau tira linha, número ou "O que conta" da tabela.
                  if (registrosDe(d.blocos) !== semAperto) falhas.push(`${nome}: a tabela do que registrou mudou`);
                  const naCaixa = d.capa.observacao === observacao;
                  const naLinha = d.blocos.some((b) => b.tipo === 'nota' && b.texto === `Observação: ${observacao}`);
                  if (observacao && !naCaixa && !naLinha) falhas.push(`${nome}: a observação sumiu`);
                }
              }
            }
          }
        }
        expect(combinacoes).toBe(64);
        expect(falhas).toEqual([]);
      }, 240_000);
    }
  }

  /** A ordem dos degraus no papel: com pouco a apertar, a caixa da observação fica e só o gráfico baixa. */
  it('advogada com três blocos, tipos longos e uma observação de uma linha: o gráfico baixa, a caixa fica', () => {
    const extra = { tipos: TIPOS_LONGOS };
    const p = advogadaNoPeriodo(TRINTA.de, TRINTA.ate, 1, 'ADVOGADO', BLOCOS_DO_PERFIL.ADVOGADO, extra);
    const anterior = {
      dados: advogadaNoPeriodo(TRINTA.anterior.de, TRINTA.anterior.ate, 0.8, 'ADVOGADO', BLOCOS_DO_PERFIL.ADVOGADO, extra),
      periodo: TRINTA.anterior,
    };
    const contexto = { de: TRINTA.de, ate: TRINTA.ate, emitidoPor: 'João Pedro', titulo: TITULO, observacao: UMA_LINHA };
    const d = documentoQueCabe(p, UMA_PESSOA, contexto, anterior, {}, medidorReal().medir);
    expect(d.desenho?.paginas).toBe(1);
    expect(d.capa.observacao).toBe(UMA_LINHA);
    const grafico = d.blocos.find((b): b is Extract<BlocoDoPdf, { tipo: 'colunas' }> => b.tipo === 'colunas');
    expect(grafico?.altura).toBeLessThan(22);
    // Sem o aperto, a mesma folha ia para a página 2.
    const semAperto = desenhar(capaDaProdutividade(p, UMA_PESSOA, contexto), planoDaProdutividade(p, UMA_PESSOA, anterior));
    expect(semAperto.paginas).toBe(2);
  });

  it('os 5 blocos com a observação no máximo: a observação vira linha cinza e o gráfico vira a tabela semanal', () => {
    const p = advogadaNoPeriodo(TRINTA.de, TRINTA.ate, 1, 'ADVOGADO', OS_CINCO);
    const anterior = {
      dados: advogadaNoPeriodo(TRINTA.anterior.de, TRINTA.anterior.ate, 0.8, 'ADVOGADO', OS_CINCO), periodo: TRINTA.anterior,
    };
    const d = documentoQueCabe(
      p, UMA_PESSOA, { de: TRINTA.de, ate: TRINTA.ate, emitidoPor: 'João Pedro', observacao: NO_MAXIMO }, anterior, {},
      medidorReal().medir,
    );
    expect(d.desenho?.paginas).toBe(1);
    expect(d.capa.observacao).toBeUndefined();
    expect(d.blocos[0]).toEqual({ tipo: 'nota', texto: `Observação: ${NO_MAXIMO}` });
    expect(d.blocos.some((b) => b.tipo === 'colunas')).toBe(false);
    expect(d.blocos.some((b) => b.tipo === 'tabela' && b.titulo?.startsWith('Atividades concluídas, semana a semana'))).toBe(true);
    // Coube, mas o gráfico que a pessoa pediu virou tabela: o toast diz por quê.
    expect(avisosDoPdf(d.avisos, true)).toEqual([
      { atencao: false, texto: 'Para caber na folha, o gráfico saiu em tabela, com os mesmos números.' },
    ]);
  });

  /**
   * QUANDO NEM O ÚLTIMO DEGRAU BASTA (15/09/2026). O diálogo limita a
   * observação a 240 caracteres; aqui ela passa disso de propósito, para a
   * folha não caber de jeito nenhum. O documento sai inteiro, em 2 folhas, e
   * o aviso vai para o toast.
   */
  it('o que não cabe nem no último degrau sai inteiro, em 2 folhas, com o aviso', () => {
    const p = advogadaNoPeriodo(TRINTA.de, TRINTA.ate, 1, 'ADVOGADO', OS_CINCO, { tipos: TIPOS_LONGOS });
    const anterior = {
      dados: advogadaNoPeriodo(TRINTA.anterior.de, TRINTA.anterior.ate, 0.8, 'ADVOGADO', OS_CINCO, { tipos: TIPOS_LONGOS }),
      periodo: TRINTA.anterior,
    };
    const enorme = 'Observação comprida demais para a folha de uma pessoa, escrita fora do diálogo. '.repeat(30);
    const d = documentoQueCabe(p, UMA_PESSOA, { de: TRINTA.de, ate: TRINTA.ate, emitidoPor: 'João Pedro', observacao: enorme }, anterior, {}, medidorReal().medir);
    expect(d.apertos).toEqual({ ana: 4 });
    expect(d.desenho?.paginas).toBe(2);
    expect(d.avisos.passaram).toEqual([NOME_COMPRIDO]);
    expect(avisosDoPdf(d.avisos, true)[0]).toEqual({
      atencao: true, texto: 'O PDF saiu em 2 folhas: mesmo apertado, o conteúdo não coube em uma.',
    });
  });

  /** "Uma página por pessoa" usa a mesma folha: com os 5 blocos, cada pessoa ainda ocupa uma folha. */
  it('no PDF da equipe com uma página por pessoa, os 5 blocos também cabem na folha de cada um', () => {
    for (const caso of PERIODOS) {
      const base = advogadaNoPeriodo(caso.de, caso.ate, 1, 'ADVOGADO', OS_CINCO);
      const pessoas = [0, 1, 2].map((i) => ({ ...base.pessoas[0], usuarioId: `p${i}`, nome: `${NOME_COMPRIDO} ${i}` }));
      const p: Produtividade = { ...base, pessoas };
      const antes = advogadaNoPeriodo(caso.anterior.de, caso.anterior.ate, 0.8, 'ADVOGADO', OS_CINCO);
      const anterior = { dados: { ...antes, pessoas: pessoas.map((l) => ({ ...antes.pessoas[0], usuarioId: l.usuarioId })) }, periodo: caso.anterior };
      const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'PAGINAS', graficos: true };
      const contexto = { de: caso.de, ate: caso.ate, emitidoPor: 'Ana', observacao: 'Para a reunião.' };
      const { medir } = medidorReal();
      const d = documentoQueCabe(p, escolhas, contexto, anterior, {}, medir);
      const resumo = medir(
        capaDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, contexto),
        planoDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, anterior),
      );
      expect(d.desenho?.paginas).toBe(resumo.paginas + pessoas.length);
      expect(d.avisos.passaram).toEqual([]);
    }
  }, 120_000);
});

/** A linha "por tipo" numa linha só, medida pela régua do próprio jsPDF (15/09/2026). */
describe('a linha "por tipo" no papel', () => {
  it('com os tipos de nome longo, cabe na célula mesclada da tabela; a linha de antes não cabia', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    doc.setFont('helvetica', 'normal');
    // A célula vai da coluna 1 ao fim: a largura útil menos a coluna do rótulo (44 mm) e a folga de 0,9 mm dos dois lados, em 7 pt.
    doc.setFontSize(7);
    const celula = doc.internal.pageSize.getWidth() - 2 * MARGEM - 44 - 2 * 0.9;
    const agora = linhaDosTipos(TIPOS_LONGOS)!;
    expect(doc.getTextWidth(agora)).toBeLessThanOrEqual(celula);
    const antes = [...TIPOS_LONGOS.slice(0, 3).map((t) => `${t.nome}: ${t.concluidas}`), 'outros tipos: 9'].join(' · ');
    expect(doc.getTextWidth(antes)).toBeGreaterThan(celula);
    // E é esta a linha que vai para a tabela da pessoa.
    const p = advogadaNoPeriodo(TRINTA.de, TRINTA.ate, 1, 'ADVOGADO', BLOCOS_DO_PERFIL.ADVOGADO, { tipos: TIPOS_LONGOS });
    const tabela = planoDaProdutividade(p, UMA_PESSOA).find(
      (b): b is Extract<BlocoDoPdf, { tipo: 'tabela' }> => b.tipo === 'tabela' && b.cabecalho[0] === 'Registro',
    )!;
    expect(tabela.linhas.find((l) => l[0].trim() === 'por tipo')).toEqual(['   por tipo', agora]);
  });
});

/**
 * O DOCUMENTO DA EQUIPE (15/09/2026). "Só os totais" com os 5 blocos e as
 * barras por tipo saía em 2 páginas; e a equipe com a tabela pessoa por pessoa
 * saía em 3, com a página 2 pela metade.
 */
describe('o documento da equipe no papel', () => {
  const OS_CINCO: Bloco[] = ['agenda', 'publicacoes', 'processos', 'filiados', 'atendimentos'];
  /*
    A EQUIPE DE VERDADE (15/09/2026): os 4 perfis, cada pessoa com os blocos do
    PRÓPRIO perfil, e os 5 blocos só pela união. A fábrica de antes fazia todo
    mundo advogado com os 5 blocos: a tabela "A equipe no período" saía com 1
    linha, e a prova de "só os totais cabe na página 1" valia para uma equipe
    que nenhum sindicato tem — a de 4 perfis saía sempre em 2 páginas.
  */
  const PERFIS_DA_EQUIPE = ['ADMINISTRADOR', 'ADVOGADO', 'ADVOGADO', 'ADVOGADO', 'COORDENACAO', 'COORDENACAO', 'TRIAGEM', 'TRIAGEM'];
  const equipe = (caso: (typeof PERIODOS)[number], quantas: number) => {
    const daPessoa = (de: string, ate: string, i: number, fator: number) => {
      const perfil = PERFIS_DA_EQUIPE[i % PERFIS_DA_EQUIPE.length];
      return advogadaNoPeriodo(de, ate, fator, perfil, BLOCOS_DO_PERFIL[perfil], {
        tipos: TIPOS_LONGOS, usuarioId: `p${i}`, nome: `Pessoa ${i + 1}`,
      }).pessoas[0];
    };
    const base = advogadaNoPeriodo(caso.de, caso.ate);
    const antes = advogadaNoPeriodo(caso.anterior.de, caso.anterior.ate);
    const p: Produtividade = { ...base, pessoas: Array.from({ length: quantas }, (_, i) => daPessoa(caso.de, caso.ate, i, 1)) };
    const anterior: AnteriorDaProdutividade = {
      dados: { ...antes, pessoas: Array.from({ length: quantas }, (_, i) => daPessoa(caso.anterior.de, caso.anterior.ate, i, 0.8)) },
      periodo: caso.anterior,
    };
    return { p, anterior };
  };

  it('"só os totais" da equipe com os 4 perfis e seis tipos cabe na página 1 em todos os períodos, com e sem comparação e gráficos', () => {
    const { medir, saida } = medidorReal();
    const tabelaDosPerfis = (blocos: BlocoDoPdf[]) =>
      blocos.find((b): b is Extract<BlocoDoPdf, { tipo: 'tabela' }> => b.tipo === 'tabela' && b.cabecalho[0] === 'Perfil');
    // O último degrau de ANTES das tabelas compactas: o do gráfico em tabela, com a observação sem caixa.
    const semCompactar = APERTOS_DO_RESUMO.findIndex((a) => a.tabelasCompactas) - 1;
    const falhas: string[] = [];
    for (const caso of PERIODOS) {
      const { p, anterior } = equipe(caso, 15);
      // O que se quis provar está mesmo na equipe: os 4 perfis e os 5 blocos só pela união.
      expect(new Set(p.pessoas.map((l) => l.perfil)).size).toBe(4);
      expect(p.pessoas.every((l) => [...blocosDaPessoa(l)].sort().join() === [...BLOCOS_DO_PERFIL[l.perfil]].sort().join())).toBe(true);
      expect([...new Set(p.pessoas.flatMap((l) => blocosDaPessoa(l)))].sort()).toEqual([...OS_CINCO].sort());
      for (const comparar of [true, false]) {
        for (const graficos of [true, false]) {
          const nome = `${caso.nome}, ${comparar ? 'com' : 'sem'} comparação, ${graficos ? 'com' : 'sem'} gráficos`;
          const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'NENHUM', graficos };
          const contexto = {
            de: caso.de, ate: caso.ate, emitidoPor: 'Ana', titulo: 'Conversa de setembro com a coordenação',
            observacao: 'Para a reunião de setembro.',
          };
          const antes = comparar ? anterior : null;
          const d = documentoQueCabe(p, escolhas, contexto, antes, {}, medir);
          if (d.desenho?.paginas !== 1 || d.avisos.resumoPassou) falhas.push(`${nome}: ${d.desenho?.paginas} páginas`);
          if (saida().includes('NaN')) falhas.push(`${nome}: NaN no PDF`);
          if (tabelaDosPerfis(d.blocos)?.linhas.length !== 4) falhas.push(`${nome}: a tabela da equipe não tem os 4 perfis`);
          // Se as barras saíram para caber, quem gerou fica sabendo.
          const temBarras = d.blocos.some((b) => b.tipo === 'barras');
          const avisos = avisosDoPdf(d.avisos, false).map((a) => a.texto).join(' ');
          if (!temBarras && !avisos.includes('as barras por tipo ficaram de fora')) falhas.push(`${nome}: as barras saíram sem aviso`);

          // Sem o aperto, e sem as tabelas compactas mesmo tirando as barras (o último degrau de antes), passava para a página 2.
          const semAperto = desenhar(capaDaProdutividade(p, escolhas, contexto), planoDaProdutividade(p, escolhas, antes));
          const deAntes = documentoDaProdutividade(p, escolhas, contexto, antes, {}, { [RESUMO_DA_EQUIPE]: semCompactar });
          const ultimoDeAntes = desenhar(deAntes.capa, deAntes.blocos.filter((b) => b.tipo !== 'barras'));
          if (semAperto.paginas !== 2 || ultimoDeAntes.paginas !== 2) {
            falhas.push(`${nome}: sem a correção saía em ${semAperto.paginas} e ${ultimoDeAntes.paginas} páginas`);
          }
        }
      }
    }
    expect(falhas).toEqual([]);
  }, 240_000);

  /** Oito pessoas: a tabela cabe na metade de página que o resumo deixa — o caso da captura de 14/09/2026. */
  it('a tabela pessoa por pessoa começa na mesma página em que o resumo termina, e o documento tem uma folha a menos', () => {
    const { p, anterior } = equipe(TRINTA, 8);
    const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'TABELA', graficos: true };
    const contexto = { de: TRINTA.de, ate: TRINTA.ate, emitidoPor: 'Ana', observacao: 'Para a reunião de setembro.' };
    const capa = capaDaProdutividade(p, escolhas, contexto);
    const plano = planoDaProdutividade(p, escolhas, anterior);
    const secao = plano.findIndex((b) => b.tipo === 'secao' && b.titulo === 'Pessoa por pessoa');
    const agora = desenhar(capa, plano);
    expect(agora.desenho.paginaDoBloco[secao]).toBe(agora.desenho.paginaDoBloco[secao - 1]);
    // Com a página nova de antes, a mesma equipe ganhava uma folha.
    const comPaginaNova = plano.map((b, i) => (i === secao ? { ...b, novaPagina: true } : b));
    expect(desenhar(capa, comPaginaNova).paginas).toBe(agora.paginas + 1);
    expect(agora.saida).not.toContain('NaN');
  });
});

/**
 * OS DOIS PDFS QUE NÃO PODIAM MUDAR. Números colhidos com o código de ANTES
 * dos blocos novos (14/09/2026), nos dois sindicatos — e, na mesma rodada,
 * a saída dos quatro documentos saiu idêntica byte a byte, antes e depois.
 */
describe('o PDF do sindicato e o do panorama continuam do mesmo tamanho', () => {
  const CAPA: CapaDoDocumento = {
    faixa: 'Relatório · agosto de 2026',
    titulo: 'Relatório do sindicato',
    periodo: '13 de agosto a 12 de setembro de 2026',
    apoio: 'Toda a equipe · Emitido por Ana em 14/09/2026',
    observacao: 'Para a assembleia.',
  };
  const anterior = { relatorio: relatorioCheio(-5), periodo: { de: '2026-07-13', ate: '2026-08-12' } };

  it.each([
    [true, 6],
    [false, 6],
  ])('relatório com tudo detalhado e comparação, gráficos %s: %i páginas, sem NaN', (graficos, paginas) => {
    const doc = desenhar(
      CAPA,
      planoDoPdf(relatorioCheio(), RELATORIO_TUDO_DETALHADO, ROTULOS_DE_TESTE, 2026, { graficos, anterior }),
    );
    expect(doc.paginas).toBe(paginas);
    expect(doc.saida).not.toContain('NaN');
  });

  it.each([
    [true, 6],
    [false, 3],
  ])('panorama com tudo detalhado, gráficos %s: %i páginas, sem NaN', (graficos, paginas) => {
    const p = panoramaCheio();
    const doc = desenhar(
      capaDoPanorama(p, { emitidoPor: 'Ana', observacao: 'Para a reunião.' }),
      planoDoPanorama(p, PANORAMA_TUDO_DETALHADO, 2026, { graficos }),
    );
    expect(doc.paginas).toBe(paginas);
    expect(doc.saida).not.toContain('NaN');
  });
});
