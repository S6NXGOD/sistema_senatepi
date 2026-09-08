import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SYNC = readFileSync(join(__dirname, 'djen-sync.service.ts'), 'utf8');
const SUGESTOES = readFileSync(join(__dirname, 'sugestoes.service.ts'), 'utf8');
/**
 * SEM COMENTÁRIOS. O próprio controller EXPLICA a armadilha da ordem citando
 * `@Get(':id')` em prosa — e a primeira versão deste teste casou com a
 * explicação em vez do decorador, acusando um defeito que não existia.
 */
const CONTROLLER = readFileSync(join(__dirname, 'processos.controller.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const SCHEMA = readFileSync(
  join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);
const MIGRACAO = readFileSync(
  join(
    __dirname, '..', '..', '..', 'prisma', 'migrations',
    '20260907160000_sugestao_de_processo', 'migration.sql',
  ),
  'utf8',
);

/**
 * A AÇÃO NOVA QUE O DIÁRIO REVELAVA E O SISTEMA JOGAVA FORA.
 *
 * A varredura do DJEN consulta por OAB, e o CNJ devolve a carteira INTEIRA de
 * cada advogado. Tudo que não casava com um `Processo.numeroCNJ` cadastrado era
 * descartado na ingestão — decisão correta de privacidade.
 *
 * Só que junto ia o caso NOVO do próprio sindicato: ação recém-distribuída em
 * que um dos nossos já está no polo, ainda sem cadastro. O Diário anunciava e
 * nós jogávamos fora. Medido nas 1.408 publicações do acervo em 07/09/2026, o
 * sindicato aparece entre os destinatários em 1.034 (754 como autor, 167 como
 * réu e 113 nos dois polos) — é essa marca que passa a valer como detecção.
 */
describe('a detecção na ingestão', () => {
  it('separa o que seria descartado antes de descartar', () => {
    expect(SYNC).toContain('const foraDoAcervo = comunicacoes.filter((c) => !porNpu.has(c.numeroProcesso));');
    expect(SYNC).toContain('const sugeridas = await this.sugerirAcoesNossas(foraDoAcervo);');
  });

  /**
   * A PENEIRA CONTINUA ESTREITA: só entra o que nomeia o sindicato. Sem isto, a
   * causa particular do advogado viraria linha no banco — exatamente o dado que
   * a decisão de privacidade da ingestão existe para não guardar.
   */
  it('só vira sugestão quando o sindicato está no ato', () => {
    const fn = SYNC.slice(
      SYNC.indexOf('private async sugerirAcoesNossas('),
      SYNC.indexOf('private async ingerir('),
    );
    expect(fn).toContain('const polo = nossoPoloNoAto(c.destinatarios, sigla);');
    expect(fn).toContain('if (!polo) continue;');
  });

  /** O TEOR NÃO É GUARDADO: decidir se vale cadastrar não exige o texto do ato. */
  it('não persiste o teor de um processo que ainda não é nosso', () => {
    const fn = SYNC.slice(
      SYNC.indexOf('private async sugerirAcoesNossas('),
      SYNC.indexOf('private async ingerir('),
    );
    expect(fn).not.toContain('texto');
    expect(fn).not.toContain('link');
  });

  /**
   * A SIGLA VEM DO CADASTRO, não de uma constante: são dois sindicatos no mesmo
   * código, e o `nomeFantasia` da parte institucional é o que o resto do módulo
   * já usa para responder "somos nós?".
   */
  it('a sigla sai da parte institucional, e não de um literal', () => {
    expect(SYNC).toContain('where: { institucional: true }');
    expect(SYNC).toContain('select: { nomeFantasia: true }');
    expect(SYNC).not.toMatch(/['"]SENATEPI['"]/);
  });

  /** A mesma ação aparece em várias publicações e rodadas — uma linha, não dez. */
  it('agrupa por NPU e faz upsert', () => {
    expect(SYNC).toContain('this.prisma.sugestaoProcesso.upsert({');
    expect(SYNC).toContain('where: { numeroCNJ }');
    expect(SYNC).toContain('publicacoes: { increment: item.n }');
  });

  /**
   * A DECISÃO DE QUEM JÁ OLHOU NÃO SE DESFAZ SOZINHA. Se alguém ignorou, uma
   * publicação nova amanhã não pode devolver a ação à fila — seria o sistema
   * discutindo com a pessoa. O contador sobe; o status, não.
   */
  it('o upsert não ressuscita o que alguém ignorou', () => {
    const upsert = SYNC.slice(SYNC.indexOf('sugestaoProcesso.upsert({'), SYNC.indexOf('if (novas > 0)'));
    expect(upsert).not.toContain('status:');
  });

  /** O polo só melhora: sobrescrever com INDEFINIDO apagaria o que já sabíamos. */
  it('o polo nunca piora', () => {
    expect(SYNC).toContain("...(item.polo !== 'INDEFINIDO' ? { nossoPolo: item.polo } : {}),");
  });

  /**
   * O VOLUME SÓ É MENSURÁVEL AQUI: a publicação de terceiro não é persistida,
   * então sem o número no resumo ninguém saberia se a detecção acha alguma coisa.
   */
  it('o resumo da varredura conta as encontradas', () => {
    expect(SYNC).toContain('resumo.sugeridas += r.sugeridas;');
    expect(SYNC).toContain("ação(ões) nossa(s) sem cadastro.");
  });
});

/**
 * A FILA SE FECHA SOZINHA — porque o cadastro entra por várias portas.
 */
describe('a fila de sugestões', () => {
  it('reconcilia contra o acervo na leitura, e não por gatilho', () => {
    expect(SUGESTOES).toContain('private async reconciliar()');
    expect(SUGESTOES).toContain('await this.reconciliar();');
    expect(SUGESTOES).toContain('status: StatusSugestaoProcesso.CADASTRADO');
  });

  /** Ignorar guarda o porquê: a mesma ação volta ao Diário por meses. */
  it('ignorar registra quem decidiu, quando e por quê', () => {
    expect(SUGESTOES).toContain('decididoPor: usuarioId');
    expect(SUGESTOES).toContain('motivoDescarte: motivo?.trim() || null');
  });

  /** Errar tem de ter volta, senão a única saída é cadastrar o que ninguém quer. */
  it('e dá para desfazer', () => {
    expect(SUGESTOES).toContain('async reabrir(');
    expect(SUGESTOES).toContain('status: StatusSugestaoProcesso.PENDENTE');
  });

  /** Decidir duas vezes a mesma coisa é sinal de tela desatualizada, não de intenção. */
  it('não deixa decidir o que já foi decidido', () => {
    expect(SUGESTOES).toContain('Esta sugestão já foi decidida.');
    expect(SUGESTOES).toContain('Esta ação já virou processo no acervo.');
  });
});

/**
 * PERMISSÃO: as rotas herdam `@Modulo('processos')` do controller, e o guard
 * resolve o nível pelo VERBO — GET exige VISUALIZAR, POST exige EDITAR. Quem só
 * lê o acervo enxerga a fila; decidir é escrita.
 */
describe('as rotas da fila', () => {
  it('vivem sob o módulo de processos', () => {
    expect(CONTROLLER).toContain("@Modulo('processos')");
  });

  /**
   * ORDEM IMPORTA: o Nest casa na ordem de declaração, e `@Get(':id')`
   * engoliria "sugestoes" como se fosse um id — a mesma armadilha que já
   * documentaram `advogados` e `contadores`.
   */
  it('a rota de leitura vem antes do parâmetro que a engoliria', () => {
    expect(CONTROLLER.indexOf("@Get('sugestoes')")).toBeLessThan(CONTROLLER.indexOf("@Get(':id')"));
  });

  it('decidir é POST — o guard cobra EDITAR', () => {
    expect(CONTROLLER).toContain("@Post('sugestoes/:id/ignorar')");
    expect(CONTROLLER).toContain("@Post('sugestoes/:id/reabrir')");
  });
});

/**
 * JANELA DE TROCA: o contêiner ANTIGO serve tráfego contra o banco já migrado.
 * Tabela nova e enum novo ele ignora; o que o derrubaria é mexer no que existe.
 */
describe('a migração', () => {
  it('cria a tabela e os dois enums', () => {
    expect(MIGRACAO).toContain('CREATE TABLE "sugestoes_processo"');
    expect(MIGRACAO).toContain('CREATE TYPE "PoloDaSugestao"');
    expect(MIGRACAO).toContain('CREATE TYPE "StatusSugestaoProcesso"');
  });

  /** O mesmo NPU não pode virar duas linhas: a ingestão faz upsert por ele. */
  it('o NPU é único', () => {
    expect(MIGRACAO).toContain('CREATE UNIQUE INDEX "sugestoes_processo_numero_cnj_key"');
  });

  /** É aditiva: não altera, não renomeia e não remove nada que já existia. */
  it('não toca em nada existente', () => {
    expect(MIGRACAO).not.toMatch(/\bDROP\b/i);
    expect(MIGRACAO).not.toMatch(/\bRENAME\b/i);
    // O único ALTER é para pendurar as FKs na tabela que ela mesma acabou de criar.
    const alters = MIGRACAO.match(/ALTER TABLE "(\w+)"/g) ?? [];
    expect(alters.every((a) => a.includes('sugestoes_processo'))).toBe(true);
  });

  /**
   * SET NULL nas duas pontas: apagar um processo ou desativar um usuário não
   * pode derrubar o registro de que a sugestão existiu e de que alguém decidiu.
   */
  it('as FKs não apagam o histórico da decisão', () => {
    expect((MIGRACAO.match(/ON DELETE SET NULL/g) ?? []).length).toBe(2);
  });

  it('e o schema declara o mesmo que a migração', () => {
    expect(SCHEMA).toContain('model SugestaoProcesso {');
    expect(SCHEMA).toContain('enum PoloDaSugestao {');
    expect(SCHEMA).toContain('@@map("sugestoes_processo")');
  });
});

/**
 * COMO SOMOS AVISADOS — a pergunta que faltava responder.
 *
 * Não existe canal de saída neste sistema: nenhum email, push ou WhatsApp na
 * API inteira. Tudo é o navegador perguntando. Então "ser notificado" aqui
 * significa uma coisa só: o aviso tem de estar onde a pessoa já está.
 *
 * São três superfícies, com papéis distintos e sem duplicar conteúdo:
 *   · o SINO — em toda tela, atualiza sozinho a cada minuto;
 *   · o PAINEL — a contagem, ao abrir o sistema;
 *   · a tela de PROCESSOS — a fila, com os botões que decidem.
 */
describe('o aviso de ação nova', () => {
  const PENDENCIAS = readFileSync(
    join(__dirname, '..', 'agenda', 'pendencias.service.ts'),
    'utf8',
  );
  const PEND_CTRL = readFileSync(
    join(__dirname, '..', 'agenda', 'pendencias.controller.ts'),
    'utf8',
  );

  it('o sino conta a ação nova', () => {
    expect(PENDENCIAS).toContain("'ACAO_NOVA'");
    expect(PENDENCIAS).toContain('this.prisma.sugestaoProcesso.findMany({');
    expect(PENDENCIAS).toContain("where: { status: 'PENDENTE' }");
  });

  /**
   * A MAIS ANTIGA PRIMEIRO. Uma ação que já apareceu oito vezes no Diário sem
   * cadastro não é novidade de ontem — é acompanhamento que não houve.
   */
  it('e mostra a que espera há mais tempo', () => {
    expect(PENDENCIAS).toContain("orderBy: { primeiraEm: 'asc' }");
  });

  /**
   * SÓ PARA QUEM PODE CADASTRAR: para quem não tem o botão, o item seria uma
   * cobrança sem saída. E o nível é resolvido no CONTROLLER, onde a matriz do
   * usuário está à mão — serviço que decide permissão sozinho é serviço que a
   * próxima chamada esquece de perguntar.
   */
  it('só para quem pode cadastrar, e o nível vem do controller', () => {
    expect(PENDENCIAS).toContain('cadastraProcesso = false');
    expect(PENDENCIAS).toContain('!cadastraProcesso');
    expect(PEND_CTRL).toContain("nivelEfetivo(user.role, user.permissoes, 'processos') === 'EDITAR'");
    expect(PEND_CTRL).toContain('this.pendencias.minhas(user.id, cadastraProcesso)');
  });

  /**
   * O ITEM ABRE O CADASTRO JÁ PREENCHIDO — e não larga a pessoa na lista.
   *
   * A primeira versão mandava para `/processos` puro: quem clicava caía na lista
   * inteira e ainda tinha de achar a fila e apertar "Cadastrar" — três passos
   * para uma decisão que o sino já tinha apresentado. Com o NPU no parâmetro, o
   * diálogo abre preenchido e a prévia do CNJ dispara sozinha.
   */
  it('o link abre o cadastro com o número dentro', () => {
    const bloco = PENDENCIAS.slice(PENDENCIAS.indexOf("tipo: 'ACAO_NOVA' as const"));
    expect(bloco.slice(0, 1400)).toContain('href: `/processos?cadastrar=${a.numeroCNJ}`');
  });

  /**
   * O POLO VEM NO TÍTULO: "movem contra nós" e "movemos" pedem urgências
   * diferentes, e o NPU sozinho obrigaria a abrir para descobrir qual é — que é
   * exatamente o que o sino existe para evitar.
   */
  it('e a linha diz de que lado estamos', () => {
    expect(PENDENCIAS).toContain('const POLO_CURTO');
    expect(PENDENCIAS).toContain("PASSIVO: 'Movem contra nós'");
    expect(PENDENCIAS).toContain('titulo: `${POLO_CURTO[a.nossoPolo]}');
  });
});

/**
 * A VARREDURA DIÁRIA OLHA TRÊS DIAS — e isso deixava um buraco de descoberta.
 *
 * Processo JÁ cadastrado também é consultado por NPU, e essa consulta não tem
 * filtro de data: traz o histórico inteiro dele (o acervo tem publicação desde
 * maio de 2024 por causa disso). Mas ação NOVA só pode ser descoberta pela
 * busca por OAB, que é limitada pela janela — um processo do sindicato
 * distribuído há dois meses e quieto nesta semana era invisível para sempre.
 */
describe('a colheita de histórico', () => {
  const CTRL = readFileSync(join(__dirname, 'djen.controller.ts'), 'utf8');

  it('a varredura aceita uma janela alargada', () => {
    expect(SYNC).toContain('diasDeHistorico?: number');
    expect(SYNC).toContain('await this.executarVarredura(resumo, aguardar, diasDeHistorico);');
  });

  /**
   * SEM O PARÂMETRO, NADA MUDA. A rodada de três dias absorve fim de semana e
   * feriado; alargar todo dia só gastaria cota reprocessando o que o `hash`
   * único descartaria.
   */
  it('sem o parâmetro, continua a janela de sempre', () => {
    expect(SYNC).toContain('const dias = diasDeHistorico');
    expect(SYNC).toContain(': this.djen.janelaDias;');
  });

  /**
   * TETO DE 180 DIAS. A busca por OAB devolve a carteira INTEIRA do advogado —
   * medido, ~113 publicações/dia somando os oito. Meio ano são ~20 mil itens.
   */
  it('e tem teto, porque a carteira inteira do advogado vem junto', () => {
    expect(SYNC).toContain('Math.min(180, Math.max(1, Math.floor(diasDeHistorico)))');
    expect(CTRL).toContain('@Max(180)');
    expect(CTRL).toContain('@Min(1)');
  });

  /** A rota já era `@Roles(ADMINISTRADOR)` — a janela larga não afrouxa isso. */
  it('continua restrita ao Administrador', () => {
    const bloco = CTRL.slice(CTRL.indexOf("@Post('sincronizar')"), CTRL.indexOf('varrer('));
    expect(bloco).toContain('@Roles(UserRole.ADMINISTRADOR)');
  });
});

/**
 * A CHAVE DE RECONHECIMENTO MORA NUM CAMPO EDITÁVEL — e some sem avisar.
 *
 * A sigla sai do `nomeFantasia` da parte institucional, o mesmo registro que
 * aparece na tela de Organizações e que alguém pode renomear. Apagado ou
 * encurtado, a detecção para de achar — e ausência de alerta parece calma: a
 * fila fica vazia e ninguém desconfia.
 *
 * O usuário perguntou se não seria melhor configurar isso explicitamente (e
 * buscar pelo CNPJ). Buscar por CNPJ é impossível: o endpoint do CNJ só aceita
 * OAB+datas ou NPU, e o destinatário do ato chega sem documento. O que dá para
 * fazer — e é o que falta num sistema que odeia zero ambíguo — é a chave
 * quebrada DIZER que quebrou.
 */
describe('quando a chave de reconhecimento não serve', () => {
  it('a detecção se desliga em voz alta, e não em silêncio', () => {
    const fn = SYNC.slice(
      SYNC.indexOf('private async sugerirAcoesNossas('),
      SYNC.indexOf('private async ingerir('),
    );
    expect(fn).toContain('if (!sigla || sigla.trim().length < 4)');
    expect(fn).toContain('this.logger.warn(');
    expect(fn).toContain('DESLIGADA');
  });

  /** O aviso tem de dizer o CONSERTO, não só o defeito. */
  it('e o aviso diz o que fazer', () => {
    expect(SYNC).toContain('Preencha o nome fantasia da organiza');
  });
});

/**
 * A PRIMEIRA COLHEITA REAL MOSTROU O QUE A FILA DE FATO É.
 *
 * 32 ações encontradas, e **só 4 de 2026**: o resto vai de 2014 a 2025, seis
 * delas de 2015. Ou seja, isto não é (só) "ação nova" — é o passivo de cadastro
 * do acervo. As duas coisas pedem reações diferentes e estavam na mesma lista,
 * sem distinção nenhuma.
 */
describe('o ano de distribuição', () => {
  it('sai do próprio NPU', () => {
    expect(SUGESTOES).toContain('private anoDoNpu(numeroCNJ: string)');
    expect(SUGESTOES).toContain('numeroCNJ.slice(9, 13)');
  });

  /** A conta tem de valer, e não só estar escrita. */
  it('e a extração acerta', () => {
    const ano = (n: string) => {
      const a = Number(n.slice(9, 13));
      return Number.isFinite(a) && a > 1990 ? a : null;
    };
    expect(ano('00010236720255220001')).toBe(2025);
    expect(ano('00000375020155220103')).toBe(2015);
    expect(ano('08002016720238180036')).toBe(2023);
    expect(ano('lixo')).toBeNull();
  });

  /**
   * ORDENAR PELO NPU NÃO SERVE, e o engano é fácil: o número começa pelo
   * SEQUENCIAL, não pelo ano. `0009999…2015` viria antes de `0000001…2026`.
   */
  it('a ordem é por ano, e não pelo número — que começa pelo sequencial', () => {
    expect(SUGESTOES).toContain('if (anoA !== anoB) return anoB - anoA;');
    expect(SUGESTOES).not.toContain("orderBy: [{ numeroCNJ: 'desc' }]");

    // A armadilha, demonstrada: ordenar pela string erra o ano.
    const porNpu = ['00000019920265220001', '00099990020155220001'].sort().reverse();
    expect(porNpu[0].slice(9, 13)).toBe('2015'); // o de 2015 vem primeiro — errado
  });

  /** Dentro do mesmo ano, a que publicou por último: sinal de que anda. */
  it('empate de ano vai para a publicação mais recente', () => {
    expect(SUGESTOES).toContain('return b.ultimaEm.getTime() - a.ultimaEm.getTime();');
  });

  /** O corte tem de ser feito DEPOIS de ordenar, senão trunca as erradas. */
  it('o corte de 50 vem depois da ordenação', () => {
    const bloco = SUGESTOES.slice(SUGESTOES.indexOf('async listar()'));
    expect(bloco.indexOf('.sort(')).toBeLessThan(bloco.indexOf('.slice(0, 50)'));
  });
});

/**
 * NÃO ENCHER A FILA COM PROCESSO QUE JÁ ACABOU.
 *
 * A primeira colheita trouxe 32 ações e boa parte era de processo encerrado — o
 * que faz sentido: o ATO DE ENCERRAMENTO é justamente a última coisa que um
 * processo morto publica no Diário, e é por ele que a varredura o encontra.
 * Fila cheia de trabalho que não existe é o jeito mais rápido de a equipe parar
 * de olhar a fila.
 *
 * O critério é ESTADO, e não idade — o usuário foi explícito: "não me importo
 * se é uma ação de 2014, contanto que ainda esteja rolando".
 */
describe('a ação que já acabou', () => {
  const MIG = readFileSync(
    join(
      __dirname, '..', '..', '..', 'prisma', 'migrations',
      '20260907190000_sugestao_encerrada', 'migration.sql',
    ),
    'utf8',
  );

  it('a varredura confere no CNJ se o processo ainda corre', () => {
    expect(SYNC).toContain('private async marcarSeJaEncerrado(');
    expect(SYNC).toContain('await this.datajud.buscarInstanciasPorNPU(numeroCNJ, siglaTribunal)');
  });

  /** A MESMA regra do resto do módulo — códigos TPU, desarquivamento, e movimento
   * posterior à baixa. Uma segunda definição de "encerrado" divergiria da
   * primeira no dia em que uma delas fosse corrigida. */
  it('e usa a regra de baixa que já existia', () => {
    expect(SYNC).toContain('instancias.every((i) => instanciaBaixada(i.movimentacoes))');
  });

  /** TODAS as instâncias: baixar o 1º grau com recurso em curso não é o fim. */
  it('exige que TODAS as instâncias estejam baixadas', () => {
    expect(SYNC).toContain('.every(');
    expect(SYNC).not.toContain('.some((i) => instanciaBaixada');
  });

  /**
   * NA DÚVIDA, MOSTRA. Sem instância nenhuma, o CNJ não sabe do processo — o que
   * não é o mesmo que dizer que ele acabou. Esconder um caso vivo custa prazo;
   * mostrar um morto custa um clique.
   */
  it('CNJ que não conhece o número não vira "encerrado"', () => {
    expect(SYNC).toContain('if (!instancias.length) return;');
  });

  /** A conferência é bônus: falhar nela não pode derrubar a ingestão. */
  it('a falha da conferência não perde a sugestão', () => {
    const fn = SYNC.slice(
      SYNC.indexOf('private async marcarSeJaEncerrado('),
      SYNC.indexOf('private async ingerir('),
    );
    expect(fn).toContain('} catch (err) {');
    expect(fn).toContain('this.logger.warn(');
  });

  /** SÓ AS NOVAS: reconferir a fila toda noite gastaria cota para nada. */
  it('só confere ação nova, e a fila antiga por lotes', () => {
    expect(SYNC).toContain('await this.marcarSeJaEncerrado(numeroCNJ, item.c.siglaTribunal);');
    expect(SYNC).toContain('private async conferirFilaSemVerificacao()');
    expect(SYNC).toContain('verificadoNoCnjEm: null');
    /*
      O NÚMERO em si não é a regra — que EXISTA teto é. Ele subiu de 20 para 40
      quando a colheita de histórico deixou 30 pendentes numa noite só; travar o
      valor exato aqui só produz um teste para atualizar junto. O que precisa
      continuar verdade é que a fila é conferida POR LOTE e o lote cabe na cota.
    */
    const teto = Number(/const TETO = (\d+);/.exec(SYNC)?.[1]);
    expect(teto).toBeGreaterThan(0);
    expect(teto).toBeLessThanOrEqual(60);
  });

  /**
   * JANELA DE TROCA: o contêiner ANTIGO só consulta `status = 'PENDENTE'`, então
   * nunca lê uma linha ENCERRADO — e não tem como falhar ao interpretar um valor
   * de enum que ele desconhece.
   */
  it('a migração é aditiva', () => {
    expect(MIG).toContain(`ALTER TYPE "StatusSugestaoProcesso" ADD VALUE IF NOT EXISTS 'ENCERRADO'`);
    expect(MIG).toContain('ADD COLUMN IF NOT EXISTS "verificado_no_cnj_em"');
    expect(MIG).not.toMatch(/\bDROP\b/i);
  });

  /** E a fila continua entregando só o que espera decisão. */
  it('a fila não lista o que foi encerrado', () => {
    expect(SUGESTOES).toContain('where: { status: StatusSugestaoProcesso.PENDENTE }');
  });
});

/**
 * CADASTRAR VÁRIAS DE UMA VEZ.
 *
 * A colheita trouxe dezenas. Uma a uma é abrir o diálogo, conferir, confirmar e
 * fechar — vezes trinta — e o que o diálogo pede que se confira é exatamente o
 * que a linha da fila já mostra.
 */
describe('o cadastro em lote', () => {
  /**
   * A MESMA rotina de importação do botão individual. Uma segunda divergiria da
   * primeira no dia em que uma delas ganhasse uma regra.
   */
  it('delega a importação de cada uma ao serviço de sempre', () => {
    expect(CONTROLLER).toContain("@Post('sugestoes/importar-lote')");
    expect(CONTROLLER).toContain('this.service.importar(item as never, this.ctx(req, userId))');
  });

  /**
   * UMA POR VEZ, e não em transação única: cada importação consulta o CNJ, e um
   * NPU que o índice não conhece não pode derrubar as outras vinte e nove.
   */
  it('a falha de uma não derruba as outras', () => {
    const fn = SUGESTOES.slice(SUGESTOES.indexOf('async importarEmLote('));
    expect(fn).toContain('} catch (err) {');
    expect(fn).toContain('resultados.push({');
    expect(fn).toContain('ok: false');
  });

  /**
   * ENTRA O QUE O TRIBUNAL DISSE; fica de fora o que exige julgamento — filiado,
   * advogado, etiqueta. O sistema já tem fila para esses ("Sem filiado
   * vinculado", "Sem réu cadastrado"), e o processo cai nelas sozinho. Inventar
   * um assistente de conclusão seria uma terceira fila para o mesmo trabalho.
   */
  it('leva o que o tribunal disse e nada que exija julgamento', () => {
    const fn = SUGESTOES.slice(SUGESTOES.indexOf('async importarEmLote('));
    expect(fn).toContain('partesContrarias: nomes');
    /*
      O ADVOGADO ENTROU, e não é exceção à regra: ele NÃO é julgamento nosso, é
      fato do ato. A ação chegou até a fila PORQUE a OAB dele estava na
      publicação. Medido: 30 das 30 têm advogado nosso identificável, e mesmo
      assim os processos nasciam com "⚠ Sem advogado".
    */
    expect(fn).toContain('advogadoId: nossosAdvogados[0]?.id');
    // Estes seguem de fora: dependem de decisão de gente.
    expect(fn).not.toContain('filiadoId');
    expect(fn).not.toContain('etiquetas');
  });

  /**
   * AS PARTES ENTRAM COMO NOME — exceto quando o cadastro JÁ EXISTE com o mesmo
   * nome exato.
   *
   * A regra original era "nunca vincular", e a razão era boa: das 78 partes
   * não-sindicato encontradas, 76 não existem no cadastro, e onde existe existe
   * em quatro variantes (HAPVIDA) — escolher uma seria cara ou coroa que agrupa
   * processos sob a empresa errada.
   *
   * O que mudou não é a régua, é a precisão dela. A auditoria dos 129 processos
   * achou o ITACOR do 0001000-26.2022.5.22.0002 entrando SOLTO enquanto a
   * organização já estava ligada em outros dois processos — e "todos os
   * processos contra a mesma empresa juntos" é a razão de a tabela existir.
   *
   * O casamento é EXATO sobre o nome normalizado, não aproximado: conferido na
   * produção, as quatro HAPVIDA dão quatro chaves distintas, e o
   * "HAPVIDA ASSISTENCIA MEDICA LTDA" do Diário não casa com nenhuma. Vincular
   * um nome idêntico a um cadastro que existe não é adivinhar — é reconhecer.
   */
  it('reaproveita o cadastro só no nome exato, e nunca no ambíguo', () => {
    const fn = SUGESTOES.slice(SUGESTOES.indexOf('async importarEmLote('));
    // O polo ativo continua entrando como nome — ali não há casamento nenhum.
    expect(fn).toContain("{ tipo: 'AVULSA' as const, nome }");
    // O réu passa pelo índice, e só vincula quando a chave existe.
    expect(fn).toContain('org ? { nome, parteExternaId: org } : { nome }');
    // Chave que aponta para duas organizações é DESCARTADA: volta a ser nome.
    expect(fn).toContain('for (const chave of ambiguas) orgsPorNome.delete(chave);');
  });

  /** O sindicato tem tipo próprio nos dois polos — nunca entra como avulsa. */
  it('e o sindicato entra como institucional', () => {
    const fn = SUGESTOES.slice(SUGESTOES.indexOf('async importarEmLote('));
    expect(fn).toContain("ehNos(nome) ? { tipo: 'INSTITUCIONAL' as const }");
    expect(fn).toContain('.filter((nome) => !ehNos(nome))');
  });

  /** Só as que ainda esperam decisão: cadastrar de novo o que já entrou dá 409. */
  it('só pega o que está pendente', () => {
    expect(SUGESTOES).toContain('where: { id: { in: ids }, status: StatusSugestaoProcesso.PENDENTE }');
  });

  /**
   * O TETO É DE COTA, não de banco: cada importação consulta o CNJ, a 14 por
   * minuto. Cinquenta já são uns quatro minutos com a tela presa.
   */
  it('tem teto de 50 por lote', () => {
    const DTO = readFileSync(join(__dirname, 'dto', 'sugestoes.dto.ts'), 'utf8');
    expect(DTO).toContain('@ArrayMaxSize(50)');
    expect(DTO).toContain('@ArrayNotEmpty()');
  });
});

/**
 * ADVOGADO SEM OAB É INVISÍVEL PARA O DIÁRIO — e a falha era silenciosa.
 *
 * A varredura consulta POR OAB: quem não tem o número no cadastro não entra na
 * lista, as publicações que o intimam nunca chegam, o sino dele nunca acende e
 * nada na tela sugere que falta algo.
 *
 * Medido em 07/09/2026: a Dra. Lara Cortez é ADVOGADA ativa, tem 2 processos
 * vinculados e está sem OAB. Dois processos cujo prazo não é anunciado.
 */
describe('o advogado que a varredura não enxerga', () => {
  it('a varredura conta quem ficou de fora', () => {
    expect(SYNC).toContain("role: 'ADVOGADO',");
    expect(SYNC).toContain('OR: [{ oab: null }, { oabUf: null }]');
    expect(SYNC).toContain('resumo.advogadosSemOab = semOab.length;');
  });

  /** O aviso nomeia QUEM e diz o CONSERTO — contagem sozinha não resolve nada. */
  it('e diz quem é e o que fazer', () => {
    expect(SYNC).toContain('a.nomeExibicao || a.nome');
    expect(SYNC).toContain('Preencha OAB e UF na ficha');
  });

  /** No log da aplicação ninguém olha: o resumo gravado é o que sobrevive. */
  it('o resumo persistido também avisa', () => {
    expect(SYNC).toContain('advogado(s) sem OAB n\u00e3o foram consultados');
  });
});
