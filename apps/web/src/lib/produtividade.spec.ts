import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAVES_DO_BLOCO, DECISAO_GRAVADA_DESDE, DECIDIDAS_NAO_MEDIDAS, LEGENDA_DO_USO, agoraDaPessoa, ausente, blocosDaPessoa, comparaDecididas,
  conteudoDoBloco, criadaNoPeriodo, dataEHoraEmTeresina, diaEmTeresina, diasDeSemana, diasMedidosDasDecididas, faixaDeUso,
  fraseDosDiasDeSemana, fraseDoPerfil, gruposPorPerfil, hrefDaAuditoria, legendaDaAba, linhasDaLegenda, medicaoDasDecididas,
  rostosValidos, segundaFeiraDe, semanasDosDias, textoDoUltimoAcesso, textoDosDiasComUso, type LinhaDeUso,
} from './produtividade';

const ler = (relativo: string) => readFileSync(join(__dirname, '..', relativo), 'utf8');

const linha = (over: Partial<LinhaDeUso> = {}): LinhaDeUso => ({
  usuarioId: 'u', nome: 'Pessoa', perfil: 'ADVOGADO', avatarUrl: null,
  ultimoAcesso: null, diasComUso: 0, diasAtivos: [],
  agenda: { concluidas: 0, noDiaMarcado: 0, criadas: 0, abertas: 0, atrasadas: 0 },
  publicacoes: { decididas: 0, esperando: 0 },
  processos: { cadastrados: 0, andamentos: 0, documentos: 0 },
  filiados: { cadastrados: 0, fichasAtualizadas: 0 },
  atendimentos: 0,
  ...over,
});

/**
 * "UMA PARTE PARA RELATÓRIOS FOCADA EM PRODUTIVIDADE, POR USUÁRIO E POR PERFIL"
 * — pedido de 12/09/2026. Os nomes de pessoas aqui são inventados.
 */
