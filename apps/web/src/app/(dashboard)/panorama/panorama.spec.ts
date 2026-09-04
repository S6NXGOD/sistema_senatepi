import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { LEITURA, resumoDesfechos, tendencia } from '@/lib/panorama';
import { moduloDaRota } from '@/components/nav-items';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const PAGINA = ler('app/(dashboard)/panorama/page.tsx');
const LISTAGEM = ler('app/(dashboard)/processos/page.tsx');
const FICHAS = ler('components/processos/painel-de-filtros.tsx');

/**
 * PANORAMA DO ACERVO — a tela que soma os processos em vez de lê-los um a um.
 *
 * O risco desta funcionalidade nunca foi técnico: é ela começar a opinar. Um
 * painel que diz "ajuíze uma coletiva" com base em três linhas de banco está
 * palpitando sobre o ofício de quem lê, e basta errar uma vez para virar ruído
 * ignorado. Os testes abaixo guardam essa fronteira.
 */
describe('a leitura em português', () => {
  it('cada padrão tem título, explicação e tom', () => {
    for (const slug of [
      'DESFECHO_SEMPRE_CONTRA',
      'DESFECHO_SEMPRE_A_FAVOR',
      'COLETIVA_POSSIVEL',
      'REINCIDENCIA',
    ] as const) {
      expect(LEITURA[slug].titulo.length).toBeGreaterThan(10);
      expect(LEITURA[slug].explicacao.length).toBeGreaterThan(40);
      expect(['alerta', 'favoravel', 'neutro']).toContain(LEITURA[slug].tom);
    }
  });

  /**
   * NENHUMA FRASE MANDA FAZER. "Vale rever", "é uma decisão de quem conduz",
   * "é o histórico que se leva" — todas terminam devolvendo a escolha. Imperativo
   * jurídico ("ajuíze", "proponha", "desista") é o que este teste barra.
   */
  it('nenhuma explicação dá ordem jurídica', () => {
    const proibido = /\b(ajuíze|ajuizar já|proponha|desista|abandone|recorra|não ajuíze)\b/i;
    for (const l of Object.values(LEITURA)) {
      expect(l.titulo).not.toMatch(proibido);
      expect(l.explicacao).not.toMatch(proibido);
    }
  });

  /** Tom errado engana mais que texto errado: alerta é só para desfecho contra. */
  it('só o desfecho contrário usa o tom de alerta', () => {
    expect(LEITURA.DESFECHO_SEMPRE_CONTRA.tom).toBe('alerta');
    expect(LEITURA.DESFECHO_SEMPRE_A_FAVOR.tom).toBe('favoravel');
    expect(LEITURA.COLETIVA_POSSIVEL.tom).toBe('neutro');
    expect(LEITURA.REINCIDENCIA.tom).toBe('neutro');
  });
});

describe('resumo dos desfechos', () => {
  it('não inventa estatística sobre amostra vazia', () => {
    expect(resumoDesfechos({ julgados: 0, procedentes: 0, parciais: 0, improcedentes: 0 })).toBeNull();
  });

  it('conta o que existe, sem porcentagem', () => {
    const texto = resumoDesfechos({
      julgados: 7,
      procedentes: 0,
      parciais: 7,
      improcedentes: 0,
    });
    expect(texto).toBe('7 já julgadas: 7 procedentes em parte');
    expect(texto).not.toMatch(/%/);
  });

  it('faz concordância no singular', () => {
    expect(
      resumoDesfechos({ julgados: 1, procedentes: 1, parciais: 0, improcedentes: 0 }),
    ).toBe('1 já julgada: 1 procedente');
  });
});

/**
 * ATALHO QUE MUDA O NÚMERO AO SER CLICADO É PIOR QUE ATALHO NENHUM.
 *
 * O cartão de dispersão conta os processos em que o assunto aparece em QUALQUER
 * posição — das 24 vezes que "Piso Salarial da Categoria" aparece no acervo, só
 * 11 são como assunto principal. Um link para a busca livre mostraria menos da
 * metade, e quem clicasse concluiria que o painel mente.
 */
