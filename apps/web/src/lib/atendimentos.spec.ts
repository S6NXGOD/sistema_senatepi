import { readFileSync } from 'fs';
import { join } from 'path';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';
import {
  agruparEquipe, assuntoMudou, comQuem, confirmacaoDoEncaminhamento, consultasDoAtendimento, corpoDoAssunto,
  dataJaPassou, deQuem, diaBR, diaDoPlantao, erroDoAssunto, faltaConcluir, filtroDaUrl, fraseDoEncaminhamento,
  horaBR, linkWhatsApp, mensagemDaConsulta, mensagemSaudacao, modalidadeDoLocal, modalidadeRemota,
  rotuloDoAssunto, rotuloDoDia, rotuloDoEncaminhamento, urlTemFiltro, ESTADO_ENCAMINHAMENTO,
  CATEGORIAS_CANCELAMENTO_ATENDIMENTO, DESFECHO_COR, LOCAL_DA_MODALIDADE, STATUS_COR,
  casoDoConcluir, concluirEhDireto, conferirFechamento, corpoDoCancelar, corpoDoConcluir, escolhaInicialDaConsulta,
  fechamentoSujo, fraseDaConsultaCancelada, fraseDoFechamento, mensagemDaConsultaCancelada, mensagemDaFalha,
  modalidadeDoCartao, mostrarConfirmacaoDoFechamento, notaObrigatoria, podeMarcarNovaConsulta, resumoDoConcluir,
  rotuloDaCategoriaDoAtendimento, rotuloDaModalidadeNoCartao, sujeitoDaFrase, textoDoReabrir,
  textosDaConsultaNoCancelar, tomDoEncaminhamento,
  type CompromissoResumo, type Encaminhamento, type EscolhasDoFechamento, type FechamentoAtendimento,
} from './atendimentos';

