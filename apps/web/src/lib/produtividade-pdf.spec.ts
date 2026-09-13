import { foraDaFontePadrao } from './pdf-graficos';
import type { BlocoDoPdf } from './pdf-documento';
import { O_QUE_NAO_MEDE, type LinhaDeUso, type Produtividade } from './produtividade';
import {
  nomeDoRecorte, pessoasDoRecorte, planoDaProdutividade, type EscolhasDaProdutividade,
} from './produtividade-pdf';

/** 62 dias, de 13/07 a 12/09/2026: atravessa três meses e ainda desenha um traço por dia. */
const DIAS = Array.from({ length: 62 }, (_, i) => new Date(Date.UTC(2026, 6, 13 + i)).toISOString().slice(0, 10));
const MESES = ['2026-07', '2026-08', '2026-09'];

const porMes = (concluidas: number[], atendimentos = [0, 0, 0]) =>
  MESES.map((mes, i) => ({
    mes, diasComUso: concluidas[i] + atendimentos[i] ? 5 : 0, concluidas: concluidas[i], andamentos: 0,
    atendimentos: atendimentos[i],
  }));

const linha = (over: Partial<LinhaDeUso> & Pick<LinhaDeUso, 'usuarioId' | 'nome' | 'perfil'>): LinhaDeUso => ({
  avatarUrl: null,
  avatarKey: null,
  ultimoAcesso: '2026-09-12T13:00:00.000Z',
  diasComUso: 0,
  diasAtivos: [],
  agenda: { concluidas: 0, noDiaMarcado: 0, criadas: 0, abertas: 0, atrasadas: 0 },
  publicacoes: { decididas: 0, esperando: 0 },
  processos: { cadastrados: 0, andamentos: 0, documentos: 0 },
  filiados: { cadastrados: 0, fichasAtualizadas: 0 },
  atendimentos: 0,
  porMes: porMes([0, 0, 0]),
  ...over,
});

/** Nomes inventados; a ordem é a da API — perfil, depois nome. */
const BASE: Produtividade = {
  periodo: { de: '2026-07-13T03:00:00.000Z', ate: '2026-09-13T03:00:00.000Z' },
  escopo: 'GLOBAL',
  dias: DIAS,
  meses: MESES,
  perfis: [
    { perfil: 'ADVOGADO', pessoas: 2, usaram: 1, semAcessoRecente: 0, nuncaEntraram: 1 },
    { perfil: 'TRIAGEM', pessoas: 1, usaram: 1, semAcessoRecente: 0, nuncaEntraram: 0 },
  ],
  pessoas: [
    linha({
      usuarioId: 'ana', nome: 'Dra. Ana', perfil: 'ADVOGADO', diasComUso: 20, diasAtivos: DIAS.slice(0, 20),
      agenda: { concluidas: 12, noDiaMarcado: 10, criadas: 3, abertas: 4, atrasadas: 1 },
      porMes: porMes([4, 5, 3]),
    }),
    linha({ usuarioId: 'bruno', nome: 'Dr. Bruno', perfil: 'ADVOGADO', ultimoAcesso: null }),
    linha({
      usuarioId: 'ivo', nome: 'Ivo', perfil: 'TRIAGEM', diasComUso: 30, atendimentos: 9,
      porMes: porMes([0, 0, 0], [3, 3, 3]),
    }),
  ],
  geradoEm: '2026-09-12T15:00:00.000Z',
};

const escolhas = (over: Partial<EscolhasDaProdutividade> = {}): EscolhasDaProdutividade => ({
  quem: 'TODOS', detalhe: 'TABELA', graficos: true, ...over,
});

const titulos = (blocos: BlocoDoPdf[]) => blocos.flatMap((b) => ('titulo' in b && b.titulo ? [b.titulo] : []));
const tabelaDasPessoas = (blocos: BlocoDoPdf[]) =>
  blocos.find((b) => b.tipo === 'tabela' && b.cabecalho[0] === 'Pessoa') as
    | Extract<BlocoDoPdf, { tipo: 'tabela' }>
    | undefined;

/**
 * "NÃO É INTERESSANTE GERAR PDF DA PRODUTIVIDADE? MENSAL, ANUAL, PERSONALIZADO,
 * POR ADVOGADO" — 12/09/2026. As decisões da aba valem no papel.
 */
