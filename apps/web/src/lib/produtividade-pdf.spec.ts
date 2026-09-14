import { foraDaFontePadrao } from './pdf-graficos';
import type { BlocoDoPdf, MedidorDeDocumento } from './pdf-documento';
import {
  DECIDIDAS_NAO_MEDIDAS, LEGENDA_DO_USO, O_QUE_NAO_MEDE, semanasDosDias, textoDoUltimoAcesso,
  type LinhaDeUso, type Produtividade, type SemanaDeUso,
} from './produtividade';
import {
  DECIDIDAS_SEM_ANTES, DECIDIDAS_SO_DESDE, OPCOES_DA_PRODUTIVIDADE, PE_DO_AGORA, SEMANA_INDISPONIVEL,
  capaDaProdutividade, documentoDaProdutividade, documentoQueCabe, gradeDoPdf, linhaDosTipos, nomeDoRecorte,
  pessoasDoRecorte, planoDaProdutividade, serieDoPerfil, somaDaEquipe, type AnteriorDaProdutividade,
  type EscolhasDaProdutividade,
} from './produtividade-pdf';

const DIA_MS = 86_400_000;
const diasEntre = (de: string, ate: string) => {
  const dias: string[] = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += DIA_MS) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
};

/** 14/08 a 13/09/2026: começa numa sexta e termina num domingo — cinco semanas, a primeira cortada. */
const DIAS = diasEntre('2026-08-14', '2026-09-13');
const SEMANAS = semanasDosDias(DIAS);

const semanas = (valores: Partial<Record<keyof SemanaDeUso, number[]>> = {}): SemanaDeUso[] =>
  SEMANAS.map((semana, i) => ({
    semana, diasNoPeriodo: i === 0 ? 3 : 7, diasComUso: valores.diasComUso?.[i] ?? 0,
    concluidas: valores.concluidas?.[i] ?? 0, noDiaMarcado: valores.noDiaMarcado?.[i] ?? 0, andamentos: 0,
    atendimentos: valores.atendimentos?.[i] ?? 0, processosCadastrados: 0, documentos: 0,
    filiadosCadastrados: valores.filiadosCadastrados?.[i] ?? 0,
  }));

const linha = (over: Partial<LinhaDeUso> & Pick<LinhaDeUso, 'usuarioId' | 'nome' | 'perfil'>): LinhaDeUso => ({
  avatarUrl: null,
  ultimoAcesso: '2026-09-13T18:27:00.000Z',
  contaCriadaEm: '2026-01-05T12:00:00.000Z',
  diasComUso: 0,
  diasAtivos: [],
  agenda: { concluidas: 0, noDiaMarcado: 0, criadas: 0, abertas: 0, atrasadas: 0, porTipo: [] },
  publicacoes: { decididas: 0, esperando: 0 },
  processos: { cadastrados: 0, andamentos: 0, documentos: 0 },
  filiados: { cadastrados: 0, fichasAtualizadas: 0 },
  atendimentos: 0,
  porSemana: semanas(),
  porMes: ['2026-08', '2026-09'].map((mes) => ({
    mes, diasComUso: 0, concluidas: 0, andamentos: 0, atendimentos: 0, noDiaMarcado: 0,
    processosCadastrados: 0, documentos: 0, filiadosCadastrados: 0,
  })),
  ...over,
});

/** Nomes inventados; a ordem é a da API — perfil, depois nome. */
const BASE: Produtividade = {
  periodo: { de: '2026-08-14T03:00:00.000Z', ate: '2026-09-14T03:00:00.000Z' },
  escopo: 'GLOBAL',
  dias: DIAS,
  meses: ['2026-08', '2026-09'],
  semanas: SEMANAS,
  perfis: [
    { perfil: 'ADVOGADO', pessoas: 2, usaram: 1, semAcessoRecente: 0, nuncaEntraram: 1 },
    { perfil: 'TRIAGEM', pessoas: 1, usaram: 1, semAcessoRecente: 1, nuncaEntraram: 0 },
  ],
  pessoas: [
    linha({
      usuarioId: 'ana', nome: 'Dra. Ana', perfil: 'ADVOGADO', diasComUso: 3,
      // 12/09/2026 é um sábado.
      diasAtivos: ['2026-08-14', '2026-08-17', '2026-09-12'],
      agenda: {
        concluidas: 12, noDiaMarcado: 10, criadas: 3, abertas: 4, atrasadas: 1,
        porTipo: [
          { tipo: 'PRAZO', nome: 'Prazo', concluidas: 6, noDiaMarcado: 5 },
          { tipo: 'AUDIENCIA', nome: 'Audiência', concluidas: 3, noDiaMarcado: 3 },
          { tipo: 'REUNIAO', nome: 'Reunião', concluidas: 2, noDiaMarcado: 1 },
          { tipo: 'PERICIA', nome: 'Perícia', concluidas: 1, noDiaMarcado: 1 },
        ],
      },
      publicacoes: { decididas: 5, esperando: 2 },
      processos: { cadastrados: 35, andamentos: 1, documentos: 0 },
      porSemana: semanas({ concluidas: [2, 3, 4, 2, 1], noDiaMarcado: [2, 2, 3, 2, 1], diasComUso: [1, 1, 0, 0, 1] }),
    }),
    linha({ usuarioId: 'bruno', nome: 'Dr. Bruno', perfil: 'ADVOGADO', ultimoAcesso: null }),
    linha({
      usuarioId: 'ivo', nome: 'Ivo', perfil: 'TRIAGEM', diasComUso: 2, diasAtivos: ['2026-08-20', '2026-08-21'],
      ultimoAcesso: '2026-09-01T12:00:00.000Z', atendimentos: 9,
      porSemana: semanas({ atendimentos: [0, 2, 4, 3, 0], diasComUso: [0, 2, 0, 0, 0] }),
    }),
  ],
  geradoEm: '2026-09-13T19:37:00.000Z',
};

const PERIODO_ANTERIOR = { de: '2026-07-14', ate: '2026-08-13' };

