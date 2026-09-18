import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria,
  DecisaoDuplicata,
  Prisma,
  TipoHistoricoFiliado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { formatarDataBR } from '../processos/utils/data-br.util';
// O validador de CPF já existe na importação — reusar em vez de escrever um
// terceiro: duas funções com a mesma pergunta e regras diferentes já
// custaram caro neste projeto (ver as duas `normalizarNome`).
import { cpfValido } from '../importacao/mapeamento.util';

/**
 * Confiança de que o grupo é a MESMA pessoa cadastrada mais de uma vez.
 *
 * O nível NÃO vem da semelhança do nome — vem da ausência de contradição entre
 * os campos e da presença de corroboração. Dois "MARIA DA SILVA" idênticos são
 * fracos como evidência; dois "MARIA DA SILVA" na mesma cidade, um deles com
 * CPF e o outro vazio, são fortes.
 */
export type Confianca = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface CandidatoDuplicata {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  numeroCoren: string | null;
  cidade: string | null;
  estado: string | null;
  telefonePrincipal: string | null;
  email: string | null;
  dataNascimento: Date | null;
  endereco: string | null;
  situacao: string;
  dataFiliacao: Date | null;
  createdAt: Date;
  temFoto: boolean;
  vinculos: number;
  /** Quanto o cadastro está preenchido — ver `PESOS`. */
  pontuacao: number;
  /** Sugerido para MANTER. Falso em todos quando há empate. */
  sugerido: boolean;
}

export interface GrupoDuplicata {
  chave: string;
  confianca: Confianca;
  /** Como o grupo foi formado, em português. */
  criterio: string;
  /** Por que o sugerido foi escolhido — nulo quando não houve escolha. */
  motivoSugestao: string | null;
  /**
   * Falso quando os candidatos empatam em completude. A tela precisa dizer
   * "o sistema não sabe escolher" em vez de fingir uma recomendação: em 261
   * dos grupos de produção não há critério que decida, e 144 deles estão
   * completamente vazios dos dois lados.
   */
  decidiu: boolean;
  /** Campos que divergem entre os candidatos (o que derruba a confiança). */
  contradicoes: string[];
  /**
   * Quando o CPF é um dos campos que divergem: o que o dígito verificador diz.
   * Nulo quando não há conflito de CPF. Ver `analisarCpfs`.
   */
  cpfEmConflito: AnaliseDeCpf | null;
  /**
   * NINGUÉM do grupo tem dado que identifique pessoa — ver `esperandoDado`.
   * Não é pendência: é uma pergunta sem resposta possível hoje.
   */
  esperandoDado: boolean;
  /**
   * O NOME BASTA COMO PROVA neste grupo — ver `nomeECidadeBastam`.
   *
   * Verdadeiro para nome idêntico e para abreviação ("PEDRO S. C. RIBEIRO" ×
   * "PEDRO SILVA COSTA RIBEIRO"). FALSO para o subconjunto sem abreviação
   * ("MARIA DAS GRAÇAS SILVA" × "MARIA DAS GRAÇAS MENDES SILVA"), em que o
   * token extra não tem inicial que o justifique: são duas pessoas.
   */
  nomeConfirmado: boolean;
  candidatos: CandidatoDuplicata[];
}

/** Um par marcado como pessoas diferentes — o que saiu da fila e ainda tem volta. */
export interface ParDescartado {
  /** Id da decisão: é o que `voltarParaFila` apaga. */
  id: string;
  autor: string | null;
  decididoEm: Date;
  cadastros: {
    id: string;
    nomeCompleto: string;
    matricula: string;
    cidade: string | null;
    cpf: string | null;
    dataNascimento: Date | null;
  }[];
}

/**
 * Peso de cada campo na completude do cadastro.
 *
 * CPF e COREN valem mais porque IDENTIFICAM a pessoa: um cadastro com CPF é
 * recuperável e conferível, um com telefone não. Os demais valem 1 — são
 * dados úteis, não âncoras de identidade.
 */
/**
 * Teto de cadastros numa decisão de grupo. O maior grupo da produção tem sete
 * (17/09/2026); dez dá folga sem deixar uma chamada fundir meia base por engano.
 */
const MAXIMO_POR_GRUPO = 10;

const PESOS = {
  cpf: 3,
  numeroCoren: 3,
  dataNascimento: 2,
  cidade: 1,
  telefonePrincipal: 1,
  email: 1,
  endereco: 1,
  foto: 1,
  vinculo: 1,
} as const;

/** Campos que, divergindo entre dois cadastros, indicam pessoas diferentes. */
const CAMPOS_CONTRADITORIOS = [
  { campo: 'cpf', rotulo: 'CPF' },
  { campo: 'numeroCoren', rotulo: 'COREN' },
  { campo: 'cidade', rotulo: 'cidade' },
  { campo: 'dataNascimento', rotulo: 'data de nascimento' },
] as const;

/** Linha crua devolvida pelas consultas de agrupamento. */
interface LinhaCandidato {
  chave: string;
  id: string;
  nome_completo: string;
  matricula: string;
  cpf: string | null;
  numero_coren: string | null;
  cidade: string | null;
  estado: string | null;
  telefone_principal: string | null;
  email: string | null;
  data_nascimento: Date | null;
  endereco: string | null;
  situacao: string;
  data_filiacao: Date | null;
  created_at: Date;
  tem_foto: boolean;
  vinculos: number;
  /** Só nos pares por subconjunto: a inicial abreviada casa com o nome extenso. */
  abreviacao?: boolean;
}

/**
 * O CADASTRO CARREGA ALGUMA INFORMAÇÃO DE VERDADE?
 *
 * A CIDADE NÃO CONTA (18/09/2026). Ela vale 1 na pontuação de completude — o que
 * é justo para escolher QUAL cadastro fica —, mas não serve para decidir se o
 * outro pode sair, por duas razões:
 *
 *  1. Ela não se perde. `fundir` copia a cidade para o cadastro que fica quando
 *     lá está vazia, junto com bairro, endereço e o resto. A promessa do lote
 *     ("nada do que sai se perde") continua inteira.
 *  2. Ela não distingue ninguém. Uma cidade num lado e nenhuma no outro não é
 *     indício de que são pessoas diferentes; e quando as duas cidades DIVERGEM
 *     isso já é contradição, e o grupo nem chega ao lote.
 *
 * MEDIDO NA PRODUÇÃO (18/09/2026, 389 grupos na fila): com a régua antiga o
 * lote oferecia ZERO pares — estava esgotado, e os 389 pareciam todos trabalho
 * de gente. Com a cidade fora, entram 128 pares e 115 grupos se fecham; em 110
 * deles o cadastro removido tinha exatamente uma cidade e mais nada.
 *
 * O mesmo critério responde à outra pergunta: se NINGUÉM do grupo tem dado
 * próprio, não há como decidir — ver `esperandoDado`.
 */
export function temDadoProprio(c: CandidatoDuplicata): boolean {
  const cheio = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';
  return (
    cheio(c.cpf) || cheio(c.numeroCoren) || !!c.dataNascimento ||
    cheio(c.telefonePrincipal) || cheio(c.email) || cheio(c.endereco) ||
    c.temFoto || c.vinculos > 0
  );
}

/**
 * O GRUPO NÃO TEM COMO SER DECIDIDO — por ninguém, nem por gente.
 *
 * Nenhum dos cadastros tem CPF, COREN, nascimento, contato, endereço, foto ou
 * vínculo: são nomes iguais e mais nada. Não dá para consolidar (seria juntar
 * dois desconhecidos) nem para afirmar que são pessoas diferentes.
 *
 * Isto NÃO é uma pendência da equipe, e cobrá-la como se fosse é o que faz uma
 * fila de 1.400 itens parecer trabalho atrasado. A saída não é decidir: é o
 * cadastro ganhar um dado — no recadastramento, num atendimento, numa ficha de
 * processo. Aí o grupo volta a ser decidível sozinho.
 */
/** Um par do lote: quem fica, quem sai, e se a filiação antiga vem junto. */
export interface ItemDoLote {
  manterId: string;
  descartarId: string;
  nome: string;
  manterMatricula: string;
  descartarMatricula: string;
  recuaFiliacao: boolean;
}

export function esperandoDado(candidatos: CandidatoDuplicata[]): boolean {
  return !candidatos.some(temDadoProprio) && !cidadeConfirmada(candidatos);
}