const params = (q: string) => new URLSearchParams(q);
/** Qualquer emoji ou pictograma — some em silêncio em várias fontes e é regra da casa não usar. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('assunto: "Qual assunto?" só quando é Outro (D12)', () => {
  it.each<[string | null, string, 'ok' | 'curto' | 'longo']>([
    ['REMUNERACAO', '', 'ok'],
    [null, '', 'ok'],
    ['', 'qualquer coisa', 'ok'],
    ['OUTRO', '', 'curto'],
    ['OUTRO', '  ap   ', 'curto'],
    ['OUTRO', '   a   b  ', 'ok'], // vira "a b": 3 caracteres, no limite
    ['OUTRO', 'aposentadoria', 'ok'],
    ['OUTRO', 'x'.repeat(80), 'ok'],
    ['OUTRO', 'x'.repeat(81), 'longo'],
  ])('assunto %p com texto %p: %s', (assunto, texto, esperado) => {
    const erro = erroDoAssunto(assunto, texto);
    if (esperado === 'ok') expect(erro).toBeNull();
    else if (esperado === 'longo') expect(erro).toMatch(/80 caracteres/);
    else expect(erro).toMatch(/pelo menos 3/);
  });

  it('o rótulo diz qual é o Outro, e cai no nome da lista nos demais', () => {
    expect(rotuloDoAssunto('OUTRO', '  plano   de saúde ')).toBe('Outro: plano de saúde');
    expect(rotuloDoAssunto('OUTRO', '')).toBe('Outro');
    expect(rotuloDoAssunto(null, 'sobra')).toBeNull();
  });

  it('o corpo do PATCH não leva o texto quando o Outro virou outro assunto', () => {
    expect(corpoDoAssunto('REMUNERACAO', 'aposentadoria')).toEqual({ assunto: 'REMUNERACAO' });
    expect(corpoDoAssunto('', 'aposentadoria')).toEqual({ assunto: null });
    expect(corpoDoAssunto('OUTRO', ' aposentadoria  especial ')).toEqual({ assunto: 'OUTRO', assuntoOutro: 'aposentadoria especial' });
  });

  it('só manda PATCH quando algo mudou de verdade', () => {
    expect(assuntoMudou({ assunto: null }, { assunto: '' })).toBe(false);
    expect(assuntoMudou({ assunto: 'OUTRO', assuntoOutro: 'plano' }, { assunto: 'OUTRO', assuntoOutro: ' plano ' })).toBe(false);
    expect(assuntoMudou({ assunto: 'OUTRO', assuntoOutro: 'plano' }, { assunto: 'OUTRO', assuntoOutro: 'aposentadoria' })).toBe(true);
    expect(assuntoMudou({ assunto: 'REMUNERACAO', assuntoOutro: 'x' }, { assunto: 'REMUNERACAO', assuntoOutro: 'y' })).toBe(false);
    expect(assuntoMudou({ assunto: null }, { assunto: 'OUTRO', assuntoOutro: 'plano' })).toBe(true);
  });
});

describe('datas no fuso de Teresina', () => {
  it('23h30 de Teresina ainda é o mesmo dia (em UTC já é o seguinte)', () => {
    const instante = '2026-09-16T02:30:00.000Z'; // 15/09 23:30 em Teresina
    expect(diaBR(instante)).toBe('2026-09-15');
    expect(horaBR(instante)).toBe('23:30');
  });

  it('dia puro nunca anda para trás', () => {
    expect(rotuloDoDia('2026-09-15')).toBe('ter, 15/09');
    expect(rotuloDoDia('lixo')).toBe('lixo');
  });

  it('o plantão mostrado é o do dia digitado, ou o dia padrão do servidor — nunca "hoje" por conta própria', () => {
    expect(diaDoPlantao('2026-09-17T10:00', '2026-09-15')).toBe('2026-09-17');
    expect(diaDoPlantao('', '2026-09-15')).toBe('2026-09-15');
    expect(diaDoPlantao('', null)).toBeNull();
  });

  it('aviso de data no passado', () => {
    const agora = new Date('2026-09-13T12:00:00-03:00');
    expect(dataJaPassou('', agora)).toBe(false);
    expect(dataJaPassou('2026-09-13T11:59:00-03:00', agora)).toBe(true);
    expect(dataJaPassou('2026-09-14T09:00:00-03:00', agora)).toBe(false);
    expect(dataJaPassou('não é data', agora)).toBe(false);
  });
});

describe('modalidade da consulta (D11: é o local, não o canal)', () => {
  it('lê de volta o que o servidor grava no local', () => {
    expect(modalidadeDoLocal('Por chamada de vídeo')).toBe('VIDEO');
    expect(modalidadeDoLocal('Por telefone')).toBe('TELEFONE');
    expect(modalidadeDoLocal('Sala 2')).toBeNull();
    expect(modalidadeDoLocal(null)).toBeNull();
  });

  it('remoto exige data', () => {
    expect(modalidadeRemota('VIDEO')).toBe(true);
    expect(modalidadeRemota('TELEFONE')).toBe(true);
    expect(modalidadeRemota('SEDE')).toBe(false);
    expect(modalidadeRemota(undefined)).toBe(false);
  });
});

describe('estado do encaminhamento', () => {
  const base: Encaminhamento = {
    estado: 'AGENDADA',
    compromissoId: 'c1',
    inicio: '2026-09-15T13:00:00.000Z', // 10:00 em Teresina
    responsavel: { id: 'u1', nome: 'Shérad Maria', nomeExibicao: 'Dra. Shérad' },
    linkReuniao: null,
    local: 'Por chamada de vídeo',
  };

  it('nenhum tom é vermelho, e "vencida" não aparece em rótulo nenhum', () => {
    for (const { rotulo, tom } of Object.values(ESTADO_ENCAMINHAMENTO)) {
      expect(['ambar', 'verde', 'neutro']).toContain(tom);
      expect(rotulo.toLowerCase()).not.toMatch(/vencid|atrasad/);
    }
    expect(ESTADO_ENCAMINHAMENTO.FICOU_PARA_TRAS.tom).toBe('ambar');
    expect(ESTADO_ENCAMINHAMENTO.ATENDIDA.tom).toBe('verde');
  });

  it('frases com quem, quando e como', () => {
    expect(fraseDoEncaminhamento(base, 'PENDENTE')).toBe('Consulta com a Dra. Shérad em ter, 15/09 às 10:00 · por vídeo');
    expect(fraseDoEncaminhamento({ ...base, estado: 'FICOU_PARA_TRAS' }, 'PENDENTE'))
      .toBe('A consulta de ter, 15/09 com a Dra. Shérad ficou para trás: ninguém marcou como atendida');
    expect(fraseDoEncaminhamento({ ...base, estado: 'ATENDIDA' }, 'PENDENTE'))
      .toBe('Consulta atendida por Dra. Shérad. Falta concluir o atendimento.');
    expect(fraseDoEncaminhamento({ ...base, estado: 'ATENDIDA' }, 'CONCLUIDO')).toBe('Consulta atendida por Dra. Shérad');
    expect(fraseDoEncaminhamento({ ...base, responsavel: null, local: null }, 'PENDENTE')).toBe('Consulta em ter, 15/09 às 10:00');
  });

  it('"Concluir atendimento" só quando a consulta foi atendida e a demanda segue aberta (D13: nada fecha sozinho)', () => {
    expect(faltaConcluir({ status: 'PENDENTE', encaminhamento: { ...base, estado: 'ATENDIDA' } })).toBe(true);
    expect(faltaConcluir({ status: 'CONCLUIDO', encaminhamento: { ...base, estado: 'ATENDIDA' } })).toBe(false);
    expect(faltaConcluir({ status: 'PENDENTE', encaminhamento: { ...base, estado: 'HOJE' } })).toBe(false);
    expect(faltaConcluir({ status: 'PENDENTE' })).toBe(false);
    expect(rotuloDoEncaminhamento('ATENDIDA', 'PENDENTE')).toBe('Consulta atendida · falta concluir');
    expect(rotuloDoEncaminhamento('ATENDIDA', 'CONCLUIDO')).toBe('Consulta atendida');
  });

  it('confirmação logo depois de encaminhar', () => {
    expect(confirmacaoDoEncaminhamento(base)).toBe('Consulta com a Dra. Shérad em ter, 15/09 às 10:00 · por vídeo');
    expect(confirmacaoDoEncaminhamento({ ...base, responsavel: { nome: 'Murilo', nomeExibicao: 'Dr. Murilo' }, local: null }))
      .toBe('Consulta com o Dr. Murilo em ter, 15/09 às 10:00');
  });

  it('artigo pelo tratamento, sem chutar gênero do nome', () => {
    expect(comQuem('Dra. Ana')).toBe('com a Dra. Ana');
    expect(comQuem('Dr Paulo')).toBe('com o Dr Paulo');
    expect(comQuem('Maria')).toBe('com Maria');
    expect(deQuem('Dra. Ana')).toBe('da Dra. Ana');
    expect(deQuem('Joana')).toBe('de Joana');
  });

  it('seguimento não é consulta, e a API antiga (só compromissos) continua lida', () => {
    const c = (id: string, origemDesfechoId: string | null = null) =>
      ({ id, status: 'PENDENTE', inicio: base.inicio, responsavel: null, origemDesfechoId });
    expect(consultasDoAtendimento({ consultas: [c('a'), c('b', 'a')] }).map((x) => x.id)).toEqual(['a']);
    expect(consultasDoAtendimento({ compromissos: [c('x')] }).map((x) => x.id)).toEqual(['x']);
    expect(consultasDoAtendimento({})).toEqual([]);
  });
});

describe('equipe agrupada: advogados primeiro, ninguém escondido', () => {
  it('mantém a ordem da API dentro de cada grupo', () => {
    const r = agruparEquipe([
      { id: '1', role: 'COORDENACAO' }, { id: '2', role: 'ADVOGADO' }, { id: '3', role: null }, { id: '4', role: 'ADVOGADO' },
    ]);
    expect(r.advogados.map((p) => p.id)).toEqual(['2', '4']);
    expect(r.outros.map((p) => p.id)).toEqual(['1', '3']);
  });
});

describe('mensagens ao filiado', () => {
  it('consulta por vídeo leva dia, hora e link; sem emoji; sigla da instalação', () => {
    const m = mensagemDaConsulta({
      nomeFiliado: 'Maria das Dores Silva',
      responsavel: { nome: 'Shérad', nomeExibicao: 'Dra. Shérad' },
      inicio: '2026-09-15T13:00:00.000Z',
      local: 'Por chamada de vídeo',
      linkReuniao: 'https://meet.google.com/abc-defg-hij',
    });
    expect(m).toContain('Olá, Maria.');
    expect(m).toContain(`Aqui é do ${tenant.sigla}.`);
    expect(m).toContain('com a Dra. Shérad ficou marcada para ter, 15/09, às 10:00');
    expect(m).toContain('https://meet.google.com/abc-defg-hij');
    expect(m).not.toMatch(EMOJI);
  });

  it('vídeo sem link avisa que o link vem depois; na sede diz onde', () => {
    const semLink = mensagemDaConsulta({ nomeFiliado: 'Ana', responsavel: null, inicio: '2026-09-15T13:00:00.000Z', local: 'Por chamada de vídeo' });
    expect(semLink).toMatch(/link para entrar será enviado/);
    const sede = mensagemDaConsulta({ nomeFiliado: 'Ana', responsavel: null, inicio: '2026-09-15T13:00:00.000Z', local: null });
    expect(sede).toContain(`É na sede do ${tenant.sigla}.`);
  });

  it('a saudação não tem emoji e usa a data de Teresina', () => {
    const s = mensagemSaudacao({ nome: 'João Pedro', data: '2026-09-16T02:30:00.000Z' });
    expect(s).toContain('Olá, João.');
    expect(s).toContain('15/09/2026');
    expect(s).not.toMatch(EMOJI);
  });
});

describe('linkWhatsApp delega à regra única de lib/whatsapp', () => {
  it('fixo não vira link; celular no secundário vira', () => {
    expect(linkWhatsApp('(86) 3222-1111', 'oi')).toBeNull();
    expect(linkWhatsApp('(86) 3222-1111', 'oi', '(86) 99999-8888')).toBe('https://wa.me/5586999998888?text=oi');
    expect(linkWhatsApp(null, 'oi', null)).toBeNull();
  });

  it('o arquivo não monta wa.me por conta própria', () => {
    const fonte = readFileSync(join(__dirname, 'atendimentos.ts'), 'utf8');
    expect(fonte).toContain("from './whatsapp'");
    expect(fonte).not.toMatch(/['"`]https:\/\/wa\.me/);
  });
});

describe('recorte vindo da URL', () => {
  it('lê o que conhece e ignora o resto', () => {
    expect(filtroDaUrl(params('assunto=OUTRO&status=PENDENTE&dataInicio=2026-08-01&dataFim=2026-08-31'))).toEqual({
      status: 'PENDENTE', desfecho: '', canal: '', assunto: 'OUTRO', dataInicio: '2026-08-01', dataFim: '2026-08-31',
    });
    expect(filtroDaUrl(params('assunto=INVENTADO&status=QUALQUER&canal=VIDEO&dataInicio=01/08/2026'))).toEqual({
      status: '', desfecho: '', canal: '', assunto: '', dataInicio: '', dataFim: '',
    });
    expect(urlTemFiltro(params('atendimento=abc'))).toBe(false);
    expect(urlTemFiltro(params('assunto=OUTRO'))).toBe(true);
  });
});

describe('estrutura: o encaminhamento não depende do módulo de escalas', () => {
  /*
    A Triagem tem atendimentos EDITAR e escalas SEM_ACESSO. Quando o modal lia
    `/escalas`, a recusa aparecia como "ninguém de plantão" e o dropdown vazio.
    Se alguém voltar a importar as leituras de escalas no modal, isto reprova.
  */
  const modal = readFileSync(
    join(__dirname, '..', 'components', 'atendimentos', 'registrar-desfecho-modal.tsx'),
    'utf8',
  );

  it('plantão e equipe vêm da rota de atendimentos', () => {
    expect(modal).toContain('opcoesDeEncaminhamento(');
    expect(modal).not.toMatch(/import\s*\{[^}]*\b(listarPlantao|listarAdvogadosEscala|listarAdvogados)\b[^}]*\}\s*from\s*'@\/lib\/escalas'/);
  });
});