/** O mesmo recorte de 14/07 a 13/08/2026. */
function dadosDeAntes(ana: Partial<LinhaDeUso> = {}): Produtividade {
  return {
    ...BASE,
    dias: diasEntre(PERIODO_ANTERIOR.de, PERIODO_ANTERIOR.ate),
    pessoas: BASE.pessoas.map((l) =>
      l.usuarioId === 'ana'
        ? {
            ...l, diasComUso: 10,
            agenda: { ...l.agenda, concluidas: 9, noDiaMarcado: 0, criadas: 0 },
            processos: { cadastrados: 0, andamentos: 0, documentos: 4 },
            publicacoes: { decididas: 1, esperando: 2 },
            ...ana,
          }
        : { ...l, diasComUso: 0 },
    ),
  };
}

const ANTERIOR: AnteriorDaProdutividade = { dados: dadosDeAntes(), periodo: PERIODO_ANTERIOR };

const escolhas = (over: Partial<EscolhasDaProdutividade> = {}): EscolhasDaProdutividade => ({
  quem: 'TODOS', detalhe: 'TABELA', graficos: true, ...over,
});

/** A mesma gente em outro período (só `dias`, `semanas` e `meses` mudam). */
const noPeriodo = (p: Produtividade, de: string, ate: string): Produtividade => {
  const dias = diasEntre(de, ate);
  return { ...p, dias, semanas: semanasDosDias(dias), meses: [...new Set(dias.map((d) => d.slice(0, 7)))] };
};

/** Uma miniatura qualquer: o plano não abre a imagem, só decide onde ela entra. */
const ROSTO = 'data:image/jpeg;base64,/9j/AAAA';
const ROSTOS = { ana: ROSTO, bruno: ROSTO, ivo: ROSTO };

type Tabela = Extract<BlocoDoPdf, { tipo: 'tabela' }>;
type Caixas = Extract<BlocoDoPdf, { tipo: 'caixas' }>;
type Colunas = Extract<BlocoDoPdf, { tipo: 'colunas' }>;

const registros = (blocos: BlocoDoPdf[]) =>
  blocos.find((b): b is Tabela => b.tipo === 'tabela' && b.cabecalho[0] === 'Registro')!;
const linhaDe = (tabela: Tabela, rotulo: string) => tabela.linhas.find((l) => l[0].trim() === rotulo);
const caixas = (blocos: BlocoDoPdf[]) => blocos.find((b): b is Caixas => b.tipo === 'caixas')!;
const colunas = (blocos: BlocoDoPdf[]) => blocos.find((b): b is Colunas => b.tipo === 'colunas');
const notas = (blocos: BlocoDoPdf[]) => blocos.flatMap((b) => (b.tipo === 'nota' ? [b.texto] : []));
const titulos = (blocos: BlocoDoPdf[]) => blocos.flatMap((b) => ('titulo' in b && b.titulo ? [b.titulo] : []));
const cartoes = (blocos: BlocoDoPdf[]) =>
  blocos.filter((b): b is Extract<BlocoDoPdf, { tipo: 'pessoa' }> => b.tipo === 'pessoa');
const textosDaCaixa = (c: Caixas['esquerda'] | Caixas['direita']) =>
  c.linhas.flatMap((l) => ('texto' in l ? [l.texto] : []));

/**
 * "NÃO É INTERESSANTE GERAR PDF DA PRODUTIVIDADE? MENSAL, ANUAL, PERSONALIZADO,
 * POR ADVOGADO" — 12/09/2026. Redesenhado em 14/09/2026 (D19): uma folha por
 * pessoa, "no período" e "agora" separados, comparação em coluna.
 */
describe('o PDF do uso do sistema', () => {
  it('abre com o aviso do que os números não medem, sem mudar uma palavra, em qualquer recorte', () => {
    for (const quem of ['TODOS', 'PERFIL:ADVOGADO', 'PESSOA:ana'] as const) {
      expect(planoDaProdutividade(BASE, escolhas({ quem }))[0]).toEqual({
        tipo: 'destaque', rotulo: 'Antes de ler', texto: O_QUE_NAO_MEDE, fonte: 8.5,
      });
    }
  });

  it('o recorte: a equipe, um perfil, uma pessoa', () => {
    expect(pessoasDoRecorte(BASE, 'PERFIL:ADVOGADO').map((l) => l.usuarioId)).toEqual(['ana', 'bruno']);
    expect(pessoasDoRecorte(BASE, 'PESSOA:ivo').map((l) => l.usuarioId)).toEqual(['ivo']);
    expect(nomeDoRecorte(BASE, 'TODOS')).toBe('Toda a equipe');
    expect(nomeDoRecorte(BASE, 'PERFIL:ADVOGADO')).toBe('Advogados');
    expect(nomeDoRecorte(BASE, 'PESSOA:ivo')).toBe('Ivo');
  });

  /** A legenda virou a coluna "O que conta": não há mais glossário empurrando uma folha só de texto. */
  it('não há mais legenda no fim do documento', () => {
    for (const detalhe of ['TABELA', 'PAGINAS', 'NENHUM'] as const) {
      const plano = planoDaProdutividade(BASE, escolhas({ detalhe }), ANTERIOR);
      expect(titulos(plano)).not.toContain('O que cada número conta');
      expect(plano.some((b) => b.tipo === 'tabela' && b.cabecalho.includes('Retrato'))).toBe(false);
    }
  });

  it('nada no plano nem no topo que a fonte do PDF não saiba desenhar', () => {
    for (const detalhe of ['TABELA', 'PAGINAS', 'NENHUM'] as const) {
      const plano = planoDaProdutividade(BASE, escolhas({ detalhe, fotos: true }), ANTERIOR, ROSTOS);
      const semFotos = plano.map((b) => (b.tipo === 'pessoa' ? { ...b, foto: undefined } : b));
      expect(foraDaFontePadrao(JSON.stringify(semFotos))).toEqual([]);
    }
    const capa = capaDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }), { de: '2026-08-14', ate: '2026-09-13', emitidoPor: 'Ana' });
    expect(foraDaFontePadrao(JSON.stringify(capa))).toEqual([]);
  });

  /** A frase curta mora ao lado do número: tem de existir, caber e ser desenhável. */
  it('toda linha da legenda tem a frase curta, de até 80 caracteres, na fonte do PDF', () => {
    for (const l of LEGENDA_DO_USO) {
      expect(l.curta.length).toBeGreaterThan(10);
      expect(l.curta.length).toBeLessThanOrEqual(80);
      expect(foraDaFontePadrao(l.curta)).toEqual([]);
    }
    for (const texto of [DECIDIDAS_NAO_MEDIDAS, DECIDIDAS_SO_DESDE, DECIDIDAS_SEM_ANTES]) {
      expect(texto.length).toBeLessThanOrEqual(80);
    }
    // E a coluna "O que conta" de qualquer plano só leva frase que cabe.
    const plano = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }), ANTERIOR);
    const tabela = registros(plano);
    const coluna = tabela.cabecalho.indexOf('O que conta');
    for (const [i, l] of tabela.linhas.entries()) {
      if (!tabela.especiais?.[i]) expect(l[coluna].length).toBeLessThanOrEqual(80);
    }
  });

  /** Barra por pessoa é pódio desenhado: o gráfico é do tempo. */
  it('nenhum gráfico põe pessoas lado a lado', () => {
    const nomes = BASE.pessoas.map((l) => l.nome);
    for (const b of planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS' }))) {
      if (b.tipo === 'barras') expect(b.itens.some((i) => nomes.includes(i.rotulo))).toBe(false);
      if (b.tipo === 'colunas') expect(b.categorias.some((c) => nomes.includes(c))).toBe(false);
    }
  });

  it('recorte sem ninguém: a frase, e nada mais', () => {
    expect(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ninguem' }))).toEqual([
      expect.objectContaining({ tipo: 'destaque' }),
      { tipo: 'texto', texto: 'Ninguém neste recorte no período.' },
    ]);
  });
});

