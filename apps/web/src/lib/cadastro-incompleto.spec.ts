import {
  fraseDoCadastroIncompleto,
  gravidadeDoCadastro,
  listarEmPortugues,
  oQueFaltaNoCadastro,
  podeMandarLink,
} from './cadastro-incompleto';

/**
 * A TRIAGEM PRECISA SER COBRADA NA HORA — 21/09/2026.
 *
 * "Se o atendimento/triagem for atender um filiado e ver que o cadastro dele tá
 * muito incompleto, mandar um aviso (...) Temos que ser mais incisivos com isso
 * para que a triagem sempre seja induzida a pedir o filiado para se
 * recadastrar."
 *
 * Medido na produção no mesmo dia: 62% dos filiados ativos não têm CPF. O
 * balcão é o único momento barato de pedir.
 */
describe('o que falta no cadastro', () => {
  const completo = {
    cpf: '123.456.789-00',
    telefone: '86 99999-0000',
    telefoneSecundario: null,
    dataNascimento: '1980-05-02',
    email: 'pessoa@exemplo.com',
  };

  it('cadastro completo não gera aviso nenhum', () => {
    expect(oQueFaltaNoCadastro(completo)).toEqual([]);
    expect(gravidadeDoCadastro([])).toBe('OK');
  });

  it('a ordem é a de quem mais atrapalha: CPF, telefone, nascimento, e-mail', () => {
    expect(
      oQueFaltaNoCadastro({
        cpf: null,
        telefone: null,
        telefoneSecundario: null,
        dataNascimento: null,
        email: null,
      }),
    ).toEqual(['CPF', 'telefone', 'data de nascimento', 'e-mail']);
  });

  /**
   * O TELEFONE SÓ FALTA QUANDO OS DOIS ESTÃO VAZIOS. A importação gravou o
   * celular da planilha no campo secundário, e 383 ativos só têm número ali —
   * acusar falta de telefone a quem tem é o jeito de a triagem parar de ler.
   */
  it('o número no campo secundário conta como telefone', () => {
    expect(
      oQueFaltaNoCadastro({ ...completo, telefone: null, telefoneSecundario: '86 98888-1111' }),
    ).toEqual([]);
  });

  it('espaço em branco não é dado', () => {
    expect(oQueFaltaNoCadastro({ ...completo, cpf: '   ' })).toEqual(['CPF']);
  });

  /**
   * CAMPO QUE NÃO VEIO NÃO É CAMPO QUE FALTA. A gaveta do atendimento monta o
   * filiado a partir do dossiê, que não traz a data de nascimento: sem esta
   * regra, TODO atendimento acusaria falta dela.
   */
  it('o campo ausente do payload não vira acusação', () => {
    expect(oQueFaltaNoCadastro({ cpf: '123', telefone: '86 9', email: 'a@b.c' })).toEqual([]);
  });

  it('nulo explícito conta, ausência não', () => {
    expect(oQueFaltaNoCadastro({ cpf: null })).toEqual(['CPF']);
    expect(oQueFaltaNoCadastro({})).toEqual([]);
  });

  it('sem filiado nenhum, nada a dizer', () => {
    expect(oQueFaltaNoCadastro(null)).toEqual([]);
    expect(oQueFaltaNoCadastro(undefined)).toEqual([]);
  });
});

describe('quão furado está', () => {
  /** Sem CPF não se acha a pessoa nos autos; sem telefone não se avisa nada. */
  it('CPF ou telefone faltando é crítico', () => {
    expect(gravidadeDoCadastro(['CPF'])).toBe('CRITICO');
    expect(gravidadeDoCadastro(['telefone'])).toBe('CRITICO');
    expect(gravidadeDoCadastro(['CPF', 'e-mail'])).toBe('CRITICO');
  });

  it('só e-mail ou só nascimento pede, mas não grita', () => {
    expect(gravidadeDoCadastro(['e-mail'])).toBe('INCOMPLETO');
    expect(gravidadeDoCadastro(['data de nascimento', 'e-mail'])).toBe('INCOMPLETO');
  });
});

