import { tenant } from '@/tenant.config';
import {
  ConsultaDoPlantao, ConsultasDoPlantao, ItemDaCopia, agruparCopiaPorDia, apoioDaConsulta, avisoDeExclusao,
  avisoDaConsultaPassada, avisoDoDestinoPreenchido, avisoDoNovoHorario, cabecalhoDasConsultas, celularDaConsultaPassada, chaveDaCopia,
  comArtigo, consultasEscolhidas, consultasForaDoNovoHorario, daPessoa, delaOuDele, ehConflito, fraseDoChoque,
  frasesDasIgnoradas, itensEscolhidosDaCopia, mensagemDaTrocaDeAdvogado, mesAnterior, nomeDoMes, nomeDoMesComAno,
  origemPadraoDaCopia, planejarPassagem, podeCopiarPara, resumoDaCopia, resumoDaTroca, rotuloCurtoDoDia,
  rotuloDasForaDoHorario, rotuloDoBotaoDaCopia, sobreposicaoQueVale, textoDoPlantaoPassado,
} from './escalas';

/*
  14/09/2026 — D15 a D17 da rodada 3. A regra da cópia e a seleção das
  consultas são do SERVIDOR; o que se testa aqui é o que a tela decide com o que
  veio: a origem proposta, o que vai no POST e no PATCH, e as frases.
*/

describe('meses como texto', () => {
  it('nome, nome com ano e o mês anterior, virando o ano', () => {
    expect(nomeDoMes('2026-10')).toBe('outubro');
    expect(nomeDoMesComAno('2026-09')).toBe('setembro de 2026');
    expect(mesAnterior('2026-10')).toBe('2026-09');
    expect(mesAnterior('2026-01')).toBe('2025-12');
  });

  it('cabeçalho do dia sem o ponto do Intl, também a partir do ISO', () => {
    expect(rotuloCurtoDoDia('2026-10-05')).toBe('seg, 05/10');
    expect(rotuloCurtoDoDia('2026-09-29T00:00:00.000Z')).toBe('ter, 29/09');
    expect(rotuloCurtoDoDia('2026-10-11')).toBe('dom, 11/10');
  });
});

/**
 * A ORIGEM É O ÚLTIMO MÊS COM PLANTÕES ANTES DO DESTINO, não "o anterior".
 * Medido em 13/09/2026: agosto 9 plantões, setembro 16.
 */
describe('origemPadraoDaCopia', () => {
  const meses = [
    { mes: '2026-07', plantoes: 0 },
    { mes: '2026-08', plantoes: 9 },
    { mes: '2026-09', plantoes: 16 },
  ];

  it('para outubro, setembro; para setembro, agosto', () => {
    expect(origemPadraoDaCopia(meses, '2026-10')).toBe('2026-09');
    expect(origemPadraoDaCopia(meses, '2026-09')).toBe('2026-08');
  });

  it('julho de recesso não é modelo para agosto: pula para junho', () => {
    expect(origemPadraoDaCopia([{ mes: '2026-06', plantoes: 20 }, { mes: '2026-07', plantoes: 0 }], '2026-08')).toBe('2026-06');
  });

  it('sem nenhum antes, o mais recente depois; sem nenhum, null', () => {
    expect(origemPadraoDaCopia([{ mes: '2026-11', plantoes: 5 }], '2026-10')).toBe('2026-11');
    expect(origemPadraoDaCopia([{ mes: '2026-10', plantoes: 5 }], '2026-10')).toBeNull();
    expect(origemPadraoDaCopia([], '2026-10')).toBeNull();
  });
});

describe('podeCopiarPara: só do mês de Teresina em diante', () => {
  const meioDeSetembro = new Date('2026-09-14T12:00:00.000Z');

  it('setembro e outubro sim, agosto não', () => {
    expect(podeCopiarPara('2026-09', meioDeSetembro)).toBe(true);
    expect(podeCopiarPara('2026-10', meioDeSetembro)).toBe(true);
    expect(podeCopiarPara('2026-08', meioDeSetembro)).toBe(false);
  });

  it('23h de 30/09 em Teresina (02h UTC de 01/10) ainda é setembro', () => {
    expect(podeCopiarPara('2026-09', new Date('2026-10-01T02:00:00.000Z'))).toBe(true);
  });
});