// ---------------------------------------------------------------------------
// Fechamento do atendimento (14/09/2026, D8–D13)
// ---------------------------------------------------------------------------

const SHERAD = { id: 'u-sherad', nome: 'Shérad Maria Araújo', nomeExibicao: 'Dra. Shérad' };
const MURILO = { id: 'u-murilo', nome: 'Murilo Sousa', nomeExibicao: 'Dr. Murilo' };
/** qui, 17/09/2026 às 09:00 em Teresina: a consulta do #14. */
const QUI_17_09H = '2026-09-17T12:00:00.000Z';
/** seg, 14/09/2026 às 10:00 em Teresina. */
const AGORA = new Date('2026-09-14T13:00:00.000Z');

type Situacao = NonNullable<FechamentoAtendimento['consulta']>['situacao'];

/** O plano como o servidor manda, para cada situação da consulta vigente (a regra do resumo). */
function plano(situacao: Situacao | 'NENHUMA', extra: { desfecho?: 'RESOLVIDO_ATO' | 'ENCAMINHADO'; inicio?: string; local?: string | null } = {}): FechamentoAtendimento {
  const consulta = situacao === 'NENHUMA'
    ? null
    : { id: 'c14', situacao, inicio: extra.inicio ?? QUI_17_09H, local: extra.local ?? null, linkReuniao: null, responsavel: SHERAD };
  const concluir: FechamentoAtendimento['concluir'] = {
    NENHUMA: { permitido: true, recusa: null, consulta: 'NENHUMA', nota: extra.desfecho === 'RESOLVIDO_ATO' ? 'OPCIONAL' : 'OBRIGATORIA' },
    ATENDIDA: { permitido: true, recusa: null, consulta: 'NENHUMA', nota: 'OPCIONAL' },
    FUTURA: { permitido: true, recusa: null, consulta: 'CANCELAR_PARA_CONCLUIR', nota: 'OBRIGATORIA' },
    COMECOU: { permitido: true, recusa: null, consulta: 'ESCOLHER', nota: 'OBRIGATORIA_SE_CANCELAR' },
    EM_ANDAMENTO: { permitido: true, recusa: null, consulta: 'SO_MANTER', nota: 'OPCIONAL' },
  }[situacao] as FechamentoAtendimento['concluir'];
  const cancelar: FechamentoAtendimento['cancelar'] = {
    NENHUMA: { permitido: true, recusa: null, consulta: 'NENHUMA' },
    ATENDIDA: { permitido: true, recusa: null, consulta: 'ATENDIDA' },
    FUTURA: { permitido: true, recusa: null, consulta: 'ESCOLHER' },
    COMECOU: { permitido: true, recusa: null, consulta: 'ESCOLHER' },
    EM_ANDAMENTO: { permitido: true, recusa: null, consulta: 'SO_MANTER' },
  }[situacao] as FechamentoAtendimento['cancelar'];
  return { consulta, consultasAbertas: consulta && situacao !== 'ATENDIDA' ? 1 : 0, concluir, cancelar };
}