describe('o documento de uma pessoa', () => {
  const plano = () => planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }), ANTERIOR);

  it('o nome e o rosto vão no topo; o plano é caixas, o que registrou e o tempo — sem cartão repetindo o nome', () => {
    expect(plano().map((b) => b.tipo)).toEqual(['destaque', 'caixas', 'secao', 'tabela', 'colunas']);
    expect(cartoes(plano())).toEqual([]);
    const contexto = { de: '2026-08-14', ate: '2026-09-13', emitidoPor: 'João Pedro' };
    expect(capaDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana', fotos: true }), contexto, ROSTOS)).toMatchObject({
      faixa: 'Uso do sistema · 14/08/2026 a 13/09/2026',
      titulo: 'Dra. Ana',
      periodo: 'Uso do sistema de 14 de agosto a 13 de setembro de 2026',
      apoio: 'Advogado(a) · emitido por João Pedro',
      pessoa: { iniciais: 'A', foto: ROSTO },
    });
  });

  it('o título digitado troca só o "Uso do sistema" da segunda linha', () => {
    const capa = capaDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }), {
      de: '2026-08-14', ate: '2026-09-13', emitidoPor: 'João Pedro', titulo: 'Conversa de setembro',
    });
    expect(capa.titulo).toBe('Dra. Ana');
    expect(capa.periodo).toBe('Conversa de setembro · 14 de agosto a 13 de setembro de 2026');
    expect(capa.pessoa?.foto).toBeUndefined();
  });

  it('a caixa do período: a grade, os dias com uso, os dias de semana e o sábado usado', () => {
    const esquerda = caixas(plano()).esquerda;
    expect(esquerda.rotulo).toBe('No período · dias com uso');
    expect(esquerda.grade?.semanas).toHaveLength(5);
    expect(esquerda.linhas[0]).toEqual({ tipo: 'grande', texto: '3 dias com uso' });
    expect(textosDaCaixa(esquerda)).toEqual([
      '3 dias com uso',
      'o período tem 21 dias de semana',
      'usou em 1 dia de sábado ou domingo',
      'De 14/07 a 13/08: 10 dias',
      LEGENDA_DO_USO.find((l) => l.chave === 'diasComUso')!.curta,
    ]);
    expect(esquerda.linhas.find((l) => l.tipo === 'chave')).toEqual({
      tipo: 'chave',
      itens: [
        { texto: 'usou', cor: 'cheia' },
        { texto: 'não usou', cor: 'vazia' },
        { texto: 'sábado e domingo', cor: 'fimDeSemana' },
      ],
    });
  });

  /** O âmbar de agora dentro do quadro do período fazia "1 atrasada" parecer do mês. */
  it('a caixa "Agora" é o único lugar com âmbar', () => {
    const { esquerda, direita } = caixas(plano());
    expect(JSON.stringify(esquerda)).not.toContain('"alerta"');
    expect(registros(plano()).alertas).toBeUndefined();
    const agora = new Date(BASE.geradoEm);
    expect(direita).toEqual({
      rotulo: 'Agora · 13/09/2026, 16:37',
      fundo: true,
      linhas: [
        { tipo: 'par', rotulo: 'Último acesso', valor: textoDoUltimoAcesso('2026-09-13T18:27:00.000Z', agora), alerta: false },
        { tipo: 'par', rotulo: 'Na agenda', valor: '4 atividades em aberto', abaixo: { texto: '1 atrasada', alerta: true } },
        { tipo: 'par', rotulo: 'Diário', valor: '2 propostas esperando decisão', alerta: true },
        { tipo: 'pe', texto: PE_DO_AGORA },
      ],
    });
  });

  it('o Diário só aparece para quem tem o bloco de publicações; zero atrasadas some a segunda linha', () => {
    const direita = caixas(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ivo' }))).direita;
    expect(direita.linhas.map((l) => (l.tipo === 'par' ? l.rotulo : l.tipo))).toEqual(['Último acesso', 'Na agenda', 'pe']);
    expect(direita.linhas[1]).not.toHaveProperty('abaixo');
    // Doze dias sem entrar pede atenção.
    expect(direita.linhas[0]).toMatchObject({ valor: 'há 12 dias', alerta: true });
  });

  /** A comparação é uma coluna com as datas no cabeçalho, e a célula só tem o número. */
  it('o que registrou: número, este período, o anterior e o que conta', () => {
    const tabela = registros(plano());
    expect(tabela.cabecalho).toEqual(['Registro', '14/08 a 13/09', '14/07 a 13/08', 'O que conta']);
    expect(tabela.linhas.map((l) => l[0].trim())).toEqual([
      'Agenda', 'Atividades concluídas', 'no dia marcado', 'por tipo', 'Atividades criadas',
      'Publicações do Diário', 'Publicações decididas',
      'Processos', 'Processos cadastrados', 'Documentos anexados', 'Andamentos internos',
    ]);
    const curta = (chave: string) => LEGENDA_DO_USO.find((l) => l.chave === chave)!.curta;
    expect(linhaDe(tabela, 'Atividades concluídas')).toEqual(['Atividades concluídas', '12', '9', curta('concluidas')]);
    expect(linhaDe(tabela, 'por tipo')).toEqual(['   por tipo', 'Prazo: 6 · Audiência: 3 · Reunião: 2 · outros tipos: 1']);
    expect(tabela.especiais).toEqual({ 0: { tipo: 'grupo' }, 3: { tipo: 'mesclada', de: 1 }, 5: { tipo: 'grupo' }, 7: { tipo: 'grupo' } });
    expect(tabela.linhas.flat().some((c) => /[+%]|antes \d/.test(c))).toBe(false);
  });

  it('zero agora com número antes aparece; zero nos dois some, menos a primeira linha do bloco', () => {
    const tabela = registros(plano());
    expect(linhaDe(tabela, 'Documentos anexados')!.slice(0, 3)).toEqual(['Documentos anexados', '0', '4']);
    const semNada = registros(
      planoDaProdutividade(
        { ...BASE, pessoas: [{ ...BASE.pessoas[0], agenda: { ...BASE.pessoas[0].agenda, concluidas: 0, noDiaMarcado: 0 } }] },
        escolhas(),
        { dados: dadosDeAntes({ agenda: { ...BASE.pessoas[0].agenda, concluidas: 0, noDiaMarcado: 0, criadas: 0 } }), periodo: PERIODO_ANTERIOR },
      ),
    );
    expect(linhaDe(semNada, 'Atividades concluídas')!.slice(0, 3)).toEqual(['Atividades concluídas', '0', '0']);
    expect(linhaDe(semNada, 'no dia marcado')).toBeUndefined();
    expect(linhaDe(semNada, 'por tipo')).toBeUndefined();
  });

  /** O bloco do perfil zerado não some: zero ali é informação. Mas vira uma linha. */
  it('bloco inteiro zerado nos dois períodos vira uma linha só', () => {
    const tabela = registros(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:bruno' })));
    const i = tabela.linhas.findIndex((l) => l[0] === 'Processos');
    expect(tabela.linhas[i + 1]).toEqual(['', 'Nada registrado no período.']);
    expect(tabela.especiais?.[i + 1]).toEqual({ tipo: 'mesclada', de: 1 });
  });

  it('nunca entrou: sem grade, a frase, e o âmbar só no "agora"', () => {
    const { esquerda, direita } = caixas(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:bruno' })));
    expect(esquerda).toEqual({ rotulo: 'No período · dias com uso', linhas: [{ tipo: 'texto', texto: 'Nunca entrou no sistema.' }] });
    expect(direita.linhas[0]).toMatchObject({ valor: 'nunca entrou', alerta: true });
  });

  it('zero dia com uso, mas já entrou: sem grade toda cinza, uma frase', () => {
    const quemSumiu = { ...BASE, pessoas: [{ ...BASE.pessoas[1], ultimoAcesso: '2026-07-01T12:00:00.000Z' }] };
    const esquerda = caixas(planoDaProdutividade(quemSumiu, escolhas())).esquerda;
    expect(esquerda.grade).toBeUndefined();
    expect(textosDaCaixa(esquerda)[0]).toBe('Nenhum dia com uso no período.');
  });

  it('sem "Comparar", não há coluna do anterior nem frase de comparação', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }));
    expect(registros(blocos).cabecalho).toEqual(['Registro', '14/08 a 13/09', 'O que conta']);
    expect(textosDaCaixa(caixas(blocos).esquerda).some((t) => t.startsWith('De '))).toBe(false);
    expect(notas(blocos)).toEqual([]);
  });
});

