import { tenant } from '@/tenant.config';
import {
  assuntoDoEmail,
  desafioPrevisto,
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
  it('nenhum emoji ou pictograma em nenhum dos três textos', () => {
    for (const desafio of ['CPF_NASCIMENTO', 'COREN', 'NENHUM'] as const) {
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

describe('desafioPrevisto — espelho da decisão da geração', () => {
  it('CPF e nascimento, os dois: CPF_NASCIMENTO', () => {
    expect(desafioPrevisto({ cpf: '12345678900', dataNascimento: '1980-01-01' }, true)).toBe('CPF_NASCIMENTO');
  });

  it('só um dos dois não basta: cai no COREN, se houver e o campo for usado', () => {
    expect(desafioPrevisto({ cpf: '12345678900', dataNascimento: null, numeroCoren: 'COREN-PI 1-ENF' }, true)).toBe('COREN');
  });

  it('COREN preenchido numa instalação que não usa o campo não conta', () => {
    expect(desafioPrevisto({ cpf: null, dataNascimento: '1980-01-01', numeroCoren: 'COREN-PI 1-ENF' }, false)).toBe('NENHUM');
  });

  it('texto em branco é o mesmo que vazio', () => {
    expect(desafioPrevisto({ cpf: '   ', dataNascimento: '1980-01-01', numeroCoren: '  ' }, true)).toBe('NENHUM');
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
