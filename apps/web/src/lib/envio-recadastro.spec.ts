import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';
import {
  assuntoDoEmail,
  avisoDoEnvio,
  emailUtilizavel,
  estadoDoLink,
  linkEmail,
  mensagemDoLink,
  nomeParaSaudacao,
  validadeCurta,
} from './envio-recadastro';

/**
 * A MENSAGEM DO LINK DE RECADASTRAMENTO.
 *
 * A sigla vem de `tenant.sigla`: a CI roda os dois clientes, e um teste com o
 * nome de um deles cravado reprovaria o outro (já aconteceu).
 *
 * Os instantes estão em UTC (`...Z`) e o esperado está no horário de Teresina:
 * o teste passa igual numa máquina em UTC, em Teresina ou em Lisboa. É isso que
 * prova que a data não depende do relógio de quem roda.
 */

const URL = 'https://sistema.exemplo.org.br/recadastro/abc_DEF-123';
/** 18h20 em UTC = 15h20 em Teresina. */
const EXPIRA = '2026-09-13T18:20:00.000Z';

describe('validadeCurta', () => {
  it('escreve no fuso de Teresina, não no da máquina', () => {
    expect(validadeCurta(EXPIRA)).toBe('13/09 às 15h20');
  });

  it('a virada do dia é a de Teresina: 02h10 UTC ainda é o dia anterior', () => {
    expect(validadeCurta('2026-09-14T02:10:00.000Z')).toBe('13/09 às 23h10');
  });

  it('meia-noite sai como 00h, nunca 24h', () => {
    expect(validadeCurta('2026-09-14T03:00:00.000Z')).toBe('14/09 às 00h00');
  });

  it('data inválida não vira "Invalid Date" no texto', () => {
    expect(validadeCurta('não é data')).toBe('');
  });
});

describe('nomeParaSaudacao', () => {
  it.each([
    ['MARIA', 'Maria'],
    ['maria', 'Maria'],
    ['  JOÃO  ', 'João'],
    ['ÉRICA DE SOUSA', 'Érica'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%p → %p', (entrada, esperado) => {
    expect(nomeParaSaudacao(entrada)).toBe(esperado);
  });
});

describe('mensagemDoLink', () => {
  it('com CPF e nascimento: diz o que vai ser pedido', () => {
    expect(
      mensagemDoLink({ primeiroNome: 'MARIA', url: URL, expiraEm: EXPIRA, desafio: 'CPF_NASCIMENTO' }),
    ).toBe(
      [
        `Olá, Maria. Aqui é do ${tenant.sigla}.`,
        'Para atualizar o seu cadastro no sindicato, abra este link:',
        URL,
        'Ele vale até 13/09 às 15h20 e só pode ser usado uma vez.',
        'Para confirmar que é você, vamos pedir o seu CPF e a sua data de nascimento.',
        'Não pedimos senha nem pagamento por este link.',
      ].join('\n'),
    );
  });

  it('com COREN: pede o número do COREN', () => {
    const m = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio: 'COREN' });
    expect(m).toContain('vamos pedir o número do seu COREN.');
    expect(m).not.toContain('não encaminhe');
  });

  /** Sem confirmação possível, quem tiver o link entra direto no cadastro. */
  it('sem confirmação (NENHUM): a linha do CPF vira o pedido de não encaminhar', () => {
    const m = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio: 'NENHUM' });
    expect(m.split('\n')).toContain('Este link é pessoal: não encaminhe.');
    expect(m).not.toContain('CPF');
    expect(m).not.toContain('COREN');
  });

  /** 14/09/2026: link de um dado só diz o que vai pedir E pede para não encaminhar. */
  it('só o CPF: diz o que vai pedir e pede para não encaminhar, nessa ordem', () => {
    const linhas = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio: 'CPF' }).split('\n');
    expect(linhas.slice(4)).toEqual([
      'Para confirmar que é você, vamos pedir o seu CPF.',
      'Este link é pessoal: não encaminhe.',
      'Não pedimos senha nem pagamento por este link.',
    ]);
  });

  it('só a data de nascimento: idem', () => {
    const linhas = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio: 'NASCIMENTO' }).split('\n');
    expect(linhas.slice(4)).toEqual([
      'Para confirmar que é você, vamos pedir a sua data de nascimento.',
      'Este link é pessoal: não encaminhe.',
      'Não pedimos senha nem pagamento por este link.',
    ]);
  });

  it('dois fatores e COREN não pedem para não encaminhar', () => {
    for (const desafio of ['CPF_NASCIMENTO', 'COREN'] as const) {
      expect(mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio })).not.toContain('não encaminhe');
    }
  });

  it('o link fica numa linha só dele (sinal colado quebra o endereço)', () => {
    const linhas = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio: 'NENHUM' }).split('\n');
    expect(linhas).toContain(URL);
  });

  it('sem nome no cadastro, a saudação não fica com vírgula pendurada', () => {
    const m = mensagemDoLink({ primeiroNome: '', url: URL, expiraEm: EXPIRA, desafio: 'CPF_NASCIMENTO' });
    expect(m.startsWith(`Olá. Aqui é do ${tenant.sigla}.`)).toBe(true);
  });

  it('a sigla é a da instalação', () => {
    const m = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio: 'COREN' });
    expect(m).toContain(`Aqui é do ${tenant.sigla}.`);
  });

  /** Mensagem de segurança com emoji parece golpe. */
  it('nenhum emoji ou pictograma em nenhum dos textos', () => {
    for (const desafio of ['CPF_NASCIMENTO', 'CPF', 'COREN', 'NASCIMENTO', 'NENHUM'] as const) {
      const m = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio });
      expect(m).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('nunca promete que foi "enviado" nem pede senha', () => {
    const m = mensagemDoLink({ primeiroNome: 'Ana', url: URL, expiraEm: EXPIRA, desafio: 'CPF_NASCIMENTO' });
    expect(m).toContain('Não pedimos senha nem pagamento');
    expect(m).not.toMatch(/digite sua senha|informe sua senha/i);
  });
});

