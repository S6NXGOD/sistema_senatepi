import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');
const PROCESSOS = ler('processos.service.ts');
const VINCULOS = ler('vinculos-pendentes.service.ts');
const VINCULO_ADV = ler('vinculo-de-advogado.service.ts');
const EXTERNAS = ler('partes-externas.service.ts');
const CSV = ler('../importacao/processos-csv.service.ts');
const CSV_UTIL = ler('../importacao/processos-csv.util.ts');

/** Só o corpo de um método — `slice` até o fim do arquivo arrasta o vizinho. */
const metodo = (fonte: string, de: string, ate: string) => {
  const i = fonte.indexOf(de);
  expect(i).toBeGreaterThan(-1);
  const j = fonte.indexOf(ate, i + de.length);
  return fonte.slice(i, j > -1 ? j : undefined);
};

/**
 * A SEGUNDA LEVA DA AUDITORIA DE PERDA SILENCIOSA.
 *
 * Mesma classe de defeito: dado que o sistema JÁ TINHA e descarta sem erro, sem
 * log e sem fila de pendência. Nenhum destes quebra nada — é por isso que
 * sobreviveram tanto tempo.
 */
describe('a decisão de gente não se desfaz por rotina', () => {
  /**
   * `marcarInstitucional` gravava só `tipoAcao`, que é DERIVADO:
   * `sincronizarAtalhos` o recalcula a cada edição de parte. A reclassificação
   * voltava sozinha para INDIVIDUAL na primeira mexida — e só acrescentava a
   * parte institucional quando o polo ativo estava VAZIO, que é o caso raro.
   */
  it('"é ação institucional" vira PARTE, não só campo derivado', () => {
    const fn = metodo(VINCULOS, 'private async marcarInstitucional(', 'private async ');
    expect(fn).toContain('const jaSomosParte = proc.partes.some((x) => x.parteExterna?.institucional)');
    expect(fn).toContain('this.partes.adicionar(');
    // E a derivação passa a concordar com a decisão, em vez de brigar com ela.
    expect(fn).toContain('TipoAcaoProcesso.INSTITUCIONAL');
  });
});

describe('o outro lado é quem não é nosso', () => {
  /**
   * `gravarNaParteContraria` invertia o polo binariamente. `PoloProcesso` tem
   * TRÊS valores: com autor (nós) + um réu + um terceiro, a inversão via UMA
   * parte contrária e gravava ali os advogados dos DOIS — o procurador do
   * terceiro passava a constar como advogado do réu, com `origem: 'DJEN'`.
   */
  it('conta as partes pelo complemento, sem inverter polo', () => {
    const fn = metodo(VINCULO_ADV, 'private async gravarNaParteContraria(', '\n}');
    expect(fn).toContain('const ehNossa =');
    expect(fn).toContain('processo.partes.filter((p) => !ehNossa(p))');
    // A inversão binária saiu de vez.
    expect(fn).not.toContain("polos.has('ATIVO') ? 'PASSIVO' : 'ATIVO'");
  });

  /** Dois candidatos continuam sendo dúvida — o sistema não escolhe. */
  it('com mais de um do outro lado, ninguém é escolhido', () => {
    const fn = metodo(VINCULO_ADV, 'private async gravarNaParteContraria(', '\n}');
    expect(fn).toContain('if (contrarias.length !== 1) return { naParte: 0, semLado: outros.length };');
  });
});

describe('mesclar organização não apaga participação', () => {
  /**
   * `jaTem` era indexado só por `processoId`: a linha da duplicada no polo
   * PASSIVO casava com a da que fica no ATIVO do MESMO processo e era APAGADA —
   * com papel, nome dos autos, advogados da parte e observação junto. E
   * mesclagem não se desfaz.
   */
  it('a chave de absorção inclui o POLO', () => {
    const fn = metodo(EXTERNAS, '// ---- 1. participações em processos', '// ---- 2.');
    expect(fn).toContain('const chave = (x: { processoId: string; polo: string }) =>');
    expect(fn).toContain('jaTem.get(chave(linha))');
    // Sem par no mesmo polo, a linha é REPONTADA (o ramo de cima), não apagada.
    expect(fn).toContain('data: { parteExternaId: ficaId,');
  });
});

describe('a planilha não perde o que trouxe', () => {
  /**
   * O CPF é a única chave que vincula sozinha nesta base (o nome dos autos não
   * é o do cadastro). Sem filiado cadastrado, ele era descartado e a parte
   * entrava só com o nome — e no dia do cadastro a fila ofereceria palpite.
   */
  it('o CPF do autor é gravado mesmo sem filiado cadastrado', () => {
    expect(CSV).toContain('...(l.filiadoCpf ? { documento: l.filiadoCpf } : {})');
    expect(CSV).toContain('o CPF gravado na parte para casar quando o cadastro existir');
  });

  /** Casar pelo nome e devolver o id jogava fora o CNPJ da planilha. */
  it('a organização em branco ganha o documento da planilha', () => {
    const fn = metodo(CSV, 'private async acharOuCriarParte(', '\n  private ');
    expect(fn).toContain('if (!porNome.documento)');
    expect(fn).toContain('data: { documento: cnpj }');
    // Divergência não é sobrescrita: é dito na linha.
    expect(fn).toContain('já está cadastrada com outro documento');
  });

  /**
   * A linha de um NPU já cadastrado retornava ANTES de resolver réu, filiado e
   * equipe — tudo o que a planilha trazia de vínculo era jogado fora com um
   * "já cadastrado". E completar um filiado é o motivo nº 1 de rodar de novo.
   */
  it('o processo já cadastrado também recebe réu, filiado e equipe', () => {
    expect(CSV_UTIL).toContain("'REU' | 'FILIADO' | 'EQUIPE'");
    expect(CSV_UTIL).toContain("if (l.reus.length && atual.temReu === false) faltas.push('REU')");
    expect(CSV_UTIL).toContain("if (l.filiadoCpf && atual.temFiliado === false) faltas.push('FILIADO')");
    const fn = metodo(CSV, 'private async completarExistente(', '\n  private ');
    expect(fn).toContain("faltas.includes('REU')");
    expect(fn).toContain("faltas.includes('FILIADO')");
    expect(fn).toContain("faltas.includes('EQUIPE')");
    // Pelos SERVIÇOS, nunca por escrita direta: são eles que sincronizam os
    // atalhos derivados, disparam o gatilho da equipe e auditam.
    expect(fn).toContain('this.partes.adicionar(');
    expect(fn).toContain('this.partes.definirAdvogados(');
  });

  /** A regra que torna isto seguro continua valendo: só o que está vazio. */
  it('e continua sem sobrescrever o que já existe', () => {
    const fn = metodo(CSV, 'private async completarExistente(', '\n  private ');
    expect(fn).toContain("if (!faltas.length) return 'JA_EXISTIA';");
  });
});

describe('o atalho do responsável nasce igual à fonte', () => {
  /**
   * `advogadoId: dto.advogadoId || null`. Com só a EQUIPE informada, a fonte
   * grava `principal: true` no primeiro e o atalho nascia NULO — e os robôs
   * leem o atalho.
   */
  it('sem responsável explícito, o primeiro da equipe assume nos dois lados', () => {
    const ocorrencias = PROCESSOS.split('advogadoId: dto.advogadoId || dto.advogadosIds?.[0] || null,').length - 1;
    // Os dois caminhos de criação: com DataJud e sem.
    expect(ocorrencias).toBe(2);
  });
});
