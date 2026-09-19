import { avisosNaTela, telaDoCaminho, type AvisoDaFaixa } from './pendencias';
import { saudacao } from './dashboard';

/**
 * A FAIXA NO PAINEL SÓ DIZ O QUE O PAINEL NÃO DIZ — 18/09/2026.
 *
 * "A barra amarela continua ali, muito feia e pra mim não chama atenção e nem
 * vai fazer o advogado realizar nenhuma ação." Ele estava olhando o PAINEL, e
 * ali ela era redundante: o aviso dizia «Elaborar manifestação» ficou para trás
 * e, dois dedos abaixo, a mesma atividade aparecia na fila com selo ATRASADA e
 * um botão que resolve.
 *
 * Um aviso que repete o que está logo abaixo, sem poder fazer nada a respeito,
 * ensina a não ler a faixa. E aí ela perde as telas em que é a única voz.
 */
const aviso = (tipo: AvisoDaFaixa['tipo']): AvisoDaFaixa => ({
  chave: tipo,
  tipo,
  texto: `aviso de ${tipo}`,
  complemento: undefined,
  href: '/x',
});

const OS_QUATRO = [
  aviso('ATRASADA'),
  aviso('PRECISA_DA_EQUIPE'),
  aviso('PUBLICACAO_SEM_TAREFA'),
  aviso('ATO_ESPERANDO_OLHO'),
];

describe('na tela que não responde nada, a faixa é a única voz', () => {
  it.each(['/processos', '/filiados', '/relatorios', '/'])('nada é suprimido em %s', (caminho) => {
    expect(avisosNaTela(OS_QUATRO, { caminho, veProcessos: true })).toHaveLength(4);
  });

  /** A rota com parâmetro e a rota filha são a mesma tela. */
  it('o que conta é o primeiro segmento', () => {
    expect(telaDoCaminho('/agenda?compromisso=42')).toBe('/agenda');
    expect(telaDoCaminho('/processos/abc/ficha')).toBe('/processos');
    expect(telaDoCaminho('/')).toBe('/');
  });
});

describe('na agenda, some o que a agenda já filtra', () => {
  /**
   * TRÊS SUPERFÍCIES PARA A MESMA COISA, medidas na tela a 1440px: a faixa no
   * topo, a aba "Ficaram para trás 5" e um aviso âmbar dentro da lista com
   * "Ver só essas". O terceiro filtra; a faixa só repetia.
   */
  it('a atrasada sai; o resto continua, porque a agenda não fala disso', () => {
    const tipos = avisosNaTela(OS_QUATRO, { caminho: '/agenda', veProcessos: true })
      .map((a) => a.tipo);
    expect(tipos).toEqual(['PRECISA_DA_EQUIPE', 'PUBLICACAO_SEM_TAREFA', 'ATO_ESPERANDO_OLHO']);
  });

  it('vale para a agenda aberta num item', () => {
    const tipos = avisosNaTela(OS_QUATRO, { caminho: '/agenda?compromisso=7', veProcessos: true })
      .map((a) => a.tipo);
    expect(tipos).not.toContain('ATRASADA');
  });
});

describe('nas publicações, some o que o filtro já recorta', () => {
  it('a publicação sem tarefa sai — o filtro "Sem tarefa na agenda" é dali', () => {
    const tipos = avisosNaTela(OS_QUATRO, { caminho: '/publicacoes', veProcessos: true })
      .map((a) => a.tipo);
    expect(tipos).toEqual(['ATRASADA', 'PRECISA_DA_EQUIPE', 'ATO_ESPERANDO_OLHO']);
  });
});

describe('no painel, some o que o painel já mostra', () => {
  const noPainel = (veProcessos: boolean) =>
    avisosNaTela(OS_QUATRO, { caminho: '/dashboard', veProcessos }).map((a) => a.tipo);

  it('a atrasada e a da equipe somem: a fila e o bloco da equipe já as mostram', () => {
    expect(noPainel(true)).not.toContain('ATRASADA');
    expect(noPainel(true)).not.toContain('PRECISA_DA_EQUIPE');
  });

  /**
   * O ATO DO TRIBUNAL FICA. Ele só existe na ficha do processo — suprimir os
   * quatro seria esconder o único que não tem outro lugar, e foi a objeção que
   * derrubou a primeira versão desta ideia.
   */
  it('o ato do tribunal continua, porque o painel não o mostra em lugar nenhum', () => {
    expect(noPainel(true)).toEqual(['ATO_ESPERANDO_OLHO']);
  });

  /**
   * A PUBLICAÇÃO DEPENDE DA PERMISSÃO: o bloco "Suas publicações" só existe
   * para quem vê processos. Sem esse módulo, o painel não a mostra — e aí ela
   * tem de continuar na faixa.
   */
  it('a publicação só some para quem vê processos', () => {
    expect(noPainel(true)).not.toContain('PUBLICACAO_SEM_TAREFA');
    expect(noPainel(false)).toContain('PUBLICACAO_SEM_TAREFA');
  });

  it('sem aviso nenhum, continua sem aviso nenhum', () => {
    expect(avisosNaTela([], { caminho: '/dashboard', veProcessos: true })).toEqual([]);
  });
});

/**
 * "BOA NOITE 'DR. O QUÊ?'" — o dono, ao abrir o painel de um advogado.
 *
 * A saudação pegava a PRIMEIRA PALAVRA do nome de exibição. Os nove advogados
 * da casa estão cadastrados com tratamento na frente, então a tela cumprimentava
 * o título: "Boa noite, Dr.".
 */
describe('a saudação cumprimenta a pessoa, não o tratamento', () => {
  const so = (s: string) => s.replace(/^(Bom dia|Boa tarde|Boa noite), ?/, '');

  it.each([
    ['Dr. Carlos Henrique de Alencar', 'Carlos'],
    ['Dra. Morgana Nualla', 'Morgana'],
    ['Sra. Ana Bianca', 'Ana'],
    ['Profa. Lara Cortez', 'Lara'],
    ['João Pedro Pinto do Ó', 'João'],
  ])('%s → %s', (nome, esperado) => {
    expect(so(saudacao(nome))).toBe(esperado);
  });

  /** Só o tratamento é melhor que nada: cumprimentar o vazio é defeito. */
  it('quem está cadastrado só como "Dra." ainda é cumprimentado', () => {
    expect(so(saudacao('Dra.'))).toBe('Dra.');
  });

  it('nome vazio não vira "Boa noite, "', () => {
    expect(saudacao('')).toMatch(/^(Bom dia|Boa tarde|Boa noite)$/);
    expect(saudacao('   ')).not.toContain(',');
  });

});