describe('linkEmail', () => {
  it('codifica assunto e corpo com %20 (nunca "+") e quebra de linha', () => {
    expect(linkEmail(' ana@exemplo.com ', 'Assunto & teste', 'Linha 1\nLinha 2')).toBe(
      'mailto:ana%40exemplo.com?subject=Assunto%20%26%20teste&body=Linha%201%0ALinha%202',
    );
  });

  it('o assunto leva a sigla da instalação', () => {
    expect(assuntoDoEmail()).toBe(`Atualização do seu cadastro no ${tenant.sigla}`);
  });
});

describe('emailUtilizavel — a mesma régua da rota de envio', () => {
  it.each([
    ['ana@exemplo.com', 'ana@exemplo.com'],
    ['  ana@exemplo.com.br  ', 'ana@exemplo.com.br'],
    ['ana@exemplo', null],
    ['ana exemplo.com', null],
    ['@exemplo.com', null],
    ['ana@@exemplo.com', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%p → %p', (entrada, esperado) => {
    expect(emailUtilizavel(entrada)).toBe(esperado);
  });
});

/**
 * O AVISO DA TELA DE ENVIO, a partir da prévia da API.
 *
 * `desafioPrevisto` saiu em 14/09/2026: era uma segunda cópia da regra da API,
 * e com a hierarquia nova (CPF válido, data plausível) ela erraria antes do
 * primeiro toque. Aqui só se testa a TRADUÇÃO da resposta.
 */
describe('avisoDoEnvio — traduz a prévia, não recalcula', () => {
  it('CPF + nascimento: nada a avisar', () => {
    expect(avisoDoEnvio({ desafio: 'CPF_NASCIMENTO', podeGerar: true }, true)).toEqual({ tipo: 'NADA' });
  });

  it('COREN: nada a avisar', () => {
    expect(avisoDoEnvio({ desafio: 'COREN', podeGerar: true }, true)).toEqual({ tipo: 'NADA' });
  });

  it('só o CPF: aviso de um dado só', () => {
    expect(avisoDoEnvio({ desafio: 'CPF', podeGerar: true }, false)).toEqual({
      tipo: 'UM_FATOR',
      texto: `Este link vai pedir só o CPF para confirmar que é o ${V.filiado}. Mande só para ele.`,
    });
  });

  it('só a data de nascimento: aviso de um dado só', () => {
    expect(avisoDoEnvio({ desafio: 'NASCIMENTO', podeGerar: true }, true)).toEqual({
      tipo: 'UM_FATOR',
      texto: `Este link vai pedir só a data de nascimento para confirmar que é o ${V.filiado}. Mande só para ele.`,
    });
  });

  it('a API não gera: caixa com título e o que fazer; COREN só onde o campo existe', () => {
    expect(avisoDoEnvio({ desafio: 'NENHUM', podeGerar: false }, true)).toEqual({
      tipo: 'SEM_CONFIRMACAO',
      titulo: 'O link abriria sem confirmar quem é',
      texto:
        `Este cadastro não tem CPF nem data de nascimento, nem COREN. Pergunte os dois ao ${V.filiado}, ` +
        'grave na ficha e volte aqui: o link passa a pedir essa confirmação.',
      completarFicha: true,
    });
    const semCoren = avisoDoEnvio({ desafio: 'NENHUM', podeGerar: false }, false);
    expect(semCoren.tipo).toBe('SEM_CONFIRMACAO');
    expect(semCoren.tipo === 'SEM_CONFIRMACAO' && semCoren.texto).toBe(
      `Este cadastro não tem CPF nem data de nascimento. Pergunte os dois ao ${V.filiado}, ` +
        'grave na ficha e volte aqui: o link passa a pedir essa confirmação.',
    );
  });

  /**
   * O PORQUÊ DO "NÃO GERA" (revisão de 14/09/2026). O desfiliado com CPF e data
   * gravados ouvia "não tem CPF nem data de nascimento" e o botão "Completar a
   * ficha"; o que falta é reativar.
   */
  it('desfiliado: manda reativar, sem "Completar a ficha"', () => {
    expect(avisoDoEnvio({ desafio: 'CPF_NASCIMENTO', podeGerar: false, motivo: 'DESFILIADO', cpfGravadoInvalido: false }, true)).toEqual({
      tipo: 'SEM_CONFIRMACAO',
      titulo: 'Este cadastro está desfiliado',
      texto: 'Reative o cadastro antes de pedir o recadastramento.',
      completarFicha: false,
    });
  });

  it('desfiliado vence o CPF que não confere: reativar vem antes', () => {
    const aviso = avisoDoEnvio({ desafio: 'NENHUM', podeGerar: false, motivo: 'DESFILIADO', cpfGravadoInvalido: true }, true);
    expect(aviso.tipo === 'SEM_CONFIRMACAO' && aviso.texto).toBe('Reative o cadastro antes de pedir o recadastramento.');
  });

  /** A ficha mostra o CPF; a caixa não pode dizer que ele não existe. */
  it('CPF gravado que não confere: pede para corrigir o CPF na ficha', () => {
    expect(avisoDoEnvio({ desafio: 'NENHUM', podeGerar: false, motivo: 'SEM_CONFIRMACAO', cpfGravadoInvalido: true }, true)).toEqual({
      tipo: 'SEM_CONFIRMACAO',
      titulo: 'O link abriria sem confirmar quem é',
      texto: 'O CPF gravado na ficha não confere. Corrija o CPF na ficha e volte aqui: o link passa a pedir essa confirmação.',
      completarFicha: true,
    });
  });

  it('NENHUM real, da API nova ou da antiga: o texto de sempre', () => {
    const esperado = avisoDoEnvio({ desafio: 'NENHUM', podeGerar: false }, false);
    expect(avisoDoEnvio({ desafio: 'NENHUM', podeGerar: false, motivo: 'SEM_CONFIRMACAO', cpfGravadoInvalido: false }, false)).toEqual(esperado);
    expect(avisoDoEnvio({ desafio: 'NENHUM', podeGerar: false, motivo: null }, false)).toEqual(esperado);
    expect(esperado.tipo === 'SEM_CONFIRMACAO' && esperado.texto).toMatch(/^Este cadastro não tem CPF nem data de nascimento\./);
  });

  it('motivo e CPF que não confere não tiram o botão de quem a API gera', () => {
    expect(avisoDoEnvio({ desafio: 'NASCIMENTO', podeGerar: true, motivo: null, cpfGravadoInvalido: true }, true).tipo).toBe('UM_FATOR');
  });

  /** A API manda: se diz que não gera, a tela não oferece os botões. */
  it('podeGerar falso vence o desafio, até um valor desconhecido', () => {
    expect(avisoDoEnvio({ desafio: 'MATRICULA', podeGerar: false }, true).tipo).toBe('SEM_CONFIRMACAO');
    expect(avisoDoEnvio({ desafio: 'CPF', podeGerar: false }, true).tipo).toBe('SEM_CONFIRMACAO');
  });

  it('valor desconhecido que a API gera: nada a avisar', () => {
    expect(avisoDoEnvio({ desafio: 'MATRICULA', podeGerar: true }, true)).toEqual({ tipo: 'NADA' });
  });

  it('nenhum texto do aviso tem cor de erro na palavra: nunca "erro" ou "inválido"', () => {
    for (const previa of [
      { desafio: 'CPF', podeGerar: true },
      { desafio: 'NASCIMENTO', podeGerar: true },
      { desafio: 'NENHUM', podeGerar: false },
      { desafio: 'CPF_NASCIMENTO', podeGerar: false, motivo: 'DESFILIADO' as const },
      { desafio: 'NENHUM', podeGerar: false, cpfGravadoInvalido: true },
    ]) {
      expect(JSON.stringify(avisoDoEnvio(previa, true))).not.toMatch(/erro|inválid/i);
    }
  });
});

describe('estadoDoLink — diz o que o sistema sabe, nunca "enviado"', () => {
  it('reaproveitado', () => {
    expect(estadoDoLink({ expiraEm: EXPIRA, reaproveitado: true, haviaLinkAtivo: true })).toBe(
      'Link ativo até 13/09 às 15h20. É o mesmo que já estava valendo.',
    );
  });

  it('novo, trocando um que estava ativo', () => {
    expect(estadoDoLink({ expiraEm: EXPIRA, reaproveitado: false, haviaLinkAtivo: true })).toBe(
      'Link ativo até 13/09 às 15h20. É um link novo: o anterior deixou de abrir.',
    );
  });

  it('novo, sem nenhum antes', () => {
    expect(estadoDoLink({ expiraEm: EXPIRA, reaproveitado: false, haviaLinkAtivo: false })).toBe(
      'Link ativo até 13/09 às 15h20. É um link novo.',
    );
  });

  it('nenhuma das frases diz "enviado"', () => {
    for (const reaproveitado of [true, false]) {
      for (const haviaLinkAtivo of [true, false]) {
        expect(estadoDoLink({ expiraEm: EXPIRA, reaproveitado, haviaLinkAtivo })).not.toMatch(/enviad/i);
      }
    }
  });
});
