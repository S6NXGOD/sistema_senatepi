import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusProcesso, TipoParteExterna, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  partesParecidas, ruidoDeCidades, type MotivoSemelhanca,
} from './utils/similaridade.util';
import { BrasilApiService, DadosCnpjReceita } from '../../common/receita/brasil-api.service';
import { PRE_PROCESSUAIS } from './processos.service';
import {
  AtualizarParteExternaDto, CriarParteExternaDto, ListParteExternaQueryDto,
} from './dto/partes.dto';

interface Ctx {
  userId?: string;
  role?: UserRole;
  ip?: string;
  userAgent?: string;
}

const SELECT = {
  id: true, tipo: true, nome: true, nomeFantasia: true, documento: true,
  email: true, telefone: true, cidade: true, uf: true, observacoes: true,
  ativo: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ParteExternaSelect;

/** Acento e caixa fora — a comparação de substring precisa ignorar os dois. */
const normalizarBusca = (t: string) =>
  t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Separa as observações acumuladas de duas organizações mescladas. */
const SEPARADOR_OBS = '\n\n';

/**
 * PartesExternasService — cadastro das partes que não são filiados nem usuários:
 * a empresa ré (PRONTOCARE), o município, uma autarquia, uma pessoa física, e o
 * próprio sindicato quando é ele quem propõe a ação.
 *
 * POR QUE CADASTRO E NÃO TEXTO LIVRE: é o que transforma "temos um processo
 * contra a Prontocare" em "temos 14 processos contra a PRONTOCARE, somando
 * R$ X em valor de causa". Com o nome redigitado a cada processo
 * ("Prontocare", "PRONTO CARE LTDA", "Pronto-Care") nenhuma dessas perguntas
 * tem resposta.
 *
 * MAS O CADASTRO É OPCIONAL: uma parte pode existir só com o nome digitado na
 * própria `ParteProcesso`. Este cadastro é o caminho de quem se repete.
 */
/**
 * QUAL DOS DOIS CADASTROS DEVE SOBREVIVER À MESCLAGEM.
 *
 * Não é gosto: é quantidade de coisa que teria de ser movida. Cada participação
 * em processo e cada vínculo de emprego repontado é uma linha alterada, e o
 * dossiê patronal carrega contribuição e credencial de portal. Sobreviver quem
 * tem mais é o caminho que mexe em menos — e o que mexe em menos erra menos.
 *
 * O documento entra com peso alto porque um cadastro COM CNPJ é o que permite
 * conferir a organização na Receita depois; perdê-lo custa mais que uma linha.
 */
function pesoDoCadastro(p: {
  documento: string | null;
  dossiePatronal: { id: string } | null;
  institucional: boolean;
  _count: { participacoes: number; vinculos: number };
}): number {
  return (
    (p.institucional ? 10_000 : 0) +
    (p.dossiePatronal ? 1_000 : 0) +
    (p.documento ? 100 : 0) +
    p._count.participacoes * 2 +
    p._count.vinculos
  );
}

/**
 * ÓRGÃO PÚBLICO OU EMPRESA? A Receita já responde, e melhor que o formulário.
 *
 * No cadastro de produção havia prefeitura classificada como "Empresa" — não
 * por descuido, mas porque a distinção não é óbvia para quem digita às pressas
 * e o campo vinha em branco. A natureza jurídica da Receita é justamente essa
 * classificação, feita por quem tem autoridade para fazê-la.
 *
 * A lista cobre os prefixos do código da natureza jurídica (grupos 1xxx =
 * Administração Pública) pelo NOME, porque é o nome que a BrasilAPI devolve.
 * Na dúvida devolve JURIDICA: errar para o lado de "empresa" é o padrão atual e
 * não piora nada; errar para "órgão público" mudaria o comportamento de tela
 * sem que ninguém tivesse pedido.
 */
export function tipoPelaNatureza(natureza?: string | null): TipoParteExterna {
  const n = (natureza ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (!n) return TipoParteExterna.JURIDICA;
  const PUBLICO = [
    'municipio', 'estado', 'uniao', 'orgao publico', 'autarquia', 'fundacao publica',
    'secretaria', 'empresa publica', 'sociedade de economia mista', 'consorcio publico',
    'poder', 'ministerio', 'tribunal', 'prefeitura', 'camara', 'assembleia',
    'servico social autonomo', 'conselho', 'comissao polinacional', 'fundo publico',
    'autoridade autonoma',
  ];
  return PUBLICO.some((t) => n.includes(t))
    ? TipoParteExterna.ORGAO_PUBLICO
    : TipoParteExterna.JURIDICA;
}

@Injectable()
export class PartesExternasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly receita: BrasilApiService,
  ) {}

  /**
   * CONSULTA O CNPJ NA RECEITA — E CONFERE O NOSSO CADASTRO ANTES.
   *
   * A ordem importa e é o ponto da funcionalidade. A duplicata não nasce por
   * falta de cuidado: nasce porque quem cadastra NÃO TEM COMO SABER que a
   * organização já existe com outro nome. "PRONTOCARE" e "PRONTOCARE CLINICA E
   * ATENDIMENTOS LTDA" são o mesmo CNPJ e dois cadastros.
   *
   * Então a resposta traz três coisas, nesta ordem de força:
   *
   *  1. `jaCadastrada` — MESMO CNPJ no nosso banco. É a mesma organização,
   *     ponto; a tela oferece abrir em vez de criar.
   *  2. `parecidas` — nome semelhante SEM o mesmo documento. É o caso do
   *     cadastro antigo feito só pelo nome, antes de alguém ter o CNPJ: aqui a
   *     consulta vira uma oportunidade de MESCLAR, não de criar mais um.
   *  3. os dados da Receita, para preencher o formulário.
   *
   * A consulta nunca é obrigatória: se a Receita estiver fora do ar, o erro sobe
   * com mensagem em português e o cadastro manual segue funcionando.
   */
  async consultarCnpj(cnpjEntrada: string) {
    const dados = await this.receita.consultar(cnpjEntrada);

    const jaCadastrada = await this.prisma.parteExterna.findFirst({
      where: { documento: dados.cnpj },
      select: { ...SELECT, dossiePatronal: { select: { id: true } } },
    });

    // Parecidas por NOME só interessam quando não houve casamento por documento
    // — com o CNPJ na mão a resposta já é definitiva, e listar semelhantes ali
    // só daria à pessoa a chance de escolher o cadastro errado.
    const parecidas = jaCadastrada
      ? []
      : // `parecidas` já achata a parte no topo do objeto; o filtro tira quem
        // casou pelo próprio documento, que aqui seria a resposta do bloco acima.
        (await this.parecidas(dados.razaoSocial, dados.cnpj)).filter(
          (c) => c.documento !== dados.cnpj,
        );

    return {
      ...dados,
      /** Sugestão de tipo a partir da natureza jurídica — a tela pode aceitar ou trocar. */
      tipoSugerido: tipoPelaNatureza(dados.naturezaJuridica),
      jaCadastrada,
      parecidas,
    };
  }

  async listar(q: ListParteExternaQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const and: Prisma.ParteExternaWhereInput[] = [];

    if (q.tipo) and.push({ tipo: q.tipo });
    if (q.incluirInativas !== 'true') and.push({ ativo: true });

    const busca = q.busca?.trim();
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      and.push({
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          { nomeFantasia: { contains: busca, mode: 'insensitive' } },
          ...(digitos.length >= 3 ? [{ documento: { contains: digitos } }] : []),
        ],
      });
    }
    const where: Prisma.ParteExternaWhereInput = and.length ? { AND: and } : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.parteExterna.count({ where }),
      this.prisma.parteExterna.findMany({
        where,
        orderBy: { nome: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { ...SELECT, _count: { select: { participacoes: true } } },
      }),
    ]);

    return { items, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * Cadastros que podem SER a parte que alguém está digitando.
   *
   * Diferente da busca do autocomplete, que usa `contains` e só acha quem digita
   * MENOS do que está gravado: quem digita a razão social inteira não encontra o
   * apelido já cadastrado, e cadastra o segundo. Foi assim que "PRONTOCARE" e
   * "PRONTOCARE CLINICA E ATENDIMENTOS LTDA" passaram a conviver na base — e a
   * conta de "quantos processos contra esta empresa" deixou de valer.
   *
   * Compara PALAVRA a palavra, nos dois sentidos, ignorando forma societária e
   * termos genéricos do ramo (ver `similaridade.util.ts`, com testes).
   *
   * A LISTA INTEIRA vem para a memória de propósito: o cadastro de partes é
   * pequeno (dezenas), a comparação por palavra não é expressável em índice, e
   * um teto explícito é mais honesto que uma consulta que degrada em silêncio.
   * Se um dia passar de mil, o caminho é `pg_trgm` — e aí este comentário vira
   * o aviso de que chegou a hora.
   */
  async parecidas(nome: string, documento?: string) {
    const termo = (nome ?? '').trim();
    if (termo.length < 3) return [];

    const candidatos = await this.prisma.parteExterna.findMany({
      where: { ativo: true },
      select: {
        id: true, nome: true, nomeFantasia: true, documento: true, tipo: true,
        _count: { select: { participacoes: true } },
      },
      orderBy: { nome: 'asc' },
      take: 1000,
    });

    const fortes = partesParecidas(termo, documento, candidatos).map((s) => ({
      ...s.parte,
      motivo: s.motivo,
    }));

    /**
     * O COMPLEMENTO POR SUBSTRING — e o buraco que ele tapa.
     *
     * A comparação por palavra descarta ruído de propósito: `municipio`,
     * `hospital`, `clinica` não identificam ninguém, senão toda prefeitura seria
     * duplicata de todas as outras. O efeito colateral apareceu no uso: digitar
     * "Município" não produz palavra significativa NENHUMA, então o aviso ficava
     * mudo — enquanto a aba "Do cadastro", que usa `contains`, listava os
     * municípios cadastrados na mesma tela.
     *
     * Quem está digitando não tem como saber que são dois algoritmos. Ver um
     * lado achar e o outro dizer "pode criar" não parece critério: parece falha.
     *
     * Então o que o autocomplete acharia entra aqui também, como indício FRACO e
     * declarado (`CONTEM`), depois dos fortes. Sem consulta nova: a varredura é
     * sobre a mesma lista já carregada acima.
     *
     * Fica de fora da fila de limpeza (`duplicadas`), que só aceita indício
     * forte — substring é ótimo para avisar quem digita e péssimo para uma
     * lista que ninguém revisa.
     */
    const jaListados = new Set(fortes.map((f) => f.id));
    const alvo = normalizarBusca(termo);
    const contem = candidatos
      .filter((c) => {
        if (jaListados.has(c.id)) return false;
        return (
          normalizarBusca(c.nome).includes(alvo) ||
          normalizarBusca(c.nomeFantasia ?? '').includes(alvo)
        );
      })
      // Mais processos primeiro: entre vários candidatos fracos, o cadastro com
      // histórico é o que mais custa duplicar.
      .sort((a, b) => b._count.participacoes - a._count.participacoes)
      .slice(0, 5)
      .map((c) => ({ ...c, motivo: 'CONTEM' as const }));

    return [...fortes, ...contem];
  }

  /**
   * Dossiê da parte: o cadastro + TODOS os processos em que ela figura.
   * É a tela que responde "o que temos contra a PRONTOCARE?".
   */
  /**
   * VARRE O CADASTRO INTEIRO PROCURANDO DUPLICATAS.
   *
   * `parecidas()` responde "o que estou digitando já existe?" — serve na hora
   * de cadastrar. Isto responde outra pergunta, a que ninguém faz sozinho:
   * "quantas duplicatas já entraram e estão aqui há meses?". Sem alguém
   * perguntar, elas ficam — e cada uma quebra em duas a contagem de processos
   * contra aquela organização, que é a razão de o cadastro existir.
   *
   * Compara todos contra todos. É O(n²), e é aceitável de propósito: o cadastro
   * tem centenas de linhas, não milhões, e a alternativa (índice de trigramas,
   * job noturno) custaria muito mais do que o problema. O `take` limita a
   * varredura e o log diz quando ela foi truncada — silêncio aqui viraria
   * "não há duplicatas" quando o que houve foi corte.
   *
   * A ORDEM DO PAR NÃO É ARBITRÁRIA: sugere como sobrevivente quem tem mais
   * vínculos, dossiê patronal ou documento — mover pouco erra menos. Mas é
   * SUGESTÃO: quem decide é a pessoa, na tela, com os dois lados à vista.
   */
  async duplicadas(limite = 400) {
    const todas = await this.prisma.parteExterna.findMany({
      where: { ativo: true },
      select: {
        id: true, nome: true, nomeFantasia: true, documento: true, tipo: true,
        cidade: true, uf: true, institucional: true,
        dossiePatronal: { select: { id: true } },
        _count: { select: { participacoes: true, vinculos: true } },
      },
      orderBy: { nome: 'asc' },
      take: limite,
    });

    const truncou = todas.length === limite;

    // Pares que uma pessoa já disse que NÃO são a mesma coisa. Sem isto, o
    // falso positivo volta em toda visita e a fila nunca converge.
    const descartados = new Set(
      (await this.prisma.parteExternaNaoDuplicada.findMany({ select: { aId: true, bId: true } }))
        .map((d) => `${d.aId}|${d.bId}`),
    );
    // As cidades DO PRÓPRIO cadastro viram ruído: "TERESINA" aparece em meia
    // dúzia de nomes e não identifica nenhum deles. Ver `ruidoDeCidades`.
    const ruido = ruidoDeCidades(todas);
    const vistos = new Set<string>();
    const pares: Array<{
      motivo: MotivoSemelhanca;
      fica: (typeof todas)[number];
      duplicada: (typeof todas)[number];
    }> = [];

    for (const atual of todas) {
      const outros = todas.filter((c) => c.id !== atual.id);
      for (const s of partesParecidas(atual.nome, atual.documento, outros, 3, ruido)) {
        // O par (A,B) e (B,A) é a mesma dupla: a chave ordenada evita listar as
        // duas e fazer a pessoa decidir a mesma coisa duas vezes.
        const chave = [atual.id, s.parte.id].sort().join('|');
        if (vistos.has(chave) || descartados.has(chave)) continue;
        vistos.add(chave);

        // PALAVRAS_EM_COMUM sozinho gera ruído demais numa varredura ampla:
        // ao digitar, o aviso é barato porque a pessoa está olhando o nome;
        // aqui ele viraria uma lista de falsos positivos que ninguém revisa.
        // (`CONTEM` nem chega até aqui: é acrescentado só em `parecidas`.)
        if (s.motivo === 'PALAVRAS_EM_COMUM') continue;

        const [fica, duplicada] = [atual, s.parte].sort(
          (a, b) => pesoDoCadastro(b) - pesoDoCadastro(a),
        );
        pares.push({ motivo: s.motivo, fica, duplicada });
      }
    }

    // Documento igual primeiro: é o único indício que não admite dúvida.
    const ordem: Record<string, number> = { MESMO_DOCUMENTO: 0, MESMO_NOME: 1, CONTIDO: 2 };
    pares.sort((a, b) => (ordem[a.motivo] ?? 9) - (ordem[b.motivo] ?? 9));

    return { pares, analisadas: todas.length, truncou };
  }

  async detalhe(id: string) {
    const parte = await this.prisma.parteExterna.findUnique({
      where: { id },
      select: {
        ...SELECT,
        institucional: true,
        /**
         * O QUE ESTÁ PENDURADO NA ORGANIZAÇÃO — e por que precisa aparecer.
         *
         * Antes o detalhe só trazia processos, e a tela nem isso mostrava. Só
         * que a pergunta prática de quem abre uma organização não é só "quantos
         * processos"; é "o que acontece se eu mexer nela?". Um hospital pode
         * ser réu em quatro ações, empregador de trezentos filiados e
         * contribuinte patronal ao mesmo tempo — e as três coisas apontam para
         * esta mesma linha. Sem vê-las juntas, desativar ou mesclar é chute.
         */
        dossiePatronal: {
          select: { id: true, razaoSocial: true, cnpj: true, primeiroAcesso: true },
        },
        _count: { select: { vinculos: true } },
      },
    });
    if (!parte) throw new NotFoundException('Parte não encontrada.');

    // Os filiados que trabalham aqui. Amostra, não lista completa: um órgão
    // grande tem centenas, e o detalhe não é a tela de listagem de filiados.
    const vinculos = await this.prisma.vinculoProfissional.findMany({
      where: { parteExternaId: id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true, cargo: true, lotacao: true, matricula: true, descontoEmFolha: true,
        filiado: {
          select: { id: true, nomeCompleto: true, matricula: true, situacao: true },
        },
      },
    });

    const participacoes = await this.prisma.parteProcesso.findMany({
      where: { parteExternaId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, polo: true, papel: true,
        processo: {
          select: {
            id: true, numeroCNJ: true, classeProcessual: true, assuntoPrincipal: true,
            tribunal: true, statusInterno: true, valorCausa: true, dataDistribuicao: true,
          },
        },
      },
    });

    // Valor total em causa: a pergunta que justifica existir este cadastro.
    const valorTotal = participacoes.reduce(
      (soma, p) => soma + Number(p.processo.valorCausa ?? 0),
      0,
    );
    // Os dois rótulos do pré-processual somam na MESMA chave: agrupar pelo valor
    // cru renderia duas linhas com o rótulo idêntico na tela ("Pré-processual: 1"
    // duas vezes), que é o tipo de coisa que faz a pessoa desconfiar do número.
    const porStatus = participacoes.reduce<Record<string, number>>((acc, p) => {
      const chave = PRE_PROCESSUAIS.includes(p.processo.statusInterno)
        ? StatusProcesso.PRE_PROCESSUAL
        : p.processo.statusInterno;
      acc[chave] = (acc[chave] ?? 0) + 1;
      return acc;
    }, {});

    return {
      ...parte,
      participacoes,
      vinculos,
      resumo: {
        processos: participacoes.length,
        comoReu: participacoes.filter((p) => p.polo === 'PASSIVO').length,
        comoAutor: participacoes.filter((p) => p.polo === 'ATIVO').length,
        valorTotalEmCausa: valorTotal,
        porStatus,
        /** Total de vínculos — `vinculos` acima é só a amostra exibida. */
        filiadosVinculados: parte._count.vinculos,
        contribuintePatronal: !!parte.dossiePatronal,
      },
    };
  }

  /**
   * "NÃO SÃO A MESMA" — a pessoa desfaz o palpite da varredura.
   *
   * Guardar a decisão é o que transforma a fila de duplicatas em algo que
   * ESVAZIA. A comparação de nomes vai errar sempre; o que não pode é errar a
   * mesma coisa toda semana, porque aí ninguém mais abre o painel — nem quando
   * houver duplicata de verdade.
   *
   * O par é normalizado antes de gravar (o CHECK do banco também exige), senão
   * descartar (A,B) deixaria (B,A) voltando na varredura seguinte.
   */
  async naoSaoDuplicadas(idA: string, idB: string, ctx: Ctx) {
    if (idA === idB) throw new BadRequestException('Escolha duas organizações diferentes.');
    const [aId, bId] = [idA, idB].sort();

    const existem = await this.prisma.parteExterna.count({ where: { id: { in: [aId, bId] } } });
    if (existem !== 2) throw new NotFoundException('Uma das organizações não foi encontrada.');

    await this.prisma.parteExternaNaoDuplicada.upsert({
      where: { aId_bId: { aId, bId } },
      update: { descartadoPor: ctx.userId ?? null },
      create: { aId, bId, descartadoPor: ctx.userId ?? null },
    });
    return { ok: true, aId, bId };
  }

  /**
   * MESCLAR DUAS ORGANIZAÇÕES QUE SÃO A MESMA.
   *
   * O que torna isto delicado não é mover as linhas: é o que o banco já
   * protege. Quatro índices únicos e uma relação de dinheiro passam por aqui, e
   * cada um exige decisão explícita — nenhum pode ser resolvido "tentando e
   * vendo se dá erro", porque o erro apareceria com a mesclagem pela metade.
   *
   *  1. `partes_processo (processo_id, parte_externa_id)` é ÚNICO. Se as duas
   *     figuram no MESMO processo — comum, porque é ali que se percebe a
   *     duplicata —, repontar estoura. A linha da duplicada é ABSORVIDA.
   *  2. `partes_processo` aceita no máximo UMA parte principal por polo.
   *  3. `empresas.parte_externa_id` é ÚNICO. Se as DUAS têm dossiê patronal, a
   *     mesclagem é RECUSADA: são contribuições lançadas no caixa e uma
   *     credencial de portal — juntá-las é decisão financeira, não de cadastro.
   *  4. `partes_externas.documento` é único. A que fica herda o documento da
   *     outra, mas só se estiver sem nenhum.
   *
   * E a parte INSTITUCIONAL (o próprio sindicato) nunca é apagada por engano.
   *
   * Tudo numa transação: ou a duplicada some com todos os vínculos já
   * transferidos, ou nada acontece. Uma mesclagem parcial deixaria processo
   * apontando para cadastro inexistente.
   */
  async mesclar(ficaId: string, duplicadaId: string, ctx: Ctx) {
    if (ficaId === duplicadaId) {
      throw new BadRequestException('Escolha duas organizações diferentes.');
    }

    const sel = {
      id: true, nome: true, nomeFantasia: true, documento: true, tipo: true,
      email: true, telefone: true, cidade: true, uf: true, observacoes: true,
      institucional: true, ativo: true,
      dossiePatronal: { select: { id: true } },
      _count: { select: { participacoes: true, vinculos: true } },
    } satisfies Prisma.ParteExternaSelect;

    const [fica, dup] = await Promise.all([
      this.prisma.parteExterna.findUnique({ where: { id: ficaId }, select: sel }),
      this.prisma.parteExterna.findUnique({ where: { id: duplicadaId }, select: sel }),
    ]);
    if (!fica) throw new NotFoundException('A organização que deve permanecer não foi encontrada.');
    if (!dup) throw new NotFoundException('A organização duplicada não foi encontrada.');

    if (dup.institucional) {
      throw new BadRequestException(
        'Esta é a organização institucional (o próprio sindicato) e não pode ser removida numa mesclagem. ' +
          'Inverta a escolha: mescle a outra DENTRO dela.',
      );
    }
    if (fica.dossiePatronal && dup.dossiePatronal) {
      throw new ConflictException(
        'As duas têm dossiê patronal, com contribuições e acesso ao portal. ' +
          'Junte primeiro os dados no módulo Patronal — mesclar aqui apagaria histórico financeiro.',
      );
    }
    if (fica.documento && dup.documento && fica.documento !== dup.documento) {
      throw new ConflictException(
        `Os documentos são diferentes (${fica.documento} e ${dup.documento}). ` +
          'Se um estiver errado, corrija antes de mesclar — do jeito que está, podem ser organizações distintas.',
      );
    }

    /**
     * A IDENTIDADE QUE VAI VALER DEPOIS DA MESCLAGEM — calculada ANTES de mexer
     * em qualquer linha.
     *
     * Três tabelas guardam uma CÓPIA do nome da organização, e cada uma por um
     * motivo legítimo:
     *
     *   · `partes_processo.nome`     — o nome como consta NOS AUTOS;
     *   · `vinculos_profissionais.empresa` — texto livre, para o vínculo
     *     sobreviver à exclusão da organização;
     *   · `empresas.razao_social/cnpj`    — reserva do dossiê patronal.
     *
     * Numa exclusão, essas cópias são o que salva o histórico. Numa MESCLAGEM,
     * elas viram o problema: a organização não sumiu, foi absorvida — e deixar a
     * cópia com o nome antigo é exatamente a "informação dispersa" que a
     * mesclagem existe para acabar. O dossiê do filiado mostraria "PRONTOCARE"
     * enquanto o vínculo aponta para "PRONTOCARE CLINICA E ATENDIMENTOS LTDA".
     *
     * Calculada aqui, e não no fim, porque a que fica ainda vai HERDAR campos em
     * branco da duplicada (o CNPJ, por exemplo). Usar `fica` cru gravaria nas
     * cópias um documento nulo que, dois passos depois, deixa de ser nulo.
     */
    const identidade = {
      nome: fica.nome,
      nomeFantasia: fica.nomeFantasia ?? dup.nomeFantasia,
      documento: fica.documento ?? dup.documento,
    };

    const resumo = await this.prisma.$transaction(async (tx) => {
      // ---- 1. participações em processos ----------------------------------
      const doDup = await tx.parteProcesso.findMany({
        where: { parteExternaId: duplicadaId },
        select: { id: true, processoId: true, polo: true, principal: true, papel: true },
      });
      const doFica = await tx.parteProcesso.findMany({
        where: {
          parteExternaId: ficaId,
          processoId: { in: doDup.map((x) => x.processoId) },
        },
        select: { id: true, processoId: true, polo: true, principal: true },
      });
      const jaTem = new Map(doFica.map((x) => [x.processoId, x]));

      let repontados = 0;
      let absorvidos = 0;
      for (const linha of doDup) {
        const existente = jaTem.get(linha.processoId);
        if (!existente) {
          // O nome gravado na parte do processo é SNAPSHOT do que consta nos
          // autos; ao repontar, passa a valer o da organização que fica, senão
          // a tela mostraria o nome do cadastro que acabou de deixar de existir.
          await tx.parteProcesso.update({
            where: { id: linha.id },
            data: { parteExternaId: ficaId, nome: identidade.nome, documento: identidade.documento },
          });
          repontados++;
          continue;
        }
        // Já figura no mesmo processo: a linha da duplicada é ABSORVIDA, e o
        // que ela tinha de melhor passa para a que fica — `papel` costuma estar
        // preenchido só em um dos dois cadastros.
        const promover =
          linha.principal && !existente.principal && linha.polo === existente.polo;

        /*
         * APAGAR VEM PRIMEIRO, E A ORDEM NÃO É ESTILO.
         *
         * `partes_processo_principal_por_polo_key` é único parcial sobre
         * (processo_id, polo) WHERE principal. Promover a que fica ANTES de
         * apagar a duplicada deixa as duas com `principal` no mesmo polo por um
         * instante — e o índice recusa dentro da transação. Custou um teste
         * contra banco de verdade para aparecer: com dublê, passava.
         *
         * Mesmo cuidado de `sincronizarEquipe`, na agenda: apagar, depois
         * rebaixar, depois promover.
         */
        await tx.parteProcesso.delete({ where: { id: linha.id } });
        if (promover || linha.papel) {
          await tx.parteProcesso.update({
            where: { id: existente.id },
            data: {
              ...(promover ? { principal: true } : {}),
              ...(linha.papel ? { papel: linha.papel } : {}),
            },
          });
        }
        absorvidos++;
      }

      // ---- 2. vínculos de emprego -----------------------------------------
      // Não há unicidade por organização aqui: repontar todos é seguro.
      //
      // `empresa` é TEXTO LIVRE e vai junto. Ele existe para o vínculo
      // sobreviver à exclusão da organização — mas aqui ela não foi excluída,
      // foi absorvida, e deixar o nome velho faria o dossiê do filiado exibir
      // uma organização que não existe mais enquanto o vínculo aponta para
      // outra. É a informação dispersa que a mesclagem veio resolver.
      const vinculos = await tx.vinculoProfissional.updateMany({
        where: { parteExternaId: duplicadaId },
        data: { parteExternaId: ficaId, empresa: identidade.nome },
      });

      // ---- 3. dossiê patronal ---------------------------------------------
      // Só chega aqui quem tem no máximo um dos dois (conferido acima).
      let dossieMovido = false;
      if (dup.dossiePatronal) {
        await tx.empresa.update({
          where: { id: dup.dossiePatronal.id },
          // As colunas de `empresas` são SNAPSHOT DE RESERVA: a identidade
          // exibida é lida da organização, mas a tabela não tem tela de edição
          // própria. Sem atualizá-las, a reserva ficaria nomeando um cadastro
          // que acabou de deixar de existir.
          data: {
            parteExternaId: ficaId,
            razaoSocial: identidade.nome,
            nomeFantasia: identidade.nomeFantasia,
            ...(identidade.documento ? { cnpj: identidade.documento } : {}),
          },
        });
        dossieMovido = true;
      }

      // ---- 4. o que estava em branco na que fica --------------------------
      // NUNCA sobrescreve o que já tem valor: a que fica é a escolhida, e o
      // objetivo é completá-la, não deixá-la refém do cadastro pior.
      const completar: Prisma.ParteExternaUpdateInput = {};
      const CAMPOS = ['documento', 'nomeFantasia', 'email', 'telefone', 'cidade', 'uf'] as const;
      for (const campo of CAMPOS) {
        if (!fica[campo] && dup[campo]) {
          (completar as Record<string, unknown>)[campo] = dup[campo];
        }
      }
      // A observação é ACUMULADA, não substituída: são anotações de pessoas, e
      // a da duplicada costuma ser justamente o que explica a confusão.
      if (dup.observacoes?.trim()) {
        completar.observacoes = [fica.observacoes?.trim(), dup.observacoes.trim()]
          .filter(Boolean)
          .join(SEPARADOR_OBS);
      }
      /*
       * DE NOVO: APAGAR PRIMEIRO.
       *
       * `partes_externas.documento` é único (parcial, onde não é nulo). Copiar
       * o CNPJ da duplicada para a que fica ENQUANTO a duplicada ainda existe
       * deixa as duas com o mesmo documento — e o índice recusa. É a mesma
       * armadilha do `principal` acima, no mesmo método, por motivo diferente:
       * herdar valor de quem vai sumir só é seguro depois que ele sumiu.
       */
      await tx.parteExterna.delete({ where: { id: duplicadaId } });

      if (Object.keys(completar).length) {
        await tx.parteExterna.update({ where: { id: ficaId }, data: completar });
      }

      return {
        processosRepontados: repontados,
        participacoesAbsorvidas: absorvidos,
        vinculosMovidos: vinculos.count,
        dossiePatronalMovido: dossieMovido,
        camposCompletados: Object.keys(completar),
      };
    });

    /**
     * A auditoria guarda o CADASTRO INTEIRO que foi apagado, não só o id.
     * Mesclagem não tem desfazer na tela; sem o retrato do que sumiu, uma
     * escolha errada não teria como ser reconstruída nem explicada depois.
     */
    await this.audit.registrar({
      acao: AcaoAuditoria.DELETE,
      entidade: 'ParteExterna',
      entidadeId: duplicadaId,
      descricao: `Organização "${dup.nome}" mesclada em "${fica.nome}"`,
      metadata: { mescladaEm: ficaId, apagada: dup, resultado: resumo },
      ...ctx,
    });

    return { ...resumo, ficaId, removida: { id: dup.id, nome: dup.nome } };
  }

  async criar(dto: CriarParteExternaDto, ctx: Ctx) {
    const documento = this.validarDocumento(dto.documento, dto.tipo);
    if (documento) await this.garantirDocumentoLivre(documento);

    const parte = await this.prisma.parteExterna.create({
      data: {
        tipo: dto.tipo,
        nome: dto.nome.trim(),
        nomeFantasia: dto.nomeFantasia?.trim() || null,
        documento,
        email: dto.email?.trim() || null,
        telefone: dto.telefone?.trim() || null,
        cidade: dto.cidade?.trim() || null,
        uf: dto.uf?.trim().toUpperCase() || null,
        observacoes: dto.observacoes?.trim() || null,
      },
      select: SELECT,
    });

    await this.auditar(AcaoAuditoria.CREATE, parte.id, ctx,
      `Parte "${parte.nome}" cadastrada (${this.rotuloTipo(parte.tipo)})`);
    return parte;
  }

  async atualizar(id: string, dto: AtualizarParteExternaDto, ctx: Ctx) {
    const atual = await this.prisma.parteExterna.findUnique({
      where: { id },
      select: { id: true, nome: true, tipo: true, documento: true },
    });
    if (!atual) throw new NotFoundException('Parte não encontrada.');

    const documento =
      dto.documento === undefined
        ? undefined
        : this.validarDocumento(dto.documento, dto.tipo ?? atual.tipo);
    if (documento && documento !== atual.documento) await this.garantirDocumentoLivre(documento);

    const parte = await this.prisma.parteExterna.update({
      where: { id },
      data: {
        tipo: dto.tipo,
        nome: dto.nome?.trim(),
        nomeFantasia: dto.nomeFantasia === undefined ? undefined : dto.nomeFantasia?.trim() || null,
        documento,
        email: dto.email === undefined ? undefined : dto.email?.trim() || null,
        telefone: dto.telefone === undefined ? undefined : dto.telefone?.trim() || null,
        cidade: dto.cidade === undefined ? undefined : dto.cidade?.trim() || null,
        uf: dto.uf === undefined ? undefined : dto.uf?.trim().toUpperCase() || null,
        observacoes: dto.observacoes === undefined ? undefined : dto.observacoes?.trim() || null,
        ativo: dto.ativo,
      },
      select: SELECT,
    });

    // O nome nos autos de cada processo é um SNAPSHOT e NÃO é reescrito de
    // propósito: se a empresa mudou de razão social, os processos antigos devem
    // continuar mostrando o nome sob o qual foram distribuídos.
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx, `Parte "${parte.nome}" atualizada`);
    return parte;
  }

  /**
   * Exclui o cadastro. Se a parte já figura em algum processo, BLOQUEIA e sugere
   * desativar — apagar viraria "parte não identificada" em processos reais.
   * (A regra global já restringe DELETE ao Administrador.)
   */
  async remover(id: string, ctx: Ctx) {
    const parte = await this.prisma.parteExterna.findUnique({
      where: { id },
      select: { id: true, nome: true, _count: { select: { participacoes: true } } },
    });
    if (!parte) throw new NotFoundException('Parte não encontrada.');

    if (parte._count.participacoes > 0) {
      throw new ConflictException(
        `"${parte.nome}" figura em ${parte._count.participacoes} processo(s). Desative o cadastro em vez de excluir para preservar o histórico.`,
      );
    }

    await this.prisma.parteExterna.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, id, ctx, `Parte "${parte.nome}" excluída do cadastro`);
    return { ok: true };
  }

  // -------------------------------------------------------------------------

  /**
   * CPF (11) para pessoa física, CNPJ (14) para PJ/órgão público. Validamos o
   * TAMANHO, não os dígitos verificadores: parte adversa costuma vir do próprio
   * documento processual e travar por DV impediria o cadastro de um dado
   * legítimo. O documento é opcional — muita parte só se conhece pelo nome.
   */
  private validarDocumento(v: string | undefined, tipo: TipoParteExterna): string | null {
    const d = (v ?? '').replace(/\D/g, '');
    if (!d) return null;
    if (tipo === TipoParteExterna.FISICA && d.length !== 11) {
      throw new BadRequestException('Pessoa física: informe um CPF com 11 dígitos.');
    }
    if (tipo !== TipoParteExterna.FISICA && d.length !== 14) {
      throw new BadRequestException('Pessoa jurídica/órgão público: informe um CNPJ com 14 dígitos.');
    }
    return d;
  }

  private async garantirDocumentoLivre(documento: string) {
    const existe = await this.prisma.parteExterna.findFirst({
      where: { documento },
      select: { id: true, nome: true },
    });
    if (existe) {
      throw new ConflictException(
        `Este CPF/CNPJ já está cadastrado em "${existe.nome}". Use o cadastro existente.`,
      );
    }
  }

  private rotuloTipo(tipo: TipoParteExterna): string {
    return tipo === 'FISICA' ? 'pessoa física'
      : tipo === 'JURIDICA' ? 'pessoa jurídica'
      : 'órgão público';
  }

  private auditar(acao: AcaoAuditoria, entidadeId: string, ctx: Ctx, descricao: string) {
    return this.audit.registrar({
      userId: ctx.userId ?? null, acao, entidade: 'ParteExterna', entidadeId, descricao,
      ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
  }
}
