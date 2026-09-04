import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Observable, tap } from 'rxjs';

import { diferencaDeCampos, fraseDaAlteracao } from './audit.diff';
import {
  comContextoDeAuditoria, jaFoiAuditadoPeloServico,
  marcarAuditadoPeloServico, marcarNadaMudou,
} from './audit.contexto';

const ler = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const lerCodigo = (rel: string) =>
  ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "DR. MURILO ALTEROU." ALTEROU O QUÊ?
 *
 * A auditoria dizia o verbo e parava. Sem o "de → para" ninguém consegue
 * conferir uma alteração, nem desfazê-la, nem saber se foi a que se pediu.
 */
describe('a diferença entre o que era e o que ficou', () => {
  it('lista só o que mudou de verdade', () => {
    const d = diferencaDeCampos(
      { cidade: 'BOM JESUS', estado: 'PI', email: 'a@b.c' },
      { cidade: 'TERESINA', estado: 'PI' },
    );
    expect(d).toEqual([
      { campo: 'cidade', label: 'Cidade', de: 'BOM JESUS', para: 'TERESINA' },
    ]);
  });

  /**
   * PATCH PARCIAL NÃO AFIRMA NADA sobre o que omitiu. Comparar o registro
   * inteiro encheria o log de linhas "de X para X".
   */
  it('ignora campo que o formulário não enviou', () => {
    const d = diferencaDeCampos({ cidade: 'A', email: 'x@y.z' }, { cidade: 'B', email: undefined });
    expect(d.map((x) => x.campo)).toEqual(['cidade']);
  });

  /** `null` e `''` são a mesma ausência — trocar um pelo outro não é edição. */
  it('não inventa alteração entre vazio e nulo', () => {
    expect(diferencaDeCampos({ local: null }, { local: '' })).toEqual([]);
    expect(diferencaDeCampos({ local: '' }, { local: null })).toEqual([]);
  });

  /** Mas sair do vazio para um valor É uma alteração, e das mais consultadas. */
  it('preencher um campo vazio conta', () => {
    const d = diferencaDeCampos({ local: null }, { local: 'Sala 2' });
    expect(d).toEqual([{ campo: 'local', label: 'Local', de: null, para: 'Sala 2' }]);
  });

  it('trata lista como conjunto ordenado', () => {
    expect(diferencaDeCampos({ etiquetas: ['B', 'A'] }, { etiquetas: ['A', 'B'] })).toEqual([]);
    const d = diferencaDeCampos({ etiquetas: ['A'] }, { etiquetas: ['A', 'B'] });
    expect(d[0]).toEqual({ campo: 'etiquetas', label: 'Etiquetas', de: ['A'], para: ['A', 'B'] });
  });

  /** Relação inteira (vínculos, dependentes) não cabe num "de → para". */
  it('não tenta diferenciar objeto aninhado', () => {
    expect(diferencaDeCampos({ vinculos: [] }, { vinculos: { create: [] } })).toEqual([]);
  });

  /**
   * O LOG É LIDO POR GENTE E EXPORTADO EM CSV, e guardado por anos. Hash de
   * senha ali é um problema de outra ordem. O campo aparece; o valor, não.
   */
  it('nunca põe senha, hash ou token no log', () => {
    const d = diferencaDeCampos(
      { senhaHash: 'antigo', tokenApi: 'abc' },
      { senhaHash: 'novo', tokenApi: 'xyz' },
    );
    // `senhaHash` está na lista fixa de ignorados; `tokenApi` cai na máscara.
    expect(d.map((x) => x.campo)).toEqual(['tokenApi']);
    expect(d[0].de).toBe('«oculto»');
    expect(d[0].para).toBe('«oculto»');
  });

  /**
   * DECIMAL DO PRISMA é objeto, e É um valor — uma CLASSE com `toString`, e não
   * um `{}`. Eu descartava "qualquer objeto" e com isso a alteração de valor da
   * causa vinda do banco sumiria do log sem aviso.
   */
  it('trata objeto-valor (Decimal) como valor, e objeto comum como relação', () => {
    class DecimalFalso {
      constructor(private readonly v: string) {}
      toString() { return this.v; }
    }
    const d = diferencaDeCampos({ valorCausa: null }, { valorCausa: new DecimalFalso('1234.56') });
    expect(d[0].para).toBe('1234.56');

    // `{}` continua fora: relação inteira não cabe num "de → para".
    expect(diferencaDeCampos({ vinculos: null }, { vinculos: { create: [] } })).toEqual([]);
  });

  /**
   * E O MESMO VALOR VINDO DOS DOIS TIPOS NÃO É ALTERAÇÃO. `valorCausa` sai do
   * banco como Decimal e volta do formulário como número JSON; com `===`,
   * reenviar o formulário sem editar gravaria "1234.56 → 1234.56".
   */
  it('não acusa mudança quando só o tipo difere', () => {
    class DecimalFalso {
      constructor(private readonly v: string) {}
      toString() { return this.v; }
    }
    expect(diferencaDeCampos({ valorCausa: new DecimalFalso('1234.56') }, { valorCausa: 1234.56 }))
      .toEqual([]);
  });

  it('a data vira ISO dos dois lados', () => {
    const d = diferencaDeCampos(
      { inicio: new Date('2026-09-04T14:00:00.000Z') },
      { inicio: new Date('2026-09-05T14:00:00.000Z') },
    );
    expect(d[0].de).toBe('2026-09-04T14:00:00.000Z');
    expect(d[0].para).toBe('2026-09-05T14:00:00.000Z');
  });
});

