import { CorrelacaoService } from './correlacao.service';
import { MOTIVOS_DO_ROBO } from './automacao-prazos.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O TEOR E O ANDAMENTO SÃO O MESMO FATO — E CHEGAM NA ORDEM INVERSA (17/09/2026).
 *
 * O DJEN publica o teor no dia (D+0). O DataJud registra o mesmo ato com
 * mediana de 62 dias de atraso. Das 294 movimentações de publicação/intimação
 * dos últimos 60 dias, 153 têm publicação do Diário até CINCO DIAS ANTES do
 * andamento — e 106 dessas viraram tarefa cega ("Verificação de Intimação /
 * Prazo") com o texto do ato já gravado no banco.
 *
 * Aqui o serviço roda DE VERDADE contra um banco pequeno em memória que aplica
 * os filtros que ele manda e reclama do operador que não conhece — teste que
 * passa por não filtrar nada é o pior que existe. O que se cobra é
 * comportamento: quem ficou pareado com quem, quem foi carimbado e, sobretudo,
 * quem NÃO foi.
 */

const DIA = 86_400_000;
/** Meia-noite UTC de hoje: a âncora das duas datas, que têm naturezas diferentes. */
const HOJE = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
/** `dataDisponibilizacao` é coluna DATE — meia-noite UTC, sem hora e sem fuso. */
const diaDoDiario = (atras: number) => new Date(HOJE.getTime() - atras * DIA);
/** `dataMovimento` é timestamp — meio-dia UTC é manhã em Teresina, sem virada de dia. */
const diaDoAto = (atras: number) => new Date(HOJE.getTime() - atras * DIA + 12 * 3_600_000);

/** Ordem nossa, prazo nosso: é o que vai direto para a agenda. */
const REPLICA =
  'PODER JUDICIÁRIO ATO ORDINATÓRIO Intimo a parte autora a apresentar réplica ' +
  'no prazo de 15 dias. CONTESTAÇÃO TEMPESTIVA';

/** Caso real 0000978-59.2022.5.22.0004: não há uma linha para nós no ato inteiro. */
const ORDEM_DA_RECLAMADA =
  'INTIME-SE A RECLAMADA PARA RECOLHIMENTO DAS CUSTAS PROCESSUAIS NO PRAZO DE 15 DIAS, ' +
  'SOB PENA DE EXECUÇÃO.';

/** Providência NENHUMA: 12 das 2.380 publicações do acervo, todas assim. */
const LISTA_DE_DISTRIBUICAO =
  'LISTA DE DISTRIBUIÇÃO PROCESSO DISTRIBUÍDO POR SORTEIO PARA A 2ª VARA DO TRABALHO.';

type Linha = Record<string, any>;

interface Mundo {
  publicacoes?: Linha[];
  andamentos?: Linha[];
}

/**
 * Uma publicação como a ingestão a grava: classificada ainda não, decidida
 * ainda não.
 */
const publicacao = (id: string, texto: string, atras: number, extra: Linha = {}): Linha => ({
  id,
  processoId: 'proc-1',
  numeroProcesso: '00008146120265220002',
  texto,
  tipoComunicacao: 'Intimação',
  nomeOrgao: '2ª Vara do Trabalho de Teresina',
  link: `https://comunica.pje.jus.br/consulta/certidao/${id}`,
  dataDisponibilizacao: diaDoDiario(atras),
  // Já éramos vigilantes deste processo há muito tempo: sem isto, tudo vira
  // notícia velha e o teste mediria outra coisa.
  createdAt: new Date(HOJE.getTime() - 120 * DIA),
  providencia: null,
  prazoMencionadoDias: null,
  compromissoId: null,
  movimentacaoId: null,
  tarefaPropostaEm: null,
  tarefaPropostaPara: null,
  tarefaDispensadaEm: null,
  tarefaDispensadaMotivo: null,
  advogados: [],
  ...extra,
});

/** Uma intimação do DataJud: rótulo, sem teor — é o que o índice do CNJ entrega. */
const andamento = (id: string, atras: number, extra: Linha = {}): Linha => ({
  id,
  processoId: 'proc-1',
  dataMovimento: diaDoAto(atras),
  descricao: 'Expedição de documento',
  detalhe: 'Intimação',
  conteudo: null,
  codigoMovimento: 60,
  compromissoId: null,
  avaliadoEm: null,
  avaliadoPor: null,
  avaliadoMotivo: null,
  ...extra,
});

function bancoEmMemoria(mundo: Mundo) {
  const publicacoes: Linha[] = mundo.publicacoes ?? [];
  const andamentos: Linha[] = mundo.andamentos ?? [];
  const compromissos: Linha[] = [];

  const igual = (a: unknown, b: unknown) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as Date).getTime() === new Date(b as Date).getTime()
      : a === b;

  const casa = (linha: Linha, where: Linha = {}): boolean =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === 'OR') return (cond as Linha[]).some((w) => casa(linha, w));
      if (campo === 'NOT') return !casa(linha, cond as Linha);
      if (campo === 'compromisso') {
        const c = compromissos.find((x) => x.id === linha.compromissoId);
        return !!c && casa(c, cond as Linha);
      }
      const v = linha[campo];
      if (cond === null) return v == null;
      if (cond instanceof Date || typeof cond !== 'object') return igual(v, cond);
      return Object.entries(cond as Linha).every(([op, alvo]) => {
        switch (op) {
          case 'not':
            return alvo === null ? v != null : !igual(v, alvo);
          case 'gte':
            return v != null && v >= alvo;
          case 'lt':
            return v != null && v < alvo;
          case 'in':
            return (alvo as unknown[]).some((a) => igual(v, a));
          default:
            throw new Error(`operador não simulado: ${campo}.${op}`);
        }
      });
    });

  const processo: Linha = {
    id: 'proc-1',
    numeroCNJ: '0000814-61.2026.5.22.0002',
    advogadoId: 'u-murilo',
    filiadoId: null,
    // O sindicato é o AUTOR: é o que permite ler "intime-se a reclamada" como
    // ordem da parte contrária.
    partes: [{ polo: 'ATIVO' }],
  };

  const prisma = {
    comunicacaoDjen: {
      findMany: jest.fn(async ({ where }: any) => publicacoes.filter((p) => casa(p, where))),
      findFirst: jest.fn(async ({ where }: any) => publicacoes.find((p) => casa(p, where)) ?? null),
      findUnique: jest.fn(async ({ where }: any) => publicacoes.find((p) => p.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(publicacoes.find((p) => p.id === where.id)!, data)),
      aggregate: jest.fn(async ({ where }: any) => {
        const datas = publicacoes.filter((p) => casa(p, where)).map((p) => p.createdAt.getTime());
        return { _min: { createdAt: datas.length ? new Date(Math.min(...datas)) : null } };
      }),
    },
    movimentacaoProcessual: {
      findMany: jest.fn(async ({ where }: any) => andamentos.filter((m) => casa(m, where))),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(andamentos.find((m) => m.id === where.id)!, data)),
    },
    processo: { findUnique: jest.fn(async () => processo) },
    compromisso: {
      create: jest.fn(async ({ data }: any) => {
        const c = { id: `comp-${compromissos.length + 1}`, ...data };
        compromissos.push(c);
        return { id: c.id };
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(compromissos.find((c) => c.id === where.id)!, data)),
      findUnique: jest.fn(async ({ where }: any) => compromissos.find((c) => c.id === where.id) ?? null),
    },
    user: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 'u-murilo' || where.role === 'ADMINISTRADOR' ? { id: 'u-murilo' } : null),
      findUnique: jest.fn(async () => ({ id: 'u-murilo', nome: 'Murilo', nomeExibicao: null })),
      findMany: jest.fn(async () => []),
    },
  };

  const pub = (id: string) => publicacoes.find((p) => p.id === id)!;
  const mov = (id: string) => andamentos.find((m) => m.id === id)!;
  return { servico: new CorrelacaoService(prisma as never), pub, mov, compromissos };
}

