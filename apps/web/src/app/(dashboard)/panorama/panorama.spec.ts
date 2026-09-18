import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  LEITURA, desfechosParaLer, duracaoEmPalavras, julgadasNoHistorico, ressalvaDoRecurso,
  resumoDesfechos, rotuloDoAno, tendencia,
} from '@/lib/panorama';
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
   * NENHUMA FRASE MANDA FAZER. Imperativo jurídico ("ajuíze", "proponha",
   * "desista") é o que este teste barra.
   */
  it('nenhuma explicação dá ordem jurídica', () => {
    const proibido = /\b(ajuíze|ajuizar já|proponha|desista|abandone|recorra|não ajuíze)\b/i;
    for (const l of Object.values(LEITURA)) {
      expect(l.titulo).not.toMatch(proibido);
      expect(l.explicacao).not.toMatch(proibido);
    }
  });

  /**
   * NEM CONSELHO DISFARÇADO. Este bloco já aceitou "Vale rever a tese antes da
   * próxima" e "é o histórico mais forte que se leva para uma mesa de
   * negociação": não eram imperativo, mas eram estratégia — e desde o PDF do
   * Panorama saem no papel com o logo do sindicato, como posição da casa
   * (auditoria panorama-pdf, 13/09/2026). Mira o OBJETO importado, e não o
   * fonte, para não bater em comentário.
   */
  it('nenhuma explicação aconselha', () => {
    const conselho = /(^|[^\p{L}])(vale rever|deve|devem|deveria|recomend\p{L}*|suger\p{L}*|sugere|é preciso)(?![\p{L}])/iu;
    for (const l of Object.values(LEITURA)) {
      expect(l.titulo).not.toMatch(conselho);
      expect(l.explicacao).not.toMatch(conselho);
    }
  });

  /** O teste de cima pega o que ele promete: sem isso, uma regex quebrada ficaria verde. */
  it('a varredura de conselho reconhece as frases antigas', () => {
    const conselho = /(^|[^\p{L}])(vale rever|deve|devem|deveria|recomend\p{L}*|suger\p{L}*|sugere|é preciso)(?![\p{L}])/iu;
    expect('Vale rever a tese antes da próxima.').toMatch(conselho);
    expect('A entidade deve negociar.').toMatch(conselho);
    expect('É preciso ajuizar.').toMatch(conselho);
    // "devedor" não é "deve": a palavra inteira é que conta.
    expect('O devedor foi citado.').not.toMatch(conselho);
  });

  /**
   * "SEMPRE" SÓ SEM RECURSO DEPOIS. A API suprime as duas leituras quando algum
   * julgado teve acórdão depois da sentença (49 de 109 na produção); o texto diz
   * isso, para quem lê o selo não tomar sentença por resultado final.
   */
  it('as leituras de resultado uniforme dizem que não houve recurso julgado depois', () => {
    expect(LEITURA.DESFECHO_SEMPRE_CONTRA.explicacao).toContain('sem recurso julgado depois');
    expect(LEITURA.DESFECHO_SEMPRE_A_FAVOR.explicacao).toContain('sem recurso julgado depois');
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
  /*
    E COM O MESMO STATUS. Este bloco travava o link sem `status=ATIVO` — provava
    o filtro e não o conjunto: o cartão conta o acervo ativo, e a lista abria
    com os encerrados junto (medido em 12/09/2026). Ver `links-do-panorama.spec`.
  */
  it('a dispersão usa o filtro exato de assunto', () => {
    expect(PAGINA).toContain(
      'href={`/processos?assunto=${encodeURIComponent(d.assunto)}&status=ATIVO`}',
    );
    expect(PAGINA).not.toContain('/processos?busca=');
  });

  it('a concentração usa o filtro por parte', () => {
    expect(PAGINA).toContain('href={`/processos?parteExternaId=${c.parteExternaId}&status=ATIVO`}');
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

  /** O ano corrente vem de fora: o plano do PDF é puro e não muda na virada do ano. */
  it('aceita o ano corrente como parâmetro', () => {
    const serie = [
      { ano: 2022, processos: 1 }, { ano: 2023, processos: 1 },
      { ano: 2024, processos: 3 }, { ano: 2025, processos: 3 }, { ano: 2026, processos: 9 },
    ];
    // Com 2026 corrente, fechados são 2022–2025: 2 contra 6.
    expect(tendencia(serie, 2026)).toBe('CRESCENDO');
    // Com 2025 corrente, só três fechados: sem base.
    expect(tendencia(serie, 2025)).toBeNull();
  });
});

/**
 * DUAS PERGUNTAS QUE NÃO SE MISTURAM — quantas estão em curso (o que o link
 * abre) e como as ajuizadas têm sido julgadas (o que a barra desenha).
 */
describe('o histórico dos desfechos', () => {
  const ativas = { julgados: 2, procedentes: 1, parciais: 0, improcedentes: 1 };
  const historico = { julgados: 9, procedentes: 3, parciais: 4, improcedentes: 2, comRecursoDepois: 3 };

  it('a barra lê o histórico quando a API manda', () => {
    expect(desfechosParaLer({ ...ativas, historico })).toEqual(historico);
  });

  /** Janela de troca do deploy: a API antiga só tem as ativas, e nada de recurso inventado. */
  it('sem histórico, as ativas entram no lugar e nenhum recurso é contado', () => {
    expect(desfechosParaLer(ativas)).toEqual({ ...ativas, comRecursoDepois: 0 });
  });

  it('"julgadas no histórico" só quando o histórico existe', () => {
    expect(julgadasNoHistorico({ historico })).toBe('9 julgadas no histórico');
    expect(julgadasNoHistorico({ historico: { ...historico, julgados: 1 } })).toBe('1 julgada no histórico');
    expect(julgadasNoHistorico({ historico: { ...historico, julgados: 0 } })).toBe('nenhuma julgada no histórico');
    expect(julgadasNoHistorico({})).toBeNull();
  });

  it('a ressalva do recurso diz quantas, e cala sem recurso', () => {
    expect(ressalvaDoRecurso(historico)).toBe(
      '3 tiveram recurso julgado depois — o resultado final pode ser outro',
    );
    expect(ressalvaDoRecurso({ ...historico, comRecursoDepois: 1 })).toBe(
      '1 teve recurso julgado depois — o resultado final pode ser outro',
    );
    expect(ressalvaDoRecurso({ ...historico, comRecursoDepois: 0 })).toBeNull();
    expect(ressalvaDoRecurso(undefined)).toBeNull();
  });

  it('o ano corrente sai com "até agora"', () => {
    expect(rotuloDoAno(2026, 2026)).toBe('2026 (até agora)');
    expect(rotuloDoAno(2025, 2026)).toBe('2025');
  });

  /** O comentário do contrato dizia que os três papéis "somam o acervo" — não somam. */
  it('a tela nunca afirma que os números somam o acervo', () => {
    expect(PAGINA).not.toMatch(/somam o acervo/i);
  });

  it('a tela mostra a ressalva do recurso e o histórico', () => {
    expect(PAGINA).toContain('ressalvaDoRecurso(h)');
    expect(PAGINA).toContain('julgadasNoHistorico(c)');
    expect(PAGINA).toContain('julgadasNoHistorico(d)');
  });
});

/**
 * "1 PROCEDENTES" — a legenda da barra colava o número num rótulo fixo no
 * plural (18/09/2026). `resumoDesfechos` e `ressalvaDoRecurso` já flexionavam;
 * esta lista, escrita depois, não.
 */
describe('a legenda da barra concorda em número', () => {
  const BLOCO = PAGINA.slice(PAGINA.indexOf('"1 PROCEDENTES"'), PAGINA.indexOf('const ressalva ='));

  it('a fatia examinada não está vazia', () => {
    expect(BLOCO.length).toBeGreaterThan(300);
  });

  /**
   * O MESMO DEFEITO EM TRÊS LUGARES (18/09/2026). Depois da legenda, a tela
   * ainda dizia "3 ativas (1 individuais)" e "contra 1 partes contrárias
   * diferentes". Consertar um caminho não basta: procure os irmãos.
   */
  it('a contagem de individuais concorda em número', () => {
    expect(PAGINA).toContain("c.individuais === 1 ? 'individual' : 'individuais'");
    expect(PAGINA).toContain("d.individuais === 1 ? 'individual' : 'individuais'");
  });

  it('a contagem de ativas e de partes contrárias também', () => {
    expect(PAGINA).toContain("d.processos === 1 ? 'ativa' : 'ativas'");
    expect(PAGINA).toContain("c.processos === 1 ? 'ativa' : 'ativas'");
    expect(PAGINA).toContain("d.adversarios === 1 ? 'parte contrária'");
  });

  it('cada faixa tem singular e plural, e a escolha é pelo número', () => {
    expect(BLOCO).toContain("um: 'procedente'");
    expect(BLOCO).toContain("um: 'procedente em parte'");
    expect(BLOCO).toContain("um: 'improcedente'");
    expect(BLOCO).toContain('f.n === 1 ? f.um : f.varios');
  });
});

/**
 * QUANTO TEMPO ATÉ A SENTENÇA — "613 dias" é preciso e não cabe na cabeça de
 * ninguém. Quem lê quer saber se demora meses ou anos.
 */
describe('duracaoEmPalavras', () => {
  it('cala sem número', () => {
    expect(duracaoEmPalavras(null)).toBeNull();
    expect(duracaoEmPalavras(undefined)).toBeNull();
    expect(duracaoEmPalavras(-3)).toBeNull();
  });

  it('poucos dias saem em dias, e o singular é singular', () => {
    expect(duracaoEmPalavras(1)).toBe('cerca de 1 dia');
    expect(duracaoEmPalavras(20)).toBe('cerca de 20 dias');
  });

  it('de mês e meio a um ano sai em meses', () => {
    expect(duracaoEmPalavras(60)).toBe('cerca de 2 meses');
    expect(duracaoEmPalavras(300)).toBe('cerca de 10 meses');
  });

  it('acima de um ano sai em anos e meses', () => {
    expect(duracaoEmPalavras(365)).toBe('cerca de 1 ano');
    expect(duracaoEmPalavras(613)).toBe('cerca de 1 ano e 8 meses');
    expect(duracaoEmPalavras(760)).toBe('cerca de 2 anos e 1 mês');
  });

  /** Arredondar é deliberado: mediana de três casos não merece precisão de dias. */
  it('o "cerca de" nunca sai da frase', () => {
    for (const d of [10, 90, 400, 2000]) expect(duracaoEmPalavras(d)).toContain('cerca de');
  });
});

/**
 * OS TRÊS CARTÕES NÃO COBREM O ACERVO, e a tela precisa dizer em vez de deixar
 * a subtração para quem lê — o rodapé anuncia o total logo abaixo deles.
 */
describe('a conta que não fecha', () => {
  const BLOCO = PAGINA.slice(PAGINA.indexOf('function ContaQueNaoFecha'));

  it('cala quando não há diferença a explicar', () => {
    expect(BLOCO.slice(0, 1200)).toContain('if (!semPartes && !ambosOsPolos) return null;');
  });

  /** Na janela de troca a API velha não manda os campos: calar > inventar. */
  it('cala também quando a API não manda os números', () => {
    expect(BLOCO.slice(0, 1200)).toContain('=== undefined');
  });

  it('nomeia o que ficou de fora e leva o recorte no link', () => {
    expect(BLOCO).toContain('parte nenhuma cadastrada');
    expect(BLOCO).toContain('/processos?semPartes=true&status=ATIVO');
  });

  it('não calcula a diferença por subtração', () => {
    expect(BLOCO).not.toContain('acervoAtivo -');
    expect(BLOCO).not.toContain('- papel.autor');
  });
});
