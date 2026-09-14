/**
 * @jest-environment node
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { montarDocumento, type BlocoDoPdf, type CapaDoDocumento, type MedidorDeDocumento } from './pdf-documento';
import { capaDoPanorama, planoDoPanorama } from './panorama-pdf';
import { planoDoPdf } from './relatorio-pdf';
import {
  PANORAMA_TUDO_DETALHADO, RELATORIO_TUDO_DETALHADO, ROTULOS_DE_TESTE, panoramaCheio, relatorioCheio,
} from './fixtures-dos-pdfs';
import {
  BLOCOS_DO_PERFIL, blocosDaPessoa, segundaFeiraDe, semanasDosDias, type Bloco, type LinhaDeUso, type Produtividade,
} from './produtividade';
import {
  OBSERVACAO_NA_FOLHA_DA_PESSOA, capaDaProdutividade, documentoQueCabe, planoDaProdutividade,
  type AnteriorDaProdutividade, type EscolhasDaProdutividade,
} from './produtividade-pdf';

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
 * Nomes inventados.
 */

function desenhar(capa: CapaDoDocumento, blocos: BlocoDoPdf[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const desenho = montarDocumento(doc, autoTable, capa, blocos, null);
  return { paginas: doc.getNumberOfPages(), saida: doc.output(), fim: desenho.fim };
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
    usuarioId: 'ana',
    nome: NOME_COMPRIDO,
    perfil,
    avatarUrl: null,
    ultimoAcesso: '2026-09-13T18:27:00.000Z',
    contaCriadaEm: '2024-01-10T12:00:00.000Z',
    diasComUso: diasAtivos.length,
    diasAtivos,
    agenda: {
      concluidas: concluidasEm(dias),
      noDiaMarcado: Math.round(concluidasEm(dias) * 0.75),
      criadas: 12 * fator,
      abertas: 8,
      atrasadas: 1,
      porTipo: [
        { tipo: 'PRAZO', nome: 'Prazo', concluidas: 8, noDiaMarcado: 7 },
        { tipo: 'AUDIENCIA', nome: 'Audiência', concluidas: 5, noDiaMarcado: 5 },
        { tipo: 'REUNIAO', nome: 'Reunião', concluidas: 3, noDiaMarcado: 2 },
        { tipo: 'PERICIA', nome: 'Perícia', concluidas: 2, noDiaMarcado: 1 },
      ],
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
    geradoEm: '2026-09-13T19:37:00.000Z',
  };
}

const UMA_PESSOA: EscolhasDaProdutividade = { quem: 'PESSOA:ana', detalhe: 'PAGINAS', graficos: true, fotos: true };

function folhaDaPessoa(de: string, ate: string, anterior: { de: string; ate: string }, escolhas = UMA_PESSOA) {
  const p = advogadaNoPeriodo(de, ate);
  const antes: AnteriorDaProdutividade = { dados: advogadaNoPeriodo(anterior.de, anterior.ate, 0.8), periodo: anterior };
  const plano = planoDaProdutividade(p, escolhas, antes);
  const capa = capaDaProdutividade(p, escolhas, { de, ate, emitidoPor: 'João Pedro' });
  return { plano, ...desenhar(capa, plano) };
}

const PERIODOS = [
  { nome: '31 dias', de: '2026-08-14', ate: '2026-09-13', anterior: { de: '2026-07-14', ate: '2026-08-13' }, grafico: 'semana a semana' },
  { nome: '90 dias', de: '2026-06-16', ate: '2026-09-13', anterior: { de: '2026-03-18', ate: '2026-06-15' }, grafico: 'semana a semana' },
  { nome: 'um ano', de: '2025-09-14', ate: '2026-09-13', anterior: { de: '2024-09-14', ate: '2025-09-13' }, grafico: 'mês a mês' },
];

describe('o documento de uma pessoa cabe em UMA folha', () => {
  const casos = PERIODOS;

  for (const caso of casos) {
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
    const { paginas, saida } = folhaDaPessoa('2026-06-16', '2026-09-13', { de: '2026-03-18', ate: '2026-06-15' }, {
      ...UMA_PESSOA, graficos: false,
    });
    expect(paginas).toBe(1);
    expect(saida).not.toContain('NaN');
  });

  /** "Uma página por pessoa": cada pessoa numa folha, e nenhuma transborda para a seguinte. */
  it('no PDF da equipe com uma página por pessoa, cada pessoa ocupa uma folha', () => {
    const base = advogadaNoPeriodo('2026-06-16', '2026-09-13');
    const pessoas = [0, 1, 2].map((i) => ({ ...base.pessoas[0], usuarioId: `p${i}`, nome: `${NOME_COMPRIDO} ${i}` }));
    const p: Produtividade = { ...base, pessoas };
    const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'PAGINAS', graficos: true };
    const plano = planoDaProdutividade(p, escolhas, null);
    const { paginas, saida } = desenhar(capaDaProdutividade(p, escolhas, { de: '2026-06-16', ate: '2026-09-13', emitidoPor: 'Ana' }), plano);
    const resumo = desenhar(
      capaDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, { de: '2026-06-16', ate: '2026-09-13', emitidoPor: 'Ana' }),
      planoDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, null),
    );
    expect(paginas).toBe(resumo.paginas + pessoas.length);
    expect(saida).not.toContain('NaN');
  });

  it('a tabela pessoa por pessoa, com o cabeçalho em duas linhas, desenha sem NaN', () => {
    const base = advogadaNoPeriodo('2026-08-14', '2026-09-13');
    const pessoas = Array.from({ length: 15 }, (_, i) => ({
      ...base.pessoas[0], usuarioId: `p${i}`, nome: `Pessoa ${i + 1}`, ultimoAcesso: i % 4 ? base.pessoas[0].ultimoAcesso : null,
    }));
    const p: Produtividade = { ...base, pessoas };
    const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'TABELA', graficos: true };
    const antes: AnteriorDaProdutividade = { dados: advogadaNoPeriodo('2026-07-14', '2026-08-13'), periodo: { de: '2026-07-14', ate: '2026-08-13' } };
    const { paginas, saida } = desenhar(
      capaDaProdutividade(p, escolhas, { de: '2026-08-14', ate: '2026-09-13', emitidoPor: 'Ana' }),
      planoDaProdutividade(p, escolhas, antes),
    );
    expect(paginas).toBeGreaterThanOrEqual(2);
    expect(saida).not.toContain('NaN');
    expect(saida).toContain('Pessoa por pessoa');
  });
});