/**
 * A FRASE CITA OS CAMPOS — é o que responde a pergunta já na lista, sem abrir
 * o detalhe.
 */
describe('a frase da alteração', () => {
  const alt = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      campo: `c${i}`, label: `Campo ${i}`, de: 'a', para: 'b',
    }));

  it('um campo', () => {
    expect(fraseDaAlteracao('Cadastro de MARIA alterado', alt(1)))
      .toBe('Cadastro de MARIA alterado — campo 0');
  });

  it('até três, enumera', () => {
    expect(fraseDaAlteracao('X', alt(3))).toBe('X — campo 0, campo 1 e campo 2');
  });

  /** Acima de três a enumeração vira parede numa lista de quarenta linhas. */
  it('acima de três, conta', () => {
    expect(fraseDaAlteracao('X', alt(5))).toBe('X — 5 campos (campo 0, campo 1, campo 2…)');
  });

  it('e diz quando nada mudou', () => {
    expect(fraseDaAlteracao('X', [])).toBe('X — nada mudou');
  });
});

/**
 * O ESCOPO PRECISA ENVOLVER O HANDLER — e no interceptor ele NÃO envolvia.
 *
 * Eu abri o `AsyncLocalStorage.run()` dentro do `intercept()` e afirmei, em
 * commit, que a duplicação tinha acabado. Não tinha: `next.handle()` devolve um
 * Observable FRIO, e o handler só corre quando o Nest se inscreve — depois de
 * `intercept()` ter retornado, fora do `run()`. Medido com a API rodando: uma
 * edição gerava DOIS registros.
 *
 * Estes dois testes reproduzem exatamente essa diferença, sem Nest.
 */
describe('onde o escopo da requisição precisa ser aberto', () => {
  /** O padrão ANTIGO: abrir no intercept e devolver o Observable. */
  it('abrir em volta de um Observable frio NÃO propaga', () => {
    const frio = new Observable<string>((sub) => { sub.next('handler'); sub.complete(); });
    let viuDentroDoHandler: boolean | null = null;

    const comoOInterceptorFazia = comContextoDeAuditoria(() =>
      frio.pipe(tap(() => { /* o tap corre na inscrição */ })),
    );

    // A inscrição acontece AQUI, fora do `run()` — é o que o Nest faz.
    comoOInterceptorFazia.subscribe(() => {
      marcarAuditadoPeloServico();
      viuDentroDoHandler = jaFoiAuditadoPeloServico();
    });

    expect(viuDentroDoHandler).toBe(false);
  });

  /** O padrão NOVO: o middleware chama `next()` dentro do escopo. */
  it('abrir em volta da chamada seguinte propaga', () => {
    let viu: boolean | null = null;
    const next = () => {
      marcarAuditadoPeloServico();
      viu = jaFoiAuditadoPeloServico();
    };
    comContextoDeAuditoria(() => next());
    expect(viu).toBe(true);
  });

  /** Também atravessa `await` — o serviço está a várias camadas de distância. */
  it('sobrevive a await', async () => {
    let viu: boolean | null = null;
    await new Promise<void>((pronto) => {
      comContextoDeAuditoria(async () => {
        await Promise.resolve();
        marcarAuditadoPeloServico();
        await new Promise((r) => setTimeout(r, 1));
        viu = jaFoiAuditadoPeloServico();
        pronto();
      });
    });
    expect(viu).toBe(true);
  });

  /**
   * "OLHEI E NÃO HÁ O QUE REGISTRAR" também cala o interceptor. Salvar o
   * formulário sem mudar nada gerava "Mexeu no cadastro de um filiado" — que
   * é o registro mais inútil possível: diz que alguém mexeu quando ninguém
   * mexeu em nada.
   */
  it('decidir não registrar também cala o último recurso', () => {
    let viu: boolean | null = null;
    comContextoDeAuditoria(() => {
      marcarNadaMudou();
      viu = jaFoiAuditadoPeloServico();
    });
    expect(viu).toBe(true);
  });

  it('e fora de qualquer requisição não trava nada', () => {
    expect(() => marcarAuditadoPeloServico()).not.toThrow();
    expect(jaFoiAuditadoPeloServico()).toBe(false);
  });
});

describe('a fiação do escopo', () => {
  it('o middleware existe e chama next dentro do escopo', () => {
    const MID = lerCodigo('audit.contexto.middleware.ts');
    expect(MID).toContain('comContextoDeAuditoria(() => next());');
  });

  it('e está aplicado a todas as rotas', () => {
    const APP = lerCodigo('../../app.module.ts');
    expect(APP).toContain('consumer.apply(AuditContextoMiddleware).forRoutes(\'*\');');
  });

  /** O interceptor não abre mais escopo nenhum — ele só lê a marca. */
  it('o interceptor deixou de abrir o escopo', () => {
    const INT = lerCodigo('audit.interceptor.ts');
    expect(INT).not.toContain('comContextoDeAuditoria');
    expect(INT).toContain('if (jaFoiAuditadoPeloServico()) return;');
  });
});
