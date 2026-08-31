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

/**
 * O BOTÃO QUE NÃO DEIXAVA COMPLETAR.
 *
 * Reportado pelo jurídico em 31/08/2026, depois de eu mesmo mandar subir a
 * planilha de novo: "eu coloco o CSV de novo mas o botão fica desativado".
 *
 * A tela calculava `aImportar = validos - jaCadastrados` e desabilitava o botão
 * quando dava zero. Com os 82 processos já cadastrados a conta dá zero — e o
 * único caminho existente para completar a área jurídica, as etiquetas e o
 * andamento do jurídico ficava trancado justamente na situação em que era
 * necessário. A prévia ainda por cima dizia "esta linha será pulada", que era o
 * comportamento de antes do `completarExistente`.
 *
 * Estes casos leem a TELA, e não o serviço: o defeito morava lá.
 */
describe('a segunda passada tem de ser possível pela tela', () => {
  const DIALOGO = ler('../web/src/components/processos/importar-lote-dialog.tsx');
  const LIB = ler('../web/src/lib/importacao-processos.ts');

  it('o botão olha os DOIS trabalhos, não só a importação', () => {
    expect(DIALOGO).toContain('const aFazer = aImportar + aCompletar;');
    expect(DIALOGO).toContain('disabled={aFazer === 0}');
    expect(DIALOGO).not.toContain('disabled={aImportar === 0}');
  });

  it('o número de "prontas" deixou de ser uma subtração adivinhada', () => {
    expect(DIALOGO).not.toContain('conferencia.validos - conferencia.jaCadastrados');
    expect(DIALOGO).toContain('conferencia?.novos');
    expect(DIALOGO).toContain('conferencia?.aCompletar');
  });

  it('a API devolve os três números que a tela precisa distinguir', () => {
    expect(CSV_SERVICE).toMatch(/novos: linhas\.filter/);
    expect(CSV_SERVICE).toContain('aCompletar,');
    expect(CSV_SERVICE).toContain('jaCompletos,');
    for (const campo of ['novos', 'aCompletar', 'jaCompletos']) {
      expect(`${campo} no tipo: ${LIB.includes(`${campo}: number`)}`).toBe(`${campo} no tipo: true`);
    }
  });

  /**
   * A prévia e a execução decidem pela MESMA função. Duas cópias divergiriam na
   * primeira correção, e o sintoma seria a tela prometer "80 a completar" e o
   * resultado dizer "80 ignorados" — sem ninguém saber qual mentiu.
   */
  it('prévia e execução chamam `oQueCompletar`', () => {
    const previa = CSV_SERVICE.slice(
      CSV_SERVICE.indexOf('async processarUpload('),
      CSV_SERVICE.indexOf('async resumo('),
    );
    const completar = CSV_SERVICE.slice(CSV_SERVICE.indexOf('private async completarExistente('));
    expect(previa).toContain('oQueCompletar(');
    expect(completar).toContain('oQueCompletar(');
  });

  /**
   * Completar não consulta o CNJ, então não deve pagar a pausa de 2–3s. Com ela,
   * uma segunda passada de 82 linhas levava três minutos e meio de espera pura.
   */
  it('a pausa do CNJ só vale para quem consultou o CNJ', () => {
    expect(CSV_SERVICE).toContain('if (consultouOCnj && processados < linhas.length) await this.aguardar();');
    expect(CSV_SERVICE).toContain("consultouOCnj = resultado === 'IMPORTADO'");
    // A linha que estourou conta como consulta: a falha provável é o próprio CNJ.
    const captura = CSV_SERVICE.slice(CSV_SERVICE.indexOf('} catch (err) {'));
    expect(captura.slice(0, 600)).toContain('consultouOCnj = true;');
  });

  /** Completado tem contador próprio: "82 importados" numa passada que não criou nada era falso. */
  it('completado não é contado como importado', () => {
    expect(CSV_SERVICE).toContain("if (resultado === 'IMPORTADO') importados++;");
    expect(CSV_SERVICE).toContain("else if (resultado === 'COMPLETADO') completados++;");
    expect(CSV_SERVICE).toContain('completados: imp.atualizados,');
    expect(DIALOGO).toContain('resumo.completados');
  });
});