const escolhas = (e: Partial<EscolhasDoFechamento> = {}): EscolhasDoFechamento => ({ consulta: null, texto: '', categoria: '', ...e });
const consultaResumo = (id: string, status: string, inicio: string, responsavel = SHERAD): CompromissoResumo =>
  ({ id, status, inicio, responsavel, origemDesfechoId: null });

describe('cores: fechado não é alarme', () => {
  it('nenhum status nem desfecho é vermelho ou riscado; resolvido no ato é a família verde do chip', () => {
    for (const cor of [...Object.values(STATUS_COR), ...Object.values(DESFECHO_COR)]) {
      expect(cor).not.toMatch(/\bred-|line-through/);
    }
    expect(DESFECHO_COR.RESOLVIDO_ATO).toContain('emerald');
    expect(STATUS_COR.PENDENTE).toContain('amber');
    expect(STATUS_COR.CONCLUIDO).not.toContain('amber');
    expect(STATUS_COR.CANCELADO).not.toContain('amber');
  });

  it('consulta cancelada só é âmbar enquanto o atendimento está pendente', () => {
    expect(tomDoEncaminhamento('CANCELADA', 'PENDENTE')).toBe('ambar');
    expect(tomDoEncaminhamento('CANCELADA', 'CANCELADO')).toBe('neutro');
    expect(tomDoEncaminhamento('CANCELADA', 'CONCLUIDO')).toBe('neutro');
    expect(tomDoEncaminhamento('FICOU_PARA_TRAS', 'PENDENTE')).toBe('ambar');
    expect(tomDoEncaminhamento('ATENDIDA', 'CONCLUIDO')).toBe('verde');
  });
});

describe('frase do encaminhamento depois de fechar', () => {
  const enc: Encaminhamento = {
    estado: 'AGENDADA', compromissoId: 'c14', inicio: QUI_17_09H, responsavel: SHERAD, linkReuniao: null, local: null,
  };

  it('consulta mantida num atendimento cancelado diz a contradição', () => {
    expect(fraseDoEncaminhamento(enc, 'CANCELADO'))
      .toBe('O atendimento foi cancelado, mas a consulta com a Dra. Shérad continua marcada para qui, 17/09 às 09:00.');
    expect(fraseDoEncaminhamento({ ...enc, estado: 'FICOU_PARA_TRAS' }, 'CANCELADO')).toMatch(/^O atendimento foi cancelado, mas/);
  });

  it('"ninguém vai atender" só cobra com a demanda aberta', () => {
    expect(fraseDoEncaminhamento({ ...enc, estado: 'CANCELADA' }, 'PENDENTE'))
      .toBe('A consulta com a Dra. Shérad foi cancelada. Ninguém vai atender se não houver outra.');
    expect(fraseDoEncaminhamento({ ...enc, estado: 'CANCELADA' }, 'CONCLUIDO')).toBe('A consulta com a Dra. Shérad foi cancelada.');
  });
});

