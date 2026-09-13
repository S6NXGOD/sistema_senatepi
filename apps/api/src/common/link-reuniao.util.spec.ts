import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import {
  ERRO_LINK,
  LIMITE_LINK_REUNIAO,
  PROVEDOR_DESCONHECIDO,
  linkReuniaoParaGravar,
  normalizarLinkReuniao,
  provedorDoLink,
} from './link-reuniao.util';

/**
 * A TABELA DE CASOS DO LINK DA CHAMADA — a mesma do espelho do web
 * (`apps/web/src/lib/link-reuniao.spec.ts`).
 *
 * O formulário valida pelo espelho e o servidor grava por esta função. Se um
 * lado aceitar o que o outro recusa, a pessoa vê "link válido" e toma 400 ao
 * salvar — ou o contrário. O último teste deste arquivo compara o TEXTO das
 * duas tabelas: mudou a regra de um lado, copie a tabela para o outro.
 */
type Esperado = null | { url: string; provedor: string } | { erro: string };

const CASOS_LINK_REUNIAO: [string, string | null | undefined, Esperado][] = [
  ['vazio', '', null],
  ['só espaço', '   ', null],
  ['nulo', null, null],
  ['indefinido', undefined, null],
  ['Meet completo', 'https://meet.google.com/abc-defg-hij', { url: 'https://meet.google.com/abc-defg-hij', provedor: 'Google Meet' }],
  ['Meet sem protocolo', 'meet.google.com/abc-defg-hij', { url: 'https://meet.google.com/abc-defg-hij', provedor: 'Google Meet' }],
  ['convite do Meet colado', 'Participe: meet.google.com/abc-defg-hij', { url: 'https://meet.google.com/abc-defg-hij', provedor: 'Google Meet' }],
  ['host em maiúsculas', 'MEET.GOOGLE.COM/abc-defg-hij', { url: 'https://meet.google.com/abc-defg-hij', provedor: 'Google Meet' }],
  ['só o host ganha a barra', 'https://meet.google.com', { url: 'https://meet.google.com/', provedor: 'Google Meet' }],
  ['entre parênteses e com ponto final', '(https://meet.google.com/abc-defg-hij).', { url: 'https://meet.google.com/abc-defg-hij', provedor: 'Google Meet' }],
  ['Zoom com subdomínio e senha na query', 'https://us02web.zoom.us/j/123456789?pwd=abc', { url: 'https://us02web.zoom.us/j/123456789?pwd=abc', provedor: 'Zoom' }],
  ['Zoom sem subdomínio', 'https://zoom.us/j/123', { url: 'https://zoom.us/j/123', provedor: 'Zoom' }],
  ['Teams', 'https://teams.microsoft.com/l/meetup-join/xyz', { url: 'https://teams.microsoft.com/l/meetup-join/xyz', provedor: 'Teams' }],
  ['Teams pessoal', 'https://teams.live.com/meet/123', { url: 'https://teams.live.com/meet/123', provedor: 'Teams' }],
  ['convite do Teams com telefone antes', 'Ligue tel:+5586999999999 ou entre https://teams.microsoft.com/l/meetup-join/xyz', { url: 'https://teams.microsoft.com/l/meetup-join/xyz', provedor: 'Teams' }],
  ['Jitsi público', 'https://meet.jit.si/SalaDoSindicato', { url: 'https://meet.jit.si/SalaDoSindicato', provedor: 'Jitsi' }],
  ['Jitsi próprio do sindicato', 'https://jitsi.sindicato.org.br/sala', { url: 'https://jitsi.sindicato.org.br/sala', provedor: PROVEDOR_DESCONHECIDO }],
  ['parecido com Zoom, mas não é', 'https://zoom.us.golpe.com/j/1', { url: 'https://zoom.us.golpe.com/j/1', provedor: PROVEDOR_DESCONHECIDO }],
  ['http', 'http://meet.google.com/abc-defg-hij', { erro: ERRO_LINK.http }],
  ['http antes de https: a primeira decide', 'http://a.com.br https://meet.google.com/x', { erro: ERRO_LINK.http }],
  ['javascript', 'javascript:alert(1)', { erro: ERRO_LINK.naoEChamada }],
  ['data', 'data:text/html,<b>oi</b>', { erro: ERRO_LINK.naoEChamada }],
  ['ftp', 'ftp://arquivos.exemplo.com/x', { erro: ERRO_LINK.naoEChamada }],
  ['texto sem link', 'a consulta vai ser por vídeo', { erro: ERRO_LINK.naoAchei }],
  ['usuário e senha no endereço', 'https://usuario:senha@meet.google.com/abc', { erro: ERRO_LINK.comSenha }],
  ['host sem ponto', 'https://localhost/sala', { erro: ERRO_LINK.invalido }],
  ['longo demais', `https://meet.google.com/${'x'.repeat(LIMITE_LINK_REUNIAO)}`, { erro: ERRO_LINK.longo }],
];

