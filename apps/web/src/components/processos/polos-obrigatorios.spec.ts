import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODAL = readFileSync(join(__dirname, 'importar-processo-dialog.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * NENHUM PROCESSO ENTRA SEM OS DOIS POLOS — pedido do dono em 07/11/2026.
 *
 * A API recusa também (`polos-do-cadastro.util`, com teste que monta o serviço).
 * Aqui é a tela: a pessoa precisa saber ANTES de esperar o CNJ, e no lugar exato
 * do que falta. O web não monta o diálogo em teste, então se fixa a estrutura.
 */
describe('o cadastro pede os dois polos', () => {
  it('os dois títulos dizem que são obrigatórios', () => {
    expect(MODAL).toContain('Polo ativo — quem pede *');
    expect(MODAL).toContain('Polo passivo — contra quem *');
  });

  it('o envio não sai sem os dois, e diz qual falta', () => {
    const envio = MODAL.slice(MODAL.indexOf('onSubmit={handleSubmit((d) => {'), MODAL.indexOf('importar.mutate(d);'));
    expect(envio).toContain('if (faltaAtivo || faltaPassivo) {');
    expect(envio).toContain('setTentouSemPolo(true);');
    expect(envio).toContain('return;');
    expect(MODAL).toContain('const faltaAtivo = poloAtivo.length === 0;');
    expect(MODAL).toContain('const faltaPassivo = reus.length === 0;');
  });

  /* O aviso aparece no polo que falta, só depois da primeira tentativa. */
  it('o aviso acende o polo que falta, e só depois de tentar', () => {
    expect(MODAL).toContain('const avisoDoPolo = (falta: boolean) => tentouSemPolo && falta;');
    expect(MODAL).toContain('avisoDoPolo(faltaAtivo) && (');
    expect(MODAL).toContain('avisoDoPolo(faltaPassivo) && (');
    expect(MODAL).toContain('Obrigatório: diga contra quem é a ação.');
  });

  /* A frase antiga do polo vazio convidava a deixar em branco — o contrário da regra. */
  it('nenhum texto da tela convida a deixar o réu em branco', () => {
    expect(MODAL).not.toContain('Dá para deixar em branco');
    expect(MODAL).toContain('Contra quem é a ação? Busque pelo nome');
  });

  it('reabrir o diálogo apaga o aviso da tentativa anterior', () => {
    expect(MODAL).toContain('useEffect(() => { if (!open) setTentouSemPolo(false); }, [open]);');
  });
});