describe('categorias do cancelamento', () => {
  it('são os slugs do catálogo da agenda, sem "Outro", e falam como a instalação chama o representado', () => {
    expect(CATEGORIAS_CANCELAMENTO_ATENDIMENTO.map((c) => c.slug)).toEqual(['DESISTENCIA', 'NAO_COMPARECEU', 'PERDEU_OBJETO', 'DUPLICIDADE']);
    expect(rotuloDaCategoriaDoAtendimento('DESISTENCIA')).toBe(`${V.Filiado} desistiu`);
    expect(rotuloDaCategoriaDoAtendimento('NAO_COMPARECEU')).toBe(`${V.Filiado} não retornou`);
    expect(rotuloDaCategoriaDoAtendimento('DUPLICIDADE')).toBe('Registrado por engano');
    expect(rotuloDaCategoriaDoAtendimento('INVENTADA')).toBe('INVENTADA');
    expect(rotuloDaCategoriaDoAtendimento(null)).toBe('');
  });
});

describe('qual tela do "Concluir" e o botão sólido', () => {
  it.each<[Situacao | 'NENHUMA', 'RESOLVIDO_ATO' | 'ENCAMINHADO', string, boolean]>([
    ['ATENDIDA', 'ENCAMINHADO', 'ATENDIDA', true],
    ['NENHUMA', 'RESOLVIDO_ATO', 'RESOLVIDO_NO_ATO', true],
    ['NENHUMA', 'ENCAMINHADO', 'SEM_CONSULTA', false],
    ['FUTURA', 'ENCAMINHADO', 'FUTURA', false],
    ['COMECOU', 'ENCAMINHADO', 'COMECOU', false],
    ['EM_ANDAMENTO', 'ENCAMINHADO', 'EM_ANDAMENTO', false],
  ])('consulta %s com desfecho %s: caso %s, sólido %p', (situacao, desfecho, caso, solido) => {
    const at = { status: 'PENDENTE' as const, desfecho, fechamento: plano(situacao, { desfecho }) };
    expect(casoDoConcluir(at)).toBe(caso);
    expect(concluirEhDireto(at)).toBe(solido);
  });

  it('sem plano (API antiga), cai no "falta concluir" de antes; fechado nunca é sólido', () => {
    const enc: Encaminhamento = { estado: 'ATENDIDA', compromissoId: 'c', inicio: QUI_17_09H, responsavel: SHERAD, linkReuniao: null, local: null };
    expect(casoDoConcluir({ desfecho: 'ENCAMINHADO' })).toBeNull();
    expect(concluirEhDireto({ status: 'PENDENTE', desfecho: 'ENCAMINHADO', encaminhamento: enc })).toBe(true);
    expect(concluirEhDireto({ status: 'CONCLUIDO', desfecho: 'ENCAMINHADO', fechamento: plano('ATENDIDA') })).toBe(false);
  });
});