describe('normalizarLinkReuniao — a tabela compartilhada com o web', () => {
  it.each(CASOS_LINK_REUNIAO)('%s', (_rotulo, entrada, esperado) => {
    const r = normalizarLinkReuniao(entrada);
    if (esperado === null) {
      expect(r).toBeNull();
    } else if ('erro' in esperado) {
      expect(r).toEqual({ ok: false, erro: esperado.erro });
    } else {
      expect(r).toEqual({ ok: true, url: esperado.url, provedor: esperado.provedor });
    }
  });

  it('o limite é 500', () => {
    expect(LIMITE_LINK_REUNIAO).toBe(500);
  });

  it('tudo que passa é https', () => {
    for (const [, entrada] of CASOS_LINK_REUNIAO) {
      const r = normalizarLinkReuniao(entrada);
      if (r?.ok) expect(r.url.startsWith('https://')).toBe(true);
    }
  });

  it('texto que não é URL vira o rótulo genérico, sem erro', () => {
    expect(provedorDoLink('não é endereço')).toBe(PROVEDOR_DESCONHECIDO);
  });
});

/**
 * O QUE O SERVIÇO GRAVA. Três respostas diferentes, e confundir duas delas
 * apagaria o link de quem só editou o título: `undefined` é "não mexa",
 * vazio/nulo é "limpe", texto é o link limpo — ou 400 com a frase da regra.
 */
describe('linkReuniaoParaGravar', () => {
  it('campo ausente não mexe', () => {
    expect(linkReuniaoParaGravar(undefined)).toBeUndefined();
  });

  it('vazio e nulo limpam', () => {
    expect(linkReuniaoParaGravar('')).toBeNull();
    expect(linkReuniaoParaGravar('  ')).toBeNull();
    expect(linkReuniaoParaGravar(null)).toBeNull();
  });

  it('o convite colado vira o link', () => {
    expect(linkReuniaoParaGravar('Participe: meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
  });

  it('o que a regra recusa volta 400 com a frase que ensina', () => {
    expect(() => linkReuniaoParaGravar('http://meet.google.com/abc')).toThrow(BadRequestException);
    expect(() => linkReuniaoParaGravar('http://meet.google.com/abc')).toThrow(ERRO_LINK.http);
    expect(() => linkReuniaoParaGravar('javascript:alert(1)')).toThrow(ERRO_LINK.naoEChamada);
  });
});

describe('as duas tabelas são a mesma', () => {
  const tabela = (texto: string) => {
    const t = texto.replace(/\r\n/g, '\n');
    const i = t.indexOf('const CASOS_LINK_REUNIAO');
    expect(i).toBeGreaterThan(-1);
    return t.slice(i, t.indexOf('\n];', i) + 3);
  };

  it('a tabela deste spec é, letra por letra, a do espelho do web', () => {
    const daApi = tabela(readFileSync(__filename, 'utf8'));
    const doWeb = tabela(
      readFileSync(join(__dirname, '../../../web/src/lib/link-reuniao.spec.ts'), 'utf8'),
    );
    expect(daApi.split('\n').length).toBeGreaterThan(20);
    expect(daApi).toBe(doWeb);
  });
});
