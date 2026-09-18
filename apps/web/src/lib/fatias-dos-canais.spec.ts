import { fatiasDosCanais } from './dashboard';

/**
 * "NO ATENDIMENTOS POR CANAL APARECE UM: 5, 5 O QUÊ?" — o dono, 18/09/2026.
 *
 * Ele estava lendo o markup certo. A legenda era bolinha + nome + número cru, e
 * a única palavra que dava unidade estava no título do cartão, longe. Aqui cada
 * fatia passa a carregar a frase inteira, e mais duas coisas que estavam
 * erradas por baixo: a cor seguia a POSIÇÃO no array filtrado (contra o
 * contrato da paleta) e o cartão não levava a lugar nenhum.
 */
const ROTULO = {
  PRESENCIAL: 'Presencial',
  WHATSAPP: 'WhatsApp',
  TELEFONE: 'Telefone',
  EMAIL: 'E-mail',
  SITE: 'Site',
};
const ORDEM = ['PRESENCIAL', 'WHATSAPP', 'TELEFONE', 'EMAIL', 'SITE'];
const PALETA = ['#c1', '#c2', '#c3', '#c4', '#c5'];

const fatias = (bruto: { canal: string; total: number }[]) =>
  fatiasDosCanais(bruto, ROTULO, ORDEM, PALETA);

describe('a fatia diz o que é o número', () => {
  it('a descrição tem nome, quantidade, a palavra atendimentos e a participação', () => {
    const [maior] = fatias([
      { canal: 'SITE', total: 3 },
      { canal: 'WHATSAPP', total: 9 },
      { canal: 'PRESENCIAL', total: 5 },
    ]);
    expect(maior.descricao).toBe('WhatsApp: 9 atendimentos (53%)');
  });

  it('um atendimento é "atendimento", não "atendimentos"', () => {
    expect(fatias([{ canal: 'SITE', total: 1 }])[0].descricao).toBe('Site: 1 atendimento (100%)');
  });
});

describe('a cor acompanha o canal, não a posição', () => {
  /**
   * O CONTRATO DA PALETA diz: "filtrar um canal não pode repintar os que
   * sobraram, senão a leitura de ontem não vale para a de hoje". O código usava
   * o índice do array JÁ FILTRADO — um dia sem presencial repintava o WhatsApp.
   */
  it('o WhatsApp tem a mesma cor com e sem presencial na lista', () => {
    const com = fatias([
      { canal: 'PRESENCIAL', total: 5 },
      { canal: 'WHATSAPP', total: 9 },
    ]);
    const sem = fatias([{ canal: 'WHATSAPP', total: 9 }]);
    const cor = (l: { canal: string; cor: string }[]) => l.find((d) => d.canal === 'WHATSAPP')!.cor;
    expect(cor(com)).toBe(cor(sem));
    expect(cor(com)).toBe('#c2');
  });

  it('canal que o web ainda não conhece não rouba a cor de ninguém e sai com o nome cru', () => {
    const [novo] = fatias([{ canal: 'INSTAGRAM', total: 2 }]);
    expect(novo.nome).toBe('INSTAGRAM');
    expect(novo.cor).toBe('#c5');
  });
});

describe('o que a fatia faz', () => {
  it('leva para a lista daquele canal', () => {
    expect(fatias([{ canal: 'WHATSAPP', total: 9 }])[0].href).toBe('/atendimentos?canal=WHATSAPP');
  });

  it('canal zerado não vira fatia nem linha na legenda', () => {
    const r = fatias([{ canal: 'WHATSAPP', total: 9 }, { canal: 'EMAIL', total: 0 }]);
    expect(r.map((d) => d.canal)).toEqual(['WHATSAPP']);
  });

  it('vem do maior para o menor, e empate desempata pelo nome', () => {
    const r = fatias([
      { canal: 'SITE', total: 4 },
      { canal: 'EMAIL', total: 4 },
      { canal: 'WHATSAPP', total: 9 },
    ]);
    expect(r.map((d) => d.nome)).toEqual(['WhatsApp', 'E-mail', 'Site']);
  });

  it('a soma das quantidades é exata, mesmo quando as porcentagens não fecham 100', () => {
    const r = fatias([
      { canal: 'SITE', total: 1 },
      { canal: 'WHATSAPP', total: 1 },
      { canal: 'PRESENCIAL', total: 1 },
    ]);
    expect(r.reduce((s, d) => s + d.total, 0)).toBe(3);
    expect(r.reduce((s, d) => s + d.fatia, 0)).toBe(99); // 33 × 3 — e está certo assim
  });

  it('lista vazia não quebra e não divide por zero', () => {
    expect(fatias([])).toEqual([]);
    expect(fatias([{ canal: 'SITE', total: 0 }])).toEqual([]);
  });
});