describe('conferir o fechamento antes de gravar (espelho das recusas da API)', () => {
  it('sem plano, não grava e não inventa motivo', () => {
    expect(conferirFechamento('CONCLUIR', null, escolhas())).toEqual({ pronto: false, falta: null });
    expect(conferirFechamento('CANCELAR', undefined, escolhas({ categoria: 'DESISTENCIA' }))).toEqual({ pronto: false, falta: null });
  });

  it('recusa do servidor vem como frase', () => {
    const f = plano('ATENDIDA');
    f.concluir = { ...f.concluir, permitido: false, recusa: 'Este atendimento já está concluído.' };
    expect(conferirFechamento('CONCLUIR', f, escolhas())).toEqual({ pronto: false, falta: 'Este atendimento já está concluído.' });
  });

  it('caso D (#14, consulta futura): só conclui cancelando, com nota de 10 caracteres', () => {
    const f = plano('FUTURA');
    expect(conferirFechamento('CONCLUIR', f, escolhas({ texto: '  ligou  ' })).pronto).toBe(false);
    expect(conferirFechamento('CONCLUIR', f, escolhas({ texto: '  ligou  ' })).falta).toMatch(/pelo menos 10 caracteres/);
    const ok = escolhas({ texto: ' Ligou e a dúvida foi esclarecida ' });
    expect(conferirFechamento('CONCLUIR', f, ok)).toEqual({ pronto: true, falta: null });
    expect(corpoDoConcluir(f, ok)).toEqual({ nota: 'Ligou e a dúvida foi esclarecida', consulta: 'CANCELAR' });
  });

  it('caso E (já começou): escolha obrigatória; a nota só pesa ao dizer que não aconteceu', () => {
    const f = plano('COMECOU', { inicio: '2026-09-14T12:00:00.000Z' });
    expect(conferirFechamento('CONCLUIR', f, escolhas()).falta).toBe('Diga se a consulta aconteceu.');
    expect(notaObrigatoria(f, escolhas({ consulta: 'MANTER' }))).toBe(false);
    expect(conferirFechamento('CONCLUIR', f, escolhas({ consulta: 'MANTER' }))).toEqual({ pronto: true, falta: null });
    expect(corpoDoConcluir(f, escolhas({ consulta: 'MANTER' }))).toEqual({ consulta: 'MANTER' });
    expect(notaObrigatoria(f, escolhas({ consulta: 'CANCELAR' }))).toBe(true);
    expect(conferirFechamento('CONCLUIR', f, escolhas({ consulta: 'CANCELAR', texto: 'não veio' })).pronto).toBe(false);
    expect(conferirFechamento('CONCLUIR', f, escolhas({ consulta: 'CANCELAR', texto: 'Não veio e desistiu por telefone' })).pronto).toBe(true);
  });

  it('caso C (encaminhado sem consulta viva): nota obrigatória; A e B: opcional e sem `consulta` no corpo', () => {
    expect(conferirFechamento('CONCLUIR', plano('NENHUMA'), escolhas()).pronto).toBe(false);
    expect(conferirFechamento('CONCLUIR', plano('NENHUMA', { desfecho: 'RESOLVIDO_ATO' }), escolhas()).pronto).toBe(true);
    expect(corpoDoConcluir(plano('ATENDIDA'), escolhas({ consulta: 'CANCELAR' }))).toEqual({});
    expect(corpoDoConcluir(plano('EM_ANDAMENTO'), escolhas({ consulta: 'CANCELAR' }))).toEqual({});
  });

  it('nota acima de 2.000 caracteres não vai', () => {
    expect(conferirFechamento('CONCLUIR', plano('ATENDIDA'), escolhas({ texto: 'x'.repeat(2001) })).falta).toBe('A nota cabe em 2000 caracteres.');
  });

  it('cancelar: a categoria é o motivo obrigatório; a consulta aberta vem com "cancelar também" marcado', () => {
    const f = plano('FUTURA');
    expect(escolhaInicialDaConsulta('CANCELAR', f)).toBe('CANCELAR');
    expect(escolhaInicialDaConsulta('CONCLUIR', plano('COMECOU'))).toBeNull();
    expect(escolhaInicialDaConsulta('CANCELAR', plano('ATENDIDA'))).toBeNull();

    expect(conferirFechamento('CANCELAR', f, escolhas({ consulta: 'CANCELAR' })).falta).toBe('Diga por que o atendimento vai ser cancelado.');
    expect(conferirFechamento('CANCELAR', f, escolhas({ categoria: 'DESISTENCIA' })).falta).toBe('Diga o que fazer com a consulta marcada.');
    const e = escolhas({ categoria: 'DESISTENCIA', consulta: 'CANCELAR', texto: '  mudou de cidade ' });
    expect(conferirFechamento('CANCELAR', f, e)).toEqual({ pronto: true, falta: null });
    expect(corpoDoCancelar(f, e)).toEqual({ categoria: 'DESISTENCIA', motivo: 'mudou de cidade', consulta: 'CANCELAR' });
    expect(corpoDoCancelar(f, escolhas({ categoria: 'DUPLICIDADE', consulta: 'MANTER' }))).toEqual({ categoria: 'DUPLICIDADE', consulta: 'MANTER' });
    expect(corpoDoCancelar(plano('NENHUMA'), escolhas({ categoria: 'PERDEU_OBJETO', consulta: 'CANCELAR' }))).toEqual({ categoria: 'PERDEU_OBJETO' });
    expect(conferirFechamento('CANCELAR', plano('NENHUMA'), escolhas({ categoria: 'NAO_COMPARECEU', texto: 'x'.repeat(1001) })).pronto).toBe(false);
  });

  it('formulário sujo: qualquer coisa digitada ou escolhida, inclusive desmarcar a consulta', () => {
    const f = plano('FUTURA');
    expect(fechamentoSujo('CANCELAR', f, escolhas({ consulta: 'CANCELAR' }))).toBe(false);
    expect(fechamentoSujo('CANCELAR', f, escolhas({ consulta: 'MANTER' }))).toBe(true);
    expect(fechamentoSujo('CANCELAR', f, escolhas({ consulta: 'CANCELAR', texto: ' ' }))).toBe(true);
    expect(fechamentoSujo('CONCLUIR', plano('ATENDIDA'), escolhas())).toBe(false);
    expect(fechamentoSujo('CANCELAR', plano('NENHUMA'), escolhas({ categoria: 'DUPLICIDADE' }))).toBe(true);
  });
});

