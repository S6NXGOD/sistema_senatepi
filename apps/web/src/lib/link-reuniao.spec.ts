import {
  ERRO_LINK,
  LIMITE_LINK_REUNIAO,
  PROVEDOR_DESCONHECIDO,
  abrirChamada,
  normalizarLinkReuniao,
  provedorDoLink,
} from './link-reuniao';

/**
 * A TABELA DE CASOS DO LINK DA CHAMADA.
 *
 * É a MESMA que o spec da API (`apps/api/src/common/link-reuniao.util.spec.ts`)
 * deve usar: o formulário valida por este espelho e o servidor grava pelo
 * dele. Se um lado aceitar o que o outro recusa, a pessoa vê "link válido" e
 * toma 400 ao salvar — ou o contrário. Mudou a regra de um lado, copie a
 * tabela para o outro.
 *
 * Cada linha: [o que a pessoa colou, o resultado esperado].
 *   `null`                 → campo vazio
 *   `{ url, provedor }`    → aceito, gravado assim
 *   `{ erro }`             → recusado com essa frase
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

describe('normalizarLinkReuniao — a tabela compartilhada com a API', () => {
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

  /** O limite é de 500 caracteres — o mesmo `MaxLength` do DTO. */
  it('o limite é 500', () => {
    expect(LIMITE_LINK_REUNIAO).toBe(500);
  });

  /** Nenhum resultado aceito sai com outro esquema que não https. */
  it('tudo que passa é https', () => {
    for (const [, entrada] of CASOS_LINK_REUNIAO) {
      const r = normalizarLinkReuniao(entrada);
      if (r?.ok) expect(r.url.startsWith('https://')).toBe(true);
    }
  });
});

describe('provedorDoLink', () => {
  it('texto que não é URL vira o rótulo genérico, sem erro', () => {
    expect(provedorDoLink('não é endereço')).toBe(PROVEDOR_DESCONHECIDO);
  });
});

describe('abrirChamada', () => {
  /** Link gravado fora da regra (http, javascript) não vira clique. */
  it('não abre o que a regra recusa', () => {
    expect(abrirChamada('javascript:alert(1)')).toBe(false);
    expect(abrirChamada('http://meet.google.com/abc')).toBe(false);
    expect(abrirChamada(null)).toBe(false);
  });
});
