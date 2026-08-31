import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { areaSugerida, areaSugeridaValida } from './area-sugerida.util';
import { AREAS_JURIDICAS } from '../areas.catalogo';

/**
 * A ÁREA JURÍDICA DE 42 PROCESSOS ESTAVA EM BRANCO — UM TERÇO DA BASE.
 *
 * E a informação já estava lá, espalhada em campos que o DataJud preenche
 * sozinho. Estes casos protegem a regra que a extrai, e sobretudo a ORDEM dela:
 * foi a ordem que eu errei na primeira tentativa.
 */
describe('área deduzida — a convenção da base', () => {
  /**
   * A TABELA MEDIDA na produção de 31/08/2026, entre os 85 processos já
   * classificados por gente. Zero contraexemplos para cada linha.
   */
  it.each([
    ['TRT22', 'INSTITUCIONAL', false, 'SINDICAL_COLETIVO'],
    ['TST', 'INSTITUCIONAL', false, 'SINDICAL_COLETIVO'],
    ['TRT22', 'INDIVIDUAL', false, 'TRABALHISTA'],
    ['TJPI', 'INSTITUCIONAL', true, 'ADMINISTRATIVO'],
    ['TJPI', 'INDIVIDUAL', true, 'ADMINISTRATIVO'],
    ['TRF1', 'INSTITUCIONAL', true, 'ADMINISTRATIVO'],
  ])('%s + %s (réu público: %s) -> %s', (tribunal, tipoAcao, reuPublico, esperado) => {
    expect(areaSugerida({ tribunal, tipoAcao, reuPublico })?.slug).toBe(esperado);
  });

  /**
   * O ERRO QUE ESTE CASO IMPEDE DE VOLTAR.
   *
   * A primeira versão punha a forma COLETIVA acima do ramo da Justiça: "Ação
   * Civil Coletiva" e "Mandado de Segurança Coletivo" viravam SINDICAL_COLETIVO
   * mesmo no TJPI. Teria classificado nove processos ao contrário do que a base
   * inteira pratica — ADMINISTRATIVO em 26 casos, sem exceção. Seria defensável
   * em tese e errado na prática, porque faria o campo significar coisas
   * diferentes conforme a data em que o registro entrou.
   *
   * A convenção é coerente: a área é a MATÉRIA, não o rito. Que a ação seja
   * coletiva aparece no selo institucional e na etiqueta da classe.
   */
  it.each(['Ação Civil Coletiva', 'Mandado de Segurança Coletivo', 'Ação Civil Pública'])(
    '"%s" no TJPI contra o poder público é ADMINISTRATIVO, não SINDICAL_COLETIVO',
    (classeProcessual) => {
      const d = areaSugerida({
        tribunal: 'TJPI', classeProcessual, tipoAcao: 'INSTITUCIONAL', reuPublico: true,
      });
      expect(d?.slug).toBe('ADMINISTRATIVO');
    },
  );
});

describe('área deduzida — o que ela se recusa a adivinhar', () => {
  /**
   * Sem órgão público no polo passivo, a Justiça comum não decide. Responder
   * "CIVEL" por eliminação seria errado com frequência: o réu pode apenas não
   * ter sido cadastrado ainda — existe fila para isso —, e aí a ausência não
   * prova nada. Cadastro incompleto virando dado errado é pior que o branco.
   */
  it('Justiça comum sem réu público não deduz', () => {
    expect(areaSugerida({ tribunal: 'TJPI', tipoAcao: 'INDIVIDUAL', reuPublico: false })).toBeNull();
  });

  it('sem tribunal e sem assunto, não deduz', () => {
    expect(areaSugerida({})).toBeNull();
    expect(areaSugerida({ classeProcessual: 'Procedimento Comum Cível' })).toBeNull();
  });

  it('tribunal desconhecido não deduz', () => {
    expect(areaSugerida({ tribunal: 'TRIBUNAL DE ALGUM LUGAR', tipoAcao: 'INDIVIDUAL' })).toBeNull();
  });
});

/**
 * Os dois casos em que o ramo do tribunal ENGANA — e por isso o assunto é lido
 * antes de tudo.
 */
describe('área deduzida — quando o assunto manda', () => {
  it('aposentadoria é previdenciário mesmo no TRT', () => {
    const d = areaSugerida({ tribunal: 'TRT22', assuntoPrincipal: 'Aposentadoria por invalidez', tipoAcao: 'INDIVIDUAL' });
    expect(d?.slug).toBe('PREVIDENCIARIO');
  });

  it('processo do conselho é ético-disciplinar mesmo na Justiça comum', () => {
    const d = areaSugerida({ tribunal: 'TJPI', assuntoPrincipal: 'Conselho Regional de Enfermagem', reuPublico: true });
    expect(d?.slug).toBe('ETICO_DISCIPLINAR');
  });

  it('o assunto vence até a ação institucional no TRT', () => {
    const d = areaSugerida({ tribunal: 'TRT22', tipoAcao: 'INSTITUCIONAL', assuntoPrincipal: 'Pensão por morte' });
    expect(d?.slug).toBe('PREVIDENCIARIO');
  });
});

describe('integridade', () => {
  it('todo slug deduzido existe no catálogo', () => {
    const casos = [
      { tribunal: 'TRT22', tipoAcao: 'INSTITUCIONAL' },
      { tribunal: 'TRT22', tipoAcao: 'INDIVIDUAL' },
      { tribunal: 'TJPI', reuPublico: true },
      { tribunal: 'TRT22', assuntoPrincipal: 'Aposentadoria' },
      { tribunal: 'TJPI', assuntoPrincipal: 'Conselho Regional', reuPublico: true },
    ];
    for (const c of casos) {
      const d = areaSugerida(c);
      expect(`${JSON.stringify(c)} -> ${areaSugeridaValida(d)}`).toBe(`${JSON.stringify(c)} -> true`);
      expect(AREAS_JURIDICAS.some((a) => a.slug === d!.slug)).toBe(true);
    }
  });

  it('sempre explica o porquê — é o texto que vai para o histórico', () => {
    const d = areaSugerida({ tribunal: 'TRT22', tipoAcao: 'INSTITUCIONAL' });
    expect(d?.porque).toContain('TRT22');
    expect(d!.porque.length).toBeGreaterThan(15);
  });

  /** Deduzir só o vazio: a classificação de uma pessoa vale mais. */
  it('o serviço só deduz quando `categoria` está nula', () => {
    const svc = readFileSync(path.join(__dirname, '..', 'processos.service.ts'), 'utf8');
    const fn = svc.slice(svc.indexOf('private async deduzirAreaJuridica('));
    expect(fn).toContain('if (!p || p.categoria) return;');
    // E a nota que registra a dedução é do sistema — não reordena a lista.
    expect(fn.slice(0, 2600)).toContain('origemSistema: true');
  });
});
