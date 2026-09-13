import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CTRL = readFileSync(join(__dirname, 'partes.controller.ts'), 'utf8');
const MODULO = readFileSync(join(__dirname, 'processos.module.ts'), 'utf8');

/**
 * "ESSE CASO DE JUNTAR ORGANIZAÇÕES ME PARECE PERIGOSO E IRREVERSÍVEL SE ALGUÉM
 * FIZER ALGO ERRADO. SÓ DEVIA SER PERMITIDO PARA ADMINISTRADORES." — 12/09/2026.
 *
 * Juntar já era só do Administrador. A fila em volta, não: a varredura, a
 * comparação e o "não são a mesma" ficavam com quem enxergasse processos — e foi
 * um "não são a mesma" dado por quem não podia juntar que tirou o par da FMS da
 * vista de quem podia. Descartar não apaga nada, mas esconde para sempre.
 */
describe('a fila de fusão de organizações é do Administrador, inteira', () => {
  const inicio = CTRL.indexOf('export class FusaoDeOrganizacoesController');
  const classe = CTRL.slice(inicio);
  const decoradores = CTRL.slice(CTRL.lastIndexOf('@ApiTags', inicio), inicio);
  const cadastro = CTRL.slice(CTRL.indexOf('export class PartesExternasController'), inicio);

  it('a classe inteira é operação de sistema', () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(decoradores).toContain('@OperacaoDeSistema()');
    expect(decoradores).toContain("@Controller('partes-externas')");
  });

  it('as quatro rotas moram nela — e só nela', () => {
    for (const rota of [
      "@Get('duplicadas')",
      "@Post(':id/nao-duplicada')",
      "@Get(':id/comparar/:outraId')",
      "@Post(':id/mesclar')",
    ]) {
      expect(classe).toContain(rota);
      expect(cadastro).not.toContain(rota);
    }
  });

  /** `duplicadas` é literal: registrado depois, o `:id` do cadastro o engoliria. */
  it('é registrada antes do cadastro de partes', () => {
    const lista = MODULO.slice(MODULO.indexOf('controllers: ['));
    expect(lista.indexOf('FusaoDeOrganizacoesController')).toBeGreaterThan(-1);
    expect(lista.indexOf('FusaoDeOrganizacoesController')).toBeLessThan(
      lista.indexOf('PartesExternasController'),
    );
  });
});
