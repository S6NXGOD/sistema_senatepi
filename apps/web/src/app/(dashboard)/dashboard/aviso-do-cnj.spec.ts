import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DIAS_ESPERA_RAZOAVEL_CNJ,
  diasEsperando,
  esperaAindaRazoavel,
  motivoFalhaDatajud,
  separarDesconhecidos,
  ultimaTentativaDoCnj,
  type ProcessoDesconhecidoNoCnj,
} from '@/lib/dashboard';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const TELA = lerCodigo('page.tsx');
const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * "AINDA NÃO PUBLICADO" NÃO É "DEU ERRO" — e o aviso tratava tudo igual.
 *
 * O painel mandava "confira o número" toda vez que o CNJ não reconhecia um
 * processo. Medido na produção em 07/09/2026: o único caso é um processo
 * **distribuído há 13 dias, status PENDENTE**, consultado 254 vezes. O índice
 * público demora a receber processo novo — mandar a equipe caçar erro de
 * digitação ali é mandar procurar defeito que não existe.
 *
 * Passado um mês a leitura se inverte, e aí o aviso tem de ser franco.
 */
describe('a espera pelo índice do CNJ', () => {
  it('processo recém-distribuído ainda está no prazo', () => {
    expect(esperaAindaRazoavel(dias(13))).toBe(true);
    expect(esperaAindaRazoavel(dias(0))).toBe(true);
  });

  it('passado o corte, deixa de ser espera normal', () => {
    expect(esperaAindaRazoavel(dias(DIAS_ESPERA_RAZOAVEL_CNJ + 1))).toBe(false);
    expect(esperaAindaRazoavel(dias(200))).toBe(false);
  });

  it('o número de dias que vai no texto é inteiro e nunca negativo', () => {
    expect(diasEsperando(dias(13))).toBe(13);
    expect(diasEsperando(new Date(Date.now() + 86_400_000))).toBe(0);
  });

  it('e diz as duas coisas: que é normal, e que não é preciso agir', () => {
    expect(TELA).toContain('O CNJ ainda não publicou');
    expect(TELA).toContain('recém-distribuído');
    expect(TELA).toContain('não é preciso fazer nada');
  });

  it('mas fica franco quando o tempo já passou', () => {
    expect(TELA).toContain('Já passou do tempo que o índice costuma levar');
    expect(TELA).toContain('não recebe andamentos h');
  });
});

/**
 * UM ITEM FORA DO PRAZO NÃO ACUSA OS OUTROS SEIS (25/09/2026).
 *
 * O tom da faixa inteira saía de `itens.every(esperaAindaRazoavel)`, e eu tinha
 * escrito no código que isso era de propósito: "BASTA UM FORA DO PRAZO, porque
 * é sempre esse que importa". Estava certo para uma lista de um ou dois itens.
 *
 * MEDIDO NA PRODUÇÃO EM 25/09/2026: a lista tem SETE. Um NPU de 32 dias (esse
 * merece suspeita) e quatro do TRT22 cadastrados há 11 dias — tempo normal para
 * o índice público. A tela mandava "conferir se o número está digitado certo"
 * para os seis que não têm nada de errado.
 *
 * É o mesmo erro que já custou caro duas vezes aqui (a faixa que acusava
 * processo dormente, o corte que escondia 2 dos 3 atrasados): acusar em bloco
 * quem não deve ensina a ignorar a faixa — e aí o único que precisa de gente
 * passa junto com o resto.
 */
describe('separar os que passaram do prazo dos que ainda estão nele', () => {
  const item = (dias: number, npu: string): ProcessoDesconhecidoNoCnj =>
    ({
      processoId: npu,
      numeroCNJ: npu,
      tribunal: 'TJPI',
      filiado: null,
      tentativas: 1,
      desde: new Date(Date.now() - dias * 86_400_000).toISOString(),
      ultima: new Date().toISOString(),
    }) as never;

  /** O caso real de 25/09: 1 de 32 dias e 4 de 11 dias, na mesma lista. */
  const REAL = [item(11, 'a'), item(11, 'b'), item(32, 'velho'), item(11, 'c'), item(11, 'd')];

  it('o de 32 dias não arrasta os de 11 para a acusação', () => {
    const { passaramDoPrazo, aindaNoPrazo } = separarDesconhecidos(REAL);
    expect(passaramDoPrazo.map((i) => i.numeroCNJ)).toEqual(['velho']);
    expect(aindaNoPrazo).toHaveLength(4);
  });

  /** Os suspeitos vêm na frente: quem abre a lista vê primeiro o que pede alguém. */
  it('ordena o que pede alguém para o topo', () => {
    expect(separarDesconhecidos(REAL).ordenados[0].numeroCNJ).toBe('velho');
  });

  it('e não perde nem duplica item nenhum', () => {
    const { ordenados } = separarDesconhecidos(REAL);
    expect(ordenados).toHaveLength(REAL.length);
    expect(new Set(ordenados.map((i) => i.numeroCNJ)).size).toBe(REAL.length);
  });

  /** Dentro de cada grupo, o mais antigo primeiro. */
  it('o mais antigo lidera o grupo', () => {
    const { passaramDoPrazo } = separarDesconhecidos([item(40, 'novo'), item(90, 'antigo')]);
    expect(passaramDoPrazo.map((i) => i.numeroCNJ)).toEqual(['antigo', 'novo']);
  });

  it('lista vazia não quebra', () => {
    expect(separarDesconhecidos([]).ordenados).toEqual([]);
  });

  /** Todos no prazo: a faixa inteira continua com a voz calma, como era. */
  it('sem nenhum fora do prazo, nada é acusado', () => {
    expect(separarDesconhecidos([item(3, 'x'), item(9, 'y')]).passaramDoPrazo).toEqual([]);
  });
});

