import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  MOSTRAR_NA_CAIXA, estadoOu, quantasMostrar, rodapeDaCaixa, seloDaProposta,
  type EstadoDaProposta,
} from './djen';

/**
 * "EXISTE UMA MANEIRA MELHOR PARA ESSAS PUBLICAÇÕES ESPERANDO DECISÃO? ELAS
 * SOMEM DEPOIS QUE PERDEM O PRAZO?" — a pergunta do dono, 18/09/2026.
 *
 * Não somem, e continuam não sumindo: o corte de tela é o único corte que
 * existe, e ele cede para tudo que pede uma pessoa. O que mudou é que a
 * proposta parada parou de ser desenhada igual à que chegou hoje.
 *
 * A régua do estado é do servidor (`situacaoDaProposta`), porque é a mesma com
 * que o robô desiste de esperar. Aqui se testa o que a TELA faz com ela.
 */

const item = (estado: EstadoDaProposta) => ({ estado });

describe('o selo que a linha ganha ao envelhecer', () => {
  /**
   * NOVIDADE NÃO É PENDÊNCIA — a mesma regra da reserva do robô.
   *
   * Selo em item de hoje é o jeito mais rápido de a equipe aprender a ignorar
   * selo. A proposta nova não pede nada: ou o robô ainda vai agir, ou a pessoa
   * ainda tem folga para olhar.
   */
  it('a que chegou agora não pede nada', () => {
    expect(seloDaProposta({ estado: 'NOVA', diasNaCaixa: 0, diasDoAto: 0 })).toEqual({
      rotulo: null, recado: null, pedeVoce: false,
    });
  });

  it('a parada diz há quanto tempo e que nada muda sozinho', () => {
    const selo = seloDaProposta({ estado: 'PARADA', diasNaCaixa: 9, diasDoAto: 9 });
    expect(selo.rotulo).toBe('parada há 9d');
    expect(selo.recado).toBe('Ninguém decidiu ainda — e nada muda sozinho.');
    expect(selo.pedeVoce).toBe(true);
  });

  /**
   * O ATO FORA DA JANELA tem um recado DIFERENTE, e não é capricho: aceitar
   * aqui abre uma atividade que já nasce atrasada — que foi o defeito das 48
   * tarefas cegas. Quem decide precisa saber disso ANTES de clicar.
   */
  it('o ato velho avisa que a tarefa já nasceria atrasada', () => {
    const selo = seloDaProposta({ estado: 'FORA_DA_JANELA', diasNaCaixa: 2, diasDoAto: 47 });
    expect(selo.rotulo).toBe('ato antigo');
    expect(selo.recado).toBe('O ato tem 47 dias: tarefa aberta agora já nasce atrasada.');
    expect(selo.pedeVoce).toBe(true);
  });

  /** Dois estados que pedem coisas diferentes nunca dividem o mesmo selo. */
  it('parada e ato antigo não dizem a mesma coisa', () => {
    const parada = seloDaProposta({ estado: 'PARADA', diasNaCaixa: 5, diasDoAto: 5 });
    const antigo = seloDaProposta({ estado: 'FORA_DA_JANELA', diasNaCaixa: 5, diasDoAto: 40 });
    expect(parada.rotulo).not.toBe(antigo.rotulo);
    expect(parada.recado).not.toBe(antigo.recado);
  });
});

describe('o corte da tela', () => {
  it('mostra quatro quando ninguém está parado', () => {
    expect(quantasMostrar([...Array(9)].map(() => item('NOVA')))).toBe(MOSTRAR_NA_CAIXA);
  });

  /**
   * O CORTE NUNCA ESCONDE O QUE PEDE ATENÇÃO.
   *
   * Com quatro vagas fixas e a fila ordenada pelo que está parado, a quinta
   * parada ficava atrás de um "ver as outras" que ninguém abre — e o que se
   * esconde aqui é prazo.
   */
  it('abre vagas até caber tudo que pede alguém', () => {
    const fila = [
      ...[...Array(6)].map(() => item('PARADA')),
      ...[...Array(3)].map(() => item('NOVA')),
    ];
    const visiveis = quantasMostrar(fila);
    expect(visiveis).toBe(6);
    expect(fila.slice(visiveis).every((i) => i.estado === 'NOVA')).toBe(true);
  });

  it('o ato fora da janela também segura a vaga', () => {
    const fila = [
      ...[...Array(5)].map(() => item('FORA_DA_JANELA')),
      ...[...Array(20)].map(() => item('NOVA')),
    ];
    expect(quantasMostrar(fila)).toBe(5);
  });

  /** Uma caixa de paradas não vira uma segunda agenda: o corte continua. */
  it('sem nada parado, a caixa não cresce', () => {
    expect(quantasMostrar([item('NOVA'), item('NOVA')])).toBe(MOSTRAR_NA_CAIXA);
  });
});

