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
    expect(SERVICO).toContain('where: souAdvogado ? { id: usuario.id } : { ativo: true }');
  });

  /**
   * O MESMO NÚMERO NOS DOIS ESCOPOS. A primeira versão filtrava o escopo
   * pessoal por "sou o responsável" e contava o global por "quem concluiu": o
   * mesmo advogado aparecia com 13 no relatório dele e 15 no da coordenação.
   * Dois números para a mesma pergunta é pior que número nenhum.
   */
  it('concluída conta para quem concluiu, nos dois escopos', () => {
    expect(SERVICO).toContain('...(souAdvogado ? { concluidoPor: usuario.id } : {})');
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

describe('o CSV', () => {
  const relatorio = {
    periodo: { de: '2026-08-01T03:00:00.000Z', ate: '2026-09-01T03:00:00.000Z' },
    escopo: 'GLOBAL' as const,
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
    atividades: { concluidas: 15, canceladas: 0, abertas: 2, atrasadas: 1, porDesfecho: [] },
    processos: { cadastrados: 0, distribuidos: 0, ativos: 0, encerrados: 0, porArea: [], porTribunal: [] },
    atendimentos: { registrados: 0, concluidos: 0, porCanal: [], porAtendente: [] },
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