const textoDe = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().toLowerCase();
};

/** Todos têm cidade preenchida, e é a MESMA. Divergir já seria contradição. */
export function cidadeConfirmada(candidatos: CandidatoDuplicata[]): boolean {
  const cidades = candidatos.map((c) => textoDe(c.cidade));
  return cidades.every((c) => c !== '') && new Set(cidades).size === 1;
}

/** Campos em que um valor do removido sumiria se divergisse do mantido. */
const CAMPOS_QUE_SOMEM = [
  'cpf', 'numeroCoren', 'dataNascimento', 'cidade', 'telefonePrincipal', 'email', 'endereco',
] as const;

/**
 * NADA SE PERDE NA FUSÃO: em cada campo, ou um só lado tem valor, ou os dois
 * têm o MESMO. É mais estrito que "sem contradição" — contradição olha quatro
 * campos, este olha todos os que a fusão copia.
 */
export function semValorDivergente(candidatos: CandidatoDuplicata[]): boolean {
  return CAMPOS_QUE_SOMEM.every((campo) => {
    const valores = candidatos
      .map((c) => textoDe(c[campo as keyof CandidatoDuplicata]))
      .filter((v) => v !== '');
    return new Set(valores).size <= 1;
  });
}

/**
 * O NOME E A CIDADE JÁ BASTAM — DECISÃO DO DONO, 18/09/2026.
 *
 * Eu havia medido e dito o contrário: dos grupos que sobravam, a maioria não
 * concorda em NADA além de nome e cidade, porque não há mais nada preenchido em
 * nenhum dos lados. Recomendei deixá-los fora do lote. A resposta foi direta:
 *
 *   "Por mim, se concordar com o nome igual e cidade, já pode tirar esses
 *    grupos, já economiza trabalho. E se for abreviado também, exemplo, Pedro
 *    Silva Costa Ribeiro e Pedro S. C. Ribeiro (...), pode remover também."
 *
 * É decisão dele, e é defensável: 62% dos filiados ATIVOS não têm CPF, então
 * esperar por um dado que talvez nunca chegue é manter a base suja para sempre.
 * O que o lote apaga é um cadastro sem informação, com a matrícula preservada
 * no histórico e a filiação mais antiga prevalecendo.
 *
 * O QUE NÃO ENTROU, e a distinção é dos exemplos dele: os três são ABREVIAÇÃO.
 * O outro tipo de nome parecido — "MARIA DAS GRAÇAS SILVA" × "MARIA DAS GRAÇAS
 * MENDES SILVA", em que o token extra não tem inicial que o justifique — não é
 * abreviação de nada, é outra pessoa, e continua na revisão um a um
 * (`nomeConfirmado` falso).
 *
 * NÃO DESFAZER ISTO achando que foi descuido: ver o teste que guarda a data e
 * a frase do pedido.
 */
export function nomeECidadeBastam(grupo: {
  nomeConfirmado: boolean;
  candidatos: CandidatoDuplicata[];
}): boolean {
  return (
    grupo.nomeConfirmado &&
    todaInicialExplicada(grupo.candidatos.map((c) => c.nomeCompleto)) &&
    cidadeConfirmada(grupo.candidatos) &&
    semValorDivergente(grupo.candidatos)
  );
}

/** Ligações e iniciais soltas não distinguem ninguém — a mesma lista do SQL. */
const SEM_VALOR_NO_NOME = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

/**
 * Tokens do nome para comparar DOIS nomes ENTRE SI.
 *
 * NÃO é um normalizador de nome de uso geral, e não deve virar um: já existem
 * dois no projeto com a mesma assinatura e regras opostas, e um deles COLA o
 * nome inteiro. Aqui só interessa tirar acento, caixa e pontuação para alinhar
 * os tokens de duas grafias da mesma pessoa.
 */
function tokensDoNome(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * TODA INICIAL TEM DE EXPLICAR UM NOME — e todo nome a mais, uma inicial.
 *
 * O SQL do agrupamento marca `abreviacao` quando UMA inicial casa com UM token
 * extra. Isso basta para levantar a suspeita, e não basta para apagar cadastro:
 *
 *   SANDRA MARIA DOS A. SILVA  ×  SANDRA MARIA DE ANDRADE PINHO SILVA
 *
 * o "A." explica "ANDRADE", e "PINHO" fica sem explicação nenhuma — pode ser a
 * mesma mulher com o nome completo, pode ser outra. Já
 *
 *   PEDRO S. C. RIBEIRO  ×  PEDRO SILVA COSTA RIBEIRO
 *
 * não deixa sobra: cada nome a mais tem a sua inicial do outro lado. São os três
 * exemplos que o dono deu, e é a linha que o lote usa.
 *
 * Grupo de 3+ só passa se TODOS os pares passarem.
 */
export function todaInicialExplicada(nomes: string[]): boolean {
  const pares: [string[], string[]][] = [];
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      pares.push([tokensDoNome(nomes[i]), tokensDoNome(nomes[j])]);
    }
  }
  return pares.every(([a, b]) => {
    const significativos = (t: string[]) =>
      t.filter((x) => x.length > 1 && !SEM_VALOR_NO_NOME.has(x));
    const [curto, longo] = significativos(a).length <= significativos(b).length ? [a, b] : [b, a];
    const sigCurto = new Set(significativos(curto));
    const extras = significativos(longo).filter((x) => !sigCurto.has(x));
    if (!extras.length) return true; // nomes iguais depois de normalizar

    // Cada extra precisa de uma inicial PRÓPRIA no nome curto: uma inicial não
    // explica dois sobrenomes.
    const iniciais = curto.filter((x) => x.length === 1 && !SEM_VALOR_NO_NOME.has(x));
    const usadas = new Set<number>();
    return extras.every((ext) => {
      const i = iniciais.findIndex((ini, idx) => !usadas.has(idx) && ini === ext[0]);
      if (i < 0) return false;
      usadas.add(i);
      return true;
    });
  });
}

/**
 * QUEM FICA, DE FORMA DETERMINÍSTICA.
 *
 * O caminho antigo do lote não precisava escolher: só um cadastro tinha dado.
 * O caminho novo precisa, e a escolha não pode depender da ordem que o banco
 * devolveu — o mesmo grupo tem de dar o mesmo resultado hoje e amanhã.
 *
 * A ordem: mais completo primeiro (é o cadastro que a equipe vem usando),
 * depois a filiação mais antiga, depois o mais antigo no banco, e por fim a
 * matrícula, para nunca haver empate. A filiação mais antiga prevalece de
 * qualquer jeito na fusão — aqui ela só desempata QUEM sobrevive.
 */
export function ordemDoLote(candidatos: CandidatoDuplicata[]): CandidatoDuplicata[] {
  const quando = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
  return [...candidatos].sort(
    (a, b) =>
      b.pontuacao - a.pontuacao ||
      quando(a.dataFiliacao) - quando(b.dataFiliacao) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.matricula.localeCompare(b.matricula, 'pt-BR'),
  );
}

/**
 * Um par do lote. `recuaFiliacao` conta só o caso que MUDOU de comportamento:
 * os dois têm data e a do removido é mais antiga. Quando o mantido não tem
 * data nenhuma, a do removido já era copiada antes e nunca se perdeu nada.
 */
export function montarItem(fica: CandidatoDuplicata, sai: CandidatoDuplicata): ItemDoLote {
  return {
    manterId: fica.id,
    descartarId: sai.id,
    nome: fica.nomeCompleto,
    manterMatricula: fica.matricula,
    descartarMatricula: sai.matricula,
    recuaFiliacao: !!sai.dataFiliacao && !!fica.dataFiliacao && sai.dataFiliacao < fica.dataFiliacao,
  };
}

