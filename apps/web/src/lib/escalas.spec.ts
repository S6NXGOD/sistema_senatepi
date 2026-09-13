import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PALETA_ADVOGADOS, agruparPorDia, contar, corDaPessoa, diaCurto, estaNoHorario, gerarDatasDaRepeticao,
  hojeBR, horaBR, mensagemDoErro, montarCores, montarCoresDaTela, nomeDeExibicao, planejarAlteracao,
  posicaoDoPopover, primeiroNome, proximoDiaUtil, rotuloDoPlantao, separarParaSeletor, ultimoDiaDoMes,
} from './escalas';

const adv = (nomeExibicao: string | null, nome = 'Fallback Sobrenome') =>
  ({ id: 'a1', nome, nomeExibicao } as Parameters<typeof primeiroNome>[0]);

/**
 * "Dra." NÃO É UM NOME.
 *
 * Visto numa tela real: no detalhe da atividade, o bloco "Plantão do dia"
 * listava duas linhas — "Dra." e "Dr." — com horário ao lado e nenhum nome.
 * Dois advogados de plantão apareciam como duas linhas indistinguíveis, e a
 * escala mostrava "Dra. -09:00" na célula do calendário.
 *
 * A causa: `primeiroNome` pegava o primeiro token de `nomeExibicao`, e o padrão
 * de nomes deste acervo é "Dra. Shérad" / "Dr. Murilo". O primeiro token é o
 * TRATAMENTO.
 */
describe('primeiroNome pula o tratamento', () => {
  it('"Dra. Shérad" vira "Shérad", não "Dra."', () => {
    expect(primeiroNome(adv('Dra. Shérad'))).toBe('Shérad');
  });

  it('"Dr. Murilo Marcones" vira "Murilo"', () => {
    expect(primeiroNome(adv('Dr. Murilo Marcones'))).toBe('Murilo');
  });

  it('nome sem tratamento continua funcionando', () => {
    expect(primeiroNome(adv('Shérad Araújo'))).toBe('Shérad');
  });

  it('não se importa com caixa, acento ou ponto', () => {
    expect(primeiroNome(adv('DRA Shérad'))).toBe('Shérad');
    expect(primeiroNome(adv('dra. Shérad'))).toBe('Shérad');
    expect(primeiroNome(adv('Sra. Jaqueline'))).toBe('Jaqueline');
    expect(primeiroNome(adv('Profa. Margareth'))).toBe('Margareth');
  });

  /**
   * Cadastro incompleto não pode virar linha em branco: uma linha vazia na
   * escala some da tela sem explicar por quê, que é pior que um rótulo feio.
   */
  it('só tratamento e mais nada devolve o que existe', () => {
    expect(primeiroNome(adv('Dr.'))).toBe('Dr.');
  });

  it('cai para `nome` quando não há `nomeExibicao`', () => {
    expect(primeiroNome(adv(null, 'Dr. Carlos Henrique'))).toBe('Carlos');
  });

  /**
   * A palavra do meio não é tratamento. "Ana Dra Silva" é bizarro, mas o
   * primeiro token já é nome e a busca para nele — a função não sai varrendo.
   */
  it('não confunde nome com tratamento no meio', () => {
    expect(primeiroNome(adv('Ana Dra Silva'))).toBe('Ana');
  });
});

/**
 * Onde há largura, o nome de exibição vai INTEIRO — "Dra. Shérad" é como a
 * pessoa é chamada, e encurtar sem necessidade só tira informação. É o que o
 * plantão do detalhe usa agora, numa linha de ~300px com `truncate`.
 */
describe('nomeDeExibicao', () => {
  it('mantém o tratamento', () => {
    expect(nomeDeExibicao(adv('Dra. Shérad'))).toBe('Dra. Shérad');
  });

  it('cai para `nome` quando não há apelido', () => {
    expect(nomeDeExibicao(adv(null, 'Carlos Henrique de Alencar'))).toBe('Carlos Henrique de Alencar');
  });
});

/**
 * "Shérad -09:00" parecia número negativo e escondia o fim do plantão.
 */