/**
 * O CONTADOR ACUMULADO SAIU DA TELA — ele descrevia agosto, não hoje.
 *
 * A linha do detalhe dizia "consultado 272× desde 24/08/2026". Medido na
 * produção em 25/09/2026, nesse mesmo NPU: **260 daquelas 272 são anteriores a
 * 12/09**, de dias com 14, 39, 41 e 52 consultas ao mesmo número — um defeito
 * de ritmo que já foi corrigido. De 12/09 para cá foram 12 consultas em 13
 * noites: uma por noite, igual ao acervo inteiro (1,0× por NPU por dia).
 *
 * O número era verdade como história e mentira como descrição do presente, e
 * nunca desce, porque conta linha de log que ninguém apaga. No lugar dele vão
 * os dois fatos que decidem algo: há quanto tempo não há resposta, e se o robô
 * ainda está tentando.
 */
describe('a última tentativa, em vez do total acumulado', () => {
  const emPontoDe = (iso: string) => new Date(iso);

  it('hoje leva a hora — é o que diz "o sistema não desistiu"', () => {
    const agora = emPontoDe('2026-09-25T12:00:00-03:00');
    expect(ultimaTentativaDoCnj(emPontoDe('2026-09-25T05:47:00-03:00'), agora)).toMatch(
      /^hoje às \d{2}:\d{2}$/,
    );
  });

  it('ontem também, porque a varredura é de madrugada', () => {
    const agora = emPontoDe('2026-09-25T12:00:00-03:00');
    expect(ultimaTentativaDoCnj(emPontoDe('2026-09-24T05:14:00-03:00'), agora)).toMatch(
      /^ontem às \d{2}:\d{2}$/,
    );
  });

  it('mais velho que isso vira data, sem hora', () => {
    const agora = emPontoDe('2026-09-25T12:00:00-03:00');
    expect(ultimaTentativaDoCnj(emPontoDe('2026-09-12T05:21:00-03:00'), agora)).toBe('12/09/2026');
  });

  /** E o total acumulado não volta para a tela por descuido. */
  it('a tela não mostra mais "consultado N×"', () => {
    expect(TELA).not.toContain('consultado {i.tentativas}');
    expect(TELA).toContain('sem resposta h');
    expect(TELA).toContain('ltima tentativa {ultimaTentativaDoCnj(i.ultima)}');
  });
});

/**
 * OS MOTIVOS DE FALHA ERAM ETIQUETA DE LOG.
 *
 * "NPU recusado pelo CNJ", "chave da API recusada", "erro 502 no CNJ" — quem
 * abre o painel de manhã não decide nada com isso. Cada motivo agora responde
 * o que aconteceu E de quem é a bola.
 */
describe('os motivos de falha, em português', () => {
  it('404 é o índice atrasado, não um defeito', () => {
    const m = motivoFalhaDatajud({ httpStatus: 404 } as never);
    expect(m.texto).toContain('ainda não publicou');
    expect(m.passageiro).toBe(false);
  });

  /**
   * 429 É NOSSO. "limite de consultas atingido" soa como restrição do CNJ; era
   * a nossa varredura passando do teto — 6 vezes em 04/09/2026.
   */
  it('429 assume a culpa em vez de empurrar para o CNJ', () => {
    const m = motivoFalhaDatajud({ httpStatus: 429 } as never);
    expect(m.texto).toContain('nossa varredura');
    expect(m.passageiro).toBe(true);
  });

  it('401/403 diz que é configuração nossa', () => {
    expect(motivoFalhaDatajud({ httpStatus: 403 } as never).texto).toContain('é configuração nossa');
  });

  it('o timeout diz quanto esperou, e não "sem resposta"', () => {
    const m = motivoFalhaDatajud({ duracaoMs: 45_000 } as never);
    expect(m.texto).toContain('demorou demais');
    expect(m.passageiro).toBe(true);
  });

  /** O que falha de novo amanhã não pode ser prometido como "a próxima resolve". */
  it('separa o passageiro do permanente', () => {
    expect(motivoFalhaDatajud({ httpStatus: 500 } as never).passageiro).toBe(true);
    expect(motivoFalhaDatajud({ httpStatus: 400 } as never).passageiro).toBe(false);
  });
});
