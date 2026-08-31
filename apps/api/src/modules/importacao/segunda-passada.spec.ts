import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  avisoDeCompletar,
  oQueCompletar,
  type EstadoNoBanco,
  type LinhaProcesso,
} from './processos-csv.util';

/**
 * A SEGUNDA PASSADA DA PLANILHA.
 *
 * O caso real, 31/08/2026: os 82 processos já estavam cadastrados, mas 124
 * processos seguiam sem área jurídica e os 82 andamentos escritos pelo jurídico
 * nunca tinham entrado. A planilha trazia as duas coisas. E a tela não deixava
 * subir: o botão calculava `validos - jaCadastrados`, dava zero, e desabilitava
 * — travando exatamente o caminho que existia para resolver.
 */
const linha = (extra: Partial<LinhaProcesso> = {}): LinhaProcesso =>
  ({
    linha: 2,
    npu: '00011936620215220005',
    poloAtivo: 'INSTITUCIONAL',
    poloAtivoNome: '',
    filiadoNome: '',
    filiadoCpf: '',
    reus: [],
    advogadoEmail: '',
    equipeEmails: [],
    categoria: 'SINDICAL_COLETIVO',
    etiquetas: ['Insalubridade'],
    andamento: 'Sentença de procedência. Aguarda R.O.',
    andamentoData: '2026-08-15',
    erros: [],
    avisos: [],
    ...extra,
  }) as LinhaProcesso;

const banco = (extra: Partial<EstadoNoBanco> = {}): EstadoNoBanco => ({
  categoria: null,
  etiquetas: [],
  andamentos: [],
  ...extra,
});

describe('o que ainda falta num processo já cadastrado', () => {
  it('processo cru: falta tudo o que a planilha traz', () => {
    expect(oQueCompletar(banco(), linha())).toEqual(['CATEGORIA', 'ETIQUETAS', 'ANDAMENTO']);
  });

  it('processo completo: nada a fazer', () => {
    const atual = banco({
      categoria: 'SINDICAL_COLETIVO',
      etiquetas: ['Insalubridade'],
      andamentos: ['Sentença de procedência. Aguarda R.O.'],
    });
    expect(oQueCompletar(atual, linha())).toEqual([]);
  });

  /**
   * NUNCA SOBRESCREVE. Se alguém corrigiu a área na ficha depois da primeira
   * carga, subir a planilha de novo não pode desfazer o trabalho — a planilha
   * é fonte auxiliar, a ficha é a fonte.
   */
  it('não toca na categoria que já existe, mesmo divergindo da planilha', () => {
    const atual = banco({ categoria: 'ADMINISTRATIVO' });
    expect(oQueCompletar(atual, linha())).not.toContain('CATEGORIA');
  });

  it('etiqueta nova entra; etiqueta repetida, não', () => {
    expect(oQueCompletar(banco({ etiquetas: ['Insalubridade'] }), linha())).not.toContain('ETIQUETAS');
    expect(oQueCompletar(banco({ etiquetas: ['Outra'] }), linha())).toContain('ETIQUETAS');
  });

  /** Rodar a planilha três vezes não pode empilhar o mesmo andamento 3x. */
  it('o andamento idêntico não entra de novo', () => {
    const atual = banco({ andamentos: ['Sentença de procedência. Aguarda R.O.'] });
    expect(oQueCompletar(atual, linha())).not.toContain('ANDAMENTO');
  });

  it('linha sem andamento não inventa pendência', () => {
    expect(oQueCompletar(banco(), linha({ andamento: '' }))).not.toContain('ANDAMENTO');
  });

  it('linha sem categoria não inventa pendência', () => {
    expect(oQueCompletar(banco(), linha({ categoria: '' }))).not.toContain('CATEGORIA');
  });
});

describe('o aviso que a prévia mostra', () => {
  it('lista o que a linha vai ganhar, em português', () => {
    expect(avisoDeCompletar(['CATEGORIA', 'ETIQUETAS', 'ANDAMENTO'])).toBe(
      'Já cadastrado — será completado: área jurídica, etiquetas e andamento do jurídico.',
    );
  });

  it('com uma pendência só, não usa vírgula nem "e"', () => {
    expect(avisoDeCompletar(['CATEGORIA'])).toBe('Já cadastrado — será completado: área jurídica.');
  });

  /**
   * O texto ANTIGO era "Já cadastrado — esta linha será pulada". Virou mentira
   * quando a segunda passada ganhou o `completarExistente`, e foi essa mentira
   * que se propagou até o botão desabilitado.
   */
  it('não promete mais que a linha será pulada', () => {
    for (const f of [[], ['CATEGORIA'], ['ANDAMENTO']] as const) {
      expect(avisoDeCompletar([...f])).not.toMatch(/pulada/);
    }
  });
});

/**
 * O ANDAMENTO SEM DATA NÃO PODE CARIMBAR O ACERVO COM "HOJE".
 *
 * O acervo real veio com `andamento_data` VAZIO nas 82 linhas: a planilha do
 * jurídico registrava a SITUAÇÃO ("Sentença de procedência. Aguarda R.O."), não
 * a data em que ela mudou.
 *
 * Isso quase produziu um estrago silencioso. O gatilho de `ultimo_movimento_em`
 * usa `COALESCE(data_fato, created_at)`, e a ordenação padrão da lista de
 * processos é por essa coluna. Oitenta e duas notas gravadas na mesma tarde,
 * todas sem data, carimbariam o acervo inteiro com a data de hoje — a lista que
 * existe para mostrar "o que se mexeu" mostraria tudo, que é o mesmo que nada.
 */
describe('andamento sem data na planilha', () => {
  const SERVICE = readFileSync(path.join(__dirname, 'processos-csv.service.ts'), 'utf8');
  const UTIL = readFileSync(path.join(__dirname, 'processos-csv.util.ts'), 'utf8');

  it('a nota se ancora no último fato conhecido, não em `now()`', () => {
    expect(SERVICE).toContain('const dataFato = l.andamentoData');
    expect(SERVICE).toContain(': processo.ultimoMovimentoEm;');
  });

  /**
   * O gatilho só AVANÇA (`GREATEST`). Ancorar no valor que a coluna já tem é,
   * por construção, um no-op — e é isso que torna a garantia estrutural, e não
   * uma coincidência que a próxima alteração desfaz.
   */
  it('a leitura traz `ultimoMovimentoEm` para poder ancorar', () => {
    const fn = SERVICE.slice(SERVICE.indexOf('private async registrarAndamento('));
    expect(fn.slice(0, 400)).toContain('ultimoMovimentoEm: true');
  });

  it('a nota registra QUEM subiu a planilha', () => {
    expect(SERVICE).toContain('autorId: autorId ?? null,');
    expect(SERVICE).toContain('this.registrarAndamento(l, ctx.userId)');
  });

  /** O aviso antigo prometia o comportamento errado — tinha de mudar junto. */
  it('a prévia não promete mais que a nota sobe o processo', () => {
    expect(UTIL).not.toContain('sobe o processo na lista');
    expect(UTIL).toContain('ancorada no último andamento conhecido');
  });
});