describe('uso e produtividade — o que a tela diz', () => {
  // Um sábado em Teresina, às 15h (o jest roda no fuso de Fortaleza).
  const agora = new Date('2026-09-12T15:00:00-03:00');

  it('último acesso em frase de gente, pelo calendário', () => {
    expect(textoDoUltimoAcesso('2026-09-12T09:05:00-03:00', agora)).toBe('hoje às 09:05');
    expect(textoDoUltimoAcesso('2026-09-11T23:00:00-03:00', agora)).toBe('ontem');
    expect(textoDoUltimoAcesso('2026-09-07T10:00:00-03:00', agora)).toBe('há 5 dias');
    expect(textoDoUltimoAcesso('2026-08-20T10:00:00-03:00', agora)).toBe('há 3 semanas');
    expect(textoDoUltimoAcesso('2026-07-04T10:00:00-03:00', agora)).toBe('em 04/07/2026');
  });

  it('ausência é o mesmo corte da API: nunca entrou, ou sete dias sem entrar', () => {
    expect(ausente(null, agora)).toBe(true);
    expect(ausente('2026-09-05T15:00:00-03:00', agora)).toBe(true);
    expect(ausente('2026-09-06T15:00:00-03:00', agora)).toBe(false);
  });

  it('a faixa é por dia até dois meses, e o fim de semana é marcado', () => {
    expect(faixaDeUso(['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'], ['2026-09-07'])).toEqual({
      tipo: 'DIA',
      marcas: [
        { dia: '2026-09-04', usou: false, fimDeSemana: false },
        { dia: '2026-09-05', usou: false, fimDeSemana: true },
        { dia: '2026-09-06', usou: false, fimDeSemana: true },
        { dia: '2026-09-07', usou: true, fimDeSemana: false },
      ],
    });
  });

  it('acima de dois meses, a faixa vira semanas', () => {
    const dias = Array.from({ length: 70 }, (_, i) =>
      new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
    );
    const faixa = faixaDeUso(dias, [dias[0], dias[1], dias[69]]);
    expect(faixa.tipo).toBe('SEMANA');
    expect(faixa.marcas).toHaveLength(10);
    expect(faixa.marcas[0]).toEqual({ inicio: '2026-07-01', diasComUso: 2, diasNoTrecho: 7 });
    expect(faixa.marcas[9]).toEqual({ inicio: dias[63], diasComUso: 1, diasNoTrecho: 7 });
  });

  /** "20 de 62" punha sábado e domingo no denominador: quem usou todo dia útil parecia ter usado um terço. */
  it('dias com uso, e quantos dias de semana o período tem — sem fração', () => {
    const agosto = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    expect(diasDeSemana(agosto)).toBe(21);
    expect(textoDosDiasComUso(20, agosto)).toBe('20 dias com uso · o período tem 21 dias de semana');
    expect(textoDosDiasComUso(1, ['2026-09-11'])).toBe('1 dia com uso · o período tem 1 dia de semana');
    expect(textoDosDiasComUso(1, ['2026-09-12', '2026-09-13'])).toBe('1 dia com uso · o período só tem fim de semana');
    expect(textoDosDiasComUso(0, [])).toBe('0 dias com uso');
  });

  /**
   * UMA FUNÇÃO SÓ PARA A FRASE E PARA A CRIAÇÃO DA CONTA (15/09/2026). O PDF
   * tinha a própria `criadaNoPeriodo` e a própria frase, e a do período só de
   * fim de semana já dizia outra coisa. A prova de que as saídas coincidem está
   * em `produtividade-pdf.spec.ts`; aqui, que a frase da aba é esta função.
   */
  it('a frase dos dias de semana é a metade de textoDosDiasComUso, e o PDF não tem cópia', () => {
    const agosto = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    expect(fraseDosDiasDeSemana(['2026-09-12', '2026-09-13'])).toBe('o período só tem fim de semana');
    expect(fraseDosDiasDeSemana([])).toBe('');
    const casos: [string[], string | null][] = [
      [agosto, null], [agosto, '2026-08-20'], [agosto, '2026-08-31'], [['2026-09-12', '2026-09-13'], null],
      [['2026-09-11', '2026-09-12', '2026-09-13'], '2026-09-12'],
    ];
    for (const [dias, desde] of casos) {
      expect(textoDosDiasComUso(2, dias, desde)).toBe(`2 dias com uso · ${fraseDosDiasDeSemana(dias, desde)}`);
    }
    const pdf = ler('lib/produtividade-pdf.ts');
    expect(pdf).not.toMatch(/function (criadaNoPeriodo|fraseDosDiasDeSemana)\s*\(/);
    expect(pdf).toMatch(/criadaNoPeriodo\(l\.contaCriadaEm, ctx\.p\.dias\)/);
    expect(pdf).toMatch(/fraseDosDiasDeSemana\(ctx\.p\.dias, desde\)/);
  });

  /**
   * CONTA CRIADA NO MEIO DO PERÍODO (15/09/2026) — a mesma regra do PDF. Os
   * dias de antes dela saíam como "não usou", e os dias de semana contavam o
   * período inteiro.
   */
  describe('a conta criada no meio do período', () => {
    const agosto = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);

    it('o dia da criação só vale dentro do período, depois do primeiro dia, no calendário de Teresina', () => {
      // 20/08 às 23h30 em Teresina já é 21/08 em UTC: vale o dia de Teresina.
      expect(criadaNoPeriodo('2026-08-21T02:30:00.000Z', agosto)).toBe('2026-08-20');
      expect(criadaNoPeriodo('2026-08-20T15:00:00.000Z', agosto)).toBe('2026-08-20');
      expect(criadaNoPeriodo('2026-08-01T15:00:00.000Z', agosto)).toBeNull();
      expect(criadaNoPeriodo('2026-07-10T15:00:00.000Z', agosto)).toBeNull();
      expect(criadaNoPeriodo('2026-09-02T15:00:00.000Z', agosto)).toBeNull();
      expect(criadaNoPeriodo(undefined, agosto)).toBeNull();
      expect(criadaNoPeriodo('2026-08-20T15:00:00.000Z', [])).toBeNull();
    });

    it('os dias de semana contam a partir da criação', () => {
      // De 20/08 (quinta) a 31/08: 20, 21, 24 a 28 e 31.
      expect(textoDosDiasComUso(3, agosto, '2026-08-20')).toBe('3 dias com uso · desde 20/08 são 8 dias de semana');
      expect(textoDosDiasComUso(1, agosto, '2026-08-31')).toBe('1 dia com uso · desde 31/08 é 1 dia de semana');
      expect(textoDosDiasComUso(1, ['2026-09-11', '2026-09-12', '2026-09-13'], '2026-09-12'))
        .toBe('1 dia com uso · desde 12/09 só houve sábado e domingo');
      // Sem a criação no período, a frase de sempre.
      expect(textoDosDiasComUso(20, agosto, null)).toBe('20 dias com uso · o período tem 21 dias de semana');
    });

    it('na faixa por dia, os dias de antes saem marcados, e não como "não usou"', () => {
      const faixa = faixaDeUso(['2026-09-04', '2026-09-05', '2026-09-07', '2026-09-08'], ['2026-09-08'], '2026-09-07');
      expect(faixa).toEqual({
        tipo: 'DIA',
        marcas: [
          { dia: '2026-09-04', usou: false, fimDeSemana: false, antesDaConta: true },
          { dia: '2026-09-05', usou: false, fimDeSemana: true, antesDaConta: true },
          { dia: '2026-09-07', usou: false, fimDeSemana: false },
          { dia: '2026-09-08', usou: true, fimDeSemana: false },
        ],
      });
    });

    it('na faixa por semana, a semana conta só os dias depois da criação', () => {
      const dias = Array.from({ length: 70 }, (_, i) => new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10));
      // Conta criada em 18/07 (o 18º dia): 2 semanas inteiras antes, e a 3ª (15 a 21/07) conta de 18 a 21.
      const faixa = faixaDeUso(dias, ['2026-07-02', '2026-07-19', '2026-07-20'], '2026-07-18');
      expect(faixa.tipo).toBe('SEMANA');
      expect(faixa.marcas.slice(0, 3)).toEqual([
        { inicio: '2026-07-01', diasComUso: 0, diasNoTrecho: 0, antesDaConta: true },
        { inicio: '2026-07-08', diasComUso: 0, diasNoTrecho: 0, antesDaConta: true },
        { inicio: '2026-07-15', diasComUso: 2, diasNoTrecho: 4 },
      ]);
      expect(faixa.marcas[3]).toEqual({ inicio: '2026-07-22', diasComUso: 0, diasNoTrecho: 7 });
    });
  });

  /** O perfil decide a ORDEM dos blocos; o que foi registrado nunca some. */
  it('o perfil ordena os blocos, mas não esconde trabalho registrado', () => {
    expect(blocosDaPessoa(linha())).toEqual(['agenda', 'publicacoes', 'processos']);
    expect(blocosDaPessoa(linha({ atendimentos: 3 }))).toEqual([
      'agenda', 'publicacoes', 'processos', 'atendimentos',
    ]);
    expect(blocosDaPessoa(linha({ perfil: 'TRIAGEM' }))[0]).toBe('atendimentos');
  });

  const curta = (chave: string) => LEGENDA_DO_USO.find((l) => l.chave === chave)!.curta;

  /**
   * V6 (15/09/2026): "0 concluídas · 4 em aberto, 2 atrasadas" no mesmo quadro
   * fazia o atraso de hoje parecer do mês. O quadro diz só o período; o que é
   * de agora sai em `agoraDaPessoa`, o único lugar com âmbar. "Atrasada", nunca
   * "prazo vencido".
   */
  it('o bloco da agenda diz só o período; em aberto e atrasadas ficam em "Agora", com o âmbar', () => {
    const l = linha({
      ultimoAcesso: '2026-09-12T09:05:00-03:00',
      agenda: { concluidas: 12, noDiaMarcado: 9, criadas: 4, abertas: 3, atrasadas: 1 },
    });
    const c = conteudoDoBloco('agenda', l);
    expect(c).toEqual({
      numero: 12,
      rotulo: 'concluídas',
      linhas: [{ texto: '9 no dia marcado' }, { texto: 'criou 4' }],
      explica: curta('concluidas'),
    });
    expect(agoraDaPessoa(l, agora)).toEqual([
      { chave: 'ultimoAcesso', rotulo: 'Último acesso', valor: 'hoje às 09:05', alerta: false, explica: curta('ultimoAcesso') },
      {
        chave: 'emAberto', rotulo: 'Na agenda', valor: '3 atividades em aberto', alerta: false,
        abaixo: { texto: '1 atrasada', alerta: true }, explica: curta('emAberto'),
      },
      { chave: 'esperando', rotulo: 'Diário', valor: 'nenhuma proposta esperando', alerta: false, explica: curta('esperando') },
    ]);
    expect(JSON.stringify([conteudoDoBloco('agenda', linha()), agoraDaPessoa(linha(), agora)])).not.toContain('vencid');
  });

  it('nunca entrou e sete dias sem entrar pedem atenção em "Agora"; sem atrasada, não há segunda linha', () => {
    const [nunca, semAtraso] = agoraDaPessoa(linha({ agenda: { concluidas: 0, noDiaMarcado: 0, criadas: 0, abertas: 2, atrasadas: 0 } }), agora);
    expect(nunca).toMatchObject({ valor: 'nunca entrou', alerta: true });
    expect(semAtraso).toEqual({ chave: 'emAberto', rotulo: 'Na agenda', valor: '2 atividades em aberto', alerta: false, explica: curta('emAberto') });
    expect(agoraDaPessoa(linha({ ultimoAcesso: '2026-09-05T15:00:00-03:00' }), agora)[0]).toMatchObject({ valor: 'há 7 dias', alerta: true });
  });

  it('proposta esperando decisão pede atenção em "Agora"; o Diário só para quem tem o bloco', () => {
    const l = linha({ publicacoes: { decididas: 8, esperando: 2 } });
    expect(conteudoDoBloco('publicacoes', l)).toMatchObject({ numero: 8, rotulo: 'decididas', linhas: [] });
    expect(agoraDaPessoa(l, agora).find((i) => i.chave === 'esperando')).toMatchObject({
      valor: '2 propostas esperando decisão', alerta: true,
    });
    expect(agoraDaPessoa(linha({ perfil: 'TRIAGEM' }), agora).map((i) => i.chave)).toEqual(['ultimoAcesso', 'emAberto']);
  });

  /** O mesmo "não medido" do PDF: 0 decididas em agosto é número que ninguém mediu. */
  it('decididas num período antes de 13/09/2026 não viram zero no quadro', () => {
    const l = linha({ publicacoes: { decididas: 0, esperando: 1 } });
    const agosto = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    expect(conteudoDoBloco('publicacoes', l, agosto)).toEqual({
      numero: null, rotulo: 'decididas', linhas: [{ texto: 'não medido antes de 13/09/2026' }], explica: DECIDIDAS_NAO_MEDIDAS,
    });
    expect(conteudoDoBloco('publicacoes', l, ['2026-09-12', '2026-09-13']).linhas).toEqual([{ texto: 'só desde 13/09/2026' }]);
    expect(conteudoDoBloco('publicacoes', l, ['2026-09-13', '2026-09-14']).linhas).toEqual([]);
  });

  /** Conta salvamentos, e não fichas: a mesma ficha salva três vezes conta três. */
  it('fichas: "salvou N alterações", e não "atualizou N fichas"', () => {
    expect(conteudoDoBloco('filiados', linha({ filiados: { cadastrados: 2, fichasAtualizadas: 3 } })).linhas).toEqual([
      { texto: 'salvou 3 alterações em fichas' },
    ]);
    expect(conteudoDoBloco('filiados', linha({ filiados: { cadastrados: 0, fichasAtualizadas: 1 } })).linhas).toEqual([
      { texto: 'salvou 1 alteração em fichas' },
    ]);
  });

  it('o resumo do perfil diz quem sumiu — ou que ninguém sumiu', () => {
    expect(
      fraseDoPerfil({ perfil: 'ADVOGADO', pessoas: 9, usaram: 7, semAcessoRecente: 1, nuncaEntraram: 2 }),
    ).toBe('1 sem entrar há uma semana ou mais · 2 nunca entraram');
    expect(
      fraseDoPerfil({ perfil: 'TRIAGEM', pessoas: 2, usaram: 2, semAcessoRecente: 0, nuncaEntraram: 0 }),
    ).toBe('todos entraram na última semana');
  });

  it('agrupa por perfil sem reordenar as pessoas', () => {
    const grupos = gruposPorPerfil([
      linha({ usuarioId: '1', nome: 'Ana' }),
      linha({ usuarioId: '2', nome: 'Bia' }),
      linha({ usuarioId: '3', nome: 'Caio', perfil: 'TRIAGEM' }),
    ]);
    expect(grupos.map((g) => [g.perfil, g.pessoas.map((p) => p.nome)])).toEqual([
      ['ADVOGADO', ['Ana', 'Bia']],
      ['TRIAGEM', ['Caio']],
    ]);
  });
});