/**
 * O QUE OS DÍGITOS VERIFICADORES DIZEM SOBRE DOIS CPFs QUE DIVERGEM.
 *
 * CASO REAL QUE ABRIU ISTO (18/09/2026) — LUANA DE GÓIS SILVA FERNANDES:
 *
 *   4002 (o que a tela mandava manter)  840.053.86**9**-34  → dígito não bate
 *   5811 (o que a tela ia apagar)       840.053.86**3**-34  → válido
 *
 * Um dígito de diferença: alguém digitou errado. E a tela estava prestes a
 * destruir o CPF CERTO e ficar com o errado, porque "quem fica" era decidido
 * por completude e o CPF ia junto com o cadastro.
 *
 * O CPF tem dois dígitos verificadores. Quando dois cadastros do mesmo grupo
 * trazem CPFs diferentes e só UM passa na conta, o sistema não precisa
 * perguntar nada: ele SABE qual é o erro de digitação.
 *
 * AS TRÊS SITUAÇÕES, e elas não recebem o mesmo tratamento:
 *
 *  - UM SÓ VÁLIDO: erro de digitação. A consolidação é liberada, e o CPF que
 *    prevalece é o válido — mesmo que ele esteja no cadastro que vai sair.
 *  - OS DOIS VÁLIDOS: dois CPFs que passam na conta são duas pessoas. Continua
 *    barrado, e nenhuma confirmação libera. Quem tiver certeza corrige o CPF na
 *    ficha e consolida depois — o caminho existe e não apaga nada por engano.
 *  - NENHUM VÁLIDO: os dois são lixo e não identificam ninguém. Liberado, com
 *    a escolha explícita de quem decide.
 */
export interface AnaliseDeCpf {
  porCadastro: { id: string; matricula: string; cpf: string; valido: boolean }[];
  /** Exatamente um passa no dígito verificador — o sistema sabe qual vale. */
  umSoValido: boolean;
  /** Todos passam: são pessoas diferentes, e nada libera a fusão. */
  todosValidos: boolean;
  /** O CPF que deve prevalecer, quando o sistema sabe. Nulo quando não sabe. */
  cpfBom: string | null;
}

export function analisarCpfs(
  candidatos: { id: string; matricula: string; cpf: string | null }[],
): AnaliseDeCpf | null {
  const comCpf = candidatos.filter((c) => (c.cpf ?? '').trim() !== '');
  const distintos = new Set(comCpf.map((c) => soDigitos(c.cpf!)));
  // Sem conflito não há o que analisar: este bloco só existe para a divergência.
  if (comCpf.length < 2 || distintos.size < 2) return null;

  const porCadastro = comCpf.map((c) => ({
    id: c.id,
    matricula: c.matricula,
    cpf: c.cpf!,
    valido: cpfValido(c.cpf),
  }));
  const validos = porCadastro.filter((c) => c.valido);
  return {
    porCadastro,
    umSoValido: validos.length === 1,
    todosValidos: validos.length === porCadastro.length,
    cpfBom: validos.length === 1 ? soDigitos(validos[0].cpf) : null,
  };
}

const soDigitos = (v: string) => v.replace(/[^0-9]/g, '');