/** "antes 0 · +18" de quem nem tinha conta não é crescimento: a coluna some, e uma linha diz por quê. */
describe('quando a comparação some', () => {
  it('a conta foi criada depois do começo do período anterior', () => {
    const criadaDepois = { ...BASE, pessoas: BASE.pessoas.map((l) => ({ ...l, contaCriadaEm: '2026-07-20T15:00:00.000Z' })) };
    const blocos = planoDaProdutividade(criadaDepois, escolhas({ quem: 'PESSOA:ana' }), ANTERIOR);
    expect(registros(blocos).cabecalho).toHaveLength(3);
    expect(notas(blocos)).toEqual(['Sem comparação: a conta foi criada em 20/07/2026.']);
    expect(textosDaCaixa(caixas(blocos).esquerda)).toContain('A conta foi criada em 20/07/2026');
  });

  it('nenhum dia com uso no período anterior', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }), {
      dados: dadosDeAntes({ diasComUso: 0 }), periodo: PERIODO_ANTERIOR,
    });
    expect(registros(blocos).cabecalho).toHaveLength(3);
    expect(notas(blocos)).toEqual(['Sem comparação: nenhum uso do sistema de 14/07 a 13/08.']);
    expect(textosDaCaixa(caixas(blocos).esquerda)).toContain('De 14/07 a 13/08: nenhum dia');
  });

  it('mês inteiro contra mês inteiro diz "em julho"', () => {
    const agosto = noPeriodo(BASE, '2026-08-01', '2026-08-31');
    const blocos = planoDaProdutividade(agosto, escolhas({ quem: 'PESSOA:ana' }), {
      dados: dadosDeAntes({ diasComUso: 0 }), periodo: { de: '2026-07-01', ate: '2026-07-31' },
    });
    expect(notas(blocos)).toContain('Sem comparação: nenhum uso do sistema em julho.');
  });
});

