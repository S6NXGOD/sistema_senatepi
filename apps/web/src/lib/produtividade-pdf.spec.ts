import { foraDaFontePadrao } from './pdf-graficos';
import type { BlocoDoPdf } from './pdf-documento';
import {
  CHAVES_DO_BLOCO, LEGENDA_DO_USO, NOTA_DAS_DECIDIDAS, O_QUE_NAO_MEDE, type LinhaDeUso, type Produtividade,
} from './produtividade';
import {
  AVISO_DA_LEGENDA, OPCOES_DA_PRODUTIVIDADE, legendaDoDocumento, nomeDoRecorte, pessoasDoRecorte,
  planoDaProdutividade, type EscolhasDaProdutividade,
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
      publicacoes: { decididas: 5, esperando: 2 },
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

/** Uma miniatura qualquer: o plano não abre a imagem, só decide onde ela entra. */
const ROSTO = 'data:image/jpeg;base64,/9j/AAAA';
const ROSTOS = { ana: ROSTO, bruno: ROSTO, ivo: ROSTO };

const titulos = (blocos: BlocoDoPdf[]) => blocos.flatMap((b) => ('titulo' in b && b.titulo ? [b.titulo] : []));
const tabelaDasPessoas = (blocos: BlocoDoPdf[]) =>
  blocos.find((b) => b.tipo === 'tabela' && b.cabecalho[0] === 'Pessoa') as
    | Extract<BlocoDoPdf, { tipo: 'tabela' }>
    | undefined;
const cartoes = (blocos: BlocoDoPdf[]) =>
  blocos.filter((b): b is Extract<BlocoDoPdf, { tipo: 'pessoa' }> => b.tipo === 'pessoa');
const numerosDaLegenda = (blocos: BlocoDoPdf[]) => {
  const tabela = blocos.find((b) => b.tipo === 'tabela' && b.cabecalho[0] === 'Número') as
    | Extract<BlocoDoPdf, { tipo: 'tabela' }>
    | undefined;
  return tabela ? tabela.linhas.map((l) => l[0]) : [];
};
const rotuloDa = (chave: string) => LEGENDA_DO_USO.find((l) => l.chave === chave)!.numero;

/**
 * "NÃO É INTERESSANTE GERAR PDF DA PRODUTIVIDADE? MENSAL, ANUAL, PERSONALIZADO,
 * POR ADVOGADO" — 12/09/2026. As decisões da aba valem no papel.
 */
describe('o PDF do uso do sistema', () => {
  /**
   * O papel sai da sala sem quem explicaria o que o número não mede. Desde
   * 13/09/2026 o aviso também aponta a legenda do fim — por isso a frase a mais.
   */
  it('abre com o aviso do que os números não medem — em qualquer recorte', () => {
    for (const quem of ['TODOS', 'PERFIL:ADVOGADO', 'PESSOA:ana'] as const) {
      expect(planoDaProdutividade(BASE, escolhas({ quem }))[0]).toEqual({
        tipo: 'destaque', rotulo: 'Antes de ler', texto: `${O_QUE_NAO_MEDE} ${AVISO_DA_LEGENDA}`,
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

  /** "20 de 62" punha sábado e domingo no denominador. */
  it('a tabela mostra os dias com uso sem fração, e diz quantos dias de semana o período tem', () => {
    const blocos = planoDaProdutividade(BASE, escolhas());
    expect(tabelaDasPessoas(blocos)!.linhas[0][2]).toBe('20');
    expect(blocos.find((b) => b.tipo === 'secao' && b.titulo === 'Pessoa por pessoa')).toMatchObject({
      subtitulo: expect.stringContaining('O período tem 45 dias de semana.'),
    });
  });

  /** Barra por pessoa é pódio desenhado: o gráfico é do tempo. */
  it('nenhum gráfico põe pessoas lado a lado', () => {
    const nomes = BASE.pessoas.map((l) => l.nome);
    for (const b of planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS' }))) {
      if (b.tipo === 'barras') expect(b.itens.some((i) => nomes.includes(i.rotulo))).toBe(false);
      if (b.tipo === 'colunas') expect(b.categorias.some((c) => nomes.includes(c))).toBe(false);
    }
  });

  /** Desde 13/09/2026 a pessoa abre com o cartão (círculo, nome e a linha de apoio), e não com uma seção. */
  it('uma pessoa: o cartão dela, sem resumo de grupo e sem tabela', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }));
    expect(titulos(blocos)).not.toContain('Resumo');
    expect(tabelaDasPessoas(blocos)).toBeUndefined();
    expect(cartoes(blocos)).toEqual([
      expect.objectContaining({ nome: 'Dra. Ana', iniciais: 'A', novaPagina: false }),
    ]);
    expect(cartoes(blocos)[0].linha).toMatch(/^Advogado\(a\) · último acesso /);
    expect(blocos.some((b) => b.tipo === 'faixa')).toBe(true);
  });

  it('uma página por pessoa: cada uma começa numa página nova', () => {
    const paginas = cartoes(planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS' })));
    expect(paginas.map((c) => c.nome)).toEqual(['Dra. Ana', 'Dr. Bruno', 'Ivo']);
    expect(paginas.every((c) => c.novaPagina)).toBe(true);
  });

  it('o cartão leva os três blocos do perfil numa fileira, com o nome do grupo e o âmbar no lugar', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }));
    const numeros = blocos.find((b) => b.tipo === 'numeros') as Extract<BlocoDoPdf, { tipo: 'numeros' }>;
    expect(numeros.porFileira).toBe(3);
    const agenda = numeros.itens.find((i) => i.grupo === 'Agenda')!;
    expect(agenda).toMatchObject({ valor: '12', rotulo: 'concluídas' });
    expect(agenda.linhas).toContainEqual({ texto: '4 em aberto, 1 atrasada', alerta: true });
    expect(numeros.itens.find((i) => i.grupo === 'Publicações')!.linhas).toEqual([
      { texto: '2 esperando decisão', alerta: true },
    ]);
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
      dados: antes, periodo: { de: '2026-09-13', ate: '2026-11-13' },
    });
    const numeros = blocos.find((b) => b.tipo === 'numeros') as Extract<BlocoDoPdf, { tipo: 'numeros' }>;
    const agenda = numeros.itens.find((i) => i.grupo === 'Agenda')!;
    expect(agenda.valor).toBe('12');
    expect(agenda.comparacao).toBe('antes 9 · +3');
    const faixa = blocos.find((b) => b.tipo === 'faixa') as Extract<BlocoDoPdf, { tipo: 'faixa' }>;
    expect(faixa).toMatchObject({
      legenda: '20 dias com uso · o período tem 45 dias de semana · antes 15',
      inicio: '13/07',
      fim: '12/09',
      chave: 'cheio = usou · claro = fim de semana',
    });
  });

  it('nada no plano que a fonte do PDF não saiba desenhar', () => {
    const plano = planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS', fotos: true }), null, ROSTOS);
    // A foto é imagem, e não texto: sai da conta.
    const semFotos = plano.map((b) => (b.tipo === 'pessoa' ? { ...b, foto: undefined } : b));
    expect(foraDaFontePadrao(JSON.stringify(semFotos))).toEqual([]);
    expect(foraDaFontePadrao(JSON.stringify(LEGENDA_DO_USO))).toEqual([]);
  });
});

