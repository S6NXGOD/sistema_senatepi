import {
  agruparDescartes, avisoDaConsolidacao, fraseDoDescarte, resumoDoCadastro, rotuloDoConsolidar,
  separarDecidiveis,
  type GrupoDuplicata, type ParDescartado,
} from './duplicidade';

/**
 * "NUM GRUPO DE CINCO, E SE UM DELES EU NÃO CONCORDO QUE É DUPLICATA?" —
 * 17/09/2026. Tirar um grava quatro pares; a lista não pode virar quatro linhas
 * repetindo os mesmos nomes.
 */
describe('a lista do que saiu da fila junta o que foi decidido de uma vez', () => {
  const cadastro = (id: string, matricula: string) => ({
    id, matricula, nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', cidade: 'Teresina', cpf: null, dataNascimento: null,
  });
  const par = (id: string, a: string, b: string, quando = '2026-09-17T13:00:00.000Z'): ParDescartado => ({
    id, autor: 'Ana Bianca', decididoEm: quando, cadastros: [cadastro('f-' + a, a), cadastro('f-' + b, b)],
  });

  it('os quatro pares de quem saiu do grupo viram UMA linha, com todos os cadastros', () => {
    const itens = agruparDescartes([
      par('d1', '5678', '008005'), par('d2', '5678', '4045'), par('d3', '5678', '4829'), par('d4', '5678', '1234'),
    ]);
    expect(itens).toHaveLength(1);
    expect(itens[0].ids).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(itens[0].cadastros.map((c) => c.matricula).sort()).toEqual(['008005', '1234', '4045', '4829', '5678']);
  });

  it('decisões sem cadastro em comum continuam separadas', () => {
    const itens = agruparDescartes([par('d1', '5678', '008005'), par('d2', '9999', '7777')]);
    expect(itens).toHaveLength(2);
  });

  it('fica a data da decisão mais recente do conjunto', () => {
    const itens = agruparDescartes([
      par('d1', '5678', '008005', '2026-09-02T12:06:00.000Z'),
      par('d2', '5678', '4045', '2026-09-17T13:40:00.000Z'),
    ]);
    expect(itens[0].decididoEm).toBe('2026-09-17T13:40:00.000Z');
    expect(fraseDoDescarte(itens[0])).toBe('Marcado por Ana Bianca em 17/09/2026');
  });
});

/**
 * "E QUANDO É 3 OU 4 DUPLICADOS? NEM O BOTÃO É MOSTRADO." — 17/09/2026.
 * O botão passou a aparecer, e precisa dizer quantos vai remover.
 */
describe('consolidar um grupo de três ou mais', () => {
  it('o botão diz quantos entram quando não é um par', () => {
    expect(rotuloDoConsolidar(2, '6223')).toBe('Consolidar mantendo 6223');
    expect(rotuloDoConsolidar(3, '008005')).toBe('Consolidar 3 mantendo 008005');
    expect(rotuloDoConsolidar(7, '008005')).toBe('Consolidar 7 mantendo 008005');
  });

  it('o aviso conta quantos foram e o que aproveitou', () => {
    expect(avisoDaConsolidacao({ fundidos: 2, camposAbsorvidos: ['telefone', 'e-mail'] })).toEqual({
      tom: 'ok', texto: '2 cadastros consolidados. Aproveitados: telefone, e-mail.',
    });
    expect(avisoDaConsolidacao({ camposAbsorvidos: [] }).texto).toBe('Cadastros consolidados.');
  });

  /**
   * O AVISO FALAVA EM NOME DE COLUNA (18/09/2026). Vinha do servidor como
   * `dataFiliacao`, `telefonePrincipal` — e depois que a filiação passou a ser
   * preservada, `dataFiliacao` virou o campo mais frequente da mensagem.
   */
  it('traduz o nome do campo em vez de mostrar a coluna do banco', () => {
    const r = avisoDaConsolidacao({ camposAbsorvidos: ['dataFiliacao', 'telefonePrincipal', 'numeroCoren'] });
    expect(r.texto).toBe('Cadastros consolidados. Aproveitados: data de filiação, telefone, COREN.');
  });

  it('campo desconhecido não vira buraco na frase', () => {
    expect(avisoDaConsolidacao({ camposAbsorvidos: ['campoNovo'] }).texto).toContain('campoNovo');
  });

  /** Meia consolidação não pode virar "pronto": a pessoa tem de saber qual ficou. */
  it('quando um cadastro fica de fora, o aviso nomeia a matrícula e o motivo', () => {
    const r = avisoDaConsolidacao({ ok: false, fundidos: 2, falhas: [{ matricula: '7777', motivo: 'Filiado a descartar não encontrado.' }] });
    expect(r.tom).toBe('aviso');
    expect(r.texto).toContain('7777');
    expect(r.texto).toContain('Filiado a descartar não encontrado.');
  });
});
import { moduloDaRota } from '@/components/nav-items';

