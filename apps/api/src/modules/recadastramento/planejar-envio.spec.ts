import {
  JANELA_SEM_REPETIR_REGISTRO_MS, LinkCandidato, VIDA_MINIMA_PARA_REAPROVEITAR_MS,
  deveRegistrarPreparo, emailUtilizavel, fraseDoPreparo, planejarEnvio, primeiroNome, validadeCurta,
} from './planejar-envio';

const AGORA = new Date('2026-09-13T15:00:00.000Z'); // 12h00 em Teresina
const H = 3_600_000;
/** O "HMAC" de mentira: o hash derivado de um id é `derivado:<id>`. */
const derivado = (id: string) => `derivado:${id}`;

function link(p: Partial<LinkCandidato> & { id: string }): LinkCandidato {
  return {
    tokenHash: derivado(p.id),
    desafio: 'CPF_NASCIMENTO',
    expiraEm: new Date(AGORA.getTime() + 20 * H),
    usadoEm: null,
    revogadoEm: null,
    createdAt: new Date(AGORA.getTime() - 4 * H),
    ...p,
  };
}

describe('planejarEnvio', () => {
  const plano = (links: LinkCandidato[], desafioAtual: LinkCandidato['desafio'] = 'CPF_NASCIMENTO') =>
    planejarEnvio({ links, agora: AGORA, hashDoTokenDerivado: derivado, desafioAtual });

  /**
   * O DESAFIO GRAVADO NO LINK É O DA GERAÇÃO (achado de 13/09/2026). Link NENHUM
   * de um cadastro que a equipe completou depois seguiria abrindo sem confirmação.
   */
  it('o cadastro passou a pedir outro desafio: gera, com o motivo', () => {
    expect(plano([link({ id: 'n', desafio: 'NENHUM' })], 'CPF_NASCIMENTO')).toEqual({
      acao: 'GERAR', motivo: 'DESAFIO_MUDOU',
    });
    // E ao contrário: o nascimento foi apagado, o link CPF_NASCIMENTO nunca conferiria.
    expect(plano([link({ id: 'c' })], 'NENHUM')).toEqual({ acao: 'GERAR', motivo: 'DESAFIO_MUDOU' });
    expect(plano([link({ id: 'k', desafio: 'COREN' })], 'COREN').acao).toBe('REAPROVEITAR');
  });

  it('link de antes da derivação continua dizendo LINK_ANTIGO, mesmo com o desafio mudado', () => {
    expect(plano([link({ id: 'v', tokenHash: 'aleatorio', desafio: 'NENHUM' })])).toEqual({
      acao: 'GERAR', motivo: 'LINK_ANTIGO',
    });
  });

  it('sem link nenhum: gera', () => {
    expect(plano([])).toEqual({ acao: 'GERAR', motivo: 'SEM_LINK_ATIVO' });
  });

  it('link vivo, derivado e com vida: reaproveita ESSE link', () => {
    const vivo = link({ id: 'a' });
    expect(plano([vivo])).toEqual({ acao: 'REAPROVEITAR', link: vivo });
  });

  it('usado, revogado ou vencido não contam como vivos', () => {
    expect(plano([
      link({ id: 'u', usadoEm: new Date(AGORA.getTime() - H) }),
      link({ id: 'r', revogadoEm: new Date(AGORA.getTime() - H) }),
      link({ id: 'v', expiraEm: new Date(AGORA.getTime() - 1) }),
    ])).toEqual({ acao: 'GERAR', motivo: 'SEM_LINK_ATIVO' });
  });

  it('vencendo exatamente agora já não é vivo', () => {
    expect(plano([link({ id: 'x', expiraEm: AGORA })]).acao).toBe('GERAR');
  });

  it('link de antes da derivação (token aleatório): gera um novo', () => {
    expect(plano([link({ id: 'velho', tokenHash: 'sha-de-token-aleatorio' })])).toEqual({
      acao: 'GERAR', motivo: 'LINK_ANTIGO',
    });
  });

  it('com menos de 2 horas de vida: gera — não se manda link que morre no caminho', () => {
    const quase = link({ id: 'q', expiraEm: new Date(AGORA.getTime() + VIDA_MINIMA_PARA_REAPROVEITAR_MS - 60_000) });
    expect(plano([quase])).toEqual({ acao: 'GERAR', motivo: 'PERTO_DE_VENCER' });
    const justo = link({ id: 'j', expiraEm: new Date(AGORA.getTime() + VIDA_MINIMA_PARA_REAPROVEITAR_MS) });
    expect(plano([justo]).acao).toBe('REAPROVEITAR');
  });

  it('dois vivos (não deveria haver): olha o mais recente', () => {
    const antigo = link({ id: 'antigo', createdAt: new Date(AGORA.getTime() - 10 * H) });
    const recente = link({ id: 'recente', createdAt: new Date(AGORA.getTime() - H) });
    expect(plano([antigo, recente])).toEqual({ acao: 'REAPROVEITAR', link: recente });
  });
});