/**
 * PUBLICAÇÕES DECIDIDAS SÓ SE COMPARAM DEPOIS DE 13/09/2026 (D19). Antes disso
 * o sistema não guardava quem aceitou: o "antes" seria zero que ninguém mediu.
 */
describe('a comparação das publicações decididas', () => {
  const anterior = (de: string, ate: string) => ({ dados: BASE, periodo: { de, ate } });
  const publicacoes = (blocos: BlocoDoPdf[]) =>
    blocos
      .flatMap((b) => (b.tipo === 'numeros' ? b.itens : []))
      .find((i) => i.grupo === 'Publicações' || i.rotulo === 'Publicações decididas')!;

  it('período anterior começando antes de 13/09/2026: sem comparação, e a nota diz por quê', () => {
    for (const quem of ['TODOS', 'PESSOA:ana'] as const) {
      const blocos = planoDaProdutividade(BASE, escolhas({ quem }), anterior('2026-05-12', '2026-07-12'));
      expect(publicacoes(blocos).comparacao).toBeUndefined();
      expect(blocos).toContainEqual({ tipo: 'nota', texto: NOTA_DAS_DECIDIDAS });
    }
  });

  it('as outras contagens continuam comparadas no mesmo PDF', () => {
    const blocos = planoDaProdutividade(BASE, escolhas(), anterior('2026-05-12', '2026-07-12'));
    const concluidas = blocos
      .flatMap((b) => (b.tipo === 'numeros' ? b.itens : []))
      .find((i) => i.rotulo === 'Atividades concluídas')!;
    expect(concluidas.comparacao).toBe('antes 12 · igual');
  });

  it('período anterior inteiro depois de 13/09/2026: compara, sem nota', () => {
    const blocos = planoDaProdutividade(BASE, escolhas(), anterior('2026-09-13', '2026-10-12'));
    expect(publicacoes(blocos).comparacao).toBe('antes 5 · igual');
    expect(blocos).not.toContainEqual({ tipo: 'nota', texto: NOTA_DAS_DECIDIDAS });
  });
});