/** "O que cada número conta" — a mesma legenda no fim do PDF e em "Como ler estes números". */
describe('a legenda do uso', () => {
  it('cada número aparece uma vez, com o que conta e o retrato', () => {
    const chaves = LEGENDA_DO_USO.map((l) => l.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const l of LEGENDA_DO_USO) {
      expect(l.numero.length).toBeGreaterThan(2);
      expect(l.conta.length).toBeGreaterThan(20);
    }
    expect(LEGENDA_DO_USO.find((l) => l.chave === 'antes')!.retrato).toBeNull();
  });

  /** Em aberto e atrasadas são de hoje: é por isso que não se comparam. */
  it('o que é de hoje não se confunde com o que é do período', () => {
    const hoje = LEGENDA_DO_USO.filter((l) => l.retrato === 'HOJE').map((l) => l.chave);
    expect(hoje).toEqual(['ultimoAcesso', 'semEntrar', 'nuncaEntraram', 'emAberto', 'atrasadas', 'esperando']);
  });

  it('todo número dos quadros tem linha na legenda', () => {
    const conhecidas = new Set(LEGENDA_DO_USO.map((l) => l.chave));
    for (const chaves of Object.values(CHAVES_DO_BLOCO)) {
      for (const c of chaves) expect(conhecidas.has(c)).toBe(true);
    }
  });

  it('só as linhas pedidas, na ordem da legenda', () => {
    expect(linhasDaLegenda(['atendimentos', 'diasComUso']).map((l) => l.chave)).toEqual(['diasComUso', 'atendimentos']);
  });

  it('a aba não explica o que só o PDF tem, e o pessoal não explica o resumo da equipe', () => {
    const global = legendaDaAba('GLOBAL').map((l) => l.chave);
    expect(global).not.toContain('antes');
    expect(global).not.toContain('mesAMes');
    expect(global).toContain('usaram');
    expect(legendaDaAba('PESSOAL').map((l) => l.chave)).not.toContain('usaram');
  });
});