describe('o teor que chegou ANTES do andamento', () => {
  /**
   * O CASO DOS 106: a publicação de cinco dias antes descreve o andamento que o
   * DataJud só entregou agora. Antes desta frente, o par não existia: a
   * publicação criava a tarefa certa e o andamento ficava solto, para o robô
   * cego abrir a sua "Verificação de Intimação / Prazo" por cima.
   */
  it('pareia, cria uma tarefa só e carimba o andamento com o teor do Diário', async () => {
    const { servico, pub, mov, compromissos } = bancoEmMemoria({
      publicacoes: [publicacao('pub-1', REPLICA, 8)],
      andamentos: [andamento('mov-1', 3)],
    });

    const resumo = await servico.aplicarAposDjen('proc-1');

    expect(resumo).toMatchObject({ criadas: 1 });
    expect(compromissos).toHaveLength(1);
    expect(pub('pub-1').movimentacaoId).toBe('mov-1');
    // O andamento herda a atividade — é a trava que o robô cego sempre respeitou.
    expect(mov('mov-1').compromissoId).toBe(compromissos[0].id);
    expect(mov('mov-1').avaliadoMotivo).toBe(MOTIVOS_DO_ROBO.TEOR_NO_DIARIO);
    expect(mov('mov-1').avaliadoEm).toBeInstanceOf(Date);
    // A decisão é do robô, e a coluna da pessoa fica intocada.
    expect(mov('mov-1').avaliadoPor).toBeNull();
    expect(mov('mov-1').dispensadoEm).toBeUndefined();
  });

  /** Seis dias antes é a cauda (26 das 294): fato diferente, par nenhum. */
  it('não pareia o teor de seis dias antes do ato', async () => {
    const { servico, pub, mov } = bancoEmMemoria({
      publicacoes: [publicacao('pub-1', REPLICA, 9)],
      andamentos: [andamento('mov-1', 3)],
    });

    await servico.aplicarAposDjen('proc-1');

    expect(pub('pub-1').movimentacaoId).toBeNull();
    expect(mov('mov-1').avaliadoMotivo).toBeNull();
  });

  /**
   * A ordem está escrita no ato e vale para o fato, venha por onde vier: o
   * andamento pareado não pode ser reavaliado às cegas amanhã para produzir a
   * tarefa que o teor acabou de dispensar.
   */
  it('a ordem da parte contrária atravessa para o andamento, sem criar tarefa', async () => {
    const { servico, pub, mov, compromissos } = bancoEmMemoria({
      publicacoes: [publicacao('pub-1', ORDEM_DA_RECLAMADA, 6)],
      andamentos: [andamento('mov-1', 4)],
    });

    const resumo = await servico.aplicarAposDjen('proc-1');

    expect(resumo).toMatchObject({ criadas: 0, deOutraParte: 1 });
    expect(compromissos).toHaveLength(0);
    expect(pub('pub-1').tarefaDispensadaMotivo).toBe('ORDEM_DA_OUTRA_PARTE');
    expect(mov('mov-1').avaliadoMotivo).toBe(MOTIVOS_DO_ROBO.TEOR_NO_DIARIO);
    expect(mov('mov-1').compromissoId).toBeNull();
  });

  /**
   * "Nada a fazer" é resposta, não silêncio — e o vínculo é gravado junto, para
   * o andamento não ser reivindicado por outra publicação na noite seguinte.
   */
  it('a publicação sem providência também pareia e carimba', async () => {
    const { servico, pub, mov } = bancoEmMemoria({
      publicacoes: [publicacao('pub-1', LISTA_DE_DISTRIBUICAO, 5)],
      andamentos: [andamento('mov-1', 2)],
    });

    await servico.aplicarAposDjen('proc-1');

    expect(pub('pub-1').providencia).toBe('NENHUMA');
    expect(pub('pub-1').movimentacaoId).toBe('mov-1');
    expect(mov('mov-1').avaliadoMotivo).toBe(MOTIVOS_DO_ROBO.TEOR_NO_DIARIO);
  });
});

