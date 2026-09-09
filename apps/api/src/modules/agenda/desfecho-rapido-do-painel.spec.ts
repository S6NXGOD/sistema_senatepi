import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESFECHOS_POR_TIPO, DESFECHOS_PADRAO } from './desfechos.catalogo';

/**
 * O BOTÃO DE UM TOQUE DO PAINEL CONTRA O CATÁLOGO DE VERDADE.
 *
 * A primeira versão do bloco de atividades oferecia conclusão em um toque para
 * seis tipos. QUATRO deles têm `exigeObs` no catálogo, e o serviço recusa:
 *
 *   agenda.service.ts → if (opcao.exigeObs && !obs) throw BadRequest
 *
 * O mais usado do sistema estava entre eles — "Dúvida esclarecida", 15 das 41
 * conclusões da produção. O botão mais apertado seria o que devolvia 400, e
 * nada no typecheck, no build ou nos testes de tela pegaria: a tabela do painel
 * é um `Record<string, ...>` que não conhece o catálogo.
 *
 * Este teste FECHA essa distância. Ele lê a tabela do componente e confere cada
 * slug contra o catálogo real do servidor — existe? é válido para aquele tipo?
 * e se exige observação, o componente sabe disso?
 *
 * Mora no lado da API de propósito: é aqui que o catálogo vive, e um teste que
 * importasse o catálogo para o front duplicaria a fonte.
 */
const COMPONENTE = readFileSync(
  join(__dirname, '../../../../web/src/components/dashboard/atividades-do-dia.tsx'),
  'utf8',
);

/** Extrai a tabela `DESFECHO_RAPIDO` do componente, sem executá-lo. */
function tabelaDoPainel(): { tipo: string; slug: string; exigeObs: boolean }[] {
  const bloco = COMPONENTE.slice(
    COMPONENTE.indexOf('const DESFECHO_RAPIDO'),
    COMPONENTE.indexOf('export function AtividadesDoDia'),
  );
  const linhas = [...bloco.matchAll(
    /^\s{2}([A-Z_]+):\s*\{\s*slug:\s*'([A-Z_]+)'[^}]*?\}/gm,
  )];
  return linhas.map((m) => ({
    tipo: m[1],
    slug: m[2],
    exigeObs: m[0].includes('exigeObs: true'),
  }));
}

const CATALOGO = [
  ...Object.entries(DESFECHOS_POR_TIPO).flatMap(([tipo, lista]) =>
    lista.map((d) => ({ ...d, tipo })),
  ),
  ...DESFECHOS_PADRAO.map((d) => ({ ...d, tipo: '*' })),
];

describe('a tabela de desfecho rápido do painel', () => {
  const tabela = tabelaDoPainel();

  it('foi lida (o teste não passa por não achar nada)', () => {
    expect(tabela.length).toBeGreaterThanOrEqual(4);
  });

  it.each(tabelaDoPainel())('$tipo → $slug existe e vale para o tipo', ({ tipo, slug }) => {
    const valido = CATALOGO.some((d) => d.slug === slug && (d.tipo === tipo || d.tipo === '*'));
    expect(valido).toBe(true);
  });

  /**
   * A FLAG QUE FALTAVA. Se o catálogo exige observação e o painel não sabe, o
   * clique devolve 400 — e o usuário conclui que "não funciona".
   */
  it.each(tabelaDoPainel())('$tipo → $slug declara exigeObs igual ao catálogo', ({ tipo, slug, exigeObs }) => {
    const doCatalogo = CATALOGO.find((d) => d.slug === slug && (d.tipo === tipo || d.tipo === '*'));
    expect(doCatalogo).toBeDefined();
    expect(exigeObs).toBe(!!(doCatalogo as { exigeObs?: boolean }).exigeObs);
  });

  /**
   * NENHUM desfecho que exija PROCESSO pode estar aqui: escolher qual processo
   * não cabe num botão de painel, e o serviço recusa sem ele.
   */
  it.each(tabelaDoPainel())('$tipo → $slug não exige processo', ({ tipo, slug }) => {
    const d = CATALOGO.find((x) => x.slug === slug && (x.tipo === tipo || x.tipo === '*')) as
      | { exigeProcesso?: boolean }
      | undefined;
    expect(!!d?.exigeProcesso).toBe(false);
  });

  /** E o componente precisa mesmo mandar a observação quando ela é exigida. */
  it('o componente envia desfechoObs quando exige', () => {
    expect(COMPONENTE).toContain("...(obs ? { desfechoObs: obs } : {})");
    expect(COMPONENTE).toContain('rapido.exigeObs');
  });
});