describe('textos do fechamento, com os nomes da equipe e o fuso de Teresina', () => {
  it('sujeito da frase pelo tratamento', () => {
    expect(sujeitoDaFrase('Dra. Shérad')).toBe('A Dra. Shérad');
    expect(sujeitoDaFrase('Dr. Murilo')).toBe('O Dr. Murilo');
    expect(sujeitoDaFrase('Margareth')).toBe('Margareth');
  });

  it('o resumo de cada caso do "Concluir"', () => {
    const at = (situacao: Situacao | 'NENHUMA', extra: Parameters<typeof plano>[1] = {}) => ({ fechamento: plano(situacao, extra) });
    expect(resumoDoConcluir('ATENDIDA', at('ATENDIDA'), AGORA).texto).toBe('A consulta com a Dra. Shérad foi atendida em qui, 17/09.');

    const futura = resumoDoConcluir('FUTURA', at('FUTURA'), AGORA);
    expect(futura.tom).toBe('ambar');
    expect(futura.texto).toBe('A consulta com a Dra. Shérad ainda não aconteceu: qui, 17/09 às 09:00.');
    expect(futura.apoio).toContain('Ela sai da agenda da Dra. Shérad como cancelada, com o seu nome');

    const hoje = resumoDoConcluir('COMECOU', at('COMECOU', { inicio: '2026-09-14T12:00:00.000Z' }), AGORA);
    expect(hoje.texto).toBe('A consulta com a Dra. Shérad era hoje às 09:00 e ninguém marcou como atendida.');
    // 23h30 de sexta em Teresina já é sábado em UTC: o dia da frase é o de Teresina.
    const sexta = resumoDoConcluir('COMECOU', at('COMECOU', { inicio: '2026-09-12T02:30:00.000Z' }), AGORA);
    expect(sexta.texto).toBe('A consulta com a Dra. Shérad de sex, 11/09 às 23:30 ficou para trás: ninguém marcou como atendida.');

    expect(resumoDoConcluir('EM_ANDAMENTO', at('EM_ANDAMENTO'), AGORA).texto)
      .toBe('A Dra. Shérad está com a consulta em andamento agora. A consulta não é mexida: quem encerra é quem atende.');
    expect(resumoDoConcluir('RESOLVIDO_NO_ATO', { desfechoEm: '2026-09-11T02:30:00.000Z', fechamento: plano('NENHUMA') }, AGORA).texto)
      .toBe('Resolvido no ato em 10/09.');
    expect(resumoDoConcluir('SEM_CONSULTA', {
      fechamento: plano('NENHUMA'),
      consultas: [consultaResumo('a', 'CANCELADO', '2026-09-08T12:00:00.000Z', SHERAD), consultaResumo('b', 'CANCELADO', '2026-09-10T12:00:00.000Z', MURILO)],
    }, AGORA).texto).toBe('A consulta com o Dr. Murilo foi cancelada e não houve outra.');
    expect(resumoDoConcluir('SEM_CONSULTA', { fechamento: plano('NENHUMA') }, AGORA).texto)
      .toBe('Nenhuma consulta foi atendida neste atendimento.');
  });

  it('a consulta no "Cancelar": caixa marcada, aviso ao desmarcar, atendida e em andamento', () => {
    const futura = textosDaConsultaNoCancelar(plano('FUTURA'), AGORA)!;
    expect(futura.titulo).toBe('Cancelar também a consulta com a Dra. Shérad');
    expect(futura.apoio).toBe('qui, 17/09 às 09:00 · Na sede. Sai da agenda da Dra. Shérad como cancelada, com o mesmo motivo e o seu nome.');
    expect(futura.aviso).toBe('A consulta continua na agenda da Dra. Shérad. Se ninguém cancelar, ela vai ficar para trás na agenda dessa pessoa depois de qui, 17/09.');

    const antiga = textosDaConsultaNoCancelar(plano('COMECOU', { inicio: '2026-09-11T12:00:00.000Z', local: 'Por chamada de vídeo' }), AGORA)!;
    expect(antiga.apoio).toMatch(/^sex, 11\/09 às 09:00 · Por vídeo\./);
    expect(antiga.aviso).toBe('A consulta continua na agenda da Dra. Shérad, como algo que ficou para trás, até alguém registrar o que houve.');

    expect(textosDaConsultaNoCancelar(plano('ATENDIDA'), AGORA)!.titulo)
      .toBe('A consulta com a Dra. Shérad já foi atendida em qui, 17/09 e continua no histórico.');
    expect(textosDaConsultaNoCancelar(plano('EM_ANDAMENTO'), AGORA)!.titulo).toMatch(/^A Dra. Shérad está com a consulta em andamento\./);
    expect(textosDaConsultaNoCancelar(plano('NENHUMA'), AGORA)).toBeNull();
  });

  it('depois de gravar: a frase e a mensagem saem da RESPOSTA do servidor', () => {
    expect(fraseDaConsultaCancelada({ inicio: QUI_17_09H, responsavel: SHERAD }))
      .toBe('A consulta com a Dra. Shérad de qui, 17/09 às 09:00 foi cancelada.');
    const m = mensagemDaConsultaCancelada({ nomeFiliado: 'Iraci Pereira da Silva', inicio: QUI_17_09H });
    expect(m).toBe(
      `Olá, Iraci. Aqui é do ${tenant.sigla}.\n\n` +
      'A sua consulta jurídica de qui, 17/09, às 09:00, foi cancelada.\n\n' +
      'Se ainda precisar de ajuda, é só responder esta mensagem.',
    );
    expect(m).not.toMatch(EMOJI);
  });

  it('a confirmação com WhatsApp só quando o servidor cancelou, e nunca em "Registrado por engano"', () => {
    const efeitos = { consultasCanceladas: [{ id: 'c14', inicio: QUI_17_09H, responsavel: SHERAD }] };
    expect(mostrarConfirmacaoDoFechamento('CANCELAR', 'DESISTENCIA', efeitos)).toBe(true);
    expect(mostrarConfirmacaoDoFechamento('CONCLUIR', '', efeitos)).toBe(true);
    expect(mostrarConfirmacaoDoFechamento('CANCELAR', 'DUPLICIDADE', efeitos)).toBe(false);
    expect(mostrarConfirmacaoDoFechamento('CANCELAR', 'DESISTENCIA', { consultasCanceladas: [] })).toBe(false);
    expect(mostrarConfirmacaoDoFechamento('CONCLUIR', '', undefined)).toBe(false);
  });
});