describe('a decisão de RELÓGIO não atravessa', () => {
  /**
   * O ERRO DE 17/09 QUE ISTO IMPEDE DE VOLTAR.
   *
   * "Notícia velha" mede QUANDO a publicação chegou a nós, não o que o ato
   * pede: são 1.419 das 2.380 do acervo. O andamento pareado pode ter entrado
   * hoje, dentro da janela, e ainda merecer o selo âmbar na ficha — propagar a
   * dispensa calaria o único lado que ainda poderia avisar.
   */
  it('a publicação anterior ao acompanhamento é dispensada, e o andamento fica intocado', async () => {
    const { servico, pub, mov } = bancoEmMemoria({
      publicacoes: [
        // Primeira publicação deste processo, baixada agora: o histórico dele
        // é tudo anterior ao momento em que passamos a olhar.
        publicacao('pub-1', REPLICA, 20, { createdAt: new Date() }),
      ],
      andamentos: [andamento('mov-1', 18)],
    });

    const resumo = await servico.aplicarAposDjen('proc-1');

    expect(resumo).toMatchObject({ criadas: 0, antigas: 1 });
    expect(pub('pub-1').tarefaDispensadaMotivo).toBe('NOTICIA_VELHA');
    // O par fica gravado (o fato é o mesmo), mas o andamento continua sem
    // carimbo: quem decide sobre ele é o outro caminho, e o selo âmbar segue.
    expect(pub('pub-1').movimentacaoId).toBe('mov-1');
    expect(mov('mov-1').avaliadoEm).toBeNull();
    expect(mov('mov-1').avaliadoMotivo).toBeNull();
    expect(mov('mov-1').compromissoId).toBeNull();
  });
});

