import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAINEL = readFileSync(join(__dirname, 'partes-panel.tsx'), 'utf8');
const LIB = readFileSync(join(__dirname, '../../lib/partes.ts'), 'utf8');
const UTIL_API = readFileSync(
  join(__dirname, '../../../../api/src/modules/processos/utils/advogados-do-ato.util.ts'),
  'utf8',
);

/**
 * O DIÁRIO DIZ QUEM ATUA — MAS NÃO DIZ DE QUEM É.
 *
 * O ato do CNJ traz `destinatarioadvogados[{advogado:{nome,numero_oab,uf_oab}}]`
 * e ponto: nenhum campo liga advogado a parte (conferido na origem). A varredura
 * atribui quando há uma única parte no polo contrário — 154 dos 168 processos —
 * e o resto fica para gente apontar.
 *
 * Estes testes guardam a HONESTIDADE da tela: se a marca de origem sumir, o
 * dado deduzido passa a parecer digitado, e ninguém mais confere.
 */
describe('advogados da parte contrária', () => {
  it('a lista de cada parte mostra o que veio do Diário como veio do Diário', () => {
    expect(PAINEL).toContain("a.origem === 'DJEN'");
    expect(PAINEL).toContain('do Diário');
    // O texto explica a dedução; sem isso a marca vira enfeite.
    expect(PAINEL).toContain('única do polo contrário');
  });

  it('e quem edita pode tirar um nome errado sem abrir formulário', () => {
    expect(PAINEL).toContain('onRemover');
    expect(PAINEL).toContain('podeEditar && (');
  });

  /**
   * A LISTA VAI INTEIRA no PATCH. Se o front reenviasse só `{nome, oab}`, o
   * primeiro salvamento apagaria `origem` e `numeroOab` — e o deduzido viraria
   * indistinguível do digitado.
   */
  it('o salvamento devolve os campos que vieram, não só nome e OAB', () => {
    expect(LIB).toContain('numeroOab');
    expect(LIB).toContain('ufOab');
    expect(LIB).toContain('origem');
    expect(PAINEL).toContain('atualizarParte(id, { advogados })');
  });
});

/**
 * O QUE SOBRA — e por que a tela pergunta em vez de chutar.
 *
 * Com duas partes no polo contrário não há candidato único. Pôr o advogado no
 * réu errado é pior que não pôr: numa audiência isso vira contato errado.
 */
describe('advogados sem lado', () => {
  it('o bloco some quando não há nada a resolver', () => {
    expect(PAINEL).toContain('if (!semLado.length || !partes.length) return null;');
  });

  it('pergunta uma vez por advogado, com um botão por parte', () => {
    expect(PAINEL).toContain('onAtribuir(p, a)');
    expect(PAINEL).toContain('min-h-9');
  });

  it('e o que a pessoa apontar fica marcado como decisão de gente', () => {
    expect(PAINEL).toContain("origem: 'MANUAL'");
  });

  it('some da lista assim que ganha dono', () => {
    expect(PAINEL).toContain("queryKey: ['processo', processoId, 'advogados-do-ato']");
    expect(PAINEL).toContain('qc.invalidateQueries');
  });

  /** A regra que sustenta tudo isso está escrita na API, não na tela. */
  it('a API documenta que o CNJ não manda o polo do advogado', () => {
    expect(UTIL_API).toContain('numero_oab');
    expect(UTIL_API.toLowerCase()).toContain('polo');
  });
});