describe('deveRegistrarPreparo — três toques não são três atos', () => {
  it('sem registro anterior: registra', () => {
    expect(deveRegistrarPreparo(null, AGORA)).toBe(true);
    expect(deveRegistrarPreparo(undefined, AGORA)).toBe(true);
  });
  it('dentro de 10 minutos: não registra de novo', () => {
    expect(deveRegistrarPreparo(new Date(AGORA.getTime() - 3 * 60_000), AGORA)).toBe(false);
    expect(deveRegistrarPreparo(new Date(AGORA.getTime() - JANELA_SEM_REPETIR_REGISTRO_MS + 1), AGORA)).toBe(false);
  });
  it('com 10 minutos ou mais: registra', () => {
    expect(deveRegistrarPreparo(new Date(AGORA.getTime() - JANELA_SEM_REPETIR_REGISTRO_MS), AGORA)).toBe(true);
  });
});

describe('contato e texto', () => {
  it.each([
    ['maria@exemplo.org', 'maria@exemplo.org'],
    ['  maria@exemplo.org ', 'maria@exemplo.org'],
    ['maria@exemplo', null],
    ['maria exemplo.org', null],
    ['', null],
    [null, null],
  ])('emailUtilizavel(%p) → %p', (entrada, esperado) => {
    expect(emailUtilizavel(entrada)).toBe(esperado);
  });

  it('primeiro nome, com espaço sobrando', () => {
    expect(primeiroNome('  MARIA   DA SILVA ')).toBe('MARIA');
  });

  /** O processo do teste roda em UTC (jest.setup); a data tem de sair em Teresina. */
  it('validade no fuso de Teresina, mesmo com o processo em UTC', () => {
    expect(validadeCurta(new Date('2026-09-13T18:20:00.000Z'))).toBe('13/09 às 15h20');
    // 01h30 UTC do dia 14 ainda é dia 13 em Teresina.
    expect(validadeCurta(new Date('2026-09-14T01:30:00.000Z'))).toBe('13/09 às 22h30');
  });

  it('a frase diz PREPARADO, o meio e se o link foi reaproveitado', () => {
    const f = fraseDoPreparo({
      nome: 'MARIA DA SILVA', meio: 'WHATSAPP', reaproveitado: true,
      expiraEm: new Date('2026-09-13T18:20:00.000Z'),
    });
    expect(f).toBe(
      'Link de recadastramento de MARIA DA SILVA preparado para envio por WhatsApp ' +
      '(o mesmo link que já estava ativo; vale até 13/09 às 15h20)',
    );
    expect(f).not.toMatch(/enviado/i);
    expect(fraseDoPreparo({
      nome: 'JOSÉ', meio: 'COPIAR', reaproveitado: false, expiraEm: new Date('2026-09-14T15:00:00.000Z'),
    })).toBe('Link de recadastramento de JOSÉ preparado para envio copiando a mensagem (link novo; vale até 14/09 às 12h00)');
  });
});
