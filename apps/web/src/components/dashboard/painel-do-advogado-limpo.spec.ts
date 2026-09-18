import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { numerosDaCarteira } from './linha-da-carteira';

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
    expect(PAGINA).toContain('const gradeDeNumeros = !escopoPessoal && kpiCards.length > 0 ?');
  });

  it('a pilha de avisos de integração vira uma linha no painel de carteira', () => {
    expect(PAGINA).toContain('<AvisoRobo robo={data.robo} resumido={escopoPessoal} />');
  });

  /**
   * A CARTEIRA VEM ANTES DO TRABALHO, e são QUATRO cartões — não os seis
   * originais nem a linha de texto que os substituiu por algumas horas. Ver
   * `linha-da-carteira.tsx` para as duas correções de rota.
   */
  it('a carteira é um bloco próprio, acima da fila, e não a grade antiga', () => {
    expect(PAGINA).toContain('<LinhaDaCarteira carteira={minhaCarteira} prazosNaSemana=');
    expect(PAGINA).not.toContain('label="Urgentes"');
    expect(PAGINA).not.toContain('label="Minhas audiências"');
    const carteira = PAGINA.indexOf('<LinhaDaCarteira');
    const fila = PAGINA.indexOf('{escopoPessoal && pode.agenda && !vazio.atividadesHoje && (');
    expect(carteira).toBeGreaterThan(-1);
    expect(carteira).toBeLessThan(fila);
  });

  /**
   * O robô virou nulo para quem não vê processo. Sem esta guarda o componente
   * desestruturava `null` e derrubava a home inteira.
   */
  it('o aviso do robô aguenta receber nulo', () => {
    expect(PAGINA).toContain('if (!robo) return null;');
  });
});

/**
 * A CARTEIRA VOLTOU A SER CARTÕES — correção de rota do mesmo dia.
 *
 * "A carteira principalmente, acho importante ela ser mostrada, a dashboard tem
 * que ter dados, bonita ao usuário, animada" — o dono, depois de ver a linha de
 * texto que eu tinha posto no lugar dos seis KPIs. Ele tem razão: painel sem
 * número nenhum deixa de ser painel. O erro era mostrar DEZ contadores
 * repetindo a fila logo abaixo, não mostrar a carteira.
 */
describe('a carteira do advogado', () => {
  const c = { meusProcessos: 110, preProcessuais: 4, semMovimentacao: 18 };

  it('são quatro números, e todos falam do ACERVO ou da semana', () => {
    expect(numerosDaCarteira(c, 9).map((n) => n.chave)).toEqual([
      'processos', 'prazos', 'aAjuizar', 'parados',
    ]);
  });

  /**
   * "Atrasadas" e "Urgentes" ficaram FORA: a fila logo abaixo mostra cada uma
   * como linha, com selo e cor. Contar duas vezes é o defeito que fazia
   * "atrasada" aparecer em quatro superfícies ao mesmo tempo.
   */
  it('o que a fila já mostra linha a linha não vira cartão', () => {
    const rotulos = numerosDaCarteira(c, 9).map((n) => n.rotulo);
    expect(rotulos).not.toContain('Atrasadas');
    expect(rotulos).not.toContain('Urgentes');
  });

  it('cada número diz o que contou', () => {
    const [processos, prazos, aAjuizar, parados] = numerosDaCarteira(c, 9);
    expect(processos.valor).toBe(110);
    expect(prazos).toMatchObject({ valor: 9, sub: 'próximos 7 dias' });
    expect(aAjuizar.sub).toContain('pré-processual');
    expect(parados.sub).toContain('sem andamento há');
  });

  /** Número clicável abre o MESMO recorte que contou; sem recorte, sem link. */
  it('os três que têm recorte levam a ele; parados fica sem link', () => {
    const [processos, prazos, aAjuizar, parados] = numerosDaCarteira(c, 9);
    expect(processos.href).toBe('/processos?meus=1');
    expect(prazos.href).toContain('/agenda');
    expect(aAjuizar.href).toBe('/processos?preProcessuais=1');
    expect(parados.href).toBeNull();
  });

  it('zero aparece — "0 parados" é a boa notícia que a pessoa precisa ler', () => {
    const zerada = numerosDaCarteira(
      { meusProcessos: 0, preProcessuais: 0, semMovimentacao: 0 }, 0,
    );
    expect(zerada).toHaveLength(4);
    expect(zerada.every((n) => n.valor === 0)).toBe(true);
  });
});