const pessoa = (id: string, nomeExibicao: string) => ({ id, nome: nomeExibicao, nomeExibicao });
const item = (origemId: string, data: string, marcado: boolean, horaInicio = '09:00'): ItemDaCopia => ({
  origemId, data, origemData: '2026-09-01', advogado: pessoa('u-tiago', 'Dr. Tiago'),
  horaInicio, horaFim: '12:00', marcado, nota: null,
});

describe('o que vai no POST da cópia', () => {
  // Outubro de 2026 tem 5 quintas (01, 08, 15, 22, 29); setembro tem 4. A 5ª
  // repete a última de setembro: o MESMO plantão de origem vai para dois dias.
  const criar = [
    item('e-shérad-24-09', '2026-10-22', true),
    item('e-shérad-24-09', '2026-10-29', true),
    item('e-murilo-07-09', '2026-10-05', false), // dia já coberto: vem desmarcado
  ];

  it('sem escolha da pessoa, vale o padrão do servidor', () => {
    expect(itensEscolhidosDaCopia(criar, {})).toEqual([
      { origemId: 'e-shérad-24-09', data: '2026-10-22' },
      { origemId: 'e-shérad-24-09', data: '2026-10-29' },
    ]);
  });

  it('desmarcar a 5ª quinta não leva junto a 4ª, e marcar o dia coberto inclui', () => {
    const escolhas = {
      [chaveDaCopia({ origemId: 'e-shérad-24-09', data: '2026-10-29' })]: false,
      [chaveDaCopia({ origemId: 'e-murilo-07-09', data: '2026-10-05' })]: true,
    };
    expect(itensEscolhidosDaCopia(criar, escolhas)).toEqual([
      { origemId: 'e-shérad-24-09', data: '2026-10-22' },
      { origemId: 'e-murilo-07-09', data: '2026-10-05' },
    ]);
  });

  it('agrupa por dia do destino, na ordem do calendário e do horário', () => {
    const grupos = agruparCopiaPorDia([
      item('b', '2026-10-06', true, '14:00'),
      item('a', '2026-10-05', true),
      item('c', '2026-10-06', true, '08:00'),
    ]);
    expect(grupos.map((g) => [g.data, g.itens.map((i) => i.origemId)])).toEqual([
      ['2026-10-05', ['a']],
      ['2026-10-06', ['c', 'b']],
    ]);
  });

  it('as frases do resumo e do botão', () => {
    expect(resumoDaCopia(22, '2026-10')).toBe('22 plantões vão ser criados em outubro.');
    expect(resumoDaCopia(1, '2026-10')).toBe('1 plantão vai ser criado em outubro.');
    expect(resumoDaCopia(0, '2026-10')).toBe('Nenhum plantão vai ser criado em outubro.');
    expect(rotuloDoBotaoDaCopia(22)).toBe('Criar 22 plantões');
    expect(rotuloDoBotaoDaCopia(1)).toBe('Criar 1 plantão');
    expect(avisoDoDestinoPreenchido(6, '2026-10')).toBe('Outubro já tem 6 plantões. Os que batem com a cópia ficaram de fora.');
    expect(avisoDoDestinoPreenchido(0, '2026-10')).toBeNull();
  });

  it('409 é conflito; 400 e rede caída não', () => {
    expect(ehConflito({ response: { status: 409 } })).toBe(true);
    expect(ehConflito({ response: { status: 400 } })).toBe(false);
    expect(ehConflito(new Error('Network Error'))).toBe(false);
  });
});