/**
 * A MATRIZ DA FOLHA ÚNICA (14/09/2026). A prova de antes só cobria o quarto
 * bloco de UMA linha. Aqui cada combinação passa por `documentoQueCabe`, que
 * aperta a folha em degraus (`APERTOS_DA_FOLHA`), e o jsPDF real conta as
 * páginas: 4 perfis × 3 conjuntos de blocos × 3 períodos × comparação ×
 * gráfico × 3 observações × título, sempre com o nome comprido.
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
    ['observação de uma linha', UMA_LINHA],
    ['observação no máximo', NO_MAXIMO],
  ] as const;
  const TITULOS = [undefined, 'Conversa de setembro com a coordenação'];

  /** O medidor com o jsPDF real; guarda o último documento para conferir o NaN sem desenhar de novo. */
  function medidorReal() {
    const ultimo: { doc?: jsPDF } = {};
    const medir: MedidorDeDocumento = (capa, blocos) => {
      ultimo.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      return montarDocumento(ultimo.doc, autoTable, capa, blocos, null);
    };
    return { medir, saida: () => ultimo.doc?.output() ?? '' };
  }
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
      it(`${perfil}, ${conjunto}: as 72 combinações saem em 1 página, sem NaN e sem cortar nada`, () => {
        // O que se quis provar está mesmo na pessoa: os blocos pedidos, e só eles.
        const amostra = advogadaNoPeriodo(PERIODOS[0].de, PERIODOS[0].ate, 1, perfil, blocos);
        expect([...blocosDaPessoa(amostra.pessoas[0])].sort()).toEqual([...blocos].sort());

        const { medir, saida } = medidorReal();
        const falhas: string[] = [];
        let combinacoes = 0;
        for (const periodo of PERIODOS) {
          const p = advogadaNoPeriodo(periodo.de, periodo.ate, 1, perfil, blocos);
          for (const comparar of [true, false]) {
            const anterior: AnteriorDaProdutividade | null = comparar
              ? { dados: advogadaNoPeriodo(periodo.anterior.de, periodo.anterior.ate, 0.8, perfil, blocos), periodo: periodo.anterior }
              : null;
            for (const graficos of [true, false]) {
              const escolhas: EscolhasDaProdutividade = { ...UMA_PESSOA, graficos };
              const semAperto = registrosDe(planoDaProdutividade(p, escolhas, anterior));
              for (const [comoObservacao, observacao] of OBSERVACOES) {
                for (const titulo of TITULOS) {
                  combinacoes += 1;
                  const contexto = { de: periodo.de, ate: periodo.ate, emitidoPor: 'João Pedro', titulo, observacao };
                  const d = documentoQueCabe(p, escolhas, contexto, anterior, {}, medir);
                  const nome = [
                    periodo.nome, comparar ? 'com comparação' : 'sem comparação', graficos ? 'com gráfico' : 'sem gráfico',
                    comoObservacao, titulo ? 'com título' : 'sem título', `degrau ${d.apertos.ana ?? 0}`,
                  ].join(', ');
                  if (d.desenho?.paginas !== 1) falhas.push(`${nome}: ${d.desenho?.paginas} páginas`);
                  // `fim` já soma os 6 mm de folga depois da última tabela (medido: 277,1 com o conteúdo em 271,1).
                  // O que não pode é chegar ao fio do rodapé, a 285 mm.
                  else if (d.desenho.fim > 285) falhas.push(`${nome}: termina em ${d.desenho.fim} mm, no rodapé`);
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
        expect(combinacoes).toBe(72);
        expect(falhas).toEqual([]);
      }, 180_000);
    }
  }

  /** A ordem dos degraus no papel: com pouco a apertar, a caixa da observação fica e só o gráfico baixa. */
  it('advogada com três blocos e uma observação de uma linha: o gráfico baixa, a caixa fica', () => {
    const [, noventa] = PERIODOS;
    const p = advogadaNoPeriodo(noventa.de, noventa.ate);
    const anterior = { dados: advogadaNoPeriodo(noventa.anterior.de, noventa.anterior.ate, 0.8), periodo: noventa.anterior };
    const d = documentoQueCabe(
      p, UMA_PESSOA, { de: noventa.de, ate: noventa.ate, emitidoPor: 'João Pedro', observacao: UMA_LINHA }, anterior, {},
      medidorReal().medir,
    );
    expect(d.desenho?.paginas).toBe(1);
    expect(d.capa.observacao).toBe(UMA_LINHA);
    const grafico = d.blocos.find((b): b is Extract<BlocoDoPdf, { tipo: 'colunas' }> => b.tipo === 'colunas');
    expect(grafico?.altura).toBeLessThan(22);
    // Sem o aperto, a mesma folha ia para a página 2.
    const semAperto = desenhar(
      capaDaProdutividade(p, UMA_PESSOA, { de: noventa.de, ate: noventa.ate, emitidoPor: 'João Pedro', observacao: UMA_LINHA }),
      planoDaProdutividade(p, UMA_PESSOA, anterior),
    );
    expect(semAperto.paginas).toBe(2);
  });

  it('os 5 blocos com a observação no máximo: a observação vira linha cinza e o gráfico vira a tabela semanal', () => {
    const [trinta] = PERIODOS;
    const p = advogadaNoPeriodo(trinta.de, trinta.ate, 1, 'ADVOGADO', OS_CINCO);
    const anterior = {
      dados: advogadaNoPeriodo(trinta.anterior.de, trinta.anterior.ate, 0.8, 'ADVOGADO', OS_CINCO), periodo: trinta.anterior,
    };
    const d = documentoQueCabe(
      p, UMA_PESSOA, { de: trinta.de, ate: trinta.ate, emitidoPor: 'João Pedro', observacao: NO_MAXIMO }, anterior, {},
      medidorReal().medir,
    );
    expect(d.desenho?.paginas).toBe(1);
    expect(d.capa.observacao).toBeUndefined();
    expect(d.blocos[0]).toEqual({ tipo: 'nota', texto: `Observação: ${NO_MAXIMO}` });
    expect(d.blocos.some((b) => b.tipo === 'colunas')).toBe(false);
    expect(d.blocos.some((b) => b.tipo === 'tabela' && b.titulo?.startsWith('Atividades concluídas, semana a semana'))).toBe(true);
  });

  /** "Uma página por pessoa" usa a mesma folha: com os 5 blocos, cada pessoa ainda ocupa uma folha. */
  it('no PDF da equipe com uma página por pessoa, os 5 blocos também cabem na folha de cada um', () => {
    for (const periodo of PERIODOS) {
      const base = advogadaNoPeriodo(periodo.de, periodo.ate, 1, 'ADVOGADO', OS_CINCO);
      const pessoas = [0, 1, 2].map((i) => ({ ...base.pessoas[0], usuarioId: `p${i}`, nome: `${NOME_COMPRIDO} ${i}` }));
      const p: Produtividade = { ...base, pessoas };
      const antes = advogadaNoPeriodo(periodo.anterior.de, periodo.anterior.ate, 0.8, 'ADVOGADO', OS_CINCO);
      const anterior = { dados: { ...antes, pessoas: pessoas.map((l) => ({ ...antes.pessoas[0], usuarioId: l.usuarioId })) }, periodo: periodo.anterior };
      const escolhas: EscolhasDaProdutividade = { quem: 'TODOS', detalhe: 'PAGINAS', graficos: true };
      const contexto = { de: periodo.de, ate: periodo.ate, emitidoPor: 'Ana', observacao: 'Para a reunião.' };
      const { medir } = medidorReal();
      const d = documentoQueCabe(p, escolhas, contexto, anterior, {}, medir);
      const resumo = medir(
        capaDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, contexto),
        planoDaProdutividade(p, { ...escolhas, detalhe: 'NENHUM' }, anterior),
      );
      expect(d.desenho?.paginas).toBe(resumo.paginas + pessoas.length);
    }
  }, 60_000);
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