describe('o rodapé', () => {
  it('não existe quando nada ficou escondido', () => {
    expect(rodapeDaCaixa([])).toBeNull();
  });

  /**
   * "VER AS OUTRAS 7" NÃO DIZ SE VALE ABRIR, e a pessoa aprende a não abrir.
   * Como o corte cede para o que pede alguém, o rodapé pode AFIRMAR que nada
   * parado ficou atrás dele — é essa afirmação que torna o corte confiável.
   */
  it('afirma que nada parado ficou escondido', () => {
    expect(rodapeDaCaixa([item('NOVA'), item('NOVA'), item('NOVA')])).toBe(
      'Ver as outras 3, nenhuma parada',
    );
  });

  /** Se um parado escapar, o rodapé conta em vez de mentir. */
  it('conta o parado que escapou, em vez de prometer o que não é', () => {
    expect(rodapeDaCaixa([item('NOVA'), item('PARADA')])).toBe('Ver as outras 2 — 1 parada');
    expect(rodapeDaCaixa([item('PARADA'), item('FORA_DA_JANELA')])).toBe(
      'Ver as outras 2 — 2 paradas',
    );
  });
});

/**
 * O QUE A TELA DEIXOU DE FAZER SOZINHA.
 *
 * Negativas sobre o CÓDIGO, com os comentários fora: um comentário que explique
 * o defeito antigo não pode reprovar o arquivo que o corrigiu.
 */
describe('o cartão não reimplementa regra nenhuma', () => {
  const FONTE = readFileSync(
    path.resolve(__dirname, '../components/dashboard/caixa-de-propostas.tsx'),
    'utf8',
  )
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

  /**
   * O ADVERSÁRIO ERA CALCULADO AQUI, com `partes.find(polo === 'PASSIVO')` — a
   * regra errada: quando a ação é contra o sindicato, o passivo somos nós, e o
   * cartão imprimia o nome do próprio sindicato como parte contrária.
   */
  it('lê o adversário pronto, e não as partes', () => {
    expect(FONTE).toContain('p.adversario');
    expect(FONTE).not.toContain('polo');
    expect(FONTE).not.toContain('partes');
  });

  /** A idade vem do servidor: duas contas do mesmo dia seriam duas verdades. */
  it('não recalcula os dias do ato', () => {
    expect(FONTE).toContain('p.diasDoAto');
    expect(FONTE).not.toContain('diasDesdeDataPura');
  });

  it('usa o corte e o rodapé da regra, não um número solto', () => {
    expect(FONTE).toContain('quantasMostrar(itens)');
    expect(FONTE).toContain('rodapeDaCaixa(itens.slice(visiveis))');
    expect(FONTE).toContain('seloDaProposta(p)');
  });

  /**
   * "O RESTO ESTÁ A UM TOQUE" — o comentário antigo prometia isso e não havia
   * um único link no item.
   */
  it('o item leva a algum lugar', () => {
    expect(FONTE).toContain('href={`/processos?processo=${p.processo.id}`}');
    expect(FONTE).toContain('href={p.link}');
  });

  /** O avatar era importado e não usado — e "sem dono" é o que a gestão vem ver. */
  it('mostra de quem é a proposta para quem coordena', () => {
    expect(FONTE).toContain('<AvatarPessoa');
    expect(FONTE).toContain('sem dono');
  });

  /** Vermelho é só do Excluir. O que pede atenção aqui é âmbar. */
  it('não pinta de vermelho o que só está esperando', () => {
    expect(FONTE).not.toContain('red-');
  });
});

/**
 * A JANELA DE TROCA DO DEPLOY — web e API sobem em serviços separados.
 *
 * `estado`, `diasNaCaixa` e `diasDoAto` nasceram nesta rodada. Nos minutos em
 * que o web novo fala com a API velha eles não vêm, e com o campo obrigatório a
 * tela escrevia "parada há undefined d". Sem eles, toda proposta é NOVA — o
 * comportamento de antes de eles existirem.
 */
describe('a caixa aguenta a API que ainda não envelheceu nada', () => {
  it('sem estado, o item é tratado como NOVA', () => {
    expect(estadoOu(undefined)).toBe('NOVA');
    expect(estadoOu('PARADA')).toBe('PARADA');
  });

  it('o corte volta ao padrão em vez de "tudo pede alguém"', () => {
    const semEstado = [{}, {}, {}, {}, {}, {}, {}];
    expect(quantasMostrar(semEstado)).toBe(quantasMostrar([]));
  });

  it('o selo não escreve "undefined" em lugar nenhum', () => {
    const selo = seloDaProposta({});
    expect(selo.rotulo).toBeNull();
    expect(JSON.stringify(seloDaProposta({ estado: 'PARADA' }))).not.toContain('undefined');
    expect(JSON.stringify(seloDaProposta({ estado: 'FORA_DA_JANELA' }))).not.toContain('undefined');
  });

  /*
    ASSERÇÃO POSITIVA, e não `not.toContain('parada')`: a resposta CERTA é
    "nenhuma parada", que contém a palavra. Negativa em português bate no texto
    correto — é o modo de errar que esta casa já catalogou.
  */
  it('e o rodapé afirma que nenhuma está parada', () => {
    expect(rodapeDaCaixa([{}, {}])).toBe('Ver as outras 2, nenhuma parada');
  });
});
