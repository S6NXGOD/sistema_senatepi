import { readFileSync } from 'fs';
import { join } from 'path';
import { tenant } from '@/tenant.config';
import {
  agruparEquipe, assuntoMudou, comQuem, confirmacaoDoEncaminhamento, consultasDoAtendimento, corpoDoAssunto,
  dataJaPassou, deQuem, diaBR, diaDoPlantao, erroDoAssunto, faltaConcluir, filtroDaUrl, fraseDoEncaminhamento,
  horaBR, linkWhatsApp, mensagemDaConsulta, mensagemSaudacao, modalidadeDoLocal, modalidadeRemota,
  rotuloDoAssunto, rotuloDoDia, rotuloDoEncaminhamento, urlTemFiltro, ESTADO_ENCAMINHAMENTO,
  type Encaminhamento,
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