describe('artigo sem chutar gênero', () => {
  it('Dra., Dr. e nome sem tratamento', () => {
    expect(comArtigo('Dra. Shérad')).toBe('a Dra. Shérad');
    expect(comArtigo('Dr. Murilo')).toBe('o Dr. Murilo');
    expect(comArtigo('Margareth')).toBe('Margareth');
    expect(daPessoa('Dra. Shérad')).toBe('da Dra. Shérad');
    expect(daPessoa('Dr. Murilo')).toBe('do Dr. Murilo');
    expect(daPessoa('Margareth')).toBe('de Margareth');
    expect(delaOuDele('Dra. Morgana')).toBe('dela');
    expect(delaOuDele('Dr. Tiago')).toBe('dele');
    expect(delaOuDele('Margareth')).toBe('de Margareth');
  });
});

// Terça, 15/09/2026, plantão 09:00–12:00. 12:00 UTC = 09:00 em Teresina.
const consulta = (id: string, extra: Partial<ConsultaDoPlantao> = {}): ConsultaDoPlantao => ({
  id,
  titulo: `Consulta jurídica ${id}`,
  inicio: '2026-09-15T12:00:00.000Z',
  fim: '2026-09-15T13:00:00.000Z',
  status: 'PENDENTE',
  papel: 'RESPONSAVEL',
  selecionavel: true,
  porQueNao: null,
  local: null,
  temLink: false,
  atendimento: null,
  filiado: null,
  choques: [],
  ...extra,
});

const previa = (extra: Partial<ConsultasDoPlantao> = {}): ConsultasDoPlantao => ({
  escalaId: 'esc-15-09',
  dia: '2026-09-15',
  horaInicio: '09:00',
  horaFim: '12:00',
  passado: false,
  sai: pessoa('u-shérad', 'Dra. Shérad'),
  entra: { ...pessoa('u-murilo', 'Dr. Murilo'), veAgenda: true },
  sobreposicao: null,
  podePassar: true,
  porQueNaoPassa: null,
  total: 4,
  noHorario: [
    consulta('c-0900'),
    consulta('c-1030', { inicio: '2026-09-15T13:30:00.000Z' }),
    consulta('c-agora', { status: 'EM_ANDAMENTO', selecionavel: false, porQueNao: 'Em consulta agora — continua com a Dra. Shérad' }),
  ],
  foraDoHorario: [consulta('c-1500', { inicio: '2026-09-15T18:00:00.000Z' })],
  ...extra,
});

/**
 * PASSAR É DECISÃO DE GENTE. No horário, marcada por padrão; fora do horário,
 * desmarcada; em consulta agora, nunca. E o campo só vai quando a prévia
 * carregou e a API disse que dá — senão a API antiga responderia 400.
 */
describe('planejarPassagem: o passarConsultas do PATCH', () => {
  it('padrão: as do horário que dá para passar; a das 15h e a em andamento ficam', () => {
    expect(planejarPassagem(previa(), {}, true)).toEqual(['c-0900', 'c-1030']);
  });

  it('desmarcar todas manda [] — a decisão de manter é carimbada', () => {
    expect(planejarPassagem(previa(), { 'c-0900': false, 'c-1030': false }, true)).toEqual([]);
  });

  it('marcar a de fora do horário inclui; marcar a em andamento não adianta', () => {
    expect(planejarPassagem(previa(), { 'c-1500': true, 'c-agora': true }, true)).toEqual(['c-0900', 'c-1030', 'c-1500']);
  });

  it('sem prévia (carregando ou erro), não manda o campo', () => {
    expect(planejarPassagem(undefined, {}, true)).toBeUndefined();
  });

  it('API disse que não dá, quem salva não edita a Agenda, ou o plantão já passou: não manda', () => {
    expect(planejarPassagem(previa({ podePassar: false, porQueNaoPassa: 'O Dr. Murilo não tem acesso à Agenda.' }), {}, true)).toBeUndefined();
    expect(planejarPassagem(previa(), {}, false)).toBeUndefined();
    expect(planejarPassagem(previa({ passado: true }), {}, true)).toBeUndefined();
  });

  it('nada selecionável: não há decisão a carimbar', () => {
    const soEmAndamento = previa({
      noHorario: [consulta('c-agora', { status: 'EM_ANDAMENTO', selecionavel: false })],
      foraDoHorario: [],
    });
    expect(planejarPassagem(soEmAndamento, {}, true)).toBeUndefined();
    expect(consultasEscolhidas(soEmAndamento, { 'c-agora': true })).toEqual([]);
  });
});