/**
 * "0 DECIDIDAS" NÃO MEDIDO NÃO É ZERO (14/09/2026). Antes de 13/09/2026 o
 * sistema não gravava quem decidia cada proposta do Diário.
 */
describe('as publicações decididas', () => {
  const decididas = (blocos: BlocoDoPdf[]) => linhaDe(registros(blocos), 'Publicações decididas');

  it('período todo antes de 13/09/2026: "Não medido", sem número', () => {
    const agosto = noPeriodo(BASE, '2026-08-01', '2026-08-31');
    expect(decididas(planoDaProdutividade(agosto, escolhas({ quem: 'PESSOA:ana' })))).toEqual([
      'Publicações decididas', DECIDIDAS_NAO_MEDIDAS,
    ]);
  });

  it('período atravessando 13/09/2026: o número, "só desde", e a célula do anterior vazia', () => {
    expect(decididas(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' }), ANTERIOR))).toEqual([
      'Publicações decididas', '5', '', DECIDIDAS_SO_DESDE,
    ]);
    const semDecisao = { ...BASE, pessoas: [{ ...BASE.pessoas[0], publicacoes: { decididas: 0, esperando: 0 } }] };
    expect(decididas(planoDaProdutividade(semDecisao, escolhas()))).toEqual([
      'Publicações decididas', 'Só é gravado desde 13/09/2026. Neste período: 1 dia medido, nenhuma decisão.',
    ]);
  });

  it('período todo depois: normal — e compara só se o anterior também já era medido', () => {
    const outubro = noPeriodo(BASE, '2026-09-13', '2026-10-12');
    expect(
      decididas(planoDaProdutividade(outubro, escolhas({ quem: 'PESSOA:ana' }), {
        dados: dadosDeAntes(), periodo: { de: '2026-08-13', ate: '2026-09-12' },
      })),
    ).toEqual(['Publicações decididas', '5', '', DECIDIDAS_SEM_ANTES]);
    const novembro = noPeriodo(BASE, '2026-10-13', '2026-11-11');
    expect(
      decididas(planoDaProdutividade(novembro, escolhas({ quem: 'PESSOA:ana' }), {
        dados: dadosDeAntes(), periodo: { de: '2026-09-13', ate: '2026-10-12' },
      })),
    ).toEqual(['Publicações decididas', '5', '1', LEGENDA_DO_USO.find((l) => l.chave === 'decididas')!.curta]);
  });
});

describe('o gráfico do tempo da pessoa', () => {
  it('até 13 semanas: semana a semana, empilhado — no dia marcado embaixo, depois em cima', () => {
    expect(colunas(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana' })))).toEqual({
      tipo: 'colunas',
      titulo: 'Atividades concluídas, semana a semana',
      unidade: 'a primeira semana começa em 14/08',
      series: [
        { nome: 'no dia marcado', cor: expect.any(Array) },
        { nome: 'depois do dia marcado', cor: expect.any(Array) },
      ],
      categorias: ['10/08', '17/08', '24/08', '31/08', '07/09'],
      valores: [[2, 2, 3, 2, 1], [0, 1, 1, 0, 0]],
      empilhar: true,
      altura: 22,
      vazio: 'Nenhuma atividade concluída no período.',
    });
  });

  it('a série segue o perfil: a triagem conta atendimentos, a administração conta filiados', () => {
    expect(serieDoPerfil('ADVOGADO')).toBe('CONCLUIDAS');
    expect(serieDoPerfil('COORDENACAO')).toBe('CONCLUIDAS');
    expect(colunas(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ivo' })))).toMatchObject({
      titulo: 'Atendimentos registrados, semana a semana',
      series: [{ nome: 'Atendimentos registrados' }],
      valores: [[0, 2, 4, 3, 0]],
    });
    const admin = {
      ...BASE,
      pessoas: [{ ...BASE.pessoas[2], perfil: 'ADMINISTRADOR', porSemana: semanas({ filiadosCadastrados: [1, 0, 0, 0, 2] }) }],
    };
    expect(colunas(planoDaProdutividade(admin, escolhas()))).toMatchObject({
      titulo: 'Filiados cadastrados, semana a semana', valores: [[1, 0, 0, 0, 2]],
    });
  });

  it('tudo zero: o desenho diz "nenhuma", em vez de um eixo vazio', () => {
    const grafico = colunas(planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:bruno' })))!;
    expect(grafico.valores.flat().every((v) => v === 0)).toBe(true);
    expect(grafico.vazio).toBe('Nenhuma atividade concluída no período.');
  });

  it('acima de 13 semanas: mês a mês, empilhado com o dia marcado do mês', () => {
    const dias = diasEntre('2026-01-01', '2026-09-13');
    const meses = [...new Set(dias.map((d) => d.slice(0, 7)))];
    const ano: Produtividade = {
      ...BASE, dias, meses, semanas: semanasDosDias(dias),
      pessoas: [{
        ...BASE.pessoas[0],
        porSemana: [],
        porMes: meses.map((mes, i) => ({
          mes, diasComUso: 10, concluidas: i + 2, noDiaMarcado: i + 1, andamentos: 0, atendimentos: 0,
        })),
      }],
    };
    expect(colunas(planoDaProdutividade(ano, escolhas()))).toMatchObject({
      titulo: 'Atividades concluídas, mês a mês',
      unidade: 'o primeiro e o último mês contam só os dias do período',
      categorias: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set'],
      valores: [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 1, 1, 1, 1, 1, 1, 1, 1]],
    });
  });

  it('sem gráficos, a semana a semana sai numa tabela deitada', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ quem: 'PESSOA:ana', graficos: false }));
    expect(colunas(blocos)).toBeUndefined();
    expect(blocos.find((b) => b.tipo === 'tabela' && b.cabecalho[0] === 'Semana')).toMatchObject({
      titulo: 'Atividades concluídas, semana a semana (a primeira semana começa em 14/08)',
      cabecalho: ['Semana', '10/08', '17/08', '24/08', '31/08', '07/09'],
      linhas: [
        ['Concluídas', '2', '3', '4', '2', '1'],
        ['No dia marcado', '2', '2', '3', '2', '1'],
      ],
    });
  });
});