describe('o andamento que já tem dono não é reivindicado de novo', () => {
  /**
   * O `jaTomadas` saía do próprio lote, que os chamadores filtram por
   * `movimentacaoId: null` — era sempre vazio. A publicação desta noite
   * reapontava o andamento que a da semana passada já descreve, e com a
   * propagação ligada isso carimbaria a decisão de um ato no andamento de
   * outro. Por isso a correção veio ANTES da propagação.
   */
  it('a publicação nova não rouba o andamento que outra já descreve', async () => {
    const { servico, pub, mov } = bancoEmMemoria({
      publicacoes: [
        publicacao('pub-velha', REPLICA, 7, {
          providencia: 'ELABORAR_MANIFESTACAO',
          prazoMencionadoDias: 15,
          movimentacaoId: 'mov-1',
          tarefaDispensadaEm: new Date(),
          tarefaDispensadaMotivo: 'ORDEM_DA_OUTRA_PARTE',
        }),
        publicacao('pub-nova', REPLICA, 2),
      ],
      andamentos: [andamento('mov-1', 4, { avaliadoMotivo: MOTIVOS_DO_ROBO.TEOR_NO_DIARIO })],
    });

    await servico.aplicarAposDjen('proc-1');

    expect(pub('pub-nova').movimentacaoId).toBeNull();
    expect(mov('mov-1').compromissoId).toBeNull();
    // E o carimbo que o ato de verdade deixou continua de pé.
    expect(mov('mov-1').avaliadoMotivo).toBe(MOTIVOS_DO_ROBO.TEOR_NO_DIARIO);
  });
});

/**
 * A PASSADA QUE SILENCIA ANDA MAIS CURTA — `vincularMovimentacoesNovas`.
 *
 * Ela é a única que grava `movimentacao.compromissoId` a partir de uma
 * publicação que JÁ virou atividade, e `compromissoId` é o silenciador mais
 * forte do sistema: apaga o selo âmbar e tira o andamento da varredura, para
 * sempre. Abrir o lado "antes" para cinco dias deu a ela um jeito NOVO de
 * errar — adotar um ato POSTERIOR à publicação que é outro fato.
 *
 * Medido na produção em 17/09/2026: doze pares candidatos, e nenhum deles é o
 * mesmo ato chegando atrasado — uma publicação de "avaliar recurso" ao lado de
 * uma "Conclusão para julgamento" dois dias depois; uma de "elaborar
 * manifestação" ao lado de um "Decurso de Prazo" quatro dias depois. (O filtro
 * de gatilho rejeita os doze hoje; por isso o defeito é latente, e não está no
 * ar. Mas quem o segura é uma proteção de outro assunto.)
 *
 * Três dias é o que a razão estrutural explica: disponibilizado em D, publicado
 * em D+1, e o fim de semana estica até D+3.
 */
describe('o teto da adoção de ato posterior', () => {
  const comAtividade = (atras: number) =>
    publicacao('pub-com-tarefa', REPLICA, atras, {
      providencia: 'ELABORAR_MANIFESTACAO',
      prazoMencionadoDias: 15,
      compromissoId: 'comp-existente',
      movimentacaoId: null,
    });

  it('o ato de três dias DEPOIS da publicação ainda é o mesmo fato', async () => {
    const { servico, mov } = bancoEmMemoria({
      publicacoes: [comAtividade(10)],
      andamentos: [andamento('mov-1', 7)],
    });
    await servico.vincularMovimentacoesNovas('proc-1');
    expect(mov('mov-1').compromissoId).toBe('comp-existente');
  });

  /**
   * E O DE QUATRO NÃO. Nada explica o par além da coincidência de datas — e o
   * preço de errar aqui é um ato de verdade calado para sempre, sem selo e sem
   * cartão com "Desfazer" para alguém consertar à mão.
   */
  it('o ato de quatro dias depois NÃO é adotado', async () => {
    const { servico, mov } = bancoEmMemoria({
      publicacoes: [comAtividade(10)],
      andamentos: [andamento('mov-1', 6)],
    });
    await servico.vincularMovimentacoesNovas('proc-1');
    expect(mov('mov-1').compromissoId).toBeNull();
  });

  /** O lado clássico (publicação DEPOIS do ato) continua inteiro. */
  it('a publicação de três dias depois do ato continua casando', async () => {
    const { servico, mov } = bancoEmMemoria({
      publicacoes: [comAtividade(4)],
      andamentos: [andamento('mov-1', 7)],
    });
    await servico.vincularMovimentacoesNovas('proc-1');
    expect(mov('mov-1').compromissoId).toBe('comp-existente');
  });
});