/**
 * A GET da prévia confere o choque com a faixa GRAVADA; o PATCH, com a do
 * formulário (revisão de 14/09/2026). A Dra. X tem 09:00–12:00, o Dr. Y já tem
 * 09:00–10:30, e a edição troca para o Dr. Y às 11:00–14:00: o PATCH aceita.
 */
describe('sobreposicaoQueVale: a da prévia só trava a faixa gravada', () => {
  const gravada = { horaInicio: '09:00', horaFim: '12:00' };
  const frase = 'Em 15/09 o Dr. Y já está de plantão 09:00–10:30.';

  it('mesma faixa: a sobreposição da prévia vale e trava', () => {
    expect(sobreposicaoQueVale(previa({ sobreposicao: frase }), gravada, { horaInicio: '09:00', horaFim: '12:00' })).toBe(frase);
  });

  it('pessoa e horário mudados juntos: quem decide é o PATCH', () => {
    expect(sobreposicaoQueVale(previa({ sobreposicao: frase }), gravada, { horaInicio: '11:00', horaFim: '14:00' })).toBeNull();
    expect(sobreposicaoQueVale(previa({ sobreposicao: frase }), gravada, { horaInicio: '09:00', horaFim: '13:00' })).toBeNull();
  });

  it('sem prévia ou sem sobreposição: nada', () => {
    expect(sobreposicaoQueVale(undefined, gravada, gravada)).toBeNull();
    expect(sobreposicaoQueVale(previa(), gravada, gravada)).toBeNull();
  });
});

describe('as frases da seção de consultas', () => {
  it('cabeçalho, resumo e as de fora do horário', () => {
    expect(cabecalhoDasConsultas(3, 'Dra. Shérad')).toBe('3 consultas marcadas com a Dra. Shérad neste plantão.');
    expect(cabecalhoDasConsultas(1, 'Dra. Shérad')).toBe('1 consulta marcada com a Dra. Shérad neste plantão.');
    expect(cabecalhoDasConsultas(0, 'Dra. Shérad')).toBe('Nenhuma consulta marcada com a Dra. Shérad neste plantão.');
    expect(resumoDaTroca('Dr. Murilo', 2)).toBe('O Dr. Murilo fica com o plantão e com 2 consultas.');
    expect(resumoDaTroca('Dr. Murilo', 1)).toBe('O Dr. Murilo fica com o plantão e com 1 consulta.');
    expect(resumoDaTroca('Dr. Murilo', 0)).toBe('O Dr. Murilo fica com o plantão.');
    expect(rotuloDasForaDoHorario(1, 'Dra. Shérad')).toBe('Mais 1 consulta dela neste dia, fora do horário do plantão');
  });

  it('a origem e a modalidade da consulta', () => {
    expect(apoioDaConsulta({ atendimento: { id: 'a', numero: 412 }, local: 'Por chamada de vídeo' })).toBe('Atendimento #412 · por vídeo');
    expect(apoioDaConsulta({ atendimento: null, local: 'Por telefone' })).toBe('Criada na agenda · por telefone');
    // O "SENATEPI" das consultas #12–#14 é o rótulo da sede.
    expect(apoioDaConsulta({ atendimento: { id: 'b', numero: 13 }, local: 'SENATEPI' })).toBe('Atendimento #13 · na sede');
  });

  it('o choque do novo plantonista, na hora de Teresina', () => {
    expect(
      fraseDoChoque('Dr. Murilo', {
        titulo: 'Audiência — Processo 0801234-56.2026.8.18.0140',
        inicio: '2026-09-15T12:30:00.000Z',
        fim: '2026-09-15T13:30:00.000Z',
      }),
    ).toBe('O Dr. Murilo já tem Audiência — Processo 0801234-56.2026.8.18.0140 das 09:30 às 10:30.');
  });
});

