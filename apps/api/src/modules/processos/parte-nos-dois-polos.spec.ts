import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUGESTOES = readFileSync(join(__dirname, 'sugestoes.service.ts'), 'utf8');

/**
 * A EBSERH PROCESSANDO A EBSERH.
 *
 * Caso real, 0001023-67.2025.5.22.0001 (RECURSO ORDINÁRIO TRABALHISTA, 24
 * publicações). O Diário listou, ao longo dessas 24, estas partes:
 *
 *   [A] AUGUSTO CESAR FERREIRA DA SILVA
 *   [A] EBSERH        [P] EBSERH
 *   [A] SENATEPI      [P] SENATEPI
 *
 * Não é defeito de leitura: em recurso os DOIS lados recorrem, então cada um é
 * recorrente numa publicação e recorrido na outra. Somando as 24, a mesma parte
 * fica nos dois polos.
 *
 * O formulário montava exatamente isso — a empresa como autora e ré do mesmo
 * processo, o sindicato idem — e com cara de dado conferido. Ia poluir
 * adversários recorrentes, o filtro de réu e a detecção de polo dos atos
 * futuros.
 *
 * O polo que o Diário informa num recurso é a posição RECURSAL, não a da ação
 * original: não há como inferir o lado certo. Chutar seria palpite com cara de
 * fato, que é a regra que o `AMBOS` da varredura já respeita.
 */
const PARTES_REAIS = [
  { nome: 'AUGUSTO CESAR FERREIRA DA SILVA', polo: 'A' },
  { nome: 'EMPRESA BRASILEIRA DE SERVICOS HOSPITALARES - EBSERH', polo: 'A' },
  { nome: 'EMPRESA BRASILEIRA DE SERVICOS HOSPITALARES - EBSERH', polo: 'P' },
  { nome: 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI', polo: 'A' },
  { nome: 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI', polo: 'P' },
];

/** A mesma normalização dos dois lados: pontuação vira ESPAÇO, nunca some. */
const chave = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

function ambiguas(partes: { nome: string; polo: string }[]): string[] {
  const noPassivo = new Set(
    partes.filter((x) => x.polo.toUpperCase() === 'P').map((x) => chave(x.nome)),
  );
  return partes
    .filter((x) => x.polo.toUpperCase() === 'A' && noPassivo.has(chave(x.nome)))
    .map((x) => x.nome);
}

describe('a parte que o Diário põe nos dois polos', () => {
  it('é detectada nas partes reais do recurso', () => {
    const achadas = ambiguas(PARTES_REAIS);
    expect(achadas).toHaveLength(2);
    expect(achadas.join(' | ')).toContain('EBSERH');
    expect(achadas.join(' | ')).toContain('SENATEPI');
  });

  /** Quem aparece num polo só nunca é ambíguo — o autor original fica de pé. */
  it('não confunde quem aparece em um polo só', () => {
    expect(ambiguas(PARTES_REAIS)).not.toContain('AUGUSTO CESAR FERREIRA DA SILVA');
  });

  /**
   * A comparação atravessa grafia: o mesmo nome com vírgula, hífen ou acento
   * diferente é a MESMA parte, e não detectar isso devolveria o bug inteiro.
   */
  it('casa o mesmo nome escrito de outro jeito', () => {
    const variacoes = [
      { nome: 'Empresa Brasileira de Serviços Hospitalares — EBSERH', polo: 'A' },
      { nome: 'EMPRESA BRASILEIRA DE SERVICOS HOSPITALARES - EBSERH', polo: 'P' },
    ];
    expect(ambiguas(variacoes)).toHaveLength(1);
  });

  it('não acusa nada num processo comum', () => {
    expect(
      ambiguas([
        { nome: 'FULANO DE TAL', polo: 'A' },
        { nome: 'EMPRESA X LTDA', polo: 'P' },
      ]),
    ).toHaveLength(0);
  });
});

/**
 * NO LOTE A RECUSA É MELHOR QUE O REMENDO.
 *
 * Descartar só a parte ambígua parece mais gentil, mas medido nas 30 da fila o
 * único caso ficaria com autor e NENHUM réu: um processo pela metade, gravado
 * em silêncio, que ninguém revisa porque parece pronto. São trinta de uma vez e
 * nenhum olho no meio.
 */
describe('o cadastro em lote diante de um recurso', () => {
  it('recusa a sugestão inteira em vez de gravar meio processo', () => {
    expect(SUGESTOES).toContain('const ambiguos = cru(\'A\').filter((n) => noPassivo.has(chaveNome(n)));');
    expect(SUGESTOES).toContain('if (ambiguos.length) {');
    expect(SUGESTOES).toContain('ok: false,');
  });

  /** O motivo vai para o aviso agrupado da tela, e diz o que fazer. */
  it('e explica o que a pessoa deve fazer', () => {
    const trecho = SUGESTOES.slice(
      SUGESTOES.indexOf('if (ambiguos.length) {'),
      SUGESTOES.indexOf('const nomes = (polo:'),
    );
    expect(trecho).toContain('nos dois polos');
    expect(trecho).toContain('cadastre pela tela');
    // Continua PENDENTE: recusa não é descarte.
    expect(trecho).toContain('continue;');
  });

  /**
   * A trava roda ANTES de qualquer escrita. Se rodasse depois de `importarUma`,
   * o processo já existiria quando a recusa fosse decidida.
   */
  it('a trava vem antes de criar o processo', () => {
    expect(SUGESTOES.indexOf('if (ambiguos.length) {')).toBeLessThan(
      SUGESTOES.indexOf('const processo = await importarUma('),
    );
  });
});