/** Foto só no cartão da pessoa — nunca na tabela da equipe nem nos totais. */
describe('a foto do perfil no PDF', () => {
  it('entra no cartão de cada pessoa quando a opção está marcada', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS', fotos: true }), null, ROSTOS);
    expect(cartoes(blocos).map((c) => c.foto)).toEqual([ROSTO, ROSTO, ROSTO]);
  });

  it('opção desmarcada, ou quem não tem foto: sai com as iniciais', () => {
    const desmarcada = planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS', fotos: false }), null, ROSTOS);
    expect(cartoes(desmarcada).some((c) => c.foto)).toBe(false);
    const semRosto = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:bruno', fotos: true }), null, { ana: ROSTO });
    expect(cartoes(semRosto)[0]).toMatchObject({ iniciais: 'B' });
    expect(cartoes(semRosto)[0].foto).toBeUndefined();
  });

  it('nunca na tabela "uma linha por pessoa" nem em "só os totais"', () => {
    for (const detalhe of ['TABELA', 'NENHUM'] as const) {
      const texto = JSON.stringify(planoDaProdutividade(BASE, escolhas({ detalhe, fotos: true }), null, ROSTOS));
      expect(texto).not.toContain('data:image');
    }
  });

  it('a opção vem marcada e é lembrada com as outras', () => {
    expect(OPCOES_DA_PRODUTIVIDADE.fotos).toBe(true);
  });
});

/** O PDF não explica número que não mostra — e não mostra número sem explicar. */
describe('a legenda do fim', () => {
  it('é o último bloco, em três colunas', () => {
    const blocos = planoDaProdutividade(BASE, escolhas());
    const ultimo = blocos[blocos.length - 1];
    expect(ultimo).toMatchObject({ tipo: 'tabela', cabecalho: ['Número', 'O que conta', 'Retrato'] });
    expect(blocos.some((b) => b.tipo === 'nota' && b.texto.startsWith('“Dia com uso”'))).toBe(false);
  });

  it('todo número da tabela e dos quadros tem linha na legenda', () => {
    const tabela = numerosDaLegenda(planoDaProdutividade(BASE, escolhas()));
    for (const chave of ['ultimoAcesso', 'diasComUso', 'concluidas', 'atrasadas', 'andamentos', 'atendimentos', 'decididas']) {
      expect(tabela).toContain(rotuloDa(chave));
    }
    const pessoa = numerosDaLegenda(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' })));
    for (const chave of [...CHAVES_DO_BLOCO.agenda, ...CHAVES_DO_BLOCO.publicacoes, ...CHAVES_DO_BLOCO.processos]) {
      expect(pessoa).toContain(rotuloDa(chave));
    }
  });

  it('"só os totais" não explica número que não mostra', () => {
    const totais = numerosDaLegenda(planoDaProdutividade(BASE, escolhas({ detalhe: 'NENHUM' })));
    for (const chave of ['documentos', 'alteracoesEmFichas', 'ultimoAcesso', 'esperando', 'antes']) {
      expect(totais).not.toContain(rotuloDa(chave));
    }
    expect(totais).toContain(rotuloDa('usaram'));
  });

  it('"Antes" só entra com comparação, e em ordem da legenda', () => {
    const semAntes = numerosDaLegenda(planoDaProdutividade(BASE, escolhas()));
    expect(semAntes).not.toContain('Antes');
    const comAntes = numerosDaLegenda(
      planoDaProdutividade(BASE, escolhas(), { dados: BASE, periodo: { de: '2026-09-13', ate: '2026-10-12' } }),
    );
    expect(comAntes[comAntes.length - 1]).toBe('Antes');
  });

  it('sem número nenhum, não há legenda', () => {
    expect(legendaDoDocumento([])).toEqual([]);
  });
});