describe('os irmãos: excluir e encurtar o horário só avisam', () => {
  it('excluir com 2 consultas no horário', () => {
    expect(avisoDeExclusao(previa({ noHorario: [consulta('a'), consulta('b')], foraDoHorario: [] }))).toBe(
      'Há 2 consultas marcadas com a Dra. Shérad neste plantão. Elas continuam na agenda dela. Se outra pessoa vai atender, use Trocar com…',
    );
  });

  it('sem Agenda a API manda só o total, e a contagem é essa', () => {
    expect(avisoDeExclusao(previa({ noHorario: [], foraDoHorario: [], total: 1 }))).toBe(
      'Há 1 consulta marcada com a Dra. Shérad neste plantão. Ela continua na agenda dela. Se outra pessoa vai atender, use Trocar com…',
    );
  });

  it('só consulta fora do horário, ou nenhuma: nada a avisar', () => {
    expect(avisoDeExclusao(previa({ noHorario: [], total: 1 }))).toBeNull();
    expect(avisoDeExclusao(previa({ noHorario: [], foraDoHorario: [], total: 0 }))).toBeNull();
  });

  it('de 09:00–12:00 para 09:00–11:00, a das 11:00 sai (a faixa é [início, fim))', () => {
    const lista = [
      { id: 'c-0900', inicio: '2026-09-15T12:00:00.000Z' },
      { id: 'c-1059', inicio: '2026-09-15T13:59:00.000Z' },
      { id: 'c-1100', inicio: '2026-09-15T14:00:00.000Z' },
    ];
    const fora = consultasForaDoNovoHorario(lista, { horaInicio: '09:00', horaFim: '11:00' });
    expect(fora.map((c) => c.id)).toEqual(['c-1100']);
    expect(avisoDoNovoHorario(fora)).toBe('1 consulta às 11:00 fica fora do novo horário.');
  });

  it('começar mais tarde tira a das 09:00; duas fora viram uma frase só', () => {
    const lista = [
      { inicio: '2026-09-15T14:30:00.000Z' },
      { inicio: '2026-09-15T12:00:00.000Z' },
    ];
    const fora = consultasForaDoNovoHorario(lista, { horaInicio: '10:00', horaFim: '11:00' });
    expect(avisoDoNovoHorario(fora)).toBe('2 consultas (09:00 e 11:30) ficam fora do novo horário.');
    expect(avisoDoNovoHorario([])).toBeNull();
  });
});