/** A API sobe antes, mas a janela existe: web novo com a API de antes não pode quebrar nem mostrar zero onde é ausência. */
describe('a janela de troca do deploy', () => {
  const antiga = (p: Produtividade): Produtividade => ({
    ...p,
    semanas: undefined,
    pessoas: p.pessoas.map((l) => ({
      ...l,
      porSemana: undefined,
      contaCriadaEm: undefined,
      agenda: { ...l.agenda, porTipo: undefined },
      porMes: l.porMes?.map(({ mes, diasComUso, concluidas, andamentos, atendimentos }) => ({
        mes, diasComUso, concluidas, andamentos, atendimentos,
      })),
    })),
  });

  it('um mês: a grade sai dos dias, o gráfico vira a nota, e não há "por tipo"', () => {
    const blocos = planoDaProdutividade(antiga(BASE), escolhas({ quem: 'PESSOA:ana' }));
    expect(caixas(blocos).esquerda.grade?.semanas).toHaveLength(5);
    expect(colunas(blocos)).toBeUndefined();
    expect(notas(blocos)).toContain(SEMANA_INDISPONIVEL);
    expect(linhaDe(registros(blocos), 'por tipo')).toBeUndefined();
  });

  it('a comparação sai sem a guarda da conta criada, como antes', () => {
    const antes = { dados: antiga(dadosDeAntes()), periodo: PERIODO_ANTERIOR };
    const blocos = planoDaProdutividade(antiga(BASE), escolhas({ quem: 'PESSOA:ana' }), antes);
    expect(registros(blocos).cabecalho).toHaveLength(4);
  });

  it('mais de 31 dias: cai no mês a mês de antes, numa cor só', () => {
    const doisMeses = noPeriodo(BASE, '2026-07-13', '2026-09-12');
    const blocos = planoDaProdutividade(antiga(doisMeses), escolhas({ quem: 'PESSOA:ana' }));
    expect(colunas(blocos)).toMatchObject({
      titulo: 'Atividades concluídas, mês a mês',
      series: [{ nome: 'Atividades concluídas' }],
    });
  });
});

describe('a grade dos dias', () => {
  it('uma coluna por semana, de segunda a domingo; o que está fora do período fica vazio', () => {
    const grade = gradeDoPdf(DIAS, ['2026-08-14', '2026-09-12']);
    expect(grade.linhas).toEqual(['seg', '', 'qua', '', 'sex', '', '']);
    expect(grade.semanas.map((s) => s.rotulo)).toEqual(['10/08', '17/08', '24/08', '31/08', '07/09']);
    expect(grade.semanas[0].dias.slice(0, 4)).toEqual([null, null, null, null]);
    expect(grade.semanas[0].dias[4]).toEqual({ dia: 14, usou: true, fimDeSemana: false });
    expect(grade.semanas[4].dias[5]).toEqual({ dia: 12, usou: true, fimDeSemana: true });
    expect(grade.semanas[4].dias[6]).toEqual({ dia: 13, usou: false, fimDeSemana: true });
  });

  it('num ano, o mês só na primeira semana de cada mês', () => {
    const dias = diasEntre('2025-09-14', '2026-09-13');
    const grade = gradeDoPdf(dias, []);
    expect(grade.semanas).toHaveLength(53);
    expect(grade.semanas.flatMap((s) => (s.rotulo ? [s.rotulo] : []))).toEqual([
      'set', 'out', 'nov', 'dez', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set',
    ]);
  });
});

