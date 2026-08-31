import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const CSV_SERVICE = ler('src/modules/importacao/processos-csv.service.ts');
const CSV_CONTROLLER = ler('src/modules/importacao/processos-csv.controller.ts');
const PROCESSOS = ler('src/modules/processos/processos.service.ts');
const DTO = ler('src/modules/processos/dto/processos.dto.ts');

/**
 * MIGRAR ACERVO NÃO É ABRIR PRAZO.
 *
 * Produção, 31/08/2026: a planilha de 82 processos entrou e o robô abriu quatro
 * "Verificação de Intimação / Prazo", todas de atos com 25 a 28 dias — ou seja,
 * todas já vencidas ao nascer. São processos acompanhados há anos pelo
 * escritório: aquelas publicações já tinham sido lidas e respondidas fora do
 * sistema. A tarefa não avisava de nada; mandava conferir o conferido.
 *
 * O robô não distingue "processo novo" de "processo antigo que acabou de
 * entrar" — para ele os dois são um processo criado hoje com movimentações
 * recentes. Quem sabe a diferença é quem importa, e por isso virou parâmetro.
 */
describe('importação em lote e o robô de prazos', () => {
  it('o cadastro AVULSO continua acordando o robô (o padrão não mudou lá)', () => {
    expect(PROCESSOS).toContain('if (dto.criarTarefasDePrazo !== false) {');
    expect(DTO).toContain('criarTarefasDePrazo?: boolean;');
  });

  it('a importação em LOTE só liga o robô quando pedem explicitamente', () => {
    expect(CSV_SERVICE).toContain('criarTarefasDePrazo: opcoes.criarTarefasDePrazo === true');
  });

  /**
   * `=== true`, e não a coerção: um corpo ausente, `undefined` ou `null` tem de
   * cair no padrão SEGURO. Com `!!` um dia alguém manda a string 'false' e o
   * acervo inteiro vira agenda.
   */
  it('qualquer coisa que não seja `true` deixa o robô dormindo', () => {
    expect(CSV_CONTROLLER).toContain('criarTarefasDePrazo: body?.criarTarefasDePrazo === true');
  });

  /**
   * O corpo é OPCIONAL. Durante a janela de troca do deploy o contêiner antigo
   * ainda atende, e a tela antiga chama `confirmar` sem corpo nenhum — com
   * `forbidNonWhitelisted` ligado, exigir o corpo quebraria a importação.
   */
  it('o corpo do confirmar é opcional', () => {
    expect(CSV_CONTROLLER).toMatch(/@Body\(\) body\?: ConfirmarImportacaoProcessosDto/);
    expect(CSV_CONTROLLER).toMatch(/@IsOptional\(\) @IsBoolean\(\)\s*\n\s*criarTarefasDePrazo\?: boolean;/);
  });

  /**
   * A classe do DTO tem de estar declarada ANTES do controller: o
   * `emitDecoratorMetadata` a referencia na definição da classe, e declará-la
   * depois derruba a API na carga com `Cannot access before initialization`.
   * Aconteceu ao escrever esta própria correção — ver `carga-dos-modulos.spec`.
   */
  it('o DTO é declarado antes do controller que o usa', () => {
    const dto = CSV_CONTROLLER.indexOf('export class ConfirmarImportacaoProcessosDto');
    const ctrl = CSV_CONTROLLER.indexOf('export class ProcessosCsvController');
    expect(dto).toBeGreaterThan(-1);
    expect(ctrl).toBeGreaterThan(-1);
    expect(dto).toBeLessThan(ctrl);
  });
});