describe('o passo "Plantão passado"', () => {
  it('o texto do plantão e das consultas, no plural e no singular', () => {
    expect(textoDoPlantaoPassado('Dr. Murilo', '2026-09-15T00:00:00.000Z', 2)).toBe(
      'O Dr. Murilo assumiu o plantão de 15/09 e 2 consultas. Elas já estão na agenda e no painel dele. Ninguém recebe aviso fora do sistema.',
    );
    expect(textoDoPlantaoPassado('Dra. Morgana', '2026-09-16', 1)).toBe(
      'A Dra. Morgana assumiu o plantão de 16/09 e 1 consulta. Ela já está na agenda e no painel dela. Ninguém recebe aviso fora do sistema.',
    );
  });

  it('as ignoradas, agrupadas pelo motivo do servidor', () => {
    expect(frasesDasIgnoradas([{ id: 'x', motivo: 'Já tinha sido concluída.' }])).toEqual([
      '1 consulta não mudou: já tinha sido concluída.',
    ]);
    expect(
      frasesDasIgnoradas([
        { id: 'x', motivo: 'Já tinha sido concluída.' },
        { id: 'y', motivo: 'já tinha sido concluída' },
        { id: 'z', motivo: 'Foi cancelada.' },
      ]),
    ).toEqual(['2 consultas não mudaram: já tinha sido concluída.', '1 consulta não mudou: foi cancelada.']);
  });

  it('a mensagem ao filiado: dia por extenso, hora de Teresina, quem atende e SEM link', () => {
    const msg = mensagemDaTrocaDeAdvogado({
      nomeFiliado: 'Maria da Silva',
      entra: { nome: 'Murilo Marcones', nomeExibicao: 'Dr. Murilo' },
      inicio: '2026-09-15T12:00:00.000Z',
    });
    expect(msg).toBe(
      `Olá, Maria. Aqui é do ${tenant.sigla}.\n\n` +
        'Sua consulta jurídica de terça, 15/09, às 09:00 continua marcada. Quem vai atender agora é o Dr. Murilo.\n\n' +
        'Se precisar remarcar, é só responder esta mensagem.',
    );
    expect(msg).not.toMatch(/https?:\/\//);
  });

  it('23h30 de terça em Teresina (02h30 UTC de quarta) continua sendo terça', () => {
    const msg = mensagemDaTrocaDeAdvogado({ nomeFiliado: 'João', entra: { nome: 'Margareth' }, inicio: '2026-09-16T02:30:00.000Z' });
    expect(msg).toContain('de terça, 15/09, às 23:30 continua marcada. Quem vai atender agora é Margareth.');
  });

  /**
   * A mensagem diz "Quem vai atender agora é…": só serve quando quem saiu ERA
   * quem atendia (revisão de 14/09/2026). A Dra. Shérad atuava junto com a
   * Dra. Ana e passou o plantão ao Dr. Murilo: a Dra. Ana continua atendendo.
   */
  it('quem saiu era o responsável: botão do WhatsApp', () => {
    expect(avisoDaConsultaPassada({ papel: 'RESPONSAVEL', jaEraResponsavel: false }, 'Dr. Murilo')).toEqual({ tipo: 'WHATSAPP' });
  });

  it('API antiga, sem papel: fica o botão, como antes', () => {
    expect(avisoDaConsultaPassada({}, 'Dr. Murilo')).toEqual({ tipo: 'WHATSAPP' });
  });

  it('quem saiu só atuava junto: linha informativa com o responsável, sem mensagem ao filiado', () => {
    expect(avisoDaConsultaPassada({ papel: 'PARTICIPANTE' }, 'Dr. Murilo', { nome: 'Ana Maria', nomeExibicao: 'Dra. Ana' })).toEqual({
      tipo: 'INFORMATIVO',
      texto: 'O Dr. Murilo passa a atuar junto; quem atende continua sendo a Dra. Ana.',
    });
    expect(avisoDaConsultaPassada({ papel: 'PARTICIPANTE', jaEraResponsavel: false }, 'Dr. Murilo')).toEqual({
      tipo: 'INFORMATIVO',
      texto: 'O Dr. Murilo passa a atuar junto; quem atende não muda.',
    });
  });

  it('quem entrou já era o responsável: linha informativa, sem mensagem', () => {
    expect(avisoDaConsultaPassada({ papel: 'PARTICIPANTE', jaEraResponsavel: true }, 'Dr. Murilo')).toEqual({
      tipo: 'INFORMATIVO',
      texto: `O Dr. Murilo já era quem atende esta consulta. Para o ${tenant.vocabulario.filiado}, nada muda.`,
    });
  });

  it('celular: só celular de verdade vira botão', () => {
    expect(celularDaConsultaPassada({ celularWhatsApp: '5586999998888' })).toBe('5586999998888');
    expect(celularDaConsultaPassada({ celularWhatsApp: '(86) 3222-1111' })).toBeNull();
    expect(celularDaConsultaPassada({ celularWhatsApp: null })).toBeNull();
    expect(celularDaConsultaPassada(null)).toBeNull();
  });
});