describe('o documento da equipe', () => {
  const plano = (over: Partial<EscolhasDaProdutividade> = {}) => planoDaProdutividade(BASE, escolhas(over), ANTERIOR, ROSTOS);

  it('a equipe no período: por perfil, com "no período" e "agora" no cabeçalho, e âmbar só em "agora"', () => {
    const tabela = plano().find((b): b is Tabela => b.tipo === 'tabela' && b.cabecalho[0] === 'Perfil')!;
    expect(tabela.grupos).toEqual([
      { texto: '', colunas: 2 },
      { texto: 'No período', colunas: 1 },
      { texto: 'Agora', colunas: 2 },
    ]);
    expect(tabela.linhas).toEqual([
      ['Advogados', '2', '1', '0', '1'],
      ['Triagem e atendimento', '1', '1', '1', '0'],
    ]);
    expect(tabela.alertas).toEqual([[0, 4], [1, 3]]);
  });

  /** A mesma atividade conta para cada pessoa da equipe dela: somar abertas dobraria. */
  it('a soma da equipe não soma em aberto nem atrasadas, e o que registrou compara pela coluna', () => {
    const soma = somaDaEquipe(BASE.pessoas);
    expect(soma.agenda).toMatchObject({ concluidas: 12, abertas: 0, atrasadas: 0 });
    expect(soma.porSemana?.map((s) => s.atendimentos)).toEqual([0, 2, 4, 3, 0]);
    const tabela = registros(plano());
    expect(tabela.cabecalho).toEqual(['Registro', '14/08 a 13/09', '14/07 a 13/08', 'O que conta']);
    expect(linhaDe(tabela, 'Atividades concluídas')).toEqual([
      'Atividades concluídas', '12', '9', LEGENDA_DO_USO.find((l) => l.chave === 'concluidas')!.curta,
    ]);
    expect(linhaDe(tabela, 'Atendimentos registrados')!.slice(0, 3)).toEqual(['Atendimentos registrados', '9', '9']);
    expect(titulos(plano())).toEqual(expect.arrayContaining(['A equipe no período', 'O que a equipe registrou']));
  });

  it('o gráfico da equipe diz embaixo quantas pessoas usaram, sem nome', () => {
    expect(colunas(plano())).toMatchObject({
      titulo: 'Atividades concluídas da equipe, semana a semana',
      detalhes: ['1 pessoa', '2 pessoas', '0 pessoas', '0 pessoas', '1 pessoa'],
    });
  });

  it('por tipo de atividade: barras de COISA, só com três tipos ou mais', () => {
    expect(plano().find((b) => b.tipo === 'barras')).toMatchObject({
      titulo: 'Por tipo de atividade',
      itens: [{ rotulo: 'Prazo' }, { rotulo: 'Audiência' }, { rotulo: 'Reunião' }, { rotulo: 'Perícia' }],
    });
    const doisTipos = {
      ...BASE,
      pessoas: BASE.pessoas.map((l) => ({ ...l, agenda: { ...l.agenda, porTipo: l.agenda.porTipo?.slice(0, 2) } })),
    };
    expect(planoDaProdutividade(doisTipos, escolhas()).some((b) => b.tipo === 'barras')).toBe(false);
    expect(linhaDosTipos([])).toBeNull();
  });

  /** Quinze linhas com "antes" viram placar de quem caiu. */
  it('pessoa por pessoa: página nova, sem coluna do anterior, âmbar só no que é de agora', () => {
    const blocos = plano();
    expect(blocos.find((b) => b.tipo === 'secao' && b.titulo === 'Pessoa por pessoa')).toMatchObject({ novaPagina: true });
    const tabela = blocos.find((b): b is Tabela => b.tipo === 'tabela' && b.cabecalho[0] === 'Pessoa')!;
    expect(tabela.cabecalho).toEqual([
      'Pessoa', 'Dias com uso', 'Concluídas', 'No dia marcado', 'Andamentos', 'Atendimentos', 'Decididas',
      'Último acesso', 'Em aberto', 'Atrasadas',
    ]);
    expect(tabela.grupos).toEqual([
      { texto: '', colunas: 1 },
      { texto: 'No período', colunas: 6 },
      { texto: 'Agora', colunas: 3 },
    ]);
    expect(tabela.linhas.map((l) => l[0].split('\n')[0])).toEqual(['Dra. Ana', 'Dr. Bruno', 'Ivo']);
    expect(tabela.linhas[0].slice(1, 7)).toEqual(['3', '12', '10', '1', '0', '5']);
    expect(tabela.alertas).toEqual([[0, 9], [1, 7], [2, 7]]);
    // O que conta, em duas colunas embaixo.
    const legenda = blocos[blocos.indexOf(tabela) + 1] as Tabela;
    expect(legenda).toMatchObject({ semCabecalho: true });
    expect(legenda.linhas[0].slice(0, 1)).toEqual(['Dias com uso']);
  });

  it('pessoa por pessoa num período não medido: sai a coluna das decididas, e a nota diz por quê', () => {
    const agosto = noPeriodo(BASE, '2026-08-01', '2026-08-31');
    const blocos = planoDaProdutividade(agosto, escolhas());
    const tabela = blocos.find((b): b is Tabela => b.tipo === 'tabela' && b.cabecalho[0] === 'Pessoa')!;
    expect(tabela.cabecalho).not.toContain('Decididas');
    expect(notas(blocos)).toContain(`Sem a coluna de publicações decididas. ${DECIDIDAS_NAO_MEDIDAS}`);
  });

  it('"só os totais" não leva o nome de ninguém', () => {
    const texto = JSON.stringify(plano({ detalhe: 'NENHUM' }));
    for (const l of BASE.pessoas) expect(texto).not.toContain(l.nome);
  });

  it('uma página por pessoa: cada uma abre a sua, com o perfil embaixo do nome e a folha dela', () => {
    const blocos = plano({ detalhe: 'PAGINAS', fotos: true });
    expect(cartoes(blocos).map((c) => [c.nome, c.linha, c.novaPagina])).toEqual([
      ['Dra. Ana', 'Advogado(a)', true],
      ['Dr. Bruno', 'Advogado(a)', true],
      ['Ivo', expect.stringMatching(/^Triagem/), true],
    ]);
    expect(blocos.filter((b) => b.tipo === 'caixas')).toHaveLength(3);
    // O aviso não se repete.
    expect(blocos.filter((b) => b.tipo === 'destaque')).toHaveLength(1);
  });

  it('o topo do documento da equipe: sem círculo, com o recorte e quem emitiu', () => {
    expect(
      capaDaProdutividade(BASE, escolhas(), { de: '2026-08-14', ate: '2026-09-13', emitidoPor: 'João Pedro' }),
    ).toEqual({
      faixa: 'Uso do sistema · 14/08/2026 a 13/09/2026',
      titulo: 'Uso e produtividade',
      periodo: '14 de agosto a 13 de setembro de 2026',
      apoio: 'Toda a equipe · emitido por João Pedro',
      observacao: undefined,
    });
  });
});

