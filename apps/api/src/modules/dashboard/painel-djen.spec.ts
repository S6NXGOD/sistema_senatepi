import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const PAINEL = ler('src/modules/dashboard/dashboard.module.ts');
const BUSCA = ler('src/modules/processos/djen-busca.service.ts');
const CONTROLLER = ler('src/modules/processos/djen.controller.ts');

/**
 * O BLOCO DO DJEN NA HOME — o último lugar que ficou sem o agrupamento.
 *
 * As cópias por destinatário foram agrupadas na gaveta da atividade, na aba do
 * processo e na tela de busca; o painel continuou listando cru, e o jurídico
 * abriu a home em 04/09/2026 com "Elaborar manifestação" duas vezes seguidas e
 * "Juntar documentos" duas vezes seguidas — quatro linhas para dois atos.
 */
describe('painel do DJEN na home', () => {
  it('agrupa as cópias pelo link do documento', () => {
    expect(PAINEL).toContain('private resumirPublicacoes(');
    const fn = PAINEL.slice(PAINEL.indexOf('private resumirPublicacoes('));
    expect(fn.slice(0, 600)).toContain('const chave = pub.link ?? `id:${pub.id}`;');
  });

  /**
   * O corte em seis vem DEPOIS do agrupamento. Cortar antes entregaria três
   * atos onde cabem seis — foi por isso que o `take` da consulta subiu.
   */
  it('busca folgado e corta depois de agrupar', () => {
    const consulta = PAINEL.slice(
      PAINEL.indexOf('As últimas com PROVIDÊNCIA'),
      PAINEL.indexOf('A ORGANIZAÇÃO DO PRÓPRIO SINDICATO'),
    );
    expect(consulta).toContain('take: 40,');
    const fn = PAINEL.slice(PAINEL.indexOf('private resumirPublicacoes('));
    expect(fn.slice(0, 900)).toContain('.slice(0, 6)');
  });

  /** O contador também conta ATOS: "4 publicações" onde havia 2 era mentira. */
  it('o volume de 7 dias conta atos, não cópias', () => {
    const fn = PAINEL.slice(PAINEL.indexOf('private situacaoDjen('));
    expect(fn.slice(0, 2600)).toContain('const atos = new Set(');
    expect(fn.slice(0, 2600)).toContain('publicacoes7d: atos.size,');
  });

  /**
   * ESCOPO DO ADVOGADO. Nove advogados dividem o acervo; sem o recorte, cada um
   * abre a home e vê publicação dos processos dos outros oito. Publicação
   * alheia com cara de prazo ou é conferida uma a uma, ou ensina a ignorar o
   * bloco — e aí some junto a que era dele.
   */
  it('o advogado só vê publicação do próprio acervo', () => {
    expect(PAINEL).toContain('const meuAcervo: Prisma.ProcessoWhereInput = souAdvogado');
    expect(PAINEL).toContain('? { advogados: { some: { advogadoId: user.id } } }');
    // As três consultas do DJEN respeitam o recorte.
    const usos = PAINEL.match(/souAdvogado \? \{ processo: meuAcervo \} : \{\}/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(2);
    expect(PAINEL).toContain("escopo: 'GLOBAL' | 'PESSOAL',");
  });

  /**
   * `compromissoId` preenchido não basta: a atividade pode ter sido concluída
   * ou cancelada, e aí a publicação volta a ser notícia sem dono. É a diferença
   * entre "alguém está cuidando" e "isto pediu algo e ninguém pegou".
   */
  it('distingue tarefa ABERTA de tarefa qualquer', () => {
    expect(PAINEL).toContain('temTarefaAberta:');
    const fn = PAINEL.slice(PAINEL.indexOf('temTarefaAberta:'));
    expect(fn.slice(0, 200)).toContain("pub.compromisso?.status === 'PENDENTE'");
    expect(fn.slice(0, 200)).toContain("pub.compromisso?.status === 'EM_ANDAMENTO'");
  });

  /** Contra quem litigamos: piso de três, e o próprio sindicato fora. */
  it('os adversários recorrentes excluem o próprio sindicato', () => {
    expect(PAINEL).toContain('const MINIMO_PARA_SER_PADRAO = 3;');
    const bloco = PAINEL.slice(PAINEL.indexOf('const adversarios = await'));
    expect(bloco.slice(0, 900)).toContain('a.parteExternaId !== organizacaoDoSindicato?.id');
    expect(bloco.slice(0, 900)).toContain('a._count.processoId >= MINIMO_PARA_SER_PADRAO');
  });

  /** A organização do sindicato é achada pelo CNPJ do tenant, não pelo nome. */
  it('reconhece o sindicato pelo CNPJ do tenant', () => {
    expect(PAINEL).toContain("documento: tenant.cnpj.replace(/\\D/g, '')");
  });

  /**
   * O CORTE É NO BACKEND, não só na tela.
   *
   * A Triagem tem `processos: SEM_ACESSO` no preset do perfil, e a home
   * escondia os blocos jurídicos apenas no front — o teor das publicações, o
   * nome das partes contrárias e o do advogado de cada processo viajavam até o
   * navegador dela do mesmo jeito. É a regra que já estava escrita para
   * `cargaEquipe`, aplicada onde faltava.
   */
  it('quem não tem o módulo de processos não recebe o dado', () => {
    expect(PAINEL).toContain(
      "const veProcessos = nivelEfetivo(user.role, user.permissoes, 'processos') !== 'SEM_ACESSO';",
    );
    // As consultas nem chegam a rodar — não é filtro depois, é ausência antes.
    const guardas = PAINEL.split("!veProcessos").length - 1;
    expect(guardas).toBe(5);
    expect(PAINEL).toContain("if (!veProcessos) return [];");
  });
});

/**
 * A MESMA CARTEIRA, NA TELA DE BUSCA. O painel é resumo de sete dias; quem
 * precisa procurar vai para /publicacoes, e o advogado tem de chegar lá na
 * própria carteira em vez de na dos nove.
 */
describe('escopo pessoal na busca de publicações', () => {
  it('o filtro existe no serviço', () => {
    expect(BUSCA).toContain('meusProcessosDe?: string;');
    expect(BUSCA).toContain(
      "where.push({ processo: { advogados: { some: { advogadoId: filtro.meusProcessosDe } } } });",
    );
  });

  /**
   * O ID SAI DO TOKEN, NUNCA DA QUERY. Aceitar um `advogadoId` do cliente
   * deixaria qualquer um ler o acervo de qualquer colega mudando a URL.
   */
  it('o id de "meus" vem do usuário autenticado', () => {
    expect(CONTROLLER).toContain("meusProcessosDe: filtro.meus === 'true' ? user.id : undefined,");
    expect(CONTROLLER).not.toContain('advogadoId?: string');
  });
});
