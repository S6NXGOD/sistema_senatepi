import { cpfValido, erroDoCpf } from './cpf';
import { avisoDoEnvio } from './envio-recadastro';
import { faltaNoDesafio, pedidoDoDesafio } from './recadastro';

/**
 * O FILIADO SE IDENTIFICA SOZINHO — 22/09/2026.
 *
 * "Como faço para deixar de depender isso do atendimento. Quero jogar essa
 * responsabilidade ao filiado também. Com validador."
 *
 * Do lado do web mudam três coisas, e cada uma tem um jeito próprio de
 * envelhecer mal:
 *
 *  1. o VALIDADOR do CPF passou a existir aqui (não existia: toda checagem era
 *     na API, o que servia enquanto quem digitava era a equipe);
 *  2. a primeira tela pública diz "informe", nunca "confirme" — não há nada
 *     guardado com o que conferir, e fingir que há engana os dois lados;
 *  3. a caixa da tela de envio deixou de BLOQUEAR e passou a EXPLICAR.
 */

const CPF_OK = '52998224725';
const CPF_ERRADO = '52998224724'; // um dígito trocado

describe('o validador de CPF', () => {
  it('aceita o CPF com dígito verificador certo, com ou sem máscara', () => {
    expect(cpfValido(CPF_OK)).toBe(true);
    expect(cpfValido('529.982.247-25')).toBe(true);
  });

  it('recusa um dígito trocado', () => {
    expect(cpfValido(CPF_ERRADO)).toBe(false);
  });

  /** Fecham a conta dos dígitos e não existem: é o buraco clássico da fórmula. */
  it('recusa os onze repetidos', () => {
    for (const d of '0123456789') expect(cpfValido(d.repeat(11))).toBe(false);
  });

  it('recusa tamanho errado, vazio e nulo', () => {
    expect(cpfValido('5299822472')).toBe(false);
    expect(cpfValido('529982247250')).toBe(false);
    expect(cpfValido('')).toBe(false);
    expect(cpfValido(null)).toBe(false);
    expect(cpfValido(undefined)).toBe(false);
  });

  /**
   * A MESMA CONTA DA API. Não é regra deste sistema — é a norma da Receita, de
   * 1965, e ela não muda. Duplicar aqui evita a ida ao servidor; a DECISÃO de
   * aceitar o CPF continua sendo de lá, que também confere unicidade.
   */
  it('bate com o exemplo que a API usa nos próprios testes', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
  });
});

describe('o aviso enquanto se digita', () => {
  /**
   * CAMPO QUE FICA VERMELHO NO PRIMEIRO CARACTERE ENSINA A IGNORAR O VERMELHO.
   * Enquanto não há 11 dígitos não há erro: há alguém digitando.
   */
  it('cala enquanto o número não está completo', () => {
    expect(erroDoCpf('')).toBeNull();
    expect(erroDoCpf('529')).toBeNull();
    expect(erroDoCpf('529.982.247-2')).toBeNull();
  });

  it('fala no 11º dígito, e só se estiver errado', () => {
    expect(erroDoCpf(CPF_ERRADO)).toMatch(/não parece certo/i);
    expect(erroDoCpf(CPF_OK)).toBeNull();
  });
});

describe('o que a primeira tela pública pede', () => {
  /**
   * "INFORME", NUNCA "CONFIRME". As outras frases dizem "confirme seus dados",
   * e ali é verdade: o sistema compara com o que guardou. Aqui não há o que
   * comparar — é a primeira vez que o sindicato registra esses dados.
   */
  it('em IDENTIFICACAO a frase pede, não manda confirmar', () => {
    const pedido = pedidoDoDesafio('IDENTIFICACAO');
    expect(pedido.tipo).toBe('FORMULARIO');
    if (pedido.tipo !== 'FORMULARIO') return;
    expect(pedido.campos).toEqual(['CPF', 'NASCIMENTO']);
    expect(pedido.frase).toMatch(/ainda não tem o seu CPF/i);
    expect(pedido.frase).not.toMatch(/confirme/i);
  });

  it('nos outros desafios a frase continua sendo de conferência', () => {
    const p = pedidoDoDesafio('CPF_NASCIMENTO');
    expect(p.tipo === 'FORMULARIO' && p.frase).toMatch(/confirme/i);
  });

  /** Valor que o web não conhece nunca cai no formulário — falha fechada. */
  it('valor desconhecido continua sendo tela desatualizada', () => {
    expect(pedidoDoDesafio('ALGO_NOVO').tipo).toBe('DESATUALIZADA');
  });
});

