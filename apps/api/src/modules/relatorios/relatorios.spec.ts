import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { csvDaEquipe } from './relatorios.controller';
import { PRESETS_PERFIL, MODULO_KEYS } from '../../common/permissions/permissoes.constants';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const SERVICO = ler('src/modules/relatorios/relatorios.service.ts');
const DOSSIE = ler('src/modules/processos/dossie-processo.service.ts');

/**
 * RELATÓRIOS — para cobrar o que ficou e mostrar o que foi feito.
 *
 * O risco desta funcionalidade não é técnico: é virar placar. São nove
 * advogados que se conhecem pelo nome, e uma tabela ordenada por volume compara
 * publicamente casos que não são comparáveis — uma execução simples e uma ação
 * civil pública contam "1" cada.
 */
describe('o relatório não é um placar', () => {
  it('a ordem é alfabética, e não por volume', () => {
    expect(SERVICO).toContain("orderBy: { nome: 'asc' }");
    // Nada de ordenar a equipe por número entregue.
    const bloco = SERVICO.slice(SERVICO.indexOf('const equipe: LinhaEquipe[]'));
    expect(bloco.slice(0, 900)).not.toMatch(/sort\(.*concluidas/);
  });

  /** Zero pode ser férias, ou um mês dentro de uma ação civil pública. */
  it('quem fechou zero continua na lista', () => {
    const bloco = SERVICO.slice(SERVICO.indexOf('const equipe: LinhaEquipe[]'));
    expect(bloco.slice(0, 900)).toContain('pessoas.map((p)');
    expect(bloco.slice(0, 900)).not.toContain('.filter((p) => ');
  });

  it('não existe pontuação, posição nem meta', () => {
    for (const proibido of ['ranking', 'score', 'pontuacao', 'posicao', 'meta', 'ranking']) {
      expect(SERVICO.toLowerCase()).not.toContain(`${proibido}:`);
    }
  });

  /**
   * MEDIANA, e não média. Uma atividade esquecida aberta a noite inteira
   * distorce a média e não move a mediana.
   */
  it('usa mediana', () => {
    expect(SERVICO).toContain('function mediana(');
    expect(SERVICO).toContain('medianaMinutos');
  });
});

describe('o recorte por perfil', () => {
  /**
   * O ADVOGADO VÊ O PRÓPRIO ESPELHO. A permissão é VISUALIZAR para ele, e o
   * recorte é no serviço — senão "relatório de equipe" seria publicar a
   * produção de cada um para todos.
   */
  it('o advogado recebe só a linha dele', () => {
    expect(SERVICO).toContain("const souAdvogado = usuario.role === 'ADVOGADO';");
    expect(SERVICO).toContain('const alvo = souAdvogado ? usuario.id : foco;');
    expect(SERVICO).toContain('where: alvo ? { id: alvo } : { ativo: true }');
  });

  /**
   * O FOCO É DA COORDENAÇÃO, e o advogado não alcança.
   *
   * O parâmetro `usuarioId` recorta o relatório numa pessoa — serve para
   * conversar com ela. Se o advogado pudesse usá-lo, "o meu relatório" viraria
   * "o relatório de quem eu quiser", que é exatamente o placar que a decisão de
   * produto recusa.
   */
  it('o advogado não pode focar em outra pessoa', () => {
    expect(SERVICO).toContain('const foco = souAdvogado ? undefined : focoId?.trim() || undefined;');
  });

  /**
   * O MESMO NÚMERO NOS DOIS ESCOPOS. A primeira versão filtrava o escopo
   * pessoal por "sou o responsável" e contava o global por "quem concluiu": o
   * mesmo advogado aparecia com 13 no relatório dele e 15 no da coordenação.
   * Dois números para a mesma pergunta é pior que número nenhum.
   */
  it('concluída conta para quem concluiu, nos dois escopos', () => {
    expect(SERVICO).toContain('...(alvo ? { concluidoPor: alvo } : {})');
    expect(SERVICO).toContain('const quem = c.concluidoPor ?? c.responsavelId;');
  });

  it('a matriz de permissões conhece o módulo novo', () => {
    expect(MODULO_KEYS).toContain('relatorios');
    expect(PRESETS_PERFIL.COORDENACAO.relatorios).toBe('VISUALIZAR');
    expect(PRESETS_PERFIL.ADVOGADO.relatorios).toBe('VISUALIZAR');
    // O balcão tem a própria fila no painel; relatório de equipe é do jurídico.
    expect(PRESETS_PERFIL.TRIAGEM.relatorios).toBe('SEM_ACESSO');
    expect(PRESETS_PERFIL.ADMINISTRADOR.relatorios).toBe('EDITAR');
  });

  /** Toda chave da matriz precisa de valor em todo perfil, ou o gate cai em SEM_ACESSO por acidente. */
  it('nenhum perfil ficou sem valor para algum módulo', () => {
    for (const [perfil, matriz] of Object.entries(PRESETS_PERFIL)) {
      for (const chave of MODULO_KEYS) {
        expect(`${perfil}.${chave}=${matriz[chave]}`).not.toContain('undefined');
      }
    }
  });
});

describe('"novo" não é "cadastrado"', () => {
  /**
   * Na primeira carga do acervo, 127 processos entraram no sistema em agosto e o
   * mais antigo é de 2015. "127 novos no mês" seria uma afirmação falsa sobre o
   * trabalho da equipe.
   */
  it('separa ajuizado de cadastrado', () => {
    expect(SERVICO).toContain('cadastrados: processosNovos');
    expect(SERVICO).toContain('distribuidos: processosDistribuidos');
    expect(SERVICO).toContain('where: { dataDistribuicao: noPeriodo }');
  });
});

describe('as contas que estavam erradas', () => {
  /**
   * ATRASADA É O DIA QUE VIROU. O relatório usava a hora passada — a conta que
   * o painel e o sino já tinham abandonado — e a tela escrevia "prazo vencido"
   * sobre a tarefa das 15h às 15h01.
   */
  it('atrasada usa o início do dia, e não o relógio', () => {
    expect(SERVICO).toContain('const hojeIni = inicioDoDiaBR(agora);');
    // A soma por pessoa saiu para `contarAbertasPorPessoa` em 13/09/2026, para a
    // linha da equipe usar a régua `daPessoa`; o corte pelo dia é provado com
    // valores em abertas-da-pessoa.util.spec.ts.
    expect(SERVICO).toContain('const abertasPorPessoa = contarAbertasPorPessoa(abertas, hojeIni);');
    expect(SERVICO).toContain('atrasadas: abertas.filter((a) => a.inicio < hojeIni).length');
    expect(SERVICO).not.toContain('a.inicio < agora');
  });

  /** "Encerrados no período" contava qualquer atualização do cadastro, inclusive a do robô. */
  it('encerrados é o estoque de hoje, e não um fluxo por data de atualização', () => {
    expect(SERVICO).toContain(
      'this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ENCERRADO } })',
    );
    expect(SERVICO).not.toContain('updatedAt: noPeriodo');
  });

  /** O zero de "ajuizadas" precisa dizer quantos ainda não têm data no CNJ. */
  it('diz quantos ativos estão sem data de distribuição', () => {
    expect(SERVICO).toContain('where: { statusInterno: StatusProcesso.ATIVO, dataDistribuicao: null },');
  });
});

describe('o sindicato na Justiça', () => {
  const JUSTICA = SERVICO.slice(
    SERVICO.indexOf('private async justica('),
    SERVICO.indexOf('private async proximos('),
  );

  /**
   * RECORTAR SENTENÇA POR ADVOGADO seria publicar taxa de vitória de colega — o
   * placar que este módulo recusa, entrando por outra porta.
   */
  it('não recebe nem usa o recorte de pessoa', () => {
    expect(JUSTICA).toContain('private async justica(inicio: Date, fim: Date, agora: Date)');
    for (const proibido of ['alvo', 'soMeu', 'responsavelId', 'advogadoId']) {
      expect(`${proibido}: ${JUSTICA.includes(proibido)}`).toBe(`${proibido}: false`);
    }
  });

  /** Os códigos de julgamento vêm do Panorama: duas listas divergiriam em silêncio. */
  it('conta com os mesmos carimbos e as mesmas CTEs do Panorama', () => {
    expect(SERVICO).toContain("} from '../processos/padroes.service';");
    expect(SERVICO).toContain('const base = baseDoAcervo(cnpj);');
    expect(JUSTICA).not.toMatch(/\b(219|220|221)\b/);
  });

  it('só vai para quem vê processos; os próximos dias, para quem vê a agenda', () => {
    expect(SERVICO).toContain(
      "const veProcessos = nivelEfetivo(role, usuario.permissoes, 'processos') !== 'SEM_ACESSO';",
    );
    expect(SERVICO).toContain('veProcessos ? this.justica(inicio, fim, agora) : null,');
    expect(SERVICO).toContain(
      "const veAgenda = nivelEfetivo(role, usuario.permissoes, 'agenda') !== 'SEM_ACESSO';",
    );
    expect(SERVICO).toContain('veAgenda ? this.proximos(soMeu, hojeIni) : null,');
  });
});

describe('publicações e robô', () => {
  /** Leitura da casa: o advogado e o espelho de uma pessoa não recebem. */
  it('só na visão da casa', () => {
    expect(SERVICO).toContain('const daCasa = !alvo && veProcessos;');
    expect(SERVICO).toContain('daCasa && djenLigado ? this.publicacoes(inicio, fim) : null,');
    expect(SERVICO).toContain('daCasa ? this.robo(inicio, fim) : null,');
  });

  /**
   * A FILA É ESTADO, NÃO PERÍODO — e a regra é a da busca de publicações.
   * Cortar pela data esconderia justamente o que espera há mais tempo.
   */
  it('a fila de decisão usa a regra da busca, sem corte de data', () => {
    expect(SERVICO).toContain("import { ESPERANDO_DECISAO } from '../processos/djen-busca.service';");
    expect(SERVICO).toContain('this.prisma.comunicacaoDjen.count({ where: ESPERANDO_DECISAO }),');
  });

  /** Tarefa cancelada pelo próprio robô não é trabalho que ele deu a alguém. */
  it('separa o que o robô cancelou do que uma pessoa teve de cancelar', () => {
    expect(SERVICO).toContain('status: StatusCompromisso.CANCELADO, canceladoPor: null');
    expect(SERVICO).toContain(
      'canceladasPorPessoas: doStatus(StatusCompromisso.CANCELADO) - canceladasPeloRobo,',
    );
  });
});

describe('o CSV', () => {
  const relatorio = {
    periodo: { de: '2026-08-01T03:00:00.000Z', ate: '2026-09-01T03:00:00.000Z' },
    escopo: 'GLOBAL' as const,
    focoUsuario: null,
    equipe: [
      {
        usuarioId: 'u1', nome: 'Dr. Murilo', papel: 'ADVOGADO',
        concluidas: 15, abertas: 0, atrasadas: 0, medianaMinutos: 16, cronometradas: 7,
      },
      {
        usuarioId: 'u2', nome: 'Aspas "no" nome', papel: 'ADVOGADO',
        concluidas: 0, abertas: 2, atrasadas: 1, medianaMinutos: null, cronometradas: 0,
      },
    ],
    atividades: {
      concluidas: 15, canceladas: 0, abertas: 2, atrasadas: 1,
      porDesfecho: [], porTipo: [], automaticas: 0, manuais: 15,
    },
    processos: {
      cadastrados: 0, distribuidos: 0, ativos: 0, encerrados: 0, semDataDeDistribuicao: 0,
      porArea: [], porTribunal: [],
    },
    atendimentos: {
      registrados: 0, concluidos: 0, filiadosAtendidos: 0, porCanal: [], porAtendente: [],
      porAssunto: [], assuntoNaoInformado: 0, outrosAssuntos: [], outrosUnicos: 0, porSetor: [],
    },
    justica: null,
    proximos: null,
    publicacoes: null,
    robo: null,
    geradoEm: '2026-09-04T00:00:00.000Z',
  };

  /** Excel em português: separador `;` e BOM, senão os acentos quebram. */
  it('sai no formato que o Excel brasileiro abre', () => {
    const csv = csvDaEquipe(relatorio);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain(';');
    expect(csv).toContain('\r\n');
  });

  /** Aspas no nome quebrariam a coluna se não fossem dobradas. */
  it('escapa aspas', () => {
    expect(csvDaEquipe(relatorio)).toContain('"Aspas ""no"" nome"');
  });

  it('mediana ausente vira célula vazia, e não zero', () => {
    const linha = csvDaEquipe(relatorio).split('\r\n')[2];
    expect(linha).toContain(';;'); // a coluna da mediana sai vazia
    expect(linha).not.toContain('"0";"0"'); // não inventa zero de amostra vazia
  });
});

/**
 * O DOSSIÊ É O PAPEL QUE SAI DO ESCRITÓRIO. O que ele não leva importa mais que
 * o que leva.
 */
describe('o dossiê do processo', () => {
  it('nunca inclui nota interna nem anotação do robô', () => {
    expect(DOSSIE).toContain('where: { notaInterna: false, origemSistema: false }');
  });

  /** O filtro é na CONSULTA: nota interna que chega ao gerador pode vazar. */
  it('o filtro é na consulta, não na montagem', () => {
    const consulta = DOSSIE.slice(
      DOSSIE.indexOf('movimentacoesInternas: {'),
      DOSSIE.indexOf('if (!p) throw'),
    );
    expect(consulta).toContain('notaInterna: false');
  });

  /** Opinar sobre desfecho em papel entregue ao filiado cria expectativa. */
  it('não emite prognóstico', () => {
    expect(DOSSIE.toLowerCase()).not.toMatch(/\b(chance|probabilidade|previs[aã]o de ganho)\b/);
  });

  /**
   * A base do CNJ ATRASA — mediana de 41 dias medida neste acervo. Sem a
   * ressalva, o dossiê mente por omissão no dia em que o tribunal ainda não
   * alimentou o índice.
   */
  it('avisa que a fonte pública atrasa', () => {
    expect(DOSSIE).toContain('const FONTE_CNJ =');
    expect(DOSSIE).toContain('atraso de alimentação pelos tribunais');
  });

  it('corta a lista de andamentos', () => {
    expect(DOSSIE).toContain('const MAX_ANDAMENTOS = 25;');
  });
});