/**
 * A ROTA DA FILA É DA PERMISSÃO PRÓPRIA (15/09/2026): quem o Administrador
 * liberou entra mesmo sem "Filiados", e quem edita filiados não entra só por isso.
 */
describe('a rota da fila de duplicados', () => {
  it('pertence a "Cadastros duplicados", e o resto de /filiados continua de Filiados', () => {
    expect(moduloDaRota('/filiados/duplicados')).toBe('duplicados');
    expect(moduloDaRota('/filiados')).toBe('filiados');
    expect(moduloDaRota('/filiados/abc-123')).toBe('filiados');
  });
});

/**
 * Os pares marcados como "pessoas diferentes" ganharam uma lista e uma volta
 * (15/09/2026). Estas frases são o que o Administrador lê para decidir se foi
 * engano — como MARIA DA CRUZ DE SOUSA, 3520 × 3746, marcada pela Coordenação.
 */
describe('pares marcados como pessoas diferentes', () => {
  it('diz quem marcou e o dia', () => {
    expect(fraseDoDescarte({ autor: 'Julian Helton', decididoEm: '2026-09-02T12:06:00.000Z' }))
      .toBe('Marcado por Julian Helton em 02/09/2026');
  });

  it('o dia é o de Teresina: 22h30 do dia 2 já é dia 3 em UTC', () => {
    expect(fraseDoDescarte({ autor: null, decididoEm: '2026-09-03T01:30:00.000Z' })).toBe('Marcado em 02/09/2026');
  });

  it('o resumo mostra o que ajuda a decidir e não inventa o que falta', () => {
    expect(resumoDoCadastro({ cidade: 'Teresina', cpf: '11122233344', dataNascimento: '1970-11-10T03:00:00.000Z' }))
      .toBe('Teresina · com CPF · nasc. 10/11/1970');
    expect(resumoDoCadastro({ cidade: '  ', cpf: null, dataNascimento: null })).toBe('sem CPF');
  });
});

/**
 * O QUE NINGUÉM TEM COMO DECIDIR SAI DA FILA (18/09/2026).
 *
 * Na produção, 255 dos 389 grupos não têm um dado sequer em nenhum cadastro.
 * Continuar pedindo decisão neles é pedir sorteio 255 vezes.
 */
describe('a fila separa o decidível do impossível', () => {
  const grupo = (chave: string, esperandoDado?: boolean): GrupoDuplicata => ({
    chave, confianca: 'ALTA', criterio: 'nome idêntico', motivoSugestao: null,
    decidiu: true, contradicoes: [], esperandoDado, candidatos: [],
  });

  it('quem espera dado sai da fila e vai para o balde do rodapé', () => {
    const { decidiveis, esperando } = separarDecidiveis([
      grupo('a', false), grupo('b', true), grupo('c', true),
    ]);
    expect(decidiveis.map((g) => g.chave)).toEqual(['a']);
    expect(esperando.map((g) => g.chave)).toEqual(['b', 'c']);
  });

  it('API antiga não manda o campo: TUDO continua na fila, como antes', () => {
    /*
      A JANELA DE TROCA DO DEPLOY. O web novo conversa com a API velha por
      alguns minutos; sem o campo, o certo é não inventar um balde vazio e
      sumir com a fila inteira da tela.
    */
    const { decidiveis, esperando } = separarDecidiveis([grupo('a'), grupo('b')]);
    expect(decidiveis).toHaveLength(2);
    expect(esperando).toHaveLength(0);
  });
});