describe('o dígito verificador barra antes da ida ao servidor', () => {
  const valores = (cpf: string) => ({ cpf, nascimento: '1985-03-12', coren: '' });

  it('CPF errado não sai do celular', () => {
    const pedido = pedidoDoDesafio('IDENTIFICACAO');
    expect(faltaNoDesafio(pedido, valores(CPF_ERRADO))).toMatch(/não parece certo/i);
  });

  it('CPF certo passa', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('IDENTIFICACAO'), valores(CPF_OK))).toBeNull();
  });

  /**
   * VALE PARA OS OUTROS DESAFIOS TAMBÉM, e de graça: `definirDesafio` só
   * escolhe CPF ou CPF_NASCIMENTO quando o CPF gravado passa no `cpfUtil`.
   * Logo um CPF que não fecha o dígito NUNCA bateria com o guardado — ir à API
   * só gastaria uma das 5 tentativas para ouvir "dados não conferem", que é a
   * mensagem errada: o problema é a digitação, não a identidade.
   */
  it('também protege as 5 tentativas do desafio de conferência', () => {
    expect(faltaNoDesafio(pedidoDoDesafio('CPF'), valores(CPF_ERRADO))).toMatch(/não parece certo/i);
  });

  it('as mensagens de campo vazio e de tamanho continuam vindo antes', () => {
    const p = pedidoDoDesafio('IDENTIFICACAO');
    expect(faltaNoDesafio(p, valores(''))).toMatch(/Preencha o CPF/);
    expect(faltaNoDesafio(p, valores('529'))).toMatch(/11 números/);
    expect(faltaNoDesafio(p, { cpf: CPF_OK, nascimento: '', coren: '' })).toMatch(/nascimento/i);
  });
});

describe('a caixa da tela de envio', () => {
  /**
   * ANTES ELA BLOQUEAVA. O print do dono: "O link abriria sem confirmar quem é
   * — Este cadastro não tem CPF nem data de nascimento, nem COREN. Pergunte os
   * dois ao filiado, grave na ficha e volte aqui." Os botões sumiam, e o
   * trabalho todo voltava para a Triagem.
   */
  it('ficha em branco: explica, e os botões ficam', () => {
    const aviso = avisoDoEnvio({ desafio: 'IDENTIFICACAO', podeGerar: true }, true);
    expect(aviso.tipo).toBe('PEDE_AO_FILIADO');
    if (aviso.tipo !== 'PEDE_AO_FILIADO') return;
    expect(aviso.titulo).toMatch(/vai informar os dados/i);
    expect(aviso.texto).toMatch(/dígito por dígito/i);
    expect(aviso.texto).toMatch(/mande só para ele/i);
  });

  /**
   * O DESFILIADO CONTINUA BARRADO, e é a checagem que eu mais poderia ter
   * quebrado: o desafio dele virou IDENTIFICACAO, mas o caminho é reativar.
   * `podeGerar` manda sobre o desafio.
   */
  it('desfiliado com ficha em branco: continua bloqueado, e por reativação', () => {
    const aviso = avisoDoEnvio(
      { desafio: 'IDENTIFICACAO', podeGerar: false, motivo: 'DESFILIADO' },
      true,
    );
    expect(aviso.tipo).toBe('SEM_CONFIRMACAO');
    if (aviso.tipo !== 'SEM_CONFIRMACAO') return;
    expect(aviso.titulo).toMatch(/desfiliado/i);
    expect(aviso.porta).toBeNull();
  });

  /** Dado gravado que não presta continua sendo caso da equipe, na edição. */
  it('CPF gravado errado: continua bloqueado, e manda para a edição', () => {
    const aviso = avisoDoEnvio(
      { desafio: 'NENHUM', podeGerar: false, motivo: 'SEM_CONFIRMACAO', cpfGravadoInvalido: true },
      true,
    );
    expect(aviso.tipo).toBe('SEM_CONFIRMACAO');
    if (aviso.tipo !== 'SEM_CONFIRMACAO') return;
    expect(aviso.porta).toBe('EDITAR');
  });

  it('os desafios de um fator continuam com o aviso de sempre', () => {
    expect(avisoDoEnvio({ desafio: 'CPF', podeGerar: true }, true).tipo).toBe('UM_FATOR');
    expect(avisoDoEnvio({ desafio: 'CPF_NASCIMENTO', podeGerar: true }, true).tipo).toBe('NADA');
  });
});