describe('o fechamento na ficha e o reabrir', () => {
  it('cancelado e concluído dizem quando, quem e por quê; registro antigo não mostra bloco', () => {
    expect(fraseDoFechamento({
      status: 'CANCELADO',
      canceladoEm: '2026-09-13T13:12:00.000Z',
      canceladoPor: { id: 'u-j', nome: 'Julian Helton' },
      canceladoCategoria: 'DESISTENCIA',
      canceladoMotivo: '  mudou de cidade  ',
    })).toEqual({ texto: `Cancelado em dom, 13/09 às 10:12 por Julian Helton · ${V.Filiado} desistiu`, detalhe: 'mudou de cidade' });
    expect(fraseDoFechamento({
      status: 'CONCLUIDO', concluidoEm: '2026-09-17T15:40:00.000Z', concluidoPor: null, conclusaoObs: '',
    })).toEqual({ texto: 'Concluído em qui, 17/09 às 12:40', detalhe: null });
    expect(fraseDoFechamento({ status: 'CANCELADO' })).toBeNull();
    // Reaberto: as colunas foram limpas, mas mesmo que sobrasse algo, pendente não tem bloco.
    expect(fraseDoFechamento({ status: 'PENDENTE', canceladoEm: '2026-09-13T13:12:00.000Z' })).toBeNull();
  });

  it('reabrir diz o que sai da ficha, e que consulta cancelada não volta', () => {
    expect(textoDoReabrir({ numero: 14, status: 'CANCELADO', consultas: [consultaResumo('c14', 'CANCELADO', QUI_17_09H)] })).toEqual({
      titulo: 'Reabrir o atendimento #14?',
      descricao: 'Ele volta para os pendentes. O motivo do cancelamento sai da ficha e continua guardado na auditoria. '
        + 'A consulta cancelada não volta: se ainda for preciso, marque outra depois.',
    });
    expect(textoDoReabrir({ numero: 9, status: 'CONCLUIDO', consultas: [consultaResumo('c9', 'CONCLUIDO', QUI_17_09H)] }).descricao)
      .toBe('Ele volta para os pendentes. A nota de conclusão sai da ficha e continua guardada na auditoria.');
  });

  it('"Marcar nova consulta": encaminhado, pendente e TODAS as consultas nascidas canceladas (seguimento não conta)', () => {
    const canc = consultaResumo('a', 'CANCELADO', QUI_17_09H);
    const seguimento = { ...consultaResumo('s', 'PENDENTE', QUI_17_09H), origemDesfechoId: 'a' };
    expect(podeMarcarNovaConsulta({ status: 'PENDENTE', desfecho: 'ENCAMINHADO', consultas: [canc, seguimento] })).toBe(true);
    expect(podeMarcarNovaConsulta({ status: 'PENDENTE', desfecho: 'ENCAMINHADO', consultas: [canc, consultaResumo('b', 'PENDENTE', QUI_17_09H)] })).toBe(false);
    expect(podeMarcarNovaConsulta({ status: 'CANCELADO', desfecho: 'ENCAMINHADO', consultas: [canc] })).toBe(false);
    expect(podeMarcarNovaConsulta({ status: 'PENDENTE', desfecho: 'RESOLVIDO_ATO', consultas: [canc] })).toBe(false);
    expect(podeMarcarNovaConsulta({ status: 'PENDENTE', desfecho: 'ENCAMINHADO', consultas: [] })).toBe(false);
  });
});

describe('falha de gravação em português de gente', () => {
  it('rota que ainda não subiu não parece atendimento sumido', () => {
    const naoChegou = 'Esta ação ainda não chegou ao servidor. Atualize a página daqui a alguns minutos.';
    expect(mensagemDaFalha({ response: { status: 404, data: { message: 'Cannot PATCH /api/atendimentos/a1/concluir' } } }, 'x')).toBe(naoChegou);
    expect(mensagemDaFalha({ response: { status: 404, data: {} } }, 'x')).toBe(naoChegou);
    expect(mensagemDaFalha({ response: { status: 404, data: { message: 'Atendimento não encontrado.' } } }, 'x')).toBe('Atendimento não encontrado.');
    expect(mensagemDaFalha({ response: { status: 400, data: { message: ['Diga por que o atendimento vai ser cancelado.'] } } }, 'x'))
      .toBe('Diga por que o atendimento vai ser cancelado.');
    expect(mensagemDaFalha(new Error('Network Error'), 'Não foi possível cancelar.')).toBe('Não foi possível cancelar.');
  });
});

describe('modalidade da consulta já marcada (D12)', () => {
  it('o local gravado é o mesmo da API', () => {
    expect(LOCAL_DA_MODALIDADE).toEqual({ SEDE: null, VIDEO: 'Por chamada de vídeo', TELEFONE: 'Por telefone' });
    for (const m of ['SEDE', 'VIDEO', 'TELEFONE'] as const) expect(modalidadeDoCartao(LOCAL_DA_MODALIDADE[m])).toBe(m);
  });

  it('o cartão sempre escreve como vai ser; texto livre aparece como está e não marca nenhuma', () => {
    expect(rotuloDaModalidadeNoCartao(null)).toBe('Na sede');
    expect(rotuloDaModalidadeNoCartao('   ')).toBe('Na sede');
    expect(rotuloDaModalidadeNoCartao('Por chamada de vídeo')).toBe('Por vídeo');
    expect(rotuloDaModalidadeNoCartao('Por telefone')).toBe('Por telefone');
    expect(modalidadeDoCartao('Sala 2 do anexo')).toBeNull();
    expect(rotuloDaModalidadeNoCartao(' Sala 2 do anexo ')).toBe('Sala 2 do anexo');
  });

  it('o aviso depois de trocar para vídeo leva o link novo', () => {
    const m = mensagemDaConsulta({
      nomeFiliado: 'Iraci Pereira', responsavel: SHERAD, inicio: QUI_17_09H,
      local: LOCAL_DA_MODALIDADE.VIDEO, linkReuniao: 'https://meet.google.com/abc-defg-hij',
    });
    expect(m).toContain('ficou marcada para qui, 17/09, às 09:00');
    expect(m).toContain('Para entrar na hora marcada: https://meet.google.com/abc-defg-hij');
  });
});
