import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ESCOLHAS_PADRAO, NOTA_DO_CNJ, planoDoPdf, secaoDisponivel,
  type BlocoDoPdf, type EscolhasDoPdf, type RotulosDoPdf,
} from '@/lib/relatorio-pdf';
import {
  fraseDasSentencas, hrefDaComarca, hrefDaParteContraria, hrefDoAssunto, type Relatorio,
} from '@/lib/relatorios';

const TELA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

const rotulos: RotulosDoPdf = {
  tipo: (s) => s, area: (s) => s, canal: (s) => s, assunto: (s) => s, setor: (s) => s,
};

/** Um mês parecido com o de 12/09/2026 — nomes de pessoas inventados. */
const base: Relatorio = {
  periodo: { de: '2026-08-13T03:00:00.000Z', ate: '2026-09-13T03:00:00.000Z' },
  escopo: 'GLOBAL',
  focoUsuario: null,
  equipe: [
    {
      usuarioId: 'u1', nome: 'Dra. Ana', papel: 'ADVOGADO',
      concluidas: 12, abertas: 3, atrasadas: 1, medianaMinutos: 20, cronometradas: 4,
    },
    {
      usuarioId: 'u2', nome: 'Dr. Bruno', papel: 'ADVOGADO',
      concluidas: 0, abertas: 2, atrasadas: 2, medianaMinutos: null, cronometradas: 0,
    },
  ],
  atividades: {
    concluidas: 12, canceladas: 2, abertas: 5, atrasadas: 3, porDesfecho: [],
    porTipo: [{ rotulo: 'PRAZO', total: 5 }], automaticas: 4, manuais: 8,
  },
  processos: {
    cadastrados: 3, distribuidos: 1, ativos: 149, encerrados: 29, semDataDeDistribuicao: 1,
    porArea: [], porTribunal: [],
  },
  atendimentos: {
    registrados: 9, concluidos: 7, filiadosAtendidos: 7, porCanal: [], porAtendente: [],
    porAssunto: [], assuntoNaoInformado: 6, porSetor: [],
  },
  justica: {
    nossoPapel: { autor: 117, representando: 26, reu: 6 },
    institucionais: 117,
    individuais: 32,
    sentencasPorAno: [
      { ano: 2025, procedentes: 9, parciais: 20, improcedentes: 5 },
      { ano: 2026, procedentes: 6, parciais: 13, improcedentes: 8 },
    ],
    ajuizadasPorAno: [
      { ano: 2025, processos: 40 },
      { ano: 2026, processos: 36 },
    ],
    sentencasNoPeriodo: [],
    totalSentencasNoPeriodo: 0,
    adversarios: [],
    comarcas: [],
    temas: [],
  },
  proximos: { dias: 30, audiencias: [], totalAudiencias: 2, prazos: [], totalPrazos: 6 },
  publicacoes: { recebidas: 102, viraramTarefa: 28, dispensadas: 66, esperandoDecisao: 7 },
  robo: { criadas: 39, concluidas: 15, canceladasPeloRobo: 14, canceladasPorPessoas: 2, abertas: 8 },
  geradoEm: '2026-09-12T12:00:00.000Z',
};

const titulos = (blocos: BlocoDoPdf[]) =>
  blocos.flatMap((b) => (b.tipo === 'secao' || b.tipo === 'tabela' ? [b.titulo] : []));

const com = (mudar: Partial<EscolhasDoPdf>): EscolhasDoPdf => ({ ...ESCOLHAS_PADRAO, ...mudar });

/**
 * "NÃO SERIA INTERESSANTE BAIXAR EM PDF, MARCANDO O QUE QUER DETALHAR?" — pedido
 * de 12/09/2026. A regra de O QUE entra é função pura, e é ela que se prova aqui.
 */