/** D19: "decididas" só se comparam quando o período anterior inteiro já tinha a decisão gravada. */
describe('publicações decididas e a data em que a decisão passou a ser gravada', () => {
  it('compara só a partir de 13/09/2026', () => {
    expect(DECISAO_GRAVADA_DESDE).toBe('2026-09-13');
    expect(comparaDecididas('2026-09-12')).toBe(false);
    expect(comparaDecididas('2026-09-13')).toBe(true);
    expect(comparaDecididas('2027-01-01')).toBe(true);
  });

  /** 14/09/2026: um PDF de agosto imprimia "0 decididas" — número que ninguém mediu. */
  it('o que se mediu de um período: nada, uma parte ou tudo', () => {
    expect(medicaoDasDecididas({ de: '2026-08-01', ate: '2026-08-31' })).toBe('NAO_MEDIDO');
    expect(medicaoDasDecididas({ de: '2026-08-14', ate: '2026-09-12' })).toBe('NAO_MEDIDO');
    expect(medicaoDasDecididas({ de: '2026-08-14', ate: '2026-09-13' })).toBe('PARCIAL');
    expect(medicaoDasDecididas({ de: '2026-09-13', ate: '2026-10-12' })).toBe('MEDIDO');
    expect(diasMedidosDasDecididas(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'])).toBe(2);
  });
});

/** A grade do PDF posiciona cada dia pela segunda-feira da semana — em data pura, como o `semanaBR` da API. */
describe('as semanas e o relógio de Teresina', () => {
  it('a segunda-feira de qualquer dia, domingo incluído', () => {
    expect(segundaFeiraDe('2026-09-13')).toBe('2026-09-07');
    expect(segundaFeiraDe('2026-09-14')).toBe('2026-09-14');
    expect(segundaFeiraDe('2026-08-14')).toBe('2026-08-10');
    // Atravessando o ano.
    expect(segundaFeiraDe('2027-01-01')).toBe('2026-12-28');
  });

  it('as semanas que o período toca, em ordem e sem repetir', () => {
    expect(semanasDosDias(['2026-09-13', '2026-08-31', '2026-09-01', '2026-09-07'])).toEqual([
      '2026-08-31', '2026-09-07',
    ]);
  });

  /** O contêiner e o CI rodam em UTC: 23h de Teresina já é o dia seguinte lá. */
  it('o dia e a hora são os de Teresina, qualquer que seja o fuso de quem roda', () => {
    expect(diaEmTeresina('2026-08-21T02:30:00.000Z')).toBe('2026-08-20');
    expect(dataEHoraEmTeresina('2026-09-13T19:37:00.000Z')).toBe('13/09/2026, 16:37');
  });

  /**
   * 15/09/2026: "hoje", "ontem" e a hora do último acesso vinham do relógio do
   * aparelho. O jest roda no fuso de Fortaleza, e aí o erro não aparece: o
   * teste troca o fuso do processo para UTC, o do contêiner e do CI.
   */
  it('o último acesso usa o calendário e a hora de Teresina, mesmo num aparelho em UTC', () => {
    const fuso = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // Segunda, 14/09/2026, 23:30 em Teresina — em UTC já é terça, 15/09.
      const agora = new Date('2026-09-15T02:30:00.000Z');
      expect(new Date('2026-09-14T12:05:00.000Z').getDate()).toBe(14);
      expect(textoDoUltimoAcesso('2026-09-14T12:05:00.000Z', agora)).toBe('hoje às 09:05');
      // 13/09 às 22:30 em Teresina: ontem, embora em UTC seja o dia 14.
      expect(textoDoUltimoAcesso('2026-09-14T01:30:00.000Z', agora)).toBe('ontem');
      // 03/07 às 22:00 em Teresina, e não 04/07.
      expect(textoDoUltimoAcesso('2026-07-04T01:00:00.000Z', agora)).toBe('em 03/07/2026');
    } finally {
      if (fuso === undefined) delete process.env.TZ;
      else process.env.TZ = fuso;
    }
  });
});

/** A foto do PDF vem pronta da API. Qualquer outra coisa vira iniciais — e o PDF nunca falha. */
describe('as fotos que o PDF aceita', () => {
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

  it('só JPEG em data URL, por id', () => {
    expect(
      rostosValidos({
        rostos: {
          ana: JPEG,
          bruno: 'https://exemplo.com/foto.jpg',
          ivo: 'data:image/png;base64,iVBOR',
          zeca: 'data:image/jpeg;base64,',
          lia: 42,
        },
      }),
    ).toEqual({ ana: JPEG });
  });

  it('resposta antiga, vazia ou torta vira {}', () => {
    expect(rostosValidos(undefined)).toEqual({});
    expect(rostosValidos(null)).toEqual({});
    expect(rostosValidos({})).toEqual({});
    expect(rostosValidos({ rostos: [JPEG] })).toEqual({});
    expect(rostosValidos('<html>')).toEqual({});
  });

  it('miniatura grande demais é descartada', () => {
    expect(rostosValidos({ rostos: { ana: JPEG + 'A'.repeat(300_000) } })).toEqual({});
  });
});

describe('uso e produtividade — onde mora', () => {
  it('"ver o que fez" abre a auditoria com a pessoa e o período, e a auditoria lê', () => {
    expect(hrefDaAuditoria('u 1', '2026-08-13', '2026-09-12')).toBe(
      '/auditoria?usuario=u%201&de=2026-08-13&ate=2026-09-12',
    );
    const AUDITORIA = ler('app/(dashboard)/auditoria/page.tsx');
    expect(AUDITORIA).toMatch(/useFiltroPorUrl\(\s*'usuario',/);
    expect(AUDITORIA).toMatch(/useFiltroPorUrl\(\s*'de',/);
    expect(AUDITORIA).toMatch(/useFiltroPorUrl\(\s*'ate',/);
    expect(AUDITORIA).toContain('<Suspense');
  });

  it('é uma aba dos relatórios, e a planilha segue a aba', () => {
    const TELA = ler('app/(dashboard)/relatorios/page.tsx');
    expect(TELA).toContain("{aba === 'uso' && <UsoEProdutividade de={de} ate={ate} />}");
    expect(TELA).toContain("if (aba === 'uso') await baixarCsvDaProdutividade(de, ate);");
    expect(TELA).toContain("enabled: aba === 'sindicato',");
  });

  /** Sem medalha: a tela não reordena o que a API mandou, e diz o que o número não mede. */
  it('o componente não ordena, e leva a ressalva e a porta da auditoria', () => {
    const COMPONENTE = ler('components/relatorios/uso-e-produtividade.tsx');
    expect(COMPONENTE).not.toMatch(/\.sort\(/);
    expect(COMPONENTE).toContain('{O_QUE_NAO_MEDE}');
    expect(COMPONENTE).toContain("podeVer(user?.role, user?.permissoes, 'auditoria')");
  });

  /**
   * MOVIMENTO NA ABA (13/09/2026): a troca de aba entra num fade na RAIZ do
   * componente — a chamada pinada acima fica intacta — e nada anima por pessoa.
   */
  it('a aba entra com fade na raiz, carrega com esqueleto e não anima o cartão de ninguém', () => {
    const COMPONENTE = ler('components/relatorios/uso-e-produtividade.tsx');
    expect(COMPONENTE).toContain('<div className="animate-surgir-leve">');
    expect(COMPONENTE).toContain('<Carregando texto="Somando o uso do período…"');
    const cartao = COMPONENTE.slice(COMPONENTE.indexOf('function CartaoDaPessoa'));
    expect(cartao).not.toMatch(/animate-|NumeroAnimado/);
    expect(COMPONENTE).toContain('<ComoLer escopo={data.escopo} />');
  });

  /** V6 (15/09/2026): as duas zonas do PDF também na tela, e o âmbar só na de agora. */
  it('o cartão tem "No período" e "Agora", e só "Agora" usa âmbar', () => {
    const COMPONENTE = ler('components/relatorios/uso-e-produtividade.tsx');
    const cartao = COMPONENTE.slice(COMPONENTE.indexOf('function CartaoDaPessoa'), COMPONENTE.indexOf('function AgoraDaPessoa'));
    const agoraNaTela = COMPONENTE.slice(COMPONENTE.indexOf('function AgoraDaPessoa'), COMPONENTE.indexOf('function tomDaSemana'));
    const quadro = COMPONENTE.slice(COMPONENTE.indexOf('function QuadroDoBloco'));
    expect(cartao).toContain('<section aria-label="No período"');
    expect(cartao).toContain('<AgoraDaPessoa p={p} agora={agora} />');
    expect(cartao).not.toContain('amber');
    expect(quadro).toContain('conteudoDoBloco(bloco, p, dias)');
    expect(quadro).not.toContain('amber');
    expect(agoraNaTela).toContain('agoraDaPessoa(p, agora).map((item) =>');
    expect(agoraNaTela).toContain("item.alerta && 'text-amber-700 dark:text-amber-400'");
  });
});
