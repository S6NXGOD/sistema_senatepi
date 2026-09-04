import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const ler = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
/** Sem comentários: o texto que explica uma remoção não pode reprovar o teste dela. */
const lerCodigo = (rel: string) =>
  ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SERVICO = lerCodigo('processos.service.ts');
const PARTES = lerCodigo('partes.service.ts');
const DTO = lerCodigo('dto/processos.dto.ts');

/**
 * O POLO ATIVO NÃO É UMA ESCOLHA ENTRE TRÊS CAIXAS.
 *
 * Era: `INSTITUCIONAL` OU `FILIADOS` OU `OUTRA`, e a gravação seguia um
 * `if/else if` igualmente exclusivo. Dá conta de 126 dos 127 processos da
 * produção — e não dá conta do litisconsórcio com outro sindicato, nem do
 * sindicato entrando ao lado do filiado.
 */
describe('a relação ordenada do polo ativo', () => {
  it('o DTO aceita uma lista de partes de tipos misturados', () => {
    expect(DTO).toContain('export class ParteDoPoloDto');
    expect(DTO).toContain("IsIn(['FILIADO', 'INSTITUCIONAL', 'ORGANIZACAO', 'AVULSA']");
    expect(DTO).toContain('partes?: ParteDoPoloDto[];');
  });

  it('a relação vence o resumo quando vem preenchida', () => {
    expect(SERVICO).toContain('if (p.partes?.length) return this.resolverPartesDoPolo(p.partes);');
  });

  /**
   * O NOME GRAVADO É O DO CADASTRO, e não o que a tela mandou: corrigir o
   * cadastro depois deixaria as duas grafias divergindo para sempre.
   */
  it('resolve o nome contra o cadastro, não contra o payload', () => {
    expect(SERVICO).toContain('partes.push({ nome: f.nomeCompleto, documento: f.cpf, filiadoId: f.id });');
    expect(SERVICO).toContain('partes.push({ nome: org.nome, documento: org.documento, parteExternaId: org.id });');
  });

  /**
   * A AÇÃO É INSTITUCIONAL QUANDO NÃO HÁ FILIADO NELA — e não quando o
   * sindicato aparece. Em litisconsórcio o sindicato entra AO LADO do filiado,
   * e aí o processo continua sendo daquela pessoa: é a ficha dela que precisa
   * mostrá-lo, e é ela que o painel conta.
   */
  it('o sindicato ao lado de um filiado não torna a ação institucional', () => {
    expect(SERVICO).toContain('return { institucional: filiados.length === 0, filiados, avulso: null, partes };');
  });

  it('recusa um polo ativo vazio', () => {
    expect(SERVICO).toContain("throw new BadRequestException('Informe ao menos uma parte no polo ativo.')");
  });

  /** O caminho antigo continua vivo: é o que o payload da tela velha manda. */
  it('a cadeia antiga fica de pé para o payload sem `partes`', () => {
    expect(PARTES).toContain('} else if (entradas.institucional) {');
    expect(PARTES).toContain('} else if (entradas.filiadosAtivos?.length) {');
  });

  it('grava na ordem, e o primeiro é o principal', () => {
    expect(PARTES).toContain('if (entradas.poloAtivoPartes?.length) {');
    expect(PARTES).toContain('principal: i === 0,');
  });
});

/**
 * A MESMA EMPRESA DUAS VEZES — uma pelo cadastro, outra digitada à mão.
 *
 * A chave era `parteExternaId` OU `nome|documento`, e por isso não pegava
 * justamente esse caso: escolher no cadastro dá chave de id, digitar dá chave
 * de nome. A tela do usuário mostrou as duas linhas de PRONTOCARE.
 */
describe('a duplicata que passava pelas duas chaves', () => {
  it('marca id E nome normalizado para cada réu que entra', () => {
    expect(PARTES).toContain('const porNome = this.comparavel(nome);');
    expect(PARTES).toContain('if ((porId && jaVistos.has(porId)) || jaVistos.has(porNome)) continue;');
    expect(PARTES).toContain('jaVistos.add(porNome);');
  });

  it('o polo ativo dedupa pelo mesmo critério', () => {
    expect(PARTES).toContain('if (vistos.has(chave) || vistos.has(this.comparavel(nome))) continue;');
  });

  /**
   * Os dois lados precisam concordar sobre o que é "a mesma parte": a tela
   * recusar o que o banco aceitaria é confuso; o banco aceitar o que a tela
   * recusa cria a duplicata pela API.
   */
  it('usa a mesma normalização da tela', () => {
    expect(PARTES).toContain("normalize('NFD')");
    expect(PARTES).toContain("replace(/[\\u0300-\\u036f]/g, '')");
    expect(PARTES).toContain("replace(/[^A-Z0-9]/g, '')");
  });
});