describe('o PDF do relatório', () => {
  it('o resumo entra sempre, mesmo sem nenhuma seção marcada', () => {
    const nada = Object.fromEntries(
      Object.keys(ESCOLHAS_PADRAO).map((k) => [k, { incluir: false, detalhar: false }]),
    ) as EscolhasDoPdf;
    expect(titulos(planoDoPdf(base, nada, rotulos, 2026))).toEqual(['Resumo do período']);
  });

  /**
   * A TABELA POR PESSOA COMEÇA DESLIGADA — a decisão de não fazer placar
   * aplicada ao papel que sai da sala. A coordenação liga quando quer.
   */
  it('a tabela por pessoa só sai quando alguém pede o detalhe da equipe', () => {
    expect(ESCOLHAS_PADRAO.equipe).toEqual({ incluir: true, detalhar: false });
    expect(titulos(planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026))).not.toContain(
      'Por pessoa, em ordem alfabética',
    );
    const detalhado = planoDoPdf(base, com({ equipe: { incluir: true, detalhar: true } }), rotulos, 2026);
    expect(titulos(detalhado)).toContain('Por pessoa, em ordem alfabética');
  });

  it('detalhar sem incluir não põe nada', () => {
    const blocos = planoDoPdf(base, com({ justica: { incluir: false, detalhar: true } }), rotulos, 2026);
    expect(titulos(blocos)).not.toContain('O sindicato na Justiça');
    expect(titulos(blocos)).not.toContain('Contra quem');
  });

  /** O papel sai da sala sem quem saberia explicar os meses fracos: o aviso vai junto. */
  it('a Justiça leva a frase do ano, as tabelas e o aviso do CNJ', () => {
    const blocos = planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026);
    expect(titulos(blocos)).toEqual(
      expect.arrayContaining(['O sindicato na Justiça', 'Sentenças por ano', 'Ações ajuizadas por ano']),
    );
    expect(blocos).toContainEqual({ tipo: 'nota', texto: NOTA_DO_CNJ });
    expect(blocos).toContainEqual({
      tipo: 'texto',
      texto: fraseDasSentencas(base.justica!.sentencasPorAno, 2026),
    });
  });

  /** Seção que a API não mandou não vira escolha, nem página vazia. */
  it('o advogado não recebe publicações, e o PDF não inventa a seção', () => {
    const doAdvogado: Relatorio = { ...base, escopo: 'PESSOAL', publicacoes: null, robo: null };
    expect(secaoDisponivel(doAdvogado, 'publicacoes')).toBe(false);
    const blocos = planoDoPdf(doAdvogado, ESCOLHAS_PADRAO, rotulos, 2026);
    expect(titulos(blocos)).not.toContain('Publicações e robô');
    expect(titulos(blocos)).toContain('Os seus números');
  });

  it('diz de onde vem o prazo: da agenda, e não do tribunal', () => {
    const blocos = planoDoPdf(base, com({ proximos: { incluir: true, detalhar: true } }), rotulos, 2026);
    const notas = blocos.flatMap((b) => (b.tipo === 'nota' ? [b.texto] : []));
    expect(notas.some((t) => t.includes('não o prazo processual'))).toBe(true);
  });
});

describe('a frase do ano', () => {
  /** "A favor" soma procedente e parcial, mas mostra as duas partes. */
  it('usa o último ano fechado e mostra as duas procedências', () => {
    expect(fraseDasSentencas(base.justica!.sentencasPorAno, 2026)).toBe(
      'Em 2025, 29 de 34 sentenças foram a favor, ao menos em parte (9 por inteiro e 20 em parte).',
    );
  });

  it('sem ano fechado com sentença, não inventa frase', () => {
    expect(
      fraseDasSentencas([{ ano: 2026, procedentes: 3, parciais: 0, improcedentes: 0 }], 2026),
    ).toBeNull();
  });
});

describe('a tela de relatórios', () => {
  /** O sistema conhece a data da agenda, não o prazo processual. */
  it('não escreve mais "com prazo vencido"', () => {
    expect(TELA).not.toContain('com prazo vencido');
  });

  it('o PDF abre a escolha de seções, e a planilha continua', () => {
    expect(TELA).toContain('<EscolherPdf');
    expect(TELA).toContain('Baixar PDF');
    expect(TELA).toContain('baixarCsvDaEquipe(de, ate, foco || undefined)');
    expect(TELA).toContain("onChange={() => alternar(s.chave, 'detalhar')}");
  });

  /** Com o foco numa pessoa, a API manda uma linha só — e o seletor sumia junto. */
  it('o seletor de pessoa não some quando há foco', () => {
    expect(TELA).toContain("if (data && data.escopo === 'GLOBAL' && !data.focoUsuario) {");
    expect(TELA).toContain("{aba === 'sindicato' && !pessoal && pessoas.length > 1 && (");
  });

  /** Número que muda quando se clica nele é pior que número nenhum. */
  it('as linhas do acervo abrem a lista com o recorte que contaram', () => {
    expect(TELA).toContain('href="/processos?nossoPapel=AUTOR&status=ATIVO"');
    expect(TELA).toContain('href={hrefDaParteContraria}');
    expect(TELA).toContain('href={hrefDaComarca}');
    expect(TELA).toContain('href={hrefDoAssunto}');
    expect(hrefDaComarca({ chave: '2211001', rotulo: 'Teresina', total: 68 })).toBe(
      '/processos?comarca=2211001&comarcaNome=Teresina&status=ATIVO',
    );
    expect(hrefDaParteContraria({ chave: 'abc', rotulo: 'HAPVIDA', total: 7 })).toBe(
      '/processos?parteExternaId=abc&status=ATIVO',
    );
    expect(hrefDoAssunto({ rotulo: 'Piso Salarial', total: 16 })).toBe(
      '/processos?assunto=Piso%20Salarial&status=ATIVO',
    );
  });

  it('a fila de publicações leva à busca já filtrada', () => {
    expect(TELA).toContain('href="/publicacoes?situacao=SEM_DECISAO"');
  });
});