/** Foto só no topo da pessoa — nunca na tabela da equipe nem nos totais. */
describe('a foto do perfil no PDF', () => {
  it('entra na página de cada pessoa quando a opção está marcada', () => {
    const blocos = planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS', fotos: true }), null, ROSTOS);
    expect(cartoes(blocos).map((c) => c.foto)).toEqual([ROSTO, ROSTO, ROSTO]);
  });

  it('opção desmarcada, ou quem não tem foto: sai com as iniciais', () => {
    const desmarcada = planoDaProdutividade(BASE, escolhas({ detalhe: 'PAGINAS', fotos: false }), null, ROSTOS);
    expect(cartoes(desmarcada).some((c) => c.foto)).toBe(false);
    const semRosto = capaDaProdutividade(
      BASE, escolhas({ quem: 'PESSOA:bruno', fotos: true }), { de: '2026-08-14', ate: '2026-09-13', emitidoPor: 'Ana' },
      { ana: ROSTO },
    );
    expect(semRosto.pessoa).toEqual({ iniciais: 'B', cor: expect.any(Object) });
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

/**
 * A FOLHA QUE CABE (14/09/2026) — os degraus em ordem, sem tirar número, e
 * só de quem passou da folha. O medidor aqui é falso; quem prova a medida com
 * o jsPDF real é `paginas-dos-pdfs.spec.ts`.
 */
describe('o aperto da folha de uma pessoa', () => {
  const OBSERVACAO = 'Para a conversa de setembro.';
  const CONTEXTO = { de: '2026-08-14', ate: '2026-09-13', emitidoPor: 'João Pedro', observacao: OBSERVACAO };
  const DE_UMA = escolhas({ quem: 'PESSOA:ana' });
  const noDegrau = (degrau: number) => documentoDaProdutividade(BASE, DE_UMA, CONTEXTO, ANTERIOR, {}, { ana: degrau });
  const tabelaDoTempo = (blocos: BlocoDoPdf[]) =>
    blocos.find((b): b is Tabela => b.tipo === 'tabela' && !!b.titulo?.startsWith('Atividades concluídas'));
  const cabe: MedidorDeDocumento = () => ({ topos: [40], fim: 200, paginas: 1, paginaDoBloco: [] });

  it('na ordem: o gráfico baixa, a observação perde a caixa e, por último, o gráfico vira tabela', () => {
    expect(
      [0, 1, 2, 3, 4].map((degrau) => {
        const d = noDegrau(degrau);
        return {
          altura: colunas(d.blocos)?.altura ?? null,
          naCaixa: d.capa.observacao ?? null,
          naLinha: notas(d.blocos).includes(`Observação: ${OBSERVACAO}`),
          emTabela: !!tabelaDoTempo(d.blocos),
        };
      }),
    ).toEqual([
      { altura: 22, naCaixa: OBSERVACAO, naLinha: false, emTabela: false },
      { altura: 16, naCaixa: OBSERVACAO, naLinha: false, emTabela: false },
      { altura: 12, naCaixa: OBSERVACAO, naLinha: false, emTabela: false },
      { altura: 12, naCaixa: null, naLinha: true, emTabela: false },
      { altura: null, naCaixa: null, naLinha: true, emTabela: true },
    ]);
    // A linha cinza vai no lugar da caixa: antes do "Antes de ler".
    expect(noDegrau(3).blocos.slice(0, 2).map((b) => b.tipo)).toEqual(['nota', 'destaque']);
  });

  it('nenhum degrau tira número: a tabela do que registrou é a mesma, e a tabela semanal tem os totais do gráfico', () => {
    const semAperto = registros(noDegrau(0).blocos);
    expect(semAperto.cabecalho).toContain('O que conta');
    for (const degrau of [1, 2, 3, 4]) expect(registros(noDegrau(degrau).blocos)).toEqual(semAperto);
    const grafico = colunas(noDegrau(0).blocos)!;
    const totais = grafico.categorias.map((_, c) => String(grafico.valores[0][c] + grafico.valores[1][c]));
    const tabela = tabelaDoTempo(noDegrau(4).blocos)!;
    expect(tabela.linhas[0]).toEqual(['Concluídas', ...totais]);
    expect(tabela.linhas[1]).toEqual(['No dia marcado', ...grafico.valores[0].map(String)]);
    expect(tabela.folga).toBeLessThan(1);
  });

  it('a folha que cabe não aperta nada, e a observação fica na caixa', () => {
    const d = documentoQueCabe(BASE, DE_UMA, CONTEXTO, ANTERIOR, {}, cabe);
    expect(d.apertos).toEqual({});
    expect(d.capa.observacao).toBe(OBSERVACAO);
    expect(colunas(d.blocos)?.altura).toBe(22);
  });

  it('a folha que não cabe sobe um degrau por medida até o último, e sai assim mesmo, sem cortar', () => {
    let medidas = 0;
    const nuncaCabe: MedidorDeDocumento = (_capa, blocos) => {
      medidas += 1;
      return { topos: [40, 22], fim: 60, paginas: 2, paginaDoBloco: blocos.map(() => 2) };
    };
    const d = documentoQueCabe(BASE, DE_UMA, CONTEXTO, ANTERIOR, {}, nuncaCabe);
    expect(d.apertos).toEqual({ ana: 4 });
    expect(medidas).toBe(5);
    expect(registros(d.blocos)).toEqual(registros(noDegrau(0).blocos));
  });

  it('com uma página por pessoa, aperta só quem passou da própria folha', () => {
    // Página nova em cada cartão, e mais uma quando a folha do Dr. Bruno ainda leva colunas.
    const brunoTransborda: MedidorDeDocumento = (_capa, blocos) => {
      let pagina = 1;
      let dono = '';
      const paginaDoBloco = blocos.map((b) => {
        if (b.tipo === 'pessoa') {
          pagina += 1;
          dono = b.nome;
        }
        if (b.tipo === 'colunas' && dono === 'Dr. Bruno') pagina += 1;
        return pagina;
      });
      return { topos: [], fim: 100, paginas: pagina, paginaDoBloco };
    };
    const d = documentoQueCabe(BASE, escolhas({ detalhe: 'PAGINAS' }), CONTEXTO, ANTERIOR, {}, brunoTransborda);
    expect(d.apertos).toEqual({ bruno: 4 });
    // A observação da equipe é do topo do documento, e não de uma folha: continua na caixa.
    expect(d.capa.observacao).toBe(OBSERVACAO);
  });

  it('a tabela da equipe e só os totais não têm folha de pessoa: nada é medido', () => {
    for (const detalhe of ['TABELA', 'NENHUM'] as const) {
      const medir = jest.fn(cabe);
      const d = documentoQueCabe(BASE, escolhas({ detalhe }), CONTEXTO, ANTERIOR, {}, medir);
      expect(medir).not.toHaveBeenCalled();
      expect(d.desenho).toBeNull();
      expect(d.apertos).toEqual({});
    }
  });
});