@Injectable()
export class DuplicidadeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Varredura
  // =========================================================================

  /**
   * Procura possíveis duplicatas na base inteira.
   *
   * Roda SOB DEMANDA, não em cron: a duplicidade nasceu de uma carga que já
   * aconteceu, o CPF é único e o COREN não repete — um agendamento rodaria
   * todo dia para não achar nada, e o alerta viraria ruído.
   */
  async varrer(): Promise<GrupoDuplicata[]> {
    const [porNome, porSubconjunto, decisoes] = await Promise.all([
      this.gruposPorNomeIdentico(),
      this.paresPorSubconjuntoDeTokens(),
      this.prisma.duplicataDecisao.findMany({
        select: { filiadoIdA: true, filiadoIdB: true },
      }),
    ]);

    const jaJulgado = new Set(decisoes.map((d) => `${d.filiadoIdA}|${d.filiadoIdB}`));

    const grupos = [
      /*
        O NOME PROVA nos dois primeiros casos e NÃO no terceiro (18/09/2026):
        idêntico prova; abreviado prova (a inicial casa com o nome por extenso);
        "um contém o outro" NÃO prova — o token a mais não tem inicial que o
        justifique, e aí são duas pessoas. Ver `nomeECidadeBastam`.
      */
      ...this.montarGrupos(porNome, () => 'nome idêntico (ignorando acento e caixa)', undefined, () => true),
      ...this.montarGrupos(
        porSubconjunto,
        (l) =>
          l.abreviacao
            ? 'nome abreviado na mesma cidade (a inicial casa com o nome por extenso)'
            : 'um nome contém o outro, na mesma cidade',
        'BAIXA',
        (l) => l.abreviacao === true,
      ),
    ];

    return grupos
      .map((g) => this.removerJulgados(g, jaJulgado))
      .filter((g): g is GrupoDuplicata => g !== null)
      .sort((a, b) => {
        const ordem = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
        return ordem[a.confianca] - ordem[b.confianca];
      });
  }

  /**
   * Quantos grupos esperam decisão — alimenta o aviso da tela de filiados.
   *
   * CONTA SÓ O DECIDÍVEL (18/09/2026). O aviso é âmbar e diz "aguardando
   * revisão": é pedido de trabalho. Na produção, 255 dos 389 grupos não têm um
   * dado sequer em nenhum cadastro — somá-los fazia o aviso pedir 389 revisões
   * quando 134 são decidíveis, e punha na tela dois números que se
   * contradizem, porque a fila já separa.
   *
   * `esperandoDado` vem junto para a tela conseguir manter a porta aberta sem
   * pintar de âmbar o que não pede ninguém.
   */
  async pendentes(): Promise<{ pendentes: number; esperandoDado: number }> {
    const grupos = await this.varrer();
    const esperando = grupos.filter((g) => g.esperandoDado).length;
    return { pendentes: grupos.length - esperando, esperandoDado: esperando };
  }

  // =========================================================================
  // Formação dos grupos (SQL)
  // =========================================================================

  /**
   * Grupos por nome normalizado idêntico.
   *
   * Reaproveita `busca_normalizada`, a coluna mantida por gatilho desde a
   * migração 20260802210000 — já está pronta, já é indexada e já ignora
   * acento, caixa e pontuação. Fazer a normalização aqui de novo seria
   * recalcular 7 mil vezes o que o banco já tem gravado.
   */
  private async gruposPorNomeIdentico(): Promise<LinhaCandidato[]> {
    return this.prisma.$queryRaw<LinhaCandidato[]>`
      WITH chave AS (
        SELECT senatepi_normalizar_busca(nome_completo) AS nn
          FROM filiados
         GROUP BY 1
        HAVING count(*) > 1
      )
      SELECT senatepi_normalizar_busca(f.nome_completo) AS chave,
             f.id, f.nome_completo, f.matricula, f.cpf, f.numero_coren,
             f.cidade, f.estado, f.telefone_principal, f.email,
             f.data_nascimento, f.endereco, f.situacao::text AS situacao,
             f.data_filiacao, f.created_at,
             (f.foto_key IS NOT NULL) AS tem_foto,
             (SELECT count(*)::int FROM vinculos_profissionais v WHERE v.filiado_id = f.id) AS vinculos
        FROM filiados f
        JOIN chave c ON senatepi_normalizar_busca(f.nome_completo) = c.nn
       ORDER BY chave, f.created_at
    `;
  }

  /**
   * Pares em que um nome é subconjunto do outro — "JOÃO PEDRO" e
   * "JOÃO P. PINTO" — E que estão na MESMA CIDADE preenchida.
   *
   * A exigência de cidade não é rigor decorativo: sem ela, o critério devolve
   * 709 pares em produção e a maioria é homônimo. "MARIA DO SOCORRO IBIAPINA
   * SILVA" e "MARIA DO SOCORRO SILVA" casam por subconjunto e são quase
   * certamente duas mulheres diferentes — em Piauí esse nome é comum. Já
   * "SILVIA CASSANDRA SANTOS DAMASCENO" e "SILVIA CASSANDRA S. DAMASCENO",
   * ambas em Teresina, é duplicata real. A cidade é o que separa os dois.
   *
   * A BLOCAGEM por primeiro+último token é o que torna a consulta viável:
   * comparar todos contra todos seriam 25 milhões de pares.
   */
  private async paresPorSubconjuntoDeTokens(): Promise<LinhaCandidato[]> {
    return this.prisma.$queryRaw<LinhaCandidato[]>`
      WITH base AS (
        -- Normaliza o NOME, e não a coluna busca_normalizada: aquela guarda
        -- nome + matrícula + COREN + CPF de propósito (serve à busca livre da
        -- listagem). Usá-la aqui punha "sen", "2026" e os dígitos do CPF entre
        -- os tokens — o "último token" virava o CPF em vez do sobrenome, e o
        -- teste de subconjunto não casava NUNCA. Custou zero par encontrado
        -- até o teste contra dados reais revelar.
        SELECT f.*, string_to_array(senatepi_normalizar_busca(f.nome_completo), ' ') AS toks
          FROM filiados f
         WHERE f.cidade IS NOT NULL AND f.cidade <> ''
      ), chaves AS (
        SELECT b.*,
               b.toks[1] AS primeiro,
               b.toks[array_length(b.toks, 1)] AS ultimo,
               -- Fora preposições e iniciais soltas: "de", "da" e "P." não
               -- distinguem ninguém, e mantê-las faria "JOÃO P. PINTO" nunca
               -- casar com "JOÃO PEDRO PINTO".
               ARRAY(
                 SELECT t FROM unnest(b.toks) t
                  WHERE length(t) > 1 AND t NOT IN ('de','da','do','dos','das','e')
               ) AS sig
          FROM base b
      ), pares AS (
        SELECT a.id AS id_a, z.id AS id_b,
               -- ABREVIAÇÃO x NOME MAIS CURTO — a diferença entre um par quase
               -- certo e um provável homônimo.
               --
               -- "ANTÔNIA MARIA V. DO NASCIMENTO" e "ANTONIA MARIA VIEIRA DO
               -- NASCIMENTO": o "V." solto casa com "VIEIRA", que só existe no
               -- outro. É a mesma pessoa, escrita duas vezes.
               --
               -- "MARIA DAS GRAÇAS SILVA" e "MARIA DAS GRAÇAS MENDES SILVA":
               -- não há inicial nenhuma justificando o "MENDES". São duas
               -- mulheres diferentes com nome comum.
               EXISTS (
                 SELECT 1
                   FROM unnest(CASE WHEN cardinality(a.sig) < cardinality(z.sig)
                                    THEN a.toks ELSE z.toks END) AS ini
                   JOIN unnest(CASE WHEN cardinality(a.sig) < cardinality(z.sig)
                                    THEN z.sig ELSE a.sig END) AS ext
                     ON left(ext, 1) = ini
                  WHERE length(ini) = 1
                    AND ext <> ALL (CASE WHEN cardinality(a.sig) < cardinality(z.sig)
                                         THEN a.sig ELSE z.sig END)
               ) AS abreviacao
          FROM chaves a
          JOIN chaves z
            ON a.primeiro = z.primeiro
           AND a.ultimo = z.ultimo
           AND a.id < z.id
           AND senatepi_normalizar_busca(a.cidade) = senatepi_normalizar_busca(z.cidade)
         WHERE a.sig <> z.sig
           AND (a.sig <@ z.sig OR z.sig <@ a.sig)
      )
      SELECT p.id_a || '::' || p.id_b AS chave,
             p.abreviacao,
             f.id, f.nome_completo, f.matricula, f.cpf, f.numero_coren,
             f.cidade, f.estado, f.telefone_principal, f.email,
             f.data_nascimento, f.endereco, f.situacao::text AS situacao,
             f.data_filiacao, f.created_at,
             (f.foto_key IS NOT NULL) AS tem_foto,
             (SELECT count(*)::int FROM vinculos_profissionais v WHERE v.filiado_id = f.id) AS vinculos
        FROM pares p
        JOIN filiados f ON f.id IN (p.id_a, p.id_b)
       ORDER BY chave, f.created_at
    `;
  }

  // =========================================================================
  // Julgamento
  // =========================================================================

  private montarGrupos(
    linhas: LinhaCandidato[],
    criterio: (primeiraLinha: LinhaCandidato) => string,
    forcarConfianca?: Confianca,
    nomeProva: (primeiraLinha: LinhaCandidato) => boolean = () => false,
  ): GrupoDuplicata[] {
    const porChave = new Map<string, LinhaCandidato[]>();
    for (const l of linhas) {
      const atual = porChave.get(l.chave) ?? [];
      atual.push(l);
      porChave.set(l.chave, atual);
    }

    const grupos: GrupoDuplicata[] = [];
    for (const [chave, membros] of porChave) {
      if (membros.length < 2) continue;
      const candidatos = membros.map((m) => this.paraCandidato(m));
      const contradicoes = this.contradicoes(candidatos);
      const { sugeridoId, decidiu, motivo } = this.escolherMantido(candidatos, contradicoes);

      grupos.push({
        chave,
        confianca: forcarConfianca ?? this.classificar(candidatos, contradicoes),
        criterio: criterio(membros[0]),
        motivoSugestao: motivo,
        decidiu,
        contradicoes: contradicoes.map((c) => c.rotulo),
        cpfEmConflito: analisarCpfs(candidatos),
        esperandoDado: esperandoDado(candidatos),
        nomeConfirmado: nomeProva(membros[0]),
        candidatos: candidatos.map((c) => ({ ...c, sugerido: c.id === sugeridoId })),
      });
    }
    return grupos;
  }

  private paraCandidato(l: LinhaCandidato): CandidatoDuplicata {
    const preenchido = (v: unknown) => v !== null && v !== undefined && v !== '';
    const pontuacao =
      (preenchido(l.cpf) ? PESOS.cpf : 0) +
      (preenchido(l.numero_coren) ? PESOS.numeroCoren : 0) +
      (l.data_nascimento ? PESOS.dataNascimento : 0) +
      (preenchido(l.cidade) ? PESOS.cidade : 0) +
      (preenchido(l.telefone_principal) ? PESOS.telefonePrincipal : 0) +
      (preenchido(l.email) ? PESOS.email : 0) +
      (preenchido(l.endereco) ? PESOS.endereco : 0) +
      (l.tem_foto ? PESOS.foto : 0) +
      l.vinculos * PESOS.vinculo;

    return {
      id: l.id,
      nomeCompleto: l.nome_completo,
      matricula: l.matricula,
      cpf: l.cpf,
      numeroCoren: l.numero_coren,
      cidade: l.cidade,
      estado: l.estado,
      telefonePrincipal: l.telefone_principal,
      email: l.email,
      dataNascimento: l.data_nascimento,
      endereco: l.endereco,
      situacao: l.situacao,
      dataFiliacao: l.data_filiacao,
      createdAt: l.created_at,
      temFoto: l.tem_foto,
      vinculos: l.vinculos,
      pontuacao,
      sugerido: false,
    };
  }

  /**
   * Campos em que dois candidatos têm valores DIFERENTES e ambos preenchidos.
   *
   * Só conta quando os dois lados têm valor: campo vazio de um lado não
   * contradiz nada — é justamente o padrão do cadastro duplicado incompleto.
   */
  private contradicoes(candidatos: CandidatoDuplicata[]) {
    return CAMPOS_CONTRADITORIOS.filter(({ campo }) => {
      const valores = new Set(
        candidatos
          .map((c) => {
            const v = c[campo as keyof CandidatoDuplicata];
            if (v === null || v === undefined || v === '') return null;
            return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).toLowerCase();
          })
          .filter((v): v is string => v !== null),
      );
      return valores.size > 1;
    });
  }

  private classificar(
    candidatos: CandidatoDuplicata[],
    contradicoes: ReturnType<DuplicidadeService['contradicoes']>,
  ): Confianca {
    // Qualquer contradição derruba para BAIXA: CPFs ou cidades diferentes são
    // evidência de pessoas distintas, não de cadastro repetido.
    if (contradicoes.length > 0) return 'BAIXA';

    // Corroboração: todos na mesma cidade, e a cidade está preenchida.
    const cidades = candidatos.map((c) => c.cidade?.trim().toLowerCase()).filter(Boolean);
    if (cidades.length === candidatos.length && new Set(cidades).size === 1) return 'ALTA';

    return 'MEDIA';
  }

  /**
   * Qual candidato manter: o mais completo. Empate devolve `decidiu: false`.
   *
   * O desempate por `createdAt` mais antigo NÃO é usado para forçar uma
   * escolha quando a completude empata — só ordena a lista. Empate é uma
   * resposta legítima: quando os dois cadastros estão igualmente vazios, não
   * existe critério técnico que diga qual apagar, e inventar um seria pior do
   * que admitir que a decisão é humana.
   */
  private escolherMantido(
    candidatos: CandidatoDuplicata[],
    contradicoes: ReturnType<DuplicidadeService['contradicoes']>,
  ): { sugeridoId: string | null; decidiu: boolean; motivo: string | null } {
    // Com contradição, o sistema não opina: os dois podem ser pessoas reais.
    if (contradicoes.length > 0) {
      return {
        sugeridoId: null,
        decidiu: false,
        motivo: null,
      };
    }

    const ordenados = [...candidatos].sort(
      (a, b) => b.pontuacao - a.pontuacao || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const melhor = ordenados[0];
    const segundo = ordenados[1];

    if (melhor.pontuacao === segundo.pontuacao) {
      return { sugeridoId: null, decidiu: false, motivo: null };
    }

    const tem: string[] = [];
    if (melhor.cpf && !segundo.cpf) tem.push('CPF');
    if (melhor.numeroCoren && !segundo.numeroCoren) tem.push('COREN');
    if (melhor.cidade && !segundo.cidade) tem.push('cidade');
    if (melhor.dataNascimento && !segundo.dataNascimento) tem.push('data de nascimento');
    if (melhor.telefonePrincipal && !segundo.telefonePrincipal) tem.push('telefone');
    if (melhor.vinculos > segundo.vinculos) tem.push('locais de trabalho');

    return {
      sugeridoId: melhor.id,
      decidiu: true,
      motivo: tem.length
        ? `Tem ${tem.join(', ')} — o outro registro não tem.`
        : 'Cadastro mais completo.',
    };
  }

  /**
   * Tira do grupo quem já foi julgado como pessoa diferente de todos os outros.
   *
   * Um par marcado como DISTINTOS não deve voltar. Num grupo de três, porém,
   * "A é diferente de B" não elimina A: ele ainda pode ser duplicata de C. Por
   * isso o candidato só sai quando já foi separado de TODOS os demais.
   */
  private removerJulgados(
    grupo: GrupoDuplicata,
    jaJulgado: Set<string>,
  ): GrupoDuplicata | null {
    const par = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

    const restantes = grupo.candidatos.filter((c) =>
      grupo.candidatos.some((o) => o.id !== c.id && !jaJulgado.has(par(c.id, o.id))),
    );

    if (restantes.length < 2) return null;
    if (restantes.length === grupo.candidatos.length) return grupo;

    // O grupo encolheu: reavalia, porque quem saiu podia ser a fonte da
    // contradição ou o candidato sugerido.
    const contradicoes = this.contradicoes(restantes);
    const { sugeridoId, decidiu, motivo } = this.escolherMantido(restantes, contradicoes);
    return {
      ...grupo,
      confianca: this.classificar(restantes, contradicoes),
      contradicoes: contradicoes.map((c) => c.rotulo),
      cpfEmConflito: analisarCpfs(restantes),
      motivoSugestao: motivo,
      decidiu,
      esperandoDado: esperandoDado(restantes),
      candidatos: restantes.map((c) => ({ ...c, sugerido: c.id === sugeridoId })),
    };
  }

  // =========================================================================
  // Lote — a fatia em que o cadastro removido não tem dado a copiar
  // =========================================================================

  /**
   * O LOTE E O QUE SOBRA DEPOIS DELE — de UMA varredura só.
   *
   * As duas contas saíam de lugares diferentes e discordavam na tela
   * (18/09/2026): o painel contava `manterId` distintos e a fila contava grupos
   * — na cópia local, 978 contra 1.020. Um cadastro pode estar em DOIS grupos
   * — no de nome idêntico e no de nome contido —, então "quantos donos" não é
   * "quantos grupos somem".
   *
   * Aqui a pergunta é uma só: depois do lote, QUAIS GRUPOS AINDA EXISTEM? Some
   * o grupo cujos cadastros foram todos tocados pelo lote, por este grupo ou
   * por outro. E do que resta, separa o que pede alguém do que espera um dado.
   */
  async resumoDoLote(): Promise<{
    itens: ItemDoLote[];
    gruposResolvidos: number;
    /** Grupos que SOBRAM e ninguém tem como decidir — não são trabalho. */
    gruposEsperandoDado: number;
  }> {
    const grupos = await this.varrer();
    const itens = this.doLote(grupos);
    /*
      "GRUPOS QUE SOMEM", e não "quantos donos" (18/09/2026): dois grupos podem
      terminar no mesmo cadastro mantido, e aí o painel promete trabalho que não
      vai existir. Na produção, 128 pares fecham 115 grupos.
    */
    const tocados = new Set(itens.flatMap((i) => [i.manterId, i.descartarId]));
    const sobram = grupos.filter((g) => !g.candidatos.every((c) => tocados.has(c.id)));
    return {
      itens,
      gruposResolvidos: grupos.length - sobram.length,
      gruposEsperandoDado: sobram.filter((g) => g.esperandoDado).length,
    };
  }

  /**
   * Grupos elegíveis à consolidação em lote.
   *
   * SÃO DOIS CAMINHOS, e nenhum deles perde informação.
   *
   *  1. UM SÓ TEM DADO. O que sai não tem CPF, COREN, nascimento, contato,
   *     endereço, foto nem vínculo — só nome, matrícula, cidade e a data de
   *     filiação, e as duas últimas viajam para o cadastro que fica. Ver
   *     `temDadoProprio` para a razão de a cidade não contar.
   *
   *  2. O NOME E A CIDADE BASTAM (decisão do dono, 18/09/2026). Nome idêntico
   *     ou abreviado, mesma cidade preenchida nos dois, e nenhum valor
   *     divergente em campo nenhum. Ver `nomeECidadeBastam`.
   *
   * Em ambos, contradição barra antes de tudo, a matrícula do removido fica no
   * histórico do que ficou e a filiação mais antiga prevalece.
   */
  async elegiveisParaLote(): Promise<ItemDoLote[]> {
    return this.doLote(await this.varrer());
  }

  /**
   * A REGRA DO LOTE, PURA — a mesma para a prévia, para a execução e para a
   * conta do que sobra. Separada da varredura para que nenhuma delas possa
   * reimplementá-la e discordar das outras na tela.
   */
  private doLote(grupos: GrupoDuplicata[]): ItemDoLote[] {
    /*
      GRUPO DE TRÊS TAMBÉM ENTRA NO LOTE (17/09/2026), desde que só UM cadastro
      tenha dado e os outros sejam casca (nome e matrícula). É o caso comum na
      produção — ÁLVARO ROGÉRIO VILARINHO tinha 008005 com CPF, vínculo e
      endereço, e 4045 e 4829 vazios. A promessa do lote continua a mesma: só
      remove quem não tem nada a copiar.
    */
    return grupos
      .filter((g) => g.contradicoes.length === 0)
      .flatMap((g) => {
        /*
          A CIDADE NÃO É DADO A PERDER — ver `temDadoProprio`. Era `pontuacao > 0`,
          e a cidade vale 1: o descartado que só tinha "Teresina" ficava fora do
          lote, e a fusão copiaria essa cidade de qualquer jeito.

          O efeito tem DOIS sinais, e o segundo é de propósito: entram os pares
          cujo removido só tinha cidade, e SAEM aqueles em que o cadastro mantido
          também não tinha nada além dela. Esses eram fusão de dois
          desconhecidos; agora caem em `esperandoDado`, que é o nome honesto do
          que eles são. Na cópia local, onde a fila ainda é grande, foram 405
          para dentro e 122 para fora.
        */
        const cheios = g.candidatos.filter(temDadoProprio);
        const vazios = g.candidatos.filter((c) => !temDadoProprio(c));

        /*
          O CAMINHO NOVO: nome e cidade bastam (decisão do dono, 18/09/2026).
          Ver `nomeECidadeBastam`. Vale quando ninguém tem dado próprio — o caso
          que antes ia para `esperandoDado` — e também quando os dois têm, desde
          que nenhum valor divirja. Nada se perde nas duas situações.
        */
        if (cheios.length !== 1 || !vazios.length) {
          if (!nomeECidadeBastam(g)) return [];
          const [fica, ...saem] = ordemDoLote(g.candidatos);
          return saem.map((sai) => montarItem(fica, sai));
        }

        const cheio = cheios[0];
        return vazios.map((vazio) => montarItem(cheio, vazio));
      });
  }


  /**
   * Executa o lote em FATIAS, e não de uma vez.
   *
   * Cada fusão é uma transação com várias consultas; 704 delas numa única
   * requisição levariam a um tempo em que o navegador, o proxy ou o Railway
   * derrubam a conexão — e uma queda no meio deixaria o operador sem saber o
   * que foi feito e o que não foi. Em fatias, cada resposta é rápida, o front
   * mostra progresso real e uma interrupção só custa a fatia corrente.
   *
   * Uma falha isolada NÃO aborta o lote: é registrada e o processamento
   * segue. Um par que ficou inválido entre a prévia e a execução não pode
   * impedir os outros 703.
   */
  async executarLote(limite: number, autor?: string) {
    const elegiveis = await this.elegiveisParaLote();
    const fatia = elegiveis.slice(0, Math.max(1, Math.min(100, limite)));

    let fundidos = 0;
    const falhas: { nome: string; motivo: string }[] = [];

    for (const item of fatia) {
      try {
        await this.fundir(item.manterId, item.descartarId, autor);
        fundidos++;
      } catch (e) {
        falhas.push({
          nome: `${item.nome} (${item.descartarMatricula})`,
          motivo: e instanceof Error ? e.message : 'erro desconhecido',
        });
      }
    }

    return { fundidos, falhas, restantes: Math.max(0, elegiveis.length - fatia.length) };
  }

  // =========================================================================
  // Ações
  // =========================================================================

  /**
   * Registra que o par é de pessoas diferentes e o tira da fila. Devolve o id da
   * decisão para a tela oferecer "Desfazer" na hora.
   */
  async marcarDistintos(idA: string, idB: string, autor?: string) {
    const [a, b] = this.ordenarPar(idA, idB);
    await this.exigirExistencia([a, b]);

    const decisao = await this.prisma.duplicataDecisao.upsert({
      where: { filiadoIdA_filiadoIdB: { filiadoIdA: a, filiadoIdB: b } },
      create: { filiadoIdA: a, filiadoIdB: b, decisao: DecisaoDuplicata.DISTINTOS, autor },
      update: { decisao: DecisaoDuplicata.DISTINTOS, autor },
    });
    return { ok: true, id: decisao.id };
  }

  /**
   * O GRUPO INTEIRO É DE PESSOAS DIFERENTES (17/09/2026).
   *
   * A decisão é gravada por PAR. Com três cadastros, marcar só o primeiro par
   * deixava os outros dois de pé e o grupo voltava na varredura seguinte — a
   * pessoa decidia e via o mesmo grupo de novo. Aqui todos os pares são
   * marcados: 3 cadastros = 3 pares, 4 = 6.
   */
  async marcarGrupoDistinto(ids: string[], autor?: string) {
    const unicos = [...new Set(ids)];
    if (unicos.length < 2) {
      throw new BadRequestException('Informe ao menos dois cadastros.');
    }
    if (unicos.length > MAXIMO_POR_GRUPO) {
      throw new BadRequestException(`São no máximo ${MAXIMO_POR_GRUPO} cadastros por vez.`);
    }
    await this.exigirExistencia(unicos);

    const criadas: string[] = [];
    for (let i = 0; i < unicos.length; i++) {
      for (let j = i + 1; j < unicos.length; j++) {
        const { id } = await this.marcarDistintos(unicos[i], unicos[j], autor);
        criadas.push(id);
      }
    }
    return { ok: true, ids: criadas };
  }

  /**
   * UM CADASTRO SAI DO GRUPO (17/09/2026).
   *
   * Pergunta do dono: "num grupo de cinco, e se um deles eu não concordo que é
   * duplicata?". Era tudo ou nada — consolidar todos ou dizer que os cinco são
   * pessoas diferentes. Aqui sai UM: ele fica gravado como distinto de CADA um
   * dos outros e some do grupo na próxima varredura.
   *
   * Os que ficam NÃO são julgados entre si, de propósito: sobre eles ninguém
   * disse nada ainda, e a fila tem de continuar perguntando.
   */
  async marcarForaDoGrupo(id: string, outros: string[], autor?: string) {
    const restantes = [...new Set(outros)].filter((o) => o !== id);
    if (!restantes.length) {
      throw new BadRequestException('Informe os outros cadastros do grupo.');
    }
    if (restantes.length + 1 > MAXIMO_POR_GRUPO) {
      throw new BadRequestException(`São no máximo ${MAXIMO_POR_GRUPO} cadastros por vez.`);
    }
    await this.exigirExistencia([id, ...restantes]);

    const ids: string[] = [];
    for (const outro of restantes) {
      const { id: decisao } = await this.marcarDistintos(id, outro, autor);
      ids.push(decisao);
    }
    return { ok: true, ids };
  }

  /**
   * O QUE SAIU DA FILA COMO "PESSOAS DIFERENTES" (15/09/2026).
   *
   * Até aqui o descarte não tinha volta nem lista: na produção, ALESSANDRA DE
   * SOUSA (5353 com CPF × 5176 com nascimento, os dois de Teresina) e MARIA DA
   * CRUZ DE SOUSA (3520 × 3746) saíram assim e ninguém mais os via. Par em que
   * um dos cadastros já foi apagado não entra: não há mais o que rever.
   */
  async listarDescartados(): Promise<ParDescartado[]> {
    const decisoes = await this.prisma.duplicataDecisao.findMany({
      where: { decisao: DecisaoDuplicata.DISTINTOS },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filiadoIdA: true, filiadoIdB: true, autor: true, createdAt: true },
    });
    if (!decisoes.length) return [];

    const ids = [...new Set(decisoes.flatMap((d) => [d.filiadoIdA, d.filiadoIdB]))];
    const filiados = await this.prisma.filiado.findMany({
      where: { id: { in: ids } },
      select: { id: true, nomeCompleto: true, matricula: true, cidade: true, cpf: true, dataNascimento: true },
    });
    const porId = new Map(filiados.map((f) => [f.id, f]));

    return decisoes.flatMap((d) => {
      const a = porId.get(d.filiadoIdA);
      const b = porId.get(d.filiadoIdB);
      if (!a || !b) return [];
      const resumo = (f: typeof a) => ({
        id: f.id,
        nomeCompleto: f.nomeCompleto,
        matricula: f.matricula,
        cidade: f.cidade,
        cpf: f.cpf,
        dataNascimento: f.dataNascimento,
      });
      return [{ id: d.id, autor: d.autor, decididoEm: d.createdAt, cadastros: [resumo(a), resumo(b)] }];
    });
  }

  /**
   * Devolve o par à fila: apaga a marcação "pessoas diferentes". A varredura lê
   * as decisões a cada vez, então o par reaparece na próxima leitura.
   *
   * Só DISTINTOS. Uma consolidação não tem volta por aqui — um dos cadastros foi
   * apagado, e a decisão FUNDIDO é o registro de para onde ele foi.
   */
  async voltarParaFila(id: string, autor?: string) {
    const decisao = await this.prisma.duplicataDecisao.findUnique({ where: { id } });
    const jaVoltou = 'Esta marcação não existe mais: o par talvez já tenha voltado para a fila.';
    if (!decisao) throw new NotFoundException(jaVoltou);
    if (decisao.decisao !== DecisaoDuplicata.DISTINTOS) {
      throw new BadRequestException(
        'Só a marcação "pessoas diferentes" volta para a fila. Cadastros consolidados não voltam: um deles foi apagado.',
      );
    }

    // Condicional: dois cliques ao mesmo tempo não viram dois registros de auditoria.
    const { count } = await this.prisma.duplicataDecisao.deleteMany({
      where: { id, decisao: DecisaoDuplicata.DISTINTOS },
    });
    if (count === 0) throw new NotFoundException(jaVoltou);

    const filiados = await this.prisma.filiado.findMany({
      where: { id: { in: [decisao.filiadoIdA, decisao.filiadoIdB] } },
      select: { nomeCompleto: true, matricula: true },
    });
    const par = filiados.map((f) => `${f.nomeCompleto} (${f.matricula})`).join(' × ');

    await this.audit.registrar({
      acao: AcaoAuditoria.DELETE,
      entidade: 'DuplicataDecisao',
      entidadeId: id,
      descricao:
        `Par de possíveis cadastros duplicados voltou para a fila${par ? `: ${par}` : ''}. ` +
        `Tinha sido marcado como pessoas diferentes${decisao.autor ? ` por ${decisao.autor}` : ''}.`,
      metadata: {
        filiadoIdA: decisao.filiadoIdA,
        filiadoIdB: decisao.filiadoIdB,
        marcadoPor: decisao.autor,
        marcadoEm: decisao.createdAt.toISOString(),
        devolvidoPor: autor ?? null,
      },
    });
    return { ok: true };
  }

  /**
   * Consolida dois cadastros: copia para o mantido o que só o descartado tem,
   * move os vínculos, registra o histórico e SÓ ENTÃO apaga o descartado.
   *
   * A ordem importa e tudo acontece na MESMA transação. `Filiado` tem 14
   * relações, quase todas `onDelete: Cascade` — apagar primeiro e copiar
   * depois destruiria o que se pretendia salvar. Se qualquer passo falhar,
   * nada acontece.
   */
  async fundir(
    manterId: string,
    descartarId: string,
    autor?: string,
    opcoes?: {
      /**
       * QUANDO OS CPFs DIVERGEM, qual deles fica — só dígitos.
       *
       * Não tem padrão de propósito: sem este campo a fusão continua barrada,
       * como sempre foi. É uma decisão de gente, uma por vez, e o lote nunca a
       * envia. Ver `analisarCpfs`.
       */
      cpfQueFica?: string;
    },
  ) {
    if (manterId === descartarId) {
      throw new BadRequestException('Os dois registros informados são o mesmo.');
    }

    return this.prisma.$transaction(async (tx) => {
      const [manter, descartar] = await Promise.all([
        tx.filiado.findUnique({ where: { id: manterId }, include: { vinculos: true } }),
        tx.filiado.findUnique({ where: { id: descartarId }, include: { vinculos: true } }),
      ]);
      if (!manter) throw new NotFoundException('Filiado a manter não encontrado.');
      if (!descartar) throw new NotFoundException('Filiado a descartar não encontrado.');

      /*
        CPFs QUE DIVERGEM: a trava continua, e agora ela SABE do que está
        falando (18/09/2026). Ver `analisarCpfs` para o caso que abriu isto —
        um dígito trocado, e a tela ia apagar justamente o CPF certo.

        A regra vive aqui, e não na tela: uma chamada direta à API não pode
        furar o que a interface protege.
      */
      const conflito = analisarCpfs([manter, descartar]);
      let cpfEscolhido: string | null = null;
      if (conflito) {
        const escolhido = (opcoes?.cpfQueFica ?? '').replace(/[^0-9]/g, '');
        const naoBate = (c: { cpf: string }) => c.cpf.replace(/[^0-9]/g, '') !== escolhido;

        if (conflito.todosValidos) {
          throw new BadRequestException(
            'Os dois CPFs passam no dígito verificador — são pessoas diferentes, e a ' +
              'consolidação não é liberada nem com confirmação. Se tiver certeza de que é a ' +
              'mesma pessoa, corrija o CPF errado na ficha e consolide depois.',
          );
        }
        if (!escolhido) {
          const bom = conflito.porCadastro.find((c) => c.valido);
          throw new BadRequestException(
            conflito.umSoValido
              ? `Os CPFs divergem, e só o da matrícula ${bom!.matricula} (${bom!.cpf}) passa no ` +
                'dígito verificador. Confirme qual CPF deve ficar para consolidar.'
              : 'Os CPFs divergem e nenhum dos dois passa no dígito verificador. ' +
                'Escolha qual deve ficar para consolidar.',
          );
        }
        if (conflito.porCadastro.every(naoBate)) {
          throw new BadRequestException('O CPF escolhido não é o de nenhum dos dois cadastros.');
        }
        if (conflito.umSoValido && escolhido !== conflito.cpfBom) {
          const bom = conflito.porCadastro.find((c) => c.valido)!;
          throw new BadRequestException(
            `O CPF escolhido não passa no dígito verificador. O válido é ${bom.cpf}, ` +
              `da matrícula ${bom.matricula}.`,
          );
        }
        cpfEscolhido = escolhido;
      }

      // 1) Absorve os campos que só o descartado tem.
      const absorvidos: Record<string, unknown> = {};
      /**
       * O QUE SE PERDE TAMBÉM TEM DE FICAR ESCRITO (18/09/2026).
       *
       * A cópia só preenche buraco: campo que o mantido já tem fica como está.
       * Quando os dois lados têm valor e eles DIFEREM, o do descartado some
       * junto com o registro — e o histórico só falava do que foi aproveitado.
       * Medido na base: 15 pares perdem cidade, endereço ou nascimento assim,
       * sem deixar rastro em lugar nenhum. Agora fica.
       */
      const descartados: Record<string, unknown> = {};
      const copiar = <K extends keyof typeof manter>(campo: K) => {
        const atual = manter[campo];
        const outro = descartar[campo];
        const vazio = atual === null || atual === undefined || atual === '';
        const temOutro = outro !== null && outro !== undefined && outro !== '';
        if (!temOutro) return;
        if (vazio) absorvidos[campo as string] = outro;
        else if (String(atual) !== String(outro)) descartados[campo as string] = outro;
      };
      (
        [
          'cpf', 'rg', 'ufRg', 'dataNascimento', 'sexo', 'estadoCivil', 'naturalidade',
          'telefonePrincipal', 'telefoneSecundario', 'email', 'cep', 'endereco', 'numero',
          'complemento', 'bairro', 'cidade', 'estado', 'numeroCoren', 'dataAdmissao',
          'formacao', 'formacaoOutro', 'modalidadeContribuicao',
          'fotoKey', 'fotoThumbKey',
        ] as const
      ).forEach(copiar);

      /*
        O CPF ESCOLHIDO PREVALECE, venha de onde vier (18/09/2026).

        `copiar` só preenche buraco: com os dois lados preenchidos, o do mantido
        ficava e o do removido ia para `descartados`. Mas quando um dos CPFs é
        erro de digitação, o certo pode estar justamente no cadastro que sai —
        foi o caso da LUANA, em que a tela ia guardar o inválido.

        Aqui a escolha de quem decide passa por cima da completude. Guarda-se a
        grafia como está no cadastro de origem, não os dígitos limpos: a base
        grava com pontuação e trocar isso na surdina viraria outra divergência.
      */
      let cpfTrocado: { de: string | null; para: string } | null = null;
      if (cpfEscolhido) {
        const origem = [manter, descartar].find(
          (c) => (c.cpf ?? '').replace(/[^0-9]/g, '') === cpfEscolhido,
        );
        const comoEstaGravado = origem?.cpf ?? cpfEscolhido;
        if ((manter.cpf ?? '').replace(/[^0-9]/g, '') !== cpfEscolhido) {
          absorvidos.cpf = comoEstaGravado;
          delete descartados.cpf;
          cpfTrocado = { de: manter.cpf, para: comoEstaGravado };
        } else {
          // O escolhido já é o do mantido: o outro sai, e isso já está em
          // `descartados` pela cópia acima. Nada a fazer além de registrar.
          cpfTrocado = { de: null, para: comoEstaGravado };
        }
      }

      /**
       * A FILIAÇÃO MAIS ANTIGA PREVALECE — e é uma regra, não uma cópia.
       *
       * `dataFiliacao` estava na lista acima, onde só entra o que o mantido não
       * tem. Os dois quase sempre têm: 868 dos 925 pares do lote. Então o
       * cadastro novo vencia o antigo e o filiado ENVELHECIA AO CONTRÁRIO —
       * 91 pares do lote de um clique, média de 2.685 dias, o pior recuando
       * RENATA DOS ANJOS MACENA de 2010 para 2023: treze anos e meio de
       * sindicato apagados num clique, sem nada na tela avisando.
       *
       * Duas fichas da mesma pessoa não são duas filiações; é uma filiação
       * cadastrada duas vezes. A verdadeira é a primeira — a segunda só existe
       * porque alguém preencheu a ficha de novo. A regra só RECUA a data, nunca
       * adianta, e fica registrada no histórico com o valor anterior.
       */
      const filiacaoAnterior = manter.dataFiliacao;
      const recuaFiliacao =
        !!descartar.dataFiliacao &&
        (!manter.dataFiliacao || descartar.dataFiliacao < manter.dataFiliacao);
      if (recuaFiliacao) absorvidos.dataFiliacao = descartar.dataFiliacao;

      if (Object.keys(absorvidos).length) {
        await tx.filiado.update({ where: { id: manterId }, data: absorvidos });
      }

      // 2) Move os locais de trabalho, continuando a numeração de ordem.
      const proximaOrdem =
        manter.vinculos.reduce((max, v) => Math.max(max, v.ordem ?? 0), 0) + 1;
      for (const [i, v] of descartar.vinculos.entries()) {
        await tx.vinculoProfissional.update({
          where: { id: v.id },
          data: { filiadoId: manterId, ordem: proximaOrdem + i },
        });
      }

      // 3) Histórico no mantido. É o que impede a matrícula do descartado de
      //    virar um número que não existe em lugar nenhum: quem procurar por
      //    ela mais tarde encontra aqui o registro de para onde foi.
      const camposAbsorvidos = Object.keys(absorvidos);
      const camposDescartados = Object.keys(descartados);
      const dia = (d: Date | null) => (d ? formatarDataBR(d) : null);
      await tx.filiadoHistorico.create({
        data: {
          filiadoId: manterId,
          tipo: TipoHistoricoFiliado.ALTERACAO,
          descricao:
            `Cadastro duplicado consolidado. Registro removido: ${descartar.nomeCompleto} ` +
            `(matrícula ${descartar.matricula}). ` +
            (camposAbsorvidos.length
              ? `Dados aproveitados: ${camposAbsorvidos.join(', ')}.`
              : 'Nenhum dado adicional a aproveitar.') +
            (recuaFiliacao
              ? ` Filiação recuada para ${dia(descartar.dataFiliacao)}` +
                (filiacaoAnterior ? ` (antes ${dia(filiacaoAnterior)})` : '') +
                ', que é a do cadastro removido.'
              : '') +
            (camposDescartados.length
              ? ` Valores do cadastro removido que NÃO foram aproveitados porque o ` +
                `mantido já tinha outro: ${camposDescartados.join(', ')}.`
              : '') +
            /*
              O CONFLITO DE CPF FICA ESCRITO POR EXTENSO. É a única fusão que
              uma pessoa libera contra uma trava do sistema: quem ler esta ficha
              daqui a um ano precisa achar aqui por que dois CPFs viraram um, e
              qual deles ficou.
            */
            (cpfTrocado
              ? ` CPFs divergentes: ficou ${cpfTrocado.para}` +
                (cpfTrocado.de ? `, no lugar de ${cpfTrocado.de}` : '') +
                `, por decisão de ${autor ?? 'um operador'}` +
                (conflito?.umSoValido
                  ? ' — é o único que passa no dígito verificador.'
                  : ' — nenhum dos dois passa no dígito verificador.')
              : '') +
            (descartar.vinculos.length
              ? ` ${descartar.vinculos.length} local(is) de trabalho transferido(s).`
              : ''),
          autor,
          metadata: {
            descartadoId: descartar.id,
            descartadoMatricula: descartar.matricula,
            descartadoNome: descartar.nomeCompleto,
            descartadoCpf: descartar.cpf,
            camposAbsorvidos,
            // O valor, e não só o nome do campo: o registro foi apagado, e este
            // é o único lugar onde ele ainda existe.
            valoresDescartados: descartados as Prisma.InputJsonValue,
            filiacaoAnterior: filiacaoAnterior ? filiacaoAnterior.toISOString() : null,
            filiacaoRecuada: recuaFiliacao,
            vinculosTransferidos: descartar.vinculos.length,
          } as Prisma.InputJsonValue,
        },
      });

      // 4) Decisão permanente do par.
      const [a, b] = this.ordenarPar(manterId, descartarId);
      await tx.duplicataDecisao.upsert({
        where: { filiadoIdA_filiadoIdB: { filiadoIdA: a, filiadoIdB: b } },
        create: {
          filiadoIdA: a,
          filiadoIdB: b,
          decisao: DecisaoDuplicata.FUNDIDO,
          autor,
          metadata: {
            mantidoId: manterId,
            descartadoId: descartarId,
            descartadoMatricula: descartar.matricula,
            descartadoNome: descartar.nomeCompleto,
            camposAbsorvidos,
          } as Prisma.InputJsonValue,
        },
        update: { decisao: DecisaoDuplicata.FUNDIDO, autor },
      });

      // 5) Agora sim: apaga o descartado (as cascatas levam o que restou).
      await tx.filiado.delete({ where: { id: descartarId } });

      // Auditoria como DELETE, e `entidadeId` do registro APAGADO: é o id que
      // alguém vai procurar quando estranhar um cadastro que sumiu. Não criei
      // uma ação nova no enum AcaoAuditoria porque acrescentar valor a enum do
      // Postgres exige `ALTER TYPE ADD VALUE`, que não roda dentro de
      // transação — e esta linha roda dentro de uma. O que a fusão faz, no
      // fim, É uma exclusão; o resto está na descrição e no metadata.
      await this.audit.registrar({
        acao: AcaoAuditoria.DELETE,
        entidade: 'Filiado',
        entidadeId: descartarId,
        descricao:
          `Cadastro duplicado consolidado: ${descartar.nomeCompleto} (${descartar.matricula}) ` +
          `foi fundido em ${manter.nomeCompleto} (${manter.matricula}) e removido.`,
        metadata: {
          mantidoId: manterId,
          mantidoMatricula: manter.matricula,
          descartadoMatricula: descartar.matricula,
          camposAbsorvidos,
          vinculosTransferidos: descartar.vinculos.length,
        },
      });

      return { ok: true, camposAbsorvidos, vinculosTransferidos: descartar.vinculos.length };
    });
  }

  /**
   * CONSOLIDAR UM GRUPO DE TRÊS OU MAIS (17/09/2026).
   *
   * A tela só oferecia o botão em grupo de dois e ainda dizia "consolide dois de
   * cada vez" — sem que houvesse como fazer isso. Eram 228 grupos parados na
   * produção (198 de três, 23 de quatro, um de sete), 724 cadastros presos.
   *
   * Cada fusão continua sendo uma transação de duas pontas, em sequência. A
   * CHECAGEM DE CPF VEM ANTES DE TUDO: se um cadastro do grupo tem CPF
   * diferente do mantido, nada é apagado e a mensagem diz qual é — descobrir
   * isso no meio deixaria metade do grupo fundido. Uma falha isolada depois
   * disso não derruba as outras; ela volta na resposta, como no lote.
   */
  async fundirGrupo(manterId: string, descartarIds: string[], autor?: string) {
    const ids = [...new Set(descartarIds)].filter((id) => id !== manterId);
    if (!ids.length) throw new BadRequestException('Escolha ao menos um cadastro para remover.');
    if (ids.length + 1 > MAXIMO_POR_GRUPO) {
      throw new BadRequestException(`São no máximo ${MAXIMO_POR_GRUPO} cadastros por vez.`);
    }

    const registros = await this.prisma.filiado.findMany({
      where: { id: { in: [manterId, ...ids] } },
      select: { id: true, cpf: true, nomeCompleto: true, matricula: true },
    });
    const manter = registros.find((r) => r.id === manterId);
    if (!manter) throw new NotFoundException('Filiado a manter não encontrado.');
    if (registros.length !== ids.length + 1) {
      throw new NotFoundException('Algum cadastro do grupo não existe mais. Recarregue a fila.');
    }
    const comCpfDiferente = registros.filter(
      (r) => r.id !== manterId && r.cpf && manter.cpf && r.cpf !== manter.cpf,
    );
    if (comCpfDiferente.length) {
      throw new BadRequestException(
        `CPF diferente do cadastro mantido em ${comCpfDiferente.map((r) => r.matricula).join(', ')} — ` +
          'são pessoas distintas. Consolide apenas os cadastros que batem.',
      );
    }

    const camposAbsorvidos = new Set<string>();
    let vinculosTransferidos = 0;
    let fundidos = 0;
    const falhas: { matricula: string; motivo: string }[] = [];

    for (const id of ids) {
      try {
        const r = await this.fundir(manterId, id, autor);
        r.camposAbsorvidos.forEach((c) => camposAbsorvidos.add(c));
        vinculosTransferidos += r.vinculosTransferidos;
        fundidos++;
      } catch (e) {
        falhas.push({
          matricula: registros.find((r) => r.id === id)?.matricula ?? id,
          motivo: e instanceof Error ? e.message : 'erro desconhecido',
        });
      }
    }

    return { ok: falhas.length === 0, fundidos, camposAbsorvidos: [...camposAbsorvidos], vinculosTransferidos, falhas };
  }

  // =========================================================================
  // Apoio
  // =========================================================================

  /** O par é sempre gravado com A < B — ver a migração. */
  private ordenarPar(x: string, y: string): [string, string] {
    return x < y ? [x, y] : [y, x];
  }

  private async exigirExistencia(ids: string[]) {
    const achados = await this.prisma.filiado.count({ where: { id: { in: ids } } });
    if (achados !== ids.length) {
      throw new NotFoundException('Filiado não encontrado.');
    }
  }
}
