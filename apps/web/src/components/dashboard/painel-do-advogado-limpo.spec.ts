import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { segmentosDaCarteira } from './linha-da-carteira';

/**
 * "ESSA DASHBOARD DO ADVOGADO NÃO ESTÁ POUCO ORGANIZADA E MUITO POLUÍDA?" —
 * o dono, 18/09/2026. E: "não era feita para o advogado se situar e realizar
 * ações rápidas e definitivas?"
 *
 * Estava. Levantado no código: 22 superfícies distintas numa página só, DEZ
 * cartões de KPI em duas grades separadas, e "atrasada" aparecendo em QUATRO
 * lugares ao mesmo tempo (faixa do topo, KPI, selo do cabeçalho e a linha
 * vermelha da lista). Na produção do mesmo dia, o sindicato INTEIRO tinha 5
 * atividades atrasadas e 7 processos com prazo aberto: mais moldura que
 * conteúdo.
 *
 * O que saiu do painel de quem tem carteira própria, e por quê:
 *  - "Com a triagem": ele tem `atendimentos: VISUALIZAR` e não resolve uma
 *    linha daquela fila.
 *  - "Contra quem litigamos": conteúdo recortado pelo acervo DELE com título
 *    institucional — o Panorama responde melhor, e o cartão já linkava para lá.
 *  - "Movimentações recentes": o DataJud tem mediana de 62 dias de atraso, e a
 *    consulta nem filtrava pelo acervo dele.
 *  - A segunda grade de 4 KPIs da casa.
 *  - A pilha de até 4 faixas de saúde de integração, que virou uma linha.
 *
 * Este arquivo lê o FONTE SEM COMENTÁRIOS — um comentário que cite o código não
 * pode deixar o teste verde.
 */
const RAIZ = path.resolve(__dirname, '../..');
const semComentarios = (src: string) =>
  src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const PAGINA = semComentarios(
  readFileSync(path.join(RAIZ, 'app/(dashboard)/dashboard/page.tsx'), 'utf8'),
);

describe('o que saiu do painel de quem tem carteira própria', () => {
  it('a fila da triagem só renderiza fora do escopo pessoal', () => {
    expect(PAGINA).toContain(
      '{pode.atendimentos && !ehTriagem && !escopoPessoal && !vazio.atendimentos && (',
    );
  });

  it('contra quem litigamos e movimentações saem do escopo pessoal', () => {
    expect(PAGINA).toContain('{pode.processos && !escopoPessoal && (');
    // Os dois moram no mesmo gate: um só `!escopoPessoal` cobre os dois.
    const trecho = PAGINA.slice(
      PAGINA.indexOf('{pode.processos && !escopoPessoal && ('),
      PAGINA.indexOf('<MovimentacoesRecentes data={data} />'),
    );
    expect(trecho).toContain('<AdversariosRecorrentes data={data} />');
  });

  it('a segunda grade de KPIs da casa não vai para quem tem carteira', () => {
    expect(PAGINA).toContain('{!escopoPessoal && kpiCards.length > 0 && (');
  });

  it('a pilha de avisos de integração vira uma linha no painel de carteira', () => {
    expect(PAGINA).toContain('<AvisoRobo robo={data.robo} resumido={escopoPessoal} />');
  });

  /**
   * A CARTEIRA NÃO É MAIS UMA GRADE. O dono pediu que ela fosse para o TOPO;
   * o que ela ganhou foi tamanho menor e posição mantida — ver o cabeçalho de
   * `linha-da-carteira.tsx` para o argumento inteiro.
   */
  it('os seis cartões da carteira viraram uma linha', () => {
    expect(PAGINA).toContain('{minhaCarteira && <LinhaDaCarteira carteira={minhaCarteira} />}');
    expect(PAGINA).not.toContain('label="Meus processos"');
    expect(PAGINA).not.toContain('label="Urgentes"');
    expect(PAGINA).not.toContain('label="Minhas audiências"');
  });

  /**
   * O robô virou nulo para quem não vê processo. Sem esta guarda o componente
   * desestruturava `null` e derrubava a home inteira.
   */
  it('o aviso do robô aguenta receber nulo', () => {
    expect(PAGINA).toContain('if (!robo) return null;');
  });
});

describe('a linha da carteira', () => {
  const c = { meusProcessos: 110, preProcessuais: 4, semMovimentacao: 9 };

  it('são três números, e nenhum deles é fato de agenda', () => {
    expect(segmentosDaCarteira(c).map((s) => s.chave)).toEqual([
      'processos', 'aAjuizar', 'parados',
    ]);
  });

  it('cada número diz o que contou, para o title e o leitor de tela', () => {
    const [processos, aAjuizar, parados] = segmentosDaCarteira(c);
    expect(processos.detalhe).toBe('110 processos vinculados a você');
    expect(aAjuizar.detalhe).toContain('pré-processual');
    expect(parados.detalhe).toContain('sem andamento novo há');
  });

  it('um processo é "processo", não "processos"', () => {
    const [um] = segmentosDaCarteira({ ...c, meusProcessos: 1 });
    expect(um.rotulo).toBe('processo');
    expect(um.detalhe).toBe('1 processo vinculado a você');
  });

  /**
   * NÚMERO CLICÁVEL ABRE O MESMO RECORTE QUE CONTOU. "Parados" fica sem link de
   * propósito: nenhuma lista recorta "sem andamento há N dias", e `?meus=1`
   * abriria a carteira inteira com outro número na tela.
   */
  it('os dois que têm recorte levam a ele; o que não tem fica sem link', () => {
    const [processos, aAjuizar, parados] = segmentosDaCarteira(c);
    expect(processos.href).toBe('/processos?meus=1');
    expect(aAjuizar.href).toBe('/processos?preProcessuais=1');
    expect(parados.href).toBeNull();
  });

  it('zero aparece — "0 parados" é a boa notícia que a pessoa precisa ler', () => {
    const zerada = segmentosDaCarteira({ meusProcessos: 0, preProcessuais: 0, semMovimentacao: 0 });
    expect(zerada).toHaveLength(3);
    expect(zerada.every((s) => s.valor === 0)).toBe(true);
  });
});