describe('os links levam ao mesmo conjunto que o cartão contou', () => {
  it('a dispersão usa o filtro exato de assunto', () => {
    expect(PAGINA).toContain('href={`/processos?assunto=${encodeURIComponent(d.assunto)}`}');
    expect(PAGINA).not.toContain('/processos?busca=');
  });

  it('a concentração usa o filtro por parte', () => {
    expect(PAGINA).toContain('href={`/processos?parteExternaId=${c.parteExternaId}`}');
  });

  it('a listagem lê os dois parâmetros da URL', () => {
    // Regex, e não texto literal: o arquivo é CRLF e a quebra não casaria.
    expect(LISTAGEM).toMatch(/useFiltroPorUrl\(\s*'parteExternaId',/);
    expect(LISTAGEM).toMatch(/useFiltroPorUrl\('assunto', \(valor\) => setAssunto/);
  });

  /** Filtro ligado sem ficha visível vira "só aparecem 3 processos" sem porquê. */
  it('o assunto filtrado aparece como ficha removível', () => {
    expect(FICHAS).toContain('rotulo="Assunto"');
    expect(LISTAGEM).toContain("if (campo === 'assunto') { setAssunto(''); return; }");
  });

  it('a rota é permissionada pelo módulo de processos', () => {
    expect(moduloDaRota('/panorama')).toBe('processos');
  });
});

/**
 * O painel diz QUEM; o panorama diz o quê e como tem sido julgado. Sem o link
 * entre os dois, a tela nova depende de alguém lembrar que ela existe.
 */
describe('a home aponta para o panorama', () => {
  it('o bloco "Contra quem litigamos" leva para lá', () => {
    const HOME = ler('app/(dashboard)/dashboard/page.tsx');
    const bloco = HOME.slice(HOME.indexOf('function AdversariosRecorrentes('));
    expect(bloco.slice(0, 1600)).toContain('actionHref="/panorama"');
  });

  it('a tela desenha a barra de desfechos e as colunas por ano', () => {
    expect(PAGINA).toContain('function BarraDeDesfechos(');
    expect(PAGINA).toContain('function ColunasPorAno(');
    expect(PAGINA).toContain('<BarraDeDesfechos d={c} />');
    expect(PAGINA).toContain('<ColunasPorAno serie={d.porAno} />');
  });
});

/**
 * OS VISUAIS NÃO PODEM MENTIR — é o único motivo de eles existirem em vez de
 * uma frase.
 */
describe('a leitura de tendência', () => {
  /**
   * A série termina no ANO PASSADO — anos fechados. Ancorar no ano corrente em
   * vez de escrever 2021 fixo evita o teste começar a falhar sozinho na virada
   * do ano, e deixa explícito qual janela cada caso está exercitando.
   */
  const fechados = (...n: number[]) => {
    const ultimo = new Date().getFullYear() - 1;
    return n.map((processos, i) => ({ ano: ultimo - n.length + 1 + i, processos }));
  };

  /** Menos de quatro anos fechados não sustenta comparação de biênios. */
  it('cala com série curta', () => {
    expect(tendencia(fechados(1, 2, 3))).toBeNull();
    expect(tendencia([])).toBeNull();
  });

  it('acha crescimento quando o biênio recente é ao menos 50% maior', () => {
    // Biênio anterior soma 2; o recente soma 6.
    expect(tendencia(fechados(1, 1, 3, 3))).toBe('CRESCENDO');
  });

  it('acha queda no sentido inverso', () => {
    expect(tendencia(fechados(4, 4, 1, 1))).toBe('DIMINUINDO');
  });

  /** Variação pequena não é movimento: uma seta em todo cartão é enfeite. */
  it('cala quando a variação é pequena', () => {
    expect(tendencia(fechados(3, 3, 3, 4))).toBeNull();
  });

  /**
   * O ANO CORRENTE FICA DE FORA. Ele está pela metade, e em janeiro puxaria
   * qualquer série para "diminuindo" — aqui ele vem com zero e não muda nada.
   */
  it('ignora o ano corrente', () => {
    const serie = [...fechados(1, 1, 3, 3), { ano: new Date().getFullYear(), processos: 0 }];
    expect(tendencia(serie)).toBe('CRESCENDO');
  });

  /** Amostra minúscula não vira leitura, mesmo com proporção grande. */
  it('cala com amostra pequena demais', () => {
    expect(tendencia(fechados(0, 1, 1, 1))).toBeNull();
  });
});