describe('o PDF do uso do sistema', () => {
  /** O papel sai da sala sem quem explicaria o que o número não mede. */
  it('abre com o aviso do que os números não medem — em qualquer recorte', () => {
    for (const quem of ['TODOS', 'PERFIL:ADVOGADO', 'PESSOA:ana'] as const) {
      expect(planoDaProdutividade(BASE, escolhas({ quem }))[0]).toEqual({
        tipo: 'destaque', rotulo: 'Antes de ler', texto: O_QUE_NAO_MEDE,
      });
    }
  });

  it('o recorte: a equipe, um perfil, uma pessoa', () => {
    expect(pessoasDoRecorte(BASE, 'PERFIL:ADVOGADO').map((l) => l.usuarioId)).toEqual(['ana', 'bruno']);
    expect(pessoasDoRecorte(BASE, 'PESSOA:ivo').map((l) => l.usuarioId)).toEqual(['ivo']);
    expect(nomeDoRecorte(BASE, 'TODOS')).toBe('Toda a equipe');
    expect(nomeDoRecorte(BASE, 'PERFIL:ADVOGADO')).toBe('Advogados');
    expect(nomeDoRecorte(BASE, 'PESSOA:ivo')).toBe('Ivo');
    expect(titulos(planoDaProdutividade(BASE, escolhas()))).toContain('Por perfil');
    expect(titulos(planoDaProdutividade(BASE, escolhas({ quem: 'PERFIL:ADVOGADO' })))).not.toContain('Por perfil');
  });

  /** Sem posição: quem concluiu mais não sobe na tabela. */
  it('a tabela pessoa por pessoa segue a ordem da API, e não o volume', () => {
    const tabela = tabelaDasPessoas(planoDaProdutividade(BASE, escolhas()))!;
    expect(tabela.linhas.map((l) => l[0].split('\n')[0])).toEqual(['Dra. Ana', 'Dr. Bruno', 'Ivo']);
  });

  /** Barra por pessoa é pódio desenhado: o gráfico é do tempo. */
  it('nenhum gráfico põe pessoas lado a lado', () => {
    const nomes = BASE.pessoas.map((l) => l.nome);
    for (const b of planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS' }))) {
      if (b.tipo === 'barras') expect(b.itens.some((i) => nomes.includes(i.rotulo))).toBe(false);
      if (b.tipo === 'colunas') expect(b.categorias.some((c) => nomes.includes(c))).toBe(false);
    }
  });

  it('uma pessoa: a página dela, sem resumo de grupo e sem tabela', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }));
    expect(titulos(blocos)).not.toContain('Resumo');
    expect(tabelaDasPessoas(blocos)).toBeUndefined();
    expect(blocos.find((b) => b.tipo === 'secao' && b.titulo === 'Dra. Ana')).toMatchObject({ novaPagina: false });
    expect(blocos.some((b) => b.tipo === 'faixa')).toBe(true);
  });

  it('uma página por pessoa: cada uma começa numa página nova', () => {
    const paginas = planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS' })).filter(
      (b) => b.tipo === 'secao' && BASE.pessoas.some((l) => l.nome === b.titulo),
    );
    expect(paginas).toHaveLength(3);
    expect(paginas.every((b) => b.tipo === 'secao' && b.novaPagina)).toBe(true);
  });

  it('"só os totais" não leva o nome de ninguém', () => {
    const texto = JSON.stringify(planoDaProdutividade(BASE, escolhas({ detalhe: 'NENHUM' })));
    for (const l of BASE.pessoas) expect(texto).not.toContain(l.nome);
  });

  /** "Atendimentos: 0" em todos os meses de um advogado é ruído. */
  it('mês a mês: série zerada não entra na legenda', () => {
    const colunas = planoDaProdutividade(BASE, escolhas({ quem: 'PERFIL:ADVOGADO' })).find((b) => b.tipo === 'colunas');
    expect(colunas).toMatchObject({
      categorias: ['jul', 'ago', 'set'],
      series: [{ nome: 'Atividades concluídas' }],
      valores: [[4, 5, 3]],
      detalhes: ['1 pessoa', '1 pessoa', '1 pessoa'],
    });
  });

  it('sem gráficos, o mês a mês sai em tabela', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ graficos: false }));
    expect(blocos.some((b) => b.tipo === 'colunas')).toBe(false);
    expect(blocos.find((b) => b.tipo === 'tabela' && b.titulo === 'Mês a mês')).toBeDefined();
  });

  it('período de um mês não desenha mês a mês', () => {
    const umMes = { ...BASE, dias: DIAS.slice(-31), meses: ['2026-08', '2026-09'] };
    expect(titulos(planoDaProdutividade(umMes, escolhas()))).not.toContain('Mês a mês');
  });

  /** A API de antes do deploy não manda `porMes`: sai sem o gráfico, sem quebrar. */
  it('sem o mês a mês da API, o PDF sai sem ele', () => {
    const antiga: Produtividade = {
      ...BASE,
      meses: undefined,
      pessoas: BASE.pessoas.map((l) => ({ ...l, porMes: undefined })),
    };
    expect(titulos(planoDaProdutividade(antiga, escolhas()))).not.toContain('Mês a mês');
  });

  /** Em aberto e atrasadas são de hoje: pedidas para o período anterior, voltariam iguais. */
  it('compara o trabalho do período, e diz quantos dias a pessoa usou antes', () => {
    const antes: Produtividade = {
      ...BASE,
      pessoas: BASE.pessoas.map((l) => ({
        ...l,
        diasComUso: l.diasComUso ? 15 : 0,
        agenda: { ...l.agenda, concluidas: l.agenda.concluidas ? 9 : 0 },
      })),
    };
    const blocos = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }), {
      dados: antes, periodo: { de: '2026-05-12', ate: '2026-07-12' },
    });
    const numeros = blocos.find((b) => b.tipo === 'numeros') as Extract<BlocoDoPdf, { tipo: 'numeros' }>;
    const agenda = numeros.itens.find((i) => i.rotulo.startsWith('Agenda'))!;
    expect(agenda.valor).toBe('12');
    expect(agenda.comparacao).toBe('antes 9 · +3');
    const faixa = blocos.find((b) => b.tipo === 'faixa') as Extract<BlocoDoPdf, { tipo: 'faixa' }>;
    expect(faixa.legenda).toBe('20 de 62 dias com uso · antes 15');
  });

  it('nada no plano que a fonte do PDF não saiba desenhar', () => {
    const plano = planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS' }));
    expect(foraDaFontePadrao(JSON.stringify(plano))).toEqual([]);
  });
});
