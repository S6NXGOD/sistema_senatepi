import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { StatusProcesso } from '@prisma/client';

import { filtroDeVarredura, STATUS_VIVOS } from './utils/varredura.util';

const SERVICE = readFileSync(path.join(__dirname, 'processos.service.ts'), 'utf8');

/**
 * O PROCESSO QUE EXISTE MAS O CNJ AINDA NÃO CONHECE.
 *
 * O CENÁRIO, palavra por palavra: um advogado cadastra hoje um processo já
 * distribuído; o índice público do CNJ ainda não o tem, porque os tribunais
 * alimentam esse índice em lote e a defasagem é de dias. A pergunta é se o
 * sistema se vira sozinho quando os dados aparecerem.
 *
 * Conferido na produção em 25/08/2026 no 0856490-91.2026.8.18.0140: cadastrado
 * no dia 24, consultado às 03:41 do dia 25, zero resultados no índice do TJPI.
 * Comportamento correto — e a cadeia inteira que o sustenta está travada
 * abaixo, porque cada elo dela já quebrou uma vez na vida deste sistema.
 */
describe('processo novo que o CNJ ainda não publicou', () => {
  const AGORA = new Date('2026-08-25T12:00:00Z');

  it('nasce PENDENTE — é o padrão de quem cadastra à mão', () => {
    expect(SERVICE).toMatch(/statusInterno: dto\.statusInterno \?\? 'PENDENTE'/);
  });

  it('PENDENTE é faixa RÁPIDA: o robô o consulta toda noite, não a cada 7 dias', () => {
    expect(STATUS_VIVOS).toContain(StatusProcesso.PENDENTE);

    const filtro = filtroDeVarredura(AGORA);
    const rapida = (filtro.OR ?? []).find(
      (r) => Array.isArray((r as { statusInterno?: { in?: unknown[] } }).statusInterno?.in),
    ) as { statusInterno: { in: StatusProcesso[] } };
    expect(rapida.statusInterno.in).toContain(StatusProcesso.PENDENTE);
  });

  it('só entra na varredura quem tem NPU — sem número não há o que consultar', () => {
    expect(filtroDeVarredura(AGORA).numeroCNJ).toEqual({ not: null });
  });

  /**
   * O ELO MAIS FÁCIL DE QUEBRAR. Se a resposta vazia apagasse o cache, um dia
   * de instabilidade do CNJ zeraria o acervo inteiro; se ela lançasse erro, o
   * processo entraria na fila de falhas e alguém iria "consertar" o que não
   * está quebrado.
   */
  it('resposta vazia do CNJ não apaga nada e não é tratada como falha', () => {
    const trecho = SERVICE.slice(
      SERVICE.indexOf('// Sem retorno agora: apenas registra a tentativa'),
      SERVICE.indexOf('A mesclagem por instância mora em InstanciasService'),
    );
    expect(trecho.length).toBeGreaterThan(200); // o teste não olha para o vazio
    // Grava só o carimbo da tentativa…
    expect(trecho).toContain('data: { ultimaSincronizacao: new Date() }');
    // …e registra como SUCESSO com zero novidades, não como erro.
    expect(trecho).toMatch(/sucesso: true, novasMovimentacoes: 0/);
    expect(trecho).toContain('Processo não localizado no índice do tribunal.');
  });

  /**
   * A TRANSIÇÃO QUE FALTAVA.
   *
   * A reavaliação sabia encerrar (todas as instâncias baixadas) e sabia reabrir
   * (ENCERRADO com instância viva) — e não sabia sair de PENDENTE. O processo
   * era preenchido pelo robô e continuava dizendo "aguardando movimentação"
   * com quarenta andamentos na tela.
   *
   * O dano não era cosmético: a carteira do advogado, no painel, conta
   * `statusInterno: ATIVO`. Um processo travado em PENDENTE não aparecia nela —
   * o mesmo ZERO silencioso do "A ajuizar: 0".
   */
  it('vira ATIVO quando o CNJ publica e há andamento', () => {
    const trecho = SERVICE.slice(
      SERVICE.indexOf('PENDENTE QUE FINALMENTE APARECEU NO CNJ VIRA ATIVO'),
      SERVICE.indexOf("if (processo.statusInterno !== 'ENCERRADO' || !viva) return;"),
    );
    expect(trecho.length).toBeGreaterThan(400);
    expect(trecho).toMatch(/processo\.statusInterno === 'PENDENTE' && viva/);
    // Exige andamento: "aguardando movimentação" só deixa de valer quando há
    // movimentação. Instância viva sem nenhum ato não muda nada.
    expect(trecho).toContain('movimentacaoProcessual.count');
    expect(trecho).toMatch(/if \(andamentos > 0\)/);
    expect(trecho).toMatch(/statusInterno: 'ATIVO'/);
  });

  it('a mudança de status deixa rastro na linha do tempo', () => {
    const trecho = SERVICE.slice(
      SERVICE.indexOf('PENDENTE QUE FINALMENTE APARECEU NO CNJ VIRA ATIVO'),
      SERVICE.indexOf("if (processo.statusInterno !== 'ENCERRADO' || !viva) return;"),
    );
    // Encontrar um processo que mudou de estado sozinho, sem explicação, é o
    // tipo de coisa que faz a equipe desconfiar do robô inteiro.
    expect(trecho).toContain('movimentacaoInterna.create');
    expect(trecho).toMatch(/statusAnterior: 'PENDENTE'/);
    expect(trecho).toMatch(/statusNovo: 'ATIVO'/);
  });

  /**
   * `idsAtivos()` filtrava `statusInterno: 'ATIVO'` e se dizia "a varredura do
   * robô". Não era — e usá-lo teria deixado PENDENTE de fora justamente no
   * cenário deste arquivo.
   */
  it('não existe seleção de varredura que filtre só ATIVO', () => {
    expect(SERVICE).not.toMatch(/async idsAtivos/);
    const varredura = SERVICE.slice(
      SERVICE.indexOf('async idsParaSincronizar'),
      SERVICE.indexOf('Leituras 100% do cache local'),
    );
    expect(varredura).toContain('filtroDeVarredura(new Date())');
    expect(varredura).not.toMatch(/statusInterno: 'ATIVO'/);
  });
});
