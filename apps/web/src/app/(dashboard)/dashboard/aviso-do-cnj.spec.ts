import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DIAS_ESPERA_RAZOAVEL_CNJ,
  diasEsperando,
  esperaAindaRazoavel,
  motivoFalhaDatajud,
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

  /** Basta UM fora do prazo para o aviso mudar de tom — é sempre esse que importa. */
  it('a tela só tranquiliza quando TODOS estão no prazo', () => {
    expect(TELA).toContain('itens.every((i) => esperaAindaRazoavel(i.desde))');
  });

  it('e diz as duas coisas: que é normal, e que não é preciso agir', () => {
    expect(TELA).toContain('O CNJ ainda não publicou');
    expect(TELA).toContain('recém-distribuído');
    expect(TELA).toContain('não é preciso fazer nada');
  });

  it('mas fica franco quando o tempo já passou', () => {
    expect(TELA).toContain('Já passou do tempo que o índice costuma levar');
    expect(TELA).toContain('não recebe andamentos há');
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