describe('a frase do aviso', () => {
  it('diz o que falta, com nome', () => {
    expect(fraseDoCadastroIncompleto(['CPF'])).toContain('Falta CPF no cadastro');
  });

  it('a crítica explica a consequência; a leve, não', () => {
    expect(fraseDoCadastroIncompleto(['CPF'])).toContain('achar a pessoa nos autos');
    expect(fraseDoCadastroIncompleto(['e-mail'])).not.toContain('achar a pessoa nos autos');
  });

  it('sem nada faltando, frase vazia — e quem chama não escreve nada', () => {
    expect(fraseDoCadastroIncompleto([])).toBe('');
  });

  it('a lista sai em português, com vírgula e "e"', () => {
    expect(listarEmPortugues(['CPF'])).toBe('CPF');
    expect(listarEmPortugues(['CPF', 'telefone'])).toBe('CPF e telefone');
    expect(listarEmPortugues(['CPF', 'telefone', 'e-mail'])).toBe('CPF, telefone e e-mail');
  });
});

/**
 * O LINK É ENVIADO — por WhatsApp ou e-mail. Sem nenhum dos dois não há para
 * onde mandar, e oferecer o botão seria oferecer um caminho que não existe.
 */
describe('dá para mandar o link?', () => {
  it('com celular, dá', () => {
    expect(podeMandarLink({ telefone: '86 99999-0000' })).toBe(true);
  });

  it('só com e-mail, também', () => {
    expect(podeMandarLink({ telefone: null, email: 'a@b.c' })).toBe(true);
  });

  it('sem telefone e sem e-mail, não — sobra o presencial', () => {
    expect(podeMandarLink({ telefone: null, telefoneSecundario: null, email: null })).toBe(false);
  });
});

/**
 * OS DOIS NOMES DO TELEFONE — o bug que o dono viu na tela (21/09/2026).
 *
 * Print: uma filiada COM telefone cadastrado, o aviso dizendo "Falta CPF, data
 * de nascimento e e-mail", o botão "Mandar link de recadastro" ESCONDIDO e o
 * rodapé afirmando "sem telefone e sem e-mail não há para onde mandar o link".
 *
 * A causa: no banco a coluna é `telefone_principal` e a API devolve
 * `telefonePrincipal`; esta régua só conhecia `telefone`. E como
 * `'telefone' in f` era falso, ela nem acusava a falta — o defeito ficava mudo
 * dos dois lados, e só a tela mostrou.
 */
describe('o telefone vem com dois nomes', () => {
  it('`telefonePrincipal` conta como telefone', () => {
    expect(oQueFaltaNoCadastro({ telefonePrincipal: '86 99846-1100' })).toEqual([]);
    expect(podeMandarLink({ telefonePrincipal: '86 99846-1100' })).toBe(true);
  });

  it('o caso do print: falta CPF, nascimento e e-mail — e o link PODE ser mandado', () => {
    const erica = {
      cpf: null,
      telefonePrincipal: '86 99846-1100',
      telefoneSecundario: null,
      dataNascimento: null,
      email: null,
    };
    expect(oQueFaltaNoCadastro(erica)).toEqual(['CPF', 'data de nascimento', 'e-mail']);
    expect(oQueFaltaNoCadastro(erica)).not.toContain('telefone');
    expect(podeMandarLink(erica)).toBe(true);
  });

  it('`telefonePrincipal` vazio e sem secundário: aí falta mesmo', () => {
    expect(
      oQueFaltaNoCadastro({ telefonePrincipal: '', telefoneSecundario: null }),
    ).toContain('telefone');
    expect(podeMandarLink({ telefonePrincipal: '', telefoneSecundario: null })).toBe(false);
  });

  it('o nome antigo continua valendo — os dois convivem', () => {
    expect(podeMandarLink({ telefone: '86 99999-0000' })).toBe(true);
  });
});