/**
 * O ADVOGADO PRECISA PROCURAR FILIADO PARA VINCULAR A PARTE.
 *
 * A rota de autocomplete era `@Roles(ADMINISTRADOR, COORDENACAO)`, e o preset
 * do ADVOGADO tem `filiados: VISUALIZAR`. Ao importar um processo, a busca do
 * polo ativo respondia 403 — e a tela, que trata erro como lista vazia, dizia
 * "Nenhum filiado encontrado". A saída que sobrava era "a parte não é o
 * sindicato nem um filiado", e o processo nascia sem dono.
 */
describe('quem pode procurar no cadastro de filiados', () => {
  const CONTROLLER = lerCodigo('../filiados/admin-filiados.controller.ts');

  it('a busca não tem mais lista de perfis chumbada', () => {
    expect(CONTROLLER).not.toContain('@Roles(');
  });

  /** Quem manda é a matriz: `@Modulo('filiados')` + GET ⇒ VISUALIZAR. */
  it('o gate por módulo continua valendo', () => {
    expect(CONTROLLER).toContain("@Modulo('filiados')");
    expect(CONTROLLER).toContain("@ModuloTenant('filiados')");
  });

  /**
   * E O GUARDA REALMENTE BARRAVA — exercitado, não suposto.
   *
   * Sem isto, a afirmação "o advogado tomava 403" seria leitura de decorador.
   * `RolesGuard` com uma lista não-vazia que não contém o perfil devolve
   * `false`, e nenhuma permissão de módulo salva depois disso.
   */
  it('a lista de perfis, quando existe, barra quem não está nela', () => {
    const contexto = (role: string) =>
      ({
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as never;

    const comLista = new RolesGuard({
      getAllAndOverride: (chave: string) =>
        chave === ROLES_KEY ? ['ADMINISTRADOR', 'COORDENACAO'] : undefined,
    } as never);
    expect(comLista.canActivate(contexto('ADVOGADO'))).toBe(false);
    expect(comLista.canActivate(contexto('COORDENACAO'))).toBe(true);

    // Sem lista, quem decide é o `PermissionsGuard` — que é o estado novo da rota.
    const semLista = new RolesGuard({ getAllAndOverride: () => undefined } as never);
    expect(semLista.canActivate(contexto('ADVOGADO'))).toBe(true);
  });
});

/**
 * A ETIQUETA QUE O ACERVO USA CONTRA AQUELE RÉU.
 *
 * A única automação de etiqueta que os dados sustentam — e sustentam pela
 * METADE, medido em 04/09/2026: entre os oito réus com 3+ processos
 * etiquetados, a dominante cobre 70% ou mais em QUATRO. UNIMED tem `RETALIAÇÃO`
 * nos sete; FMS/THE, o maior réu, fica em 33%.
 *
 * As outras duas hipóteses foram medidas e DESCARTADAS:
 *  · o assunto do CNJ não prevê o pedido — "Assistência Judiciária Gratuita" é
 *    o assunto de processos etiquetados INSALUBRIDADE, REAJUSTE e SELETIVO
 *    SIMPLIFICADO;
 *  · o ano da distribuição não prevê a CCT — `CCT 2018/2020` aparece em
 *    processos de 2021 a 2025.
 */
describe('etiquetas do acervo, por réu', () => {
  const CONTROLLER = lerCodigo('partes.controller.ts');

  it('a rota aceita o réu como parâmetro opcional', () => {
    expect(CONTROLLER).toContain("etiquetasDoAcervo(@Query('parteExternaId') parteExternaId?: string)");
    expect(CONTROLLER).toContain('parteExternaId?.trim() || undefined');
  });

  it('sem réu, devolve o acervo como antes', () => {
    expect(PARTES).toContain('if (!parteExternaId) return geral;');
  });

  /**
   * `parte_externa_id` é TEXT (o Prisma gera cuid, não uuid). Eu tinha escrito
   * `= $1::uuid` por hábito e o Postgres recusava a comparação inteira —
   * "operator does not exist: text = uuid", 500 na tela. Só apareceu quando
   * rodei a consulta contra dados reais.
   */
  it('compara texto com texto, sem cast para uuid', () => {
    expect(PARTES).toContain('AND pp.parte_externa_id = ${parteExternaId}');
    expect(PARTES).not.toContain('${parteExternaId}::uuid');
  });

  it('o número vem separado, para a tela ordenar sem marcar nada', () => {
    expect(PARTES).toContain("mapa.has(g.etiqueta) ? { ...g, noReu: mapa.get(g.etiqueta) } : g");
  });
});

/**
 * QUEM CADASTRA ORGANIZAÇÃO no meio do processo.
 *
 * `POST /partes-externas` vive sob `@Modulo('processos')`, então exige EDITAR
 * em PROCESSOS — que é justamente quem alcança o modal de importação. Não há
 * botão morto: o ADVOGADO tem `processos: EDITAR`.
 */
describe('cadastrar organização a partir do processo', () => {
  it('o gate é o do módulo processos', () => {
    const src = lerCodigo('partes.controller.ts');
    const externas = src.slice(src.indexOf("@Controller('partes-externas')"));
    expect(src).toContain("@Modulo('processos')");
    expect(externas).not.toContain('@Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)');
  });
});