describe('rótulo do plantão', () => {
  it('nome e faixa com traço de intervalo, sem hífen colado', () => {
    const r = rotuloDoPlantao({ advogado: adv('Dra. Shérad'), horaInicio: '09:00', horaFim: '12:00' });
    expect(r).toBe('Shérad 09:00–12:00');
    expect(r).not.toContain(' -');
  });

  it('dia curto igual ao da frase de erro da API, também a partir do ISO', () => {
    expect(diaCurto('2026-09-15')).toBe('15/09');
    expect(diaCurto('2026-09-15T00:00:00.000Z')).toBe('15/09');
  });

  it('plural de gente', () => {
    expect(contar(1, 'plantão', 'plantões')).toBe('1 plantão');
    expect(contar(0, 'plantão', 'plantões')).toBe('0 plantões');
    expect(contar(3, 'plantão', 'plantões')).toBe('3 plantões');
  });
});

/**
 * COR ESTÁVEL. Era a ordem alfabética entre os escalados do MÊS: o mesmo
 * advogado mudava de cor entre setembro e outubro, e ficava sempre azul ao
 * filtrar (sozinho na lista, era o primeiro).
 */
describe('cor por pessoa', () => {
  const equipe = ['u-shérad', 'u-murilo', 'u-ana', 'u-carlos', 'u-jaque'].map((id) => ({ id }));

  it('a mesma pessoa tem sempre a mesma cor, só pelo id', () => {
    expect(corDaPessoa('u-murilo')).toBe(corDaPessoa('u-murilo'));
    expect(PALETA_ADVOGADOS).toContain(corDaPessoa('qualquer-id'));
  });

  it('a ordem de chegada (a do mês, a do nome) não muda a cor', () => {
    const a = montarCores(equipe);
    const b = montarCores([...equipe].reverse());
    const c = montarCores([equipe[2], equipe[0], equipe[4], equipe[1], equipe[3]]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('sozinha no conjunto, a pessoa fica com a cor do próprio id (o filtro não pinta todo mundo de azul)', () => {
    for (const { id } of equipe) {
      expect(montarCores([{ id }])[id]).toBe(corDaPessoa(id));
    }
  });

  it('com até dez pessoas, ninguém divide cor', () => {
    const dez = Array.from({ length: 10 }, (_, i) => ({ id: `pessoa-${i}` }));
    const cores = Object.values(montarCores(dez));
    expect(new Set(cores).size).toBe(10);
  });

  it('com mais pessoas que cores, todas ainda recebem uma cor da paleta', () => {
    const doze = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));
    const mapa = montarCores(doze);
    expect(Object.keys(mapa)).toHaveLength(12);
    for (const cor of Object.values(mapa)) expect(PALETA_ADVOGADOS).toContain(cor);
  });

  it('id repetido não gasta duas cores', () => {
    const mapa = montarCores([{ id: 'x' }, { id: 'x' }, { id: 'y' }]);
    expect(Object.keys(mapa).sort()).toEqual(['x', 'y']);
  });

  /**
   * O colega desativado aparece nos meses antigos. Se ele disputasse a paleta,
   * a cor de quem está ativo mudaria só por navegar até esse mês.
   */
  it('na tela, quem está fora da equipe não empurra a cor de ninguém', () => {
    const daEquipe = montarCores(equipe);
    const tela = montarCoresDaTela(equipe, [...equipe, { id: 'u-desativado' }]);
    for (const { id } of equipe) expect(tela[id]).toBe(daEquipe[id]);
    expect(tela['u-desativado']).toBe(corDaPessoa('u-desativado'));
  });

  /** Âmbar é "ficou para trás" e vermelho é erro: pessoa não pode parecer aviso. */
  it('a paleta não usa âmbar nem vermelho', () => {
    for (const cor of PALETA_ADVOGADOS) {
      expect(cor.bg).not.toMatch(/amber|red|rose|yellow/);
      expect(cor.dot).not.toMatch(/amber|red|rose|yellow/);
    }
  });
});

/**
 * REPETIR TODA SEMANA. Medido em 12/09/2026: 25 plantões, 5 advogados, cada um
 * num dia fixo da semana, 09:00–12:00. Setembro de 2026 começa numa terça.
 */
describe('gerarDatasDaRepeticao', () => {
  it('segundas e quartas de setembro de 2026', () => {
    expect(gerarDatasDaRepeticao({ diasDaSemana: [1, 3], de: '2026-09-01', ate: '2026-09-30' })).toEqual([
      '2026-09-02', '2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16',
      '2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30',
    ]);
  });

  it('as pontas do período entram', () => {
    expect(gerarDatasDaRepeticao({ diasDaSemana: [1], de: '2026-09-14', ate: '2026-09-28' })).toEqual([
      '2026-09-14', '2026-09-21', '2026-09-28',
    ]);
  });

  it('atravessa o mês', () => {
    expect(gerarDatasDaRepeticao({ diasDaSemana: [5], de: '2026-09-25', ate: '2026-10-09' })).toEqual([
      '2026-09-25', '2026-10-02', '2026-10-09',
    ]);
  });

  it('pula o fim de semana mesmo que alguém peça sábado e domingo', () => {
    expect(gerarDatasDaRepeticao({ diasDaSemana: [0, 6, 1], de: '2026-09-12', ate: '2026-09-14' })).toEqual([
      '2026-09-14',
    ]);
    expect(gerarDatasDaRepeticao({ diasDaSemana: [0, 6], de: '2026-09-01', ate: '2026-09-30' })).toEqual([]);
  });

  it('período invertido, dia inexistente ou nenhum dia escolhido dão lista vazia, sem exceção', () => {
    expect(gerarDatasDaRepeticao({ diasDaSemana: [1], de: '2026-09-30', ate: '2026-09-01' })).toEqual([]);
    expect(gerarDatasDaRepeticao({ diasDaSemana: [1], de: '2026-02-31', ate: '2026-03-31' })).toEqual([]);
    expect(gerarDatasDaRepeticao({ diasDaSemana: [], de: '2026-09-01', ate: '2026-09-30' })).toEqual([]);
    expect(gerarDatasDaRepeticao({ diasDaSemana: [1], de: '', ate: '2026-09-30' })).toEqual([]);
  });

  it('um período absurdo para no limite de um ano, em vez de travar a tela', () => {
    const datas = gerarDatasDaRepeticao({ diasDaSemana: [1, 2, 3, 4, 5], de: '2026-01-01', ate: '2035-12-31' });
    expect(datas.length).toBeGreaterThan(250);
    expect(datas.length).toBeLessThanOrEqual(262);
  });

  it('"Adicionar data" propõe o dia útil seguinte, não a mesma data', () => {
    expect(proximoDiaUtil('2026-09-11')).toBe('2026-09-14'); // sexta → segunda
    expect(proximoDiaUtil('2026-09-14')).toBe('2026-09-15');
  });

  it('último dia do mês, com fevereiro bissexto', () => {
    expect(ultimoDiaDoMes('2026-09-13')).toBe('2026-09-30');
    expect(ultimoDiaDoMes('2026-02-10')).toBe('2026-02-28');
    expect(ultimoDiaDoMes('2028-02-01')).toBe('2028-02-29');
  });
});

/**
 * NO CELULAR, A LISTA ABRE POR DIA, COM HOJE PRIMEIRO. Quem abre a escala no
 * telefone quer saber quem está hoje e quem vem depois.
 */
describe('agruparPorDia', () => {
  const e = (id: string, data: string, horaInicio: string) => ({ id, data: `${data}T00:00:00.000Z`, horaInicio });
  const escalas = [
    e('passado', '2026-09-10', '09:00'),
    e('hoje-tarde', '2026-09-13', '14:00'),
    e('hoje-manha', '2026-09-13', '09:00'),
    e('depois', '2026-09-20', '09:00'),
    e('amanha', '2026-09-15', '09:00'),
    e('bem-antes', '2026-09-01', '09:00'),
  ];

  it('hoje, depois os próximos em ordem, e no fim os que passaram', () => {
    const grupos = agruparPorDia(escalas, '2026-09-13');
    expect(grupos.map((g) => [g.data, g.quando])).toEqual([
      ['2026-09-13', 'hoje'],
      ['2026-09-15', 'proximo'],
      ['2026-09-20', 'proximo'],
      ['2026-09-01', 'passado'],
      ['2026-09-10', 'passado'],
    ]);
  });

  it('dentro do dia, pela hora', () => {
    const [hoje] = agruparPorDia(escalas, '2026-09-13');
    expect(hoje.itens.map((i) => i.id)).toEqual(['hoje-manha', 'hoje-tarde']);
  });

  it('mês que não é o atual: sem bloco de hoje, na ordem do calendário', () => {
    const grupos = agruparPorDia(escalas, '2026-08-01');
    expect(grupos.every((g) => g.quando === 'proximo')).toBe(true);
    expect(grupos.map((g) => g.data)).toEqual(['2026-09-01', '2026-09-10', '2026-09-13', '2026-09-15', '2026-09-20']);
  });
});

/**
 * "HOJE" E "AGORA" SÃO OS DE TERESINA, qualquer que seja o aparelho. As horas
 * da escala são daqui; o cartão do painel já usava esta régua.
 */
describe('fuso da escala', () => {
  it('23h30 em Teresina ainda é o mesmo dia (02h30 UTC do dia seguinte)', () => {
    const agora = new Date('2026-09-14T02:30:00.000Z');
    expect(hojeBR(agora)).toBe('2026-09-13');
    expect(horaBR(agora)).toBe('23:30');
  });

  it('00h30 em Teresina já é o dia seguinte', () => {
    const agora = new Date('2026-09-14T03:30:00.000Z');
    expect(hojeBR(agora)).toBe('2026-09-14');
    expect(horaBR(agora)).toBe('00:30');
  });

  it('no horário pela hora de Teresina', () => {
    const turno = { horaInicio: '09:00', horaFim: '12:00' };
    expect(estaNoHorario(turno, new Date('2026-09-14T12:30:00.000Z'))).toBe(true); // 09:30
    expect(estaNoHorario(turno, new Date('2026-09-14T15:01:00.000Z'))).toBe(false); // 12:01
    expect(estaNoHorario(turno, new Date('2026-09-14T11:59:00.000Z'))).toBe(false); // 08:59
  });
});

describe('seletor: advogados primeiro, os outros agrupados', () => {
  const p = (id: string, nome: string, role?: string) => ({ id, nome, nomeExibicao: null, role });

  it('separa por perfil e ordena por nome dentro de cada grupo', () => {
    const r = separarParaSeletor([
      p('1', 'Zélia', 'TRIAGEM'),
      p('2', 'Murilo', 'ADVOGADO'),
      p('3', 'Ana', 'COORDENACAO'),
      p('4', 'Ângela', 'ADVOGADO'),
    ]);
    expect(r.temPerfil).toBe(true);
    expect(r.advogados.map((x) => x.nome)).toEqual(['Ângela', 'Murilo']);
    expect(r.outros.map((x) => x.nome)).toEqual(['Ana', 'Zélia']);
  });

  /** Janela do deploy: a API antiga não manda `role`. Ninguém some do seletor. */
  it('sem perfil em ninguém, todos num grupo só', () => {
    const r = separarParaSeletor([p('1', 'Zélia'), p('2', 'Ana')]);
    expect(r.temPerfil).toBe(false);
    expect(r.advogados.map((x) => x.nome)).toEqual(['Ana', 'Zélia']);
    expect(r.outros).toEqual([]);
  });
});

describe('planejarAlteracao manda só o que mudou', () => {
  const atual = {
    horaInicio: '09:00', horaFim: '12:00', observacao: null as string | null,
    advogadoId: 'u1', advogado: { id: 'u1', nome: 'Shérad', nomeExibicao: 'Dra. Shérad' },
  };
  const form = { advogadoId: 'u1', horaInicio: '09:00', horaFim: '12:00', observacao: '' };

  it('nada mudou: nada a mandar', () => {
    expect(planejarAlteracao(atual, form)).toBeNull();
    expect(planejarAlteracao(atual, { ...form, observacao: '   ' })).toBeNull();
  });

  it('troca de pessoa é só o advogadoId', () => {
    expect(planejarAlteracao(atual, { ...form, advogadoId: 'u2' })).toEqual({ advogadoId: 'u2' });
  });

  it('horário e observação', () => {
    expect(planejarAlteracao(atual, { ...form, horaFim: '11:00', observacao: ' troca combinada ' })).toEqual({
      horaFim: '11:00', observacao: 'troca combinada',
    });
  });

  it('apagar a observação manda null', () => {
    expect(planejarAlteracao({ ...atual, observacao: 'Substitui' }, form)).toEqual({ observacao: null });
  });

  it('sem advogadoId no objeto, compara com o advogado aninhado', () => {
    const { advogadoId: _fora, ...semId } = atual;
    expect(planejarAlteracao(semId, form)).toBeNull();
  });

  it('trocar sem escolher ninguém não vira alteração', () => {
    expect(planejarAlteracao(atual, { ...form, advogadoId: '' })).toBeNull();
  });
});

/**
 * A FRASE DA API VAI PARA A TELA. A recusa de sobreposição diz qual dia e qual
 * horário colidiu; trocar por "não foi possível salvar" faria quem cadastrou
 * vinte datas procurar a errada.
 */
describe('mensagemDoErro', () => {
  const erro = (message: unknown) => ({ response: { data: { message } } });

  it('a frase da sobreposição chega inteira', () => {
    const frase = 'Em 15/09 a Dra. Shérad já está de plantão 09:00–12:00.';
    expect(mensagemDoErro(erro(frase), 'padrão')).toBe(frase);
  });

  it('lista do ValidationPipe: a primeira frase', () => {
    expect(mensagemDoErro(erro(['No máximo 62 datas por vez.', 'outra']), 'padrão')).toBe('No máximo 62 datas por vez.');
  });

  it('sem frase (rede caiu), o texto padrão', () => {
    expect(mensagemDoErro(new Error('Network Error'), 'padrão')).toBe('padrão');
    expect(mensagemDoErro(erro(''), 'padrão')).toBe('padrão');
    expect(mensagemDoErro(undefined, 'padrão')).toBe('padrão');
  });

  /** Janela do deploy: a tela nova diante da API que ainda não tem o PATCH. */
  it('rota que ainda não existe vira frase de gente', () => {
    const m = mensagemDoErro(erro('Cannot PATCH /api/escalas/abc'), 'padrão');
    expect(m).not.toContain('Cannot');
    expect(m).toContain('ainda não está disponível');
  });
});

/**
 * O cartão do plantão abria em `top: r.bottom` com largura fixa: nos plantões da
 * última semana do mês ele sumia atrás do rodapé da janela.
 */
describe('posicaoDoPopover', () => {
  const janela = { largura: 1280, altura: 800 };
  const cartao = { largura: 288, altura: 200 };

  it('cabe embaixo: abre embaixo da barra', () => {
    expect(posicaoDoPopover({ top: 100, bottom: 120, left: 300 }, janela, cartao)).toEqual({ left: 300, top: 124 });
  });

  it('não cabe embaixo: abre em cima, ancorado pelo rodapé', () => {
    expect(posicaoDoPopover({ top: 700, bottom: 720, left: 300 }, janela, cartao)).toEqual({ left: 300, bottom: 104 });
  });

  it('na borda direita, recua para dentro da janela', () => {
    expect(posicaoDoPopover({ top: 100, bottom: 120, left: 1200 }, janela, cartao).left).toBe(1280 - 288 - 8);
  });

  it('janela baixa demais para os dois lados: fica dentro, embaixo', () => {
    const r = posicaoDoPopover({ top: 150, bottom: 170, left: 10 }, { largura: 400, altura: 300 }, cartao);
    expect(r.bottom).toBeUndefined();
    expect(r.top! + cartao.altura).toBeLessThanOrEqual(300);
  });
});

/**
 * O PDF é um irmão da tela: formatava a data à mão. Correto, mas fora da regra
 * única — e o teste de data pura não o listava.
 */
describe('o PDF da escala lê a data pela regra única', () => {
  const fonte = readFileSync(join(__dirname, 'escalas-pdf.ts'), 'utf8');
  it('usa formatDataPura na data', () => {
    expect(fonte).toContain('formatDataPura(e.data');
    expect(fonte).not.toContain('new Date(e.data)');
  });
});

/**
 * A prévia e o que é salvo saem da MESMA lista: se o modal recalculasse as
 * datas do lote por conta própria, a pessoa desmarcaria o feriado e ele seria
 * gravado mesmo assim.
 */
describe('o modal salva o que a prévia mostra', () => {
  const fonte = readFileSync(join(__dirname, '..', 'components', 'escalas', 'nova-escala-modal.tsx'), 'utf8');
  it('as datas saem de gerarDatasDaRepeticao e do filtro das desmarcadas', () => {
    expect(fonte).toContain('gerarDatasDaRepeticao({');
    expect(fonte).toContain('marcadas.map((data) =>');
  });
});
