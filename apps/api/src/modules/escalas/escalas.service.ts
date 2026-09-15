import { randomUUID } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusCompromisso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { marcarNadaMudou } from '../../common/audit/audit.contexto';
import { AlteracaoDeCampo, diferencaDeCampos } from '../../common/audit/audit.diff';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { nivelEfetivo } from '../../common/permissions/permissoes.constants';
import { AgendaService } from '../agenda/agenda.service';
import { NAO_E_RESERVA } from '../agenda/equipe.util';
import { passarConsultaEmTransacao, PassagemFeita } from '../agenda/troca-de-responsavel';
import { diaBR, diaDeCalendarioBR, mesBR } from '../processos/utils/data-br.util';
import { celularParaWhatsApp } from '../recadastramento/whatsapp.util';
import {
  AtualizarEscalaDto, CopiaQueryDto, CopiarEscalaDto, CriarEscalasDto, ListEscalasQueryDto,
} from './dto/escalas.dto';
import {
  ConsultaClassificada, ConsultaLida, FRASE_PLANTAO_PASSOU, classificarConsultas, foraDoNovoHorario,
  instanteBR, motivoDaConsultaQueSaiu, papelDeQuemSai, selectDaConsultaDoPlantao,
  whereDasConsultasDoPlantao,
} from './consultas-do-plantao';
import {
  Faixa, JANELA_DO_DESFAZER_DA_COPIA_MS, PlantaoDaCopia, PlantaoDoLote, chaveDaCopia, contar, dataDaColuna,
  decidirDesfazerCopia, diaCurto, ehDataPuraValida, faixaValida, fraseDaSobreposicao,
  fraseDosDiasSemNinguem, nomeDoMes, PlantaoGravado, pessoaDepoisDeDe, pessoaNaFrase, pessoaNoInicio,
  planejarCopia, procurarSobreposicao, textoDaColuna,
} from './escalas.regras';

type Leitor = Pick<AuthUser, 'id' | 'role' | 'permissoes'>;

interface Ctx {
  userId?: string;
  /** Nome de quem agiu — congelado na linha do tempo da consulta. */
  nome?: string;
  /** Perfil e matriz de quem pede: passar consultas exige Agenda EDITAR. */
  leitor?: Leitor;
  ip?: string;
  userAgent?: string;
}

/** O nível do leitor num módulo; sem leitor (chamada interna sem token), nenhum. */
const nivelDo = (leitor: Leitor | undefined, modulo: 'agenda' | 'filiados') =>
  leitor ? nivelEfetivo(leitor.role, leitor.permissoes, modulo) : 'SEM_ACESSO';

/**
 * `avatarUrl` + `avatarKey`: a foto enviada por upload mora no storage, e quem
 * a resolve é o `AvataresInterceptor`, que só mexe em objeto que carrega a
 * chave (e a remove depois). O encaminhamento da triagem (C5) mostra o rosto de
 * quem está de plantão.
 */
const advogadoSel = {
  select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true },
} as const;

const escalaSel = {
  id: true, data: true, horaInicio: true, horaFim: true, observacao: true,
  advogadoId: true, advogado: advogadoSel,
} as const;

/** O que a cópia lê de cada plantão: `ativo` decide se a pessoa ainda pode ser escalada. */
const plantaoDaCopiaSel = {
  id: true, data: true, horaInicio: true, horaFim: true, advogadoId: true,
  advogado: { select: { id: true, nome: true, nomeExibicao: true, ativo: true } },
} as const;

/**
 * Intervalo [gte, lt) do mês (YYYY-MM), para a coluna `@db.Date`.
 *
 * SEM MÊS, O MÊS É O DE TERESINA. Estava `new Date().getUTCMonth()`: das 21h do
 * último dia do mês em diante, no contêiner (UTC), "o mês atual" já era o
 * seguinte. Nenhum chamador omitia o parâmetro, então o defeito era latente —
 * mas era a regra do fuso escrita de novo, fora de `data-br.util`.
 *
 * Os limites são meia-noite UTC de propósito: é assim que o Postgres materializa
 * uma coluna `date` (dia contra dia).
 */
export function rangeMes(mes?: string, agora = new Date()) {
  const texto = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : mesBR(agora);
  const [y, m] = texto.split('-').map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

/**
 * O dia do plantão, para a coluna `@db.Date`.
 *
 * SEM DATA, "HOJE" É O DIA DE TERESINA (`diaDeCalendarioBR`). Estava o dia UTC
 * do relógio: às 22h daqui a triagem veria o plantão de amanhã.
 */
export function diaDoPlantao(data?: string, agora = new Date()) {
  const gte = data && ehDataPuraValida(data) ? dataDaColuna(data) : diaDeCalendarioBR(agora);
  return { gte, lt: new Date(gte.getTime() + 24 * 3_600_000) };
}

/** Nomes dos campos da escala no "de → para" (a tabela comum não os tem). */
const ROTULO: Record<string, string> = {
  advogadoId: 'Quem está de plantão',
  horaInicio: 'Início do plantão',
  horaFim: 'Fim do plantão',
  observacao: 'Observação',
};

@Injectable()
export class EscalasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agenda: AgendaService,
  ) {}

  /**
   * Usuários ativos que podem ser escalados (equipe jurídica/geral).
   *
   * `role` vai junto para a tela agrupar "Advogados" primeiro e "Outros" depois.
   * Não filtra por perfil: um sindicato pode escalar estagiário ou secretária, e
   * o filtro rígido tiraria gente real do seletor. Agrupar, não esconder.
   */
  listarAdvogados() {
    return this.prisma.user.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, nomeExibicao: true, role: true, avatarUrl: true, avatarKey: true,
      },
    });
  }

  async listar(q: ListEscalasQueryDto) {
    const { gte, lt } = rangeMes(q.mes);
    return this.prisma.escalaAdvogado.findMany({
      where: { data: { gte, lt }, ...(q.advogadoId ? { advogadoId: q.advogadoId } : {}) },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
      select: escalaSel,
    });
  }

  /**
   * Quem está de plantão numa data (YYYY-MM-DD; padrão: hoje em Teresina).
   * Usado na triagem — o encaminhamento (atendimentos) chama direto, com o dia
   * em que a consulta vai cair.
   */
  async listarPlantao(data?: string) {
    const { gte, lt } = diaDoPlantao(data);
    return this.prisma.escalaAdvogado.findMany({
      where: { data: { gte, lt } },
      orderBy: { horaInicio: 'asc' },
      select: {
        id: true, data: true, horaInicio: true, horaFim: true, advogadoId: true, advogado: advogadoSel,
      },
    });
  }

  /** A pessoa existe e está ativa — senão, a frase de por que não dá. */
  private async pessoaEscalavel(id: string) {
    const pessoa = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, nome: true, nomeExibicao: true, ativo: true, role: true, permissoes: true },
    });
    if (!pessoa) throw new BadRequestException('Pessoa não encontrada para a escala.');
    /*
      INATIVO NÃO ENTRA NA ESCALA. O seletor da tela só lista ativos, mas o POST
      aceitava qualquer id: dava para escalar, pela API, quem já saiu da casa, e
      o plantão apareceria no painel e nos chips da triagem para uma pessoa que
      não vai atender.
    */
    if (!pessoa.ativo) throw new BadRequestException(fraseDeInativo(pessoa));
    return pessoa;
  }

  /** Plantões já gravados da pessoa nos dias pedidos, com a data recortada. */
  private async gravadosNosDias(advogadoId: string, datas: string[]): Promise<PlantaoGravado[]> {
    const linhas = await this.prisma.escalaAdvogado.findMany({
      where: { advogadoId, data: { in: [...new Set(datas)].map(dataDaColuna) } },
      select: { id: true, data: true, horaInicio: true, horaFim: true },
    });
    return linhas.map((l) => ({ ...l, data: textoDaColuna(l.data) }));
  }

  async criar(dto: CriarEscalasDto, ctx: Ctx) {
    for (const it of dto.itens) {
      if (!ehDataPuraValida(it.data)) {
        throw new BadRequestException(`A data ${it.data} não existe no calendário.`);
      }
      if (!faixaValida(it)) {
        throw new BadRequestException(`Em ${diaCurto(it.data)}, a hora de fim deve ser após a de início.`);
      }
    }

    const adv = await this.pessoaEscalavel(dto.advogadoId);

    /*
      SOBREPOSIÇÃO RECUSADA — no banco e dentro do próprio lote.

      Sem índice único, e de propósito: se a produção tivesse alguma duplicata
      antiga, a migração do índice derrubaria o deploy. A checagem no serviço
      protege daqui para a frente sem exigir limpeza antes. Dois turnos no mesmo
      dia (09–12 e 14–17) não se sobrepõem e continuam permitidos.
    */
    const existentes = await this.gravadosNosDias(dto.advogadoId, dto.itens.map((i) => i.data));
    const choque = procurarSobreposicao(dto.itens, existentes);
    if (choque) throw new BadRequestException(fraseDaSobreposicao(choque, adv));

    /*
      OS IDS NASCEM AQUI, e não no banco, porque `createMany` não os devolve. A
      auditoria carimbava só o `advogadoId`, e não havia como ligar a criação de
      uma escala à exclusão dela (que carimba o id da linha).
    */
    const linhas = dto.itens.map((it) => ({
      id: randomUUID(),
      advogadoId: dto.advogadoId,
      data: dataDaColuna(it.data),
      horaInicio: it.horaInicio,
      horaFim: it.horaFim,
      observacao: it.observacao?.trim() || null,
      criadoPor: ctx.userId,
    }));
    const { count } = await this.prisma.escalaAdvogado.createMany({ data: linhas });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'EscalaAdvogado',
      // Continua sendo a pessoa: é "de quem é a escala" que a tela de auditoria
      // agrupa. As linhas criadas vão em `ids`.
      entidadeId: dto.advogadoId,
      descricao: `${count} escala(s) cadastrada(s) para ${adv.nome}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        advogadoId: dto.advogadoId,
        quantidade: count,
        ids: linhas.map((l) => l.id),
        datas: dto.itens.map((i) => i.data),
      },
    });
    return { ok: true, criadas: count, ids: linhas.map((l) => l.id) };
  }

  // -------------------------------------------------------------------------
  // COPIAR A ESCALA DE UM MÊS PARA OUTRO (D15, 14/09/2026)
  // -------------------------------------------------------------------------

  /**
   * Os meses que podem ser copiados, e as duas travas que valem para a prévia e
   * para a gravação.
   */
  private conferirMesesDaCopia(origem: string, destino: string, agora: Date) {
    if (origem === destino) {
      throw new BadRequestException('Escolha um mês de origem diferente do destino.');
    }
    if (destino < mesBR(agora)) {
      throw new BadRequestException('Não dá para copiar para um mês que já passou.');
    }
  }

  /** Os plantões de um mês, com a data recortada e a pessoa (para a regra pura). */
  private async plantoesDoMes(db: Prisma.TransactionClient, mes: string): Promise<PlantaoDaCopia[]> {
    const linhas = await db.escalaAdvogado.findMany({
      where: { data: rangeMes(mes) },
      orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
      select: plantaoDaCopiaSel,
    });
    return linhas.map((l) => ({ ...l, data: textoDaColuna(l.data) }));
  }

  /** Lê origem e destino e roda `planejarCopia` — a mesma chamada na prévia e na gravação. */
  private async planoDaCopia(db: Prisma.TransactionClient, origem: string, destino: string, agora: Date) {
    const plantoesDaOrigem = await this.plantoesDoMes(db, origem);
    const plantoesDoDestino = await this.plantoesDoMes(db, destino);
    return {
      plano: planejarCopia({ origem, destino, plantoesDaOrigem, plantoesDoDestino, hoje: diaBR(agora) }),
      existentesNoDestino: plantoesDoDestino.length,
    };
  }

  /**
   * Os meses com plantões, do mais recente para o mais antigo.
   *
   * VEM SEMPRE, mesmo quando a origem pedida está vazia: a tela abre propondo o
   * mês anterior e, se ele não tem plantões (recesso), usa esta lista para
   * trocar pela origem certa sem uma segunda ida. Agrupado por dia no banco
   * (uns 16 por mês) e somado por mês aqui, sem SQL cru de data.
   */
  private async mesesComPlantao(): Promise<{ mes: string; plantoes: number }[]> {
    const dias = await this.prisma.escalaAdvogado.groupBy({ by: ['data'], _count: { _all: true } });
    const porMes = new Map<string, number>();
    for (const d of dias) {
      const mes = textoDaColuna(d.data).slice(0, 7);
      porMes.set(mes, (porMes.get(mes) ?? 0) + d._count._all);
    }
    return [...porMes.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([mes, plantoes]) => ({ mes, plantoes }));
  }

  /**
   * GET /escalas/meses — o mês de Teresina e os meses com plantões, sem prévia.
   *
   * O BOTÃO DA PÁGINA PRECISA SABER ANTES DE ABRIR (15/09/2026). Ele só nomeava
   * o mês quando a origem era exatamente o anterior, e aparecia mesmo sem mês
   * nenhum com plantões — um beco sem saída. A prévia já trazia a lista, mas
   * pedi-la exige origem e destino, e o destino não pode ser mês passado: aberta
   * num mês antigo, a página não teria como perguntar. Esta leitura não recusa
   * nada, e o `mesAtual` é o de Teresina, para a tela montar "de → para" sem
   * recalcular fuso.
   */
  async mesesDaCopia(agora = new Date()) {
    return { mesAtual: mesBR(agora), mesesComPlantao: await this.mesesComPlantao() };
  }

  /**
   * GET /escalas/copia — os textos já prontos; a tela não refaz a regra.
   *
   * QUALQUER DESTINO DO MÊS ATUAL EM DIANTE (V1, 15/09/2026). A tela abria sempre
   * "do mês anterior para o mês da tela", e em setembro (já com 16 plantões) a
   * prévia dizia "Criar 0 plantões". A regra do servidor nunca prendeu o destino
   * ao mês seguinte à origem: vale setembro → novembro, e até outubro → setembro.
   * As únicas travas são as de `conferirMesesDaCopia`.
   *
   * `diasSemNinguem` e a frase pronta dizem o buraco que a cópia deixa no destino
   * (ver `diasSemNinguemNoDestino`).
   */
  async previaDaCopia(q: CopiaQueryDto, agora = new Date()) {
    this.conferirMesesDaCopia(q.origem, q.destino, agora);
    const { plano, existentesNoDestino } = await this.planoDaCopia(this.prisma, q.origem, q.destino, agora);
    return {
      origem: q.origem,
      destino: q.destino,
      mesesComPlantao: await this.mesesComPlantao(),
      existentesNoDestino,
      criar: plano.criar,
      fora: plano.fora,
      diasSemNinguem: plano.diasSemNinguem,
      fraseDiasSemNinguem: fraseDosDiasSemNinguem(q.destino, plano.diasSemNinguem),
    };
  }

  /**
   * POST /escalas/copia — grava SÓ o que a regra ainda propõe.
   *
   * POR QUE NÃO O LOTE QUE JÁ EXISTE: são cinco POSTs, um por pessoa. Se o
   * terceiro falha, os dois primeiros ficam gravados; ao tentar de novo, o
   * primeiro recusa com "já está de plantão" e a cópia fica pela metade sem
   * caminho óbvio.
   *
   * Aqui é uma transação: relê os dois meses, roda `planejarCopia` de novo e
   * confere cada item enviado. Um item que deixou de ser criável (alguém
   * cadastrou à mão no meio, o dia virou, a pessoa foi desativada) responde 409
   * e nada é gravado. Repetir o mesmo POST cai em "já está de plantão": 409, sem
   * duplicar.
   *
   * O nível de isolamento é o padrão do Postgres: um cadastro que entre
   * exatamente entre a releitura e o `createMany` passa. Com cinco pessoas e
   * uma cópia por mês, pagar `Serializable` (e o erro de serialização que a
   * tela teria de tratar) não se justifica.
   */
  async copiar(dto: CopiarEscalaDto, ctx: Ctx, agora = new Date()) {
    this.conferirMesesDaCopia(dto.origem, dto.destino, agora);
    const vistos = new Set<string>();
    for (const it of dto.itens) {
      if (!ehDataPuraValida(it.data)) {
        throw new BadRequestException(`A data ${it.data} não existe no calendário.`);
      }
      const chave = chaveDaCopia(it);
      if (vistos.has(chave)) throw new BadRequestException(`O pedido repete o mesmo plantão em ${diaCurto(it.data)}.`);
      vistos.add(chave);
    }

    const feito = await this.prisma.$transaction(async (tx) => {
      const { plano } = await this.planoDaCopia(tx, dto.origem, dto.destino, agora);
      const criaveis = new Map(plano.criar.map((i) => [chaveDaCopia(i), i]));
      if (dto.itens.some((i) => !criaveis.has(chaveDaCopia(i)))) {
        throw new ConflictException(`A escala de ${nomeDoMes(dto.destino)} mudou enquanto você conferia.`);
      }
      const itens = dto.itens.map((i) => criaveis.get(chaveDaCopia(i))!);
      // A observação NÃO é copiada: as 25 de agosto e setembro eram nulas, e a
      // que existir costuma ser do dia ("troca combinada", "substitui a Dra. X").
      const linhas = itens.map((i) => ({
        id: randomUUID(),
        advogadoId: i.advogado.id,
        data: dataDaColuna(i.data),
        horaInicio: i.horaInicio,
        horaFim: i.horaFim,
        observacao: null,
        criadoPor: ctx.userId,
      }));
      const { count } = await tx.escalaAdvogado.createMany({ data: linhas });
      return { count, itens, linhas, plano };
    });

    // Carimbe toda decisão: o que ficou de fora pela regra E o que a pessoa desmarcou.
    const desmarcados = feito.plano.criar.filter((i) => !vistos.has(chaveDaCopia(i)));
    const deFora = feito.plano.fora.length + desmarcados.length;
    /*
      O LOTE DA CÓPIA MORA NA AUDITORIA, sem coluna nova (15/09/2026).

      O desfazer precisa de três coisas: quem copiou, quando, e o que foi criado
      exatamente como foi criado. As três já cabem na linha que esta cópia grava;
      uma coluna `lote_copia_id` exigiria migração só para uma janela de dez
      minutos, e nada além do desfazer a leria. `copiadaEm` é o relógio do
      contêiner, o mesmo que o desfazer consulta — o `created_at` da auditoria
      vem do banco. `plantoes` é a foto que prova que nada foi alterado depois.
    */
    const loteId = randomUUID();
    const plantoes: PlantaoDoLote[] = feito.linhas.map((l) => ({
      id: l.id,
      advogadoId: l.advogadoId,
      data: textoDaColuna(l.data),
      horaInicio: l.horaInicio,
      horaFim: l.horaFim,
    }));
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'EscalaAdvogado',
      // O mês: a cópia é do mês inteiro, e as linhas criadas vão em `ids`.
      entidadeId: dto.destino,
      descricao:
        `Escala de ${nomeDoMes(dto.origem)} copiada para ${nomeDoMes(dto.destino)}: ` +
        `${contar(feito.count, 'plantão', 'plantões')}` +
        (deFora ? ` (${deFora} ${deFora === 1 ? 'ficou' : 'ficaram'} de fora)` : ''),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        origem: dto.origem,
        destino: dto.destino,
        quantidade: feito.count,
        ids: feito.linhas.map((l) => l.id),
        datas: feito.itens.map((i) => i.data),
        fora: feito.plano.fora.map((f) => ({ origemId: f.origemId, origemData: f.origemData, motivo: f.motivo })),
        desmarcados: desmarcados.map((i) => ({ origemId: i.origemId, data: i.data })),
        loteId,
        copiadaEm: agora.toISOString(),
        plantoes: plantoes as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      ok: true,
      criadas: feito.count,
      ids: feito.linhas.map((l) => l.id),
      loteId,
      desfazerAte: new Date(agora.getTime() + JANELA_DO_DESFAZER_DA_COPIA_MS).toISOString(),
    };
  }

  /**
   * DELETE /escalas/copia/:loteId — desfaz a cópia recém-feita (15/09/2026).
   *
   * A exceção estreita à regra "só o Administrador apaga", decidida pelo dono:
   * só quem copiou, em até dez minutos, e só se nenhum plantão do lote foi
   * alterado nem ganhou consulta depois. As travas são as de
   * `decidirDesfazerCopia`; aqui só se lê o banco e se escreve.
   *
   * A EXCLUSÃO É CONDICIONAL: cada linha só sai se continua com a pessoa, o
   * horário e a observação vazia que a cópia gravou. Se alguém trocou um
   * plantão entre a leitura e a exclusão, a contagem não bate e a transação
   * volta atrás inteira — nada fica pela metade.
   */
  async desfazerCopia(loteId: string, ctx: Ctx, agora = new Date()) {
    const naoAchei = new NotFoundException('Não achei esta cópia. Atualize a página e confira a escala.');
    if (!/^[0-9a-f-]{36}$/i.test(loteId)) throw naoAchei;

    const registro = await this.prisma.auditoria.findFirst({
      where: {
        entidade: 'EscalaAdvogado',
        acao: AcaoAuditoria.CREATE,
        // Um dia de folga sobre a janela: só para a busca no JSON não varrer a tabela inteira.
        createdAt: { gte: new Date(agora.getTime() - 24 * 3_600_000) },
        metadata: { path: ['loteId'], equals: loteId },
      },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, createdAt: true, metadata: true },
    });
    const meta = (registro?.metadata ?? null) as {
      origem?: string; destino?: string; copiadaEm?: string; plantoes?: PlantaoDoLote[];
    } | null;
    if (!registro || !meta || !Array.isArray(meta.plantoes)) throw naoAchei;

    const ids = meta.plantoes.map((p) => p.id);
    const pessoas = [...new Set(meta.plantoes.map((p) => p.advogadoId))];
    const [linhas, alteracoes, gente] = await Promise.all([
      this.prisma.escalaAdvogado.findMany({
        where: { id: { in: ids } },
        select: { id: true, advogadoId: true, data: true, horaInicio: true, horaFim: true, observacao: true },
      }),
      this.prisma.auditoria.findMany({
        where: {
          entidade: 'EscalaAdvogado',
          acao: AcaoAuditoria.UPDATE,
          entidadeId: { in: ids },
          createdAt: { gte: registro.createdAt },
        },
        select: { entidadeId: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: pessoas } },
        select: { id: true, nome: true, nomeExibicao: true },
      }),
    ]);
    const atuais = linhas.map((l) => ({ ...l, data: textoDaColuna(l.data) }));
    const comConsultaNova = meta.copiadaEm
      ? await this.plantoesComConsultaNova(meta.plantoes.filter((p) => ids.includes(p.id)), new Date(meta.copiadaEm))
      : [];

    const decisao = decidirDesfazerCopia({
      copia: { userId: registro.userId, copiadaEm: meta.copiadaEm ?? null, plantoes: meta.plantoes },
      usuarioId: ctx.userId,
      agora,
      atuais,
      alteradosNaAuditoria: alteracoes.map((a) => a.entidadeId).filter((x): x is string => !!x),
      comConsultaNova,
      nomes: new Map(gente.map((g) => [g.id, g.nomeExibicao?.trim() || g.nome])),
    });
    if (!decisao.ok) {
      if (decisao.recusa === 'OUTRA_PESSOA') throw new ForbiddenException(decisao.motivo);
      if (decisao.recusa === 'TEMPO') throw new BadRequestException(decisao.motivo);
      throw new ConflictException(decisao.motivo);
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.escalaAdvogado.deleteMany({
        where: {
          OR: decisao.apagar.map((p) => ({
            id: p.id, advogadoId: p.advogadoId, horaInicio: p.horaInicio, horaFim: p.horaFim, observacao: null,
          })),
        },
      });
      if (count !== decisao.apagar.length) {
        throw new ConflictException('A escala mudou enquanto você desfazia a cópia. Atualize a página e confira.');
      }
    });

    const n = decisao.apagar.length;
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'EscalaAdvogado',
      entidadeId: meta.destino,
      descricao:
        `Cópia da escala de ${meta.origem ? nomeDoMes(meta.origem) : '?'} para ${meta.destino ? nomeDoMes(meta.destino) : '?'} ` +
        `desfeita: ${contar(n, 'plantão apagado', 'plantões apagados')}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { loteId, ids: decisao.apagar.map((p) => p.id), jaApagados: decisao.jaApagados },
    });
    return { ok: true, apagados: n, jaApagados: decisao.jaApagados };
  }

  /**
   * Os plantões do lote que ganharam consulta DEPOIS da cópia.
   *
   * A mesma definição de "consulta do plantão" da troca (tipo, sem ser
   * seguimento, aberta, a pessoa como responsável ou na equipe por gente), no
   * dia inteiro de Teresina e só a criada depois de `copiadaEm`: a consulta que
   * já existia antes da cópia não nasceu do plantão novo, e não impede nada.
   * Uma consulta só ao banco, casada por pessoa e dia aqui.
   */
  private async plantoesComConsultaNova(plantoes: PlantaoDoLote[], copiadaEm: Date): Promise<string[]> {
    if (!plantoes.length) return [];
    const dias = plantoes.map((p) => p.data).sort();
    const pessoas = [...new Set(plantoes.map((p) => p.advogadoId))];
    const consultas = await this.prisma.compromisso.findMany({
      where: {
        tipo: 'CONSULTA_JURIDICA',
        origemDesfechoId: null,
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        inicio: {
          gte: instanteBR(dias[0], '00:00'),
          lt: new Date(instanteBR(dias[dias.length - 1], '00:00').getTime() + 24 * 3_600_000),
        },
        /*
          CRIADA OU MEXIDA DEPOIS DA CÓPIA (15/09/2026). Só `createdAt` deixava
          passar a consulta antiga REMARCADA para o plantão novo (o remarcar é um
          update na mesma linha) ou passada para a pessoa do plantão: o desfazer
          apagava o plantão e a consulta ficava num dia sem ninguém. É
          conservador de propósito: uma consulta antiga editada por outro motivo
          também trava o desfazer. Os dois OR vão dentro de um AND, porque duas
          chaves OR no mesmo objeto se sobrescrevem.
        */
        AND: [
          { OR: [{ createdAt: { gte: copiadaEm } }, { updatedAt: { gte: copiadaEm } }] },
          {
            OR: [
              { responsavelId: { in: pessoas } },
              { equipe: { some: { usuarioId: { in: pessoas }, ...NAO_E_RESERVA } } },
            ],
          },
        ],
      },
      select: {
        id: true, inicio: true, responsavelId: true,
        equipe: { select: { usuarioId: true, principal: true, origem: true } },
      },
    });
    return plantoes
      .filter((p) =>
        consultas.some(
          (c) => diaBR(c.inicio) === p.data && papelDeQuemSai(c as unknown as ConsultaLida, p.advogadoId) !== null,
        ),
      )
      .map((p) => p.id);
  }

  // -------------------------------------------------------------------------
  // AS CONSULTAS DO PLANTÃO (D16 e D17, 14/09/2026)
  // -------------------------------------------------------------------------

  /** As consultas do dia de quem está no plantão, classificadas pela regra única. */
  private async consultasClassificadas(
    db: Prisma.TransactionClient,
    escala: { advogadoId: string; advogado: { nome: string; nomeExibicao: string | null }; horaInicio: string; horaFim: string },
    dia: string,
    passado: boolean,
    entraId?: string,
  ): Promise<ConsultaClassificada[]> {
    const lidas = (await db.compromisso.findMany({
      where: whereDasConsultasDoPlantao(escala.advogadoId, dia),
      orderBy: [{ inicio: 'asc' }, { id: 'asc' }],
      select: selectDaConsultaDoPlantao,
    })) as ConsultaLida[];
    return classificarConsultas(lidas, {
      saiId: escala.advogadoId,
      sai: escala.advogado,
      plantao: { data: dia, horaInicio: escala.horaInicio, horaFim: escala.horaFim },
      passado,
      entraId,
    });
  }

  /**
   * GET /escalas/:id/consultas?entra= — a prévia com decisão.
   *
   * CORTES NO BACKEND, e a tela só esconde o que a API já recusaria:
   *  · quem lê sem Agenda recebe só `total` (as consultas no horário), sem
   *    nomes nem horários;
   *  · o celular do filiado só vai para quem vê Filiados;
   *  · `podePassar` = leitor com Agenda EDITAR, quem entra vê a Agenda, e o
   *    plantão não passou. Sem isso, `porQueNaoPassa` diz a frase.
   *
   * `sobreposicao` é a recusa que o PATCH daria para quem entra — plantão
   * sobreposto, ou cadastro inativo — dita antes, para a tela desabilitar o
   * botão em vez de deixar a pessoa decidir as consultas e bater num 400.
   *
   * O CHOQUE AVISA E NÃO BLOQUEIA (a regra da agenda): para cada consulta que
   * pode passar, a mesma conta de `AgendaService.conflitos`. São no máximo
   * umas 3 por plantão na produção; se um dia forem dezenas, trocar por uma
   * consulta só com OR sobre as janelas.
   */
  async consultasDoPlantao(
    id: string,
    entraId: string | undefined,
    leitor: Leitor | undefined,
    agora = new Date(),
    /** O horário que o plantão vai ter — o aviso de encurtar (15/09/2026). Só um lado vale o outro de agora. */
    novoHorario?: Partial<Faixa>,
  ) {
    const escala = await this.prisma.escalaAdvogado.findUnique({
      where: { id },
      select: {
        id: true, data: true, horaInicio: true, horaFim: true, advogadoId: true,
        advogado: { select: { id: true, nome: true, nomeExibicao: true } },
      },
    });
    if (!escala) throw new NotFoundException('Escala não encontrada.');

    const dia = textoDaColuna(escala.data);
    const passado = dia < diaBR(agora);

    let entra: { id: string; nome: string; nomeExibicao: string | null; veAgenda: boolean } | null = null;
    let sobreposicao: string | null = null;
    if (entraId) {
      if (entraId === escala.advogadoId) {
        throw new BadRequestException('Quem assume já é a pessoa deste plantão.');
      }
      const pessoa = await this.prisma.user.findUnique({
        where: { id: entraId },
        select: { id: true, nome: true, nomeExibicao: true, ativo: true, role: true, permissoes: true },
      });
      if (!pessoa) throw new BadRequestException('Pessoa não encontrada para a escala.');
      entra = {
        id: pessoa.id,
        nome: pessoa.nome,
        nomeExibicao: pessoa.nomeExibicao,
        veAgenda: nivelEfetivo(pessoa.role, pessoa.permissoes, 'agenda') !== 'SEM_ACESSO',
      };
      if (!pessoa.ativo) {
        sobreposicao = fraseDeInativo(pessoa);
      } else {
        const outros = await this.gravadosNosDias(pessoa.id, [dia]);
        const choque = procurarSobreposicao(
          [{ data: dia, horaInicio: escala.horaInicio, horaFim: escala.horaFim }],
          outros,
          escala.id,
        );
        if (choque) sobreposicao = fraseDaSobreposicao(choque, pessoa);
      }
    }

    const nivelAgenda = nivelDo(leitor, 'agenda');
    const veTelefone = nivelDo(leitor, 'filiados') !== 'SEM_ACESSO';
    const classificadas = await this.consultasClassificadas(this.prisma, escala, dia, passado, entra?.id);
    const noHorario = classificadas.filter((c) => c.noHorario);
    /*
      O AVISO DE ENCURTAR PELA MESMA CONTA DO PATCH (15/09/2026). A contagem vai
      para todo leitor, como `total`: quem não vê a Agenda não fica sabendo quem
      nem a que horas, mas fica sabendo que existem consultas que o horário novo
      deixa de fora. Faixa inválida (fim antes do início, enquanto a pessoa
      digita) responde nulo em vez de 400: o PATCH é que recusa.
    */
    const faixaNova = novoHorario && (novoHorario.horaInicio || novoHorario.horaFim)
      ? { horaInicio: novoHorario.horaInicio ?? escala.horaInicio, horaFim: novoHorario.horaFim ?? escala.horaFim }
      : null;
    const saemDoHorario = faixaNova && faixaValida(faixaNova) ? foraDoNovoHorario(classificadas, dia, faixaNova) : null;

    const podePassar = nivelAgenda === 'EDITAR' && !!entra?.veAgenda && !passado;
    let porQueNaoPassa: string | null = null;
    if (!podePassar) {
      if (passado) porQueNaoPassa = FRASE_PLANTAO_PASSOU;
      else if (entra && !entra.veAgenda) {
        porQueNaoPassa =
          `${pessoaNoInicio(entra)} não tem acesso à Agenda e não veria as consultas. ` +
          `Elas continuam com ${pessoaNaFrase(escala.advogado)}.`;
      } else if (entra && nivelAgenda !== 'EDITAR') {
        porQueNaoPassa =
          `As consultas continuam com ${pessoaNaFrase(escala.advogado)}. Passar consultas é de quem edita a Agenda.`;
      }
    }

    const cabecalho = {
      escalaId: escala.id,
      dia,
      horaInicio: escala.horaInicio,
      horaFim: escala.horaFim,
      passado,
      sai: escala.advogado,
      entra,
      sobreposicao,
      podePassar,
      porQueNaoPassa,
      total: noHorario.length,
      foraDoNovoHorario: saemDoHorario ? saemDoHorario.length : null,
    };
    if (nivelAgenda === 'SEM_ACESSO') {
      return { ...cabecalho, idsForaDoNovoHorario: [] as string[], noHorario: [], foraDoHorario: [] };
    }
    const idsForaDoNovoHorario = (saemDoHorario ?? []).map((c) => c.consulta.id);

    const paraTela = async (c: ConsultaClassificada) => {
      const k = c.consulta;
      const choques = entra && c.selecionavel
        ? (await this.agenda.conflitos({
          pessoas: entra.id,
          inicio: k.inicio.toISOString(),
          fim: k.fim.toISOString(),
          ignorarId: k.id,
        })).slice(0, 3).map((x) => ({
          id: x.id, titulo: x.titulo, inicio: x.inicio.toISOString(), fim: x.fim.toISOString(),
        }))
        : [];
      return {
        id: k.id,
        titulo: k.titulo,
        inicio: k.inicio.toISOString(),
        fim: k.fim.toISOString(),
        status: k.status,
        papel: c.papel,
        // Passar só tira quem sai da equipe: a tela não conta a linha como consulta ganha.
        jaEraResponsavel: c.jaEraResponsavel,
        selecionavel: c.selecionavel,
        porQueNao: c.porQueNao,
        local: k.local,
        temLink: !!k.linkReuniao?.trim(),
        atendimento: k.atendimento ? { id: k.atendimento.id, numero: k.atendimento.numero } : null,
        filiado: this.filiadoParaTela(k.filiado, veTelefone),
        choques,
        responsavel: c.principal ? { nome: c.principal.nome, nomeExibicao: c.principal.nomeExibicao } : null,
      };
    };

    const dentro: Awaited<ReturnType<typeof paraTela>>[] = [];
    const fora: Awaited<ReturnType<typeof paraTela>>[] = [];
    for (const c of classificadas) (c.noHorario ? dentro : fora).push(await paraTela(c));
    return { ...cabecalho, idsForaDoNovoHorario, noHorario: dentro, foraDoHorario: fora };
  }

  /** O filiado da consulta, com o celular para o wa.me só para quem vê Filiados. */
  private filiadoParaTela(f: ConsultaLida['filiado'], veTelefone: boolean) {
    if (!f) return null;
    return {
      id: f.id,
      nomeCompleto: f.nomeCompleto,
      celularWhatsApp: veTelefone ? celularParaWhatsApp(f.telefonePrincipal, f.telefoneSecundario) : null,
    };
  }

  /**
   * CORRIGIR OU TROCAR — a porta que faltava à Coordenação.
   *
   * Até 13/09/2026 o módulo não tinha edição: hora digitada errada, advogado
   * doente ou troca entre colegas exigiam o Administrador apagar a linha (só ele
   * apaga) e alguém recriar. A troca, que é o evento mais comum depois do
   * cadastro, não tinha caminho.
   *
   * As MESMAS travas do criar: fim depois do início, pessoa ativa, sobreposição
   * com os outros plantões da pessoa (a própria linha não conta).
   *
   * E, desde 14/09/2026, AS CONSULTAS DE QUEM SAI (`passarConsultas`):
   *  · ausente: a troca de sempre; as consultas não mudam (a tela antiga segue
   *    funcionando), mas a auditoria anota quais ficaram sem decisão;
   *  · presente sem troca de pessoa: 400;
   *  · com ids, sem Agenda EDITAR: 403 — é a matriz, conferida aqui;
   *  · com ids, quem entra sem Agenda: 400 (não veria as consultas);
   *  · `[]`: decidiu manter todas, e fica carimbado.
   * Na transação, a escala muda e cada id AINDA selecionável pela mesma regra
   * da prévia passa no mesmo papel. O que deixou de ser selecionável entre a
   * prévia e o salvar vai para `ignoradas`, com o motivo, e não derruba a troca.
   */
  async atualizar(id: string, dto: AtualizarEscalaDto, ctx: Ctx, agora = new Date()) {
    const atual = await this.prisma.escalaAdvogado.findUnique({
      where: { id },
      select: {
        id: true, data: true, horaInicio: true, horaFim: true, observacao: true, advogadoId: true,
        advogado: { select: { id: true, nome: true, nomeExibicao: true } },
      },
    });
    if (!atual) throw new NotFoundException('Escala não encontrada.');

    const dia = textoDaColuna(atual.data);
    const depois = {
      advogadoId: dto.advogadoId ?? atual.advogadoId,
      horaInicio: dto.horaInicio ?? atual.horaInicio,
      horaFim: dto.horaFim ?? atual.horaFim,
      observacao:
        dto.observacao === undefined ? atual.observacao : dto.observacao?.trim() || null,
    };

    if (!faixaValida(depois)) {
      throw new BadRequestException(`Em ${diaCurto(dia)}, a hora de fim deve ser após a de início.`);
    }

    const troca = depois.advogadoId !== atual.advogadoId;
    const decideConsultas = dto.passarConsultas !== undefined;
    const pedidas = [...new Set(dto.passarConsultas ?? [])];
    if (decideConsultas && !troca) {
      throw new BadRequestException('Consultas só mudam de dono quando o plantão muda de pessoa.');
    }

    /*
      SÓ QUEM ENTRA precisa estar ativo. Corrigir o horário de um plantão antigo
      de quem foi desativado depois é arrumar o histórico, não escalar alguém.
    */
    const entra = troca ? await this.pessoaEscalavel(depois.advogadoId) : null;
    const quem = entra ?? atual.advogado;

    // Com ids pedidos há troca (a checagem acima garante), então `entra` existe.
    if (pedidas.length && entra) {
      if (nivelDo(ctx.leitor, 'agenda') !== 'EDITAR') {
        throw new ForbiddenException('Passar consultas é de quem edita a Agenda.');
      }
      if (nivelEfetivo(entra.role, entra.permissoes, 'agenda') === 'SEM_ACESSO') {
        throw new BadRequestException(`${pessoaNoInicio(entra)} não tem acesso à Agenda e não veria as consultas.`);
      }
    }

    const alteracoes: AlteracaoDeCampo[] = diferencaDeCampos(
      atual as unknown as Record<string, unknown>,
      depois,
    ).map((a) => ({ ...a, label: ROTULO[a.campo] ?? a.label }));

    if (!alteracoes.length) {
      // Salvar sem mudar nada não é fato auditável — nem para o interceptor.
      marcarNadaMudou();
      return this.prisma.escalaAdvogado.findUnique({ where: { id }, select: escalaSel });
    }

    const mexeuNaHoraOuNaPessoa = alteracoes.some((a) => a.campo !== 'observacao');
    if (mexeuNaHoraOuNaPessoa) {
      const outros = await this.gravadosNosDias(depois.advogadoId, [dia]);
      const choque = procurarSobreposicao([{ data: dia, ...depois }], outros, id);
      if (choque) throw new BadRequestException(fraseDaSobreposicao(choque, quem));
    }

    const passado = dia < diaBR(agora);
    let atualizada: Prisma.EscalaAdvogadoGetPayload<{ select: typeof escalaSel }>;
    let decisao: {
      passadas: { c: ConsultaClassificada; feita: PassagemFeita }[];
      mantidas: string[];
      ignoradas: { id: string; motivo: string }[];
    } | null = null;
    /** D17: o que a mudança deixou para trás sem decidir — só para a auditoria. */
    let semDecisao: string[] | null = null;
    let idsForaDoNovoHorario: string[] | null = null;

    if (!decideConsultas) {
      atualizada = await this.prisma.escalaAdvogado.update({ where: { id }, data: depois, select: escalaSel });
      if (mexeuNaHoraOuNaPessoa) {
        const classificadas = await this.consultasClassificadas(this.prisma, atual, dia, passado);
        if (troca) {
          semDecisao = classificadas.map((c) => c.consulta.id);
        } else {
          // A mesma conta que a prévia usa para o aviso de encurtar.
          idsForaDoNovoHorario = foraDoNovoHorario(classificadas, dia, depois).map((c) => c.consulta.id);
        }
      }
    } else {
      const r = await this.prisma.$transaction(async (tx) => {
        const escrita = await tx.escalaAdvogado.update({ where: { id }, data: depois, select: escalaSel });
        // A lista é relida AQUI, com a faixa de antes da alteração: é ela que a
        // prévia mostrou, e é o estado da agenda neste instante que decide.
        const classificadas = await this.consultasClassificadas(tx, atual, dia, passado);
        const porId = new Map(classificadas.map((c) => [c.consulta.id, c]));
        const sumidas = pedidas.filter((cid) => !porId.has(cid));
        const situacao = sumidas.length
          ? await tx.compromisso.findMany({ where: { id: { in: sumidas } }, select: { id: true, status: true } })
          : [];

        const passadas: { c: ConsultaClassificada; feita: PassagemFeita }[] = [];
        const ignoradas: { id: string; motivo: string }[] = [];
        for (const cid of pedidas) {
          const c = porId.get(cid);
          if (!c) {
            ignoradas.push({ id: cid, motivo: motivoDaConsultaQueSaiu(situacao.find((s) => s.id === cid), atual.advogado) });
            continue;
          }
          if (!c.selecionavel) {
            ignoradas.push({ id: cid, motivo: c.motivoSeNaoPassar ?? 'Não podia passar.' });
            continue;
          }
          const feita = await passarConsultaEmTransacao(tx, {
            compromissoId: cid,
            deId: atual.advogadoId,
            paraId: depois.advogadoId,
          });
          passadas.push({ c, feita });
        }
        const mantidas = classificadas
          .filter((c) => c.selecionavel && !pedidas.includes(c.consulta.id))
          .map((c) => c.consulta.id);
        return { escrita, passadas, mantidas, ignoradas };
      });
      atualizada = r.escrita;
      decisao = { passadas: r.passadas, mantidas: r.mantidas, ignoradas: r.ignoradas };
    }

    // Depois do commit: a linha do tempo de cada consulta e a auditoria.
    for (const { c, feita } of decisao?.passadas ?? []) {
      const de = pessoaDepoisDeDe({ nome: feita.deNome });
      const para = pessoaNaFrase({ nome: feita.paraNome });
      const metadata = {
        motivo: 'TROCA_DE_PLANTAO',
        escalaId: id,
        de: atual.advogadoId,
        para: depois.advogadoId,
        deNome: feita.deNome,
        paraNome: feita.paraNome,
        papel: feita.papel,
        jaEraResponsavel: feita.jaEraResponsavel,
      };
      /*
        Quem entra JÁ ERA o responsável (14/09/2026): nada "passou" para ele, só
        quem sai deixou a equipe. "Quem atua junto passou para o Dr. Murilo"
        descrevia uma equipe que não existe — ele responde, e está sozinho.
      */
      const saiu = `${pessoaNoInicio({ nome: feita.deNome })} deixou a equipe; ${para} já era o responsável`;
      let noHistorico: string;
      if (feita.jaEraResponsavel) noHistorico = `${saiu} (troca do plantão de ${diaCurto(dia)}).`;
      else if (feita.papel === 'RESPONSAVEL') noHistorico = `Passou ${de} para ${para}, que assumiu o plantão de ${diaCurto(dia)}.`;
      else noHistorico = `Quem atua junto passou ${de} para ${para}, que assumiu o plantão de ${diaCurto(dia)}.`;
      await this.agenda.registrarNoHistorico(c.consulta.id, {
        acao: 'EDITADO',
        descricao: noHistorico,
        metadata,
        autorId: ctx.userId ?? null,
        autorNome: ctx.nome ?? null,
      });
      const qual = c.consulta.filiado ? `Consulta de ${c.consulta.filiado.nomeCompleto}` : `Consulta "${c.consulta.titulo}"`;
      await this.audit.registrar({
        userId: ctx.userId ?? null,
        acao: AcaoAuditoria.UPDATE,
        entidade: 'Compromisso',
        entidadeId: c.consulta.id,
        descricao: feita.jaEraResponsavel
          ? `${qual}: ${pessoaNaFrase({ nome: feita.deNome })} deixou a equipe; ${para} já era o responsável (troca do plantão de ${diaCurto(dia)})`
          : `${qual} passou ${de} para ${para} (troca do plantão de ${diaCurto(dia)})`,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata,
      });
    }

    // No log, pessoa por NOME: "de 3f2a… para 9b1c…" não responde quem trocou com quem.
    const legivel = alteracoes.map((a) =>
      a.campo === 'advogadoId'
        ? { ...a, de: atual.advogado.nome, para: quem.nome }
        : a,
    );
    const resto = legivel
      .filter((a) => a.campo !== 'advogadoId')
      .map((a) => `${a.label.toLowerCase()}: ${a.de ?? '—'} → ${a.para ?? '—'}`)
      .join('; ');
    const nPassadas = decisao?.passadas.length ?? 0;
    const descricao = troca
      ? `${pessoaNoInicio(quem)} assumiu o plantão de ${diaCurto(dia)} no lugar de ${atual.advogado.nome}` +
        (nPassadas ? `, com ${contar(nPassadas, 'consulta', 'consultas')}` : '') +
        (resto ? ` — ${resto}` : '')
      : `Escala de ${atual.advogado.nome} em ${diaCurto(dia)} alterada — ${resto}`;

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'EscalaAdvogado',
      entidadeId: id,
      descricao,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        data: dia,
        troca,
        advogadoAnteriorId: atual.advogadoId,
        advogadoId: depois.advogadoId,
        alteracoes: legivel,
        ...(decisao
          ? {
            consultasPassadas: decisao.passadas.map((p) => p.c.consulta.id),
            consultasMantidas: decisao.mantidas,
            consultasIgnoradas: decisao.ignoradas,
          }
          : {}),
        ...(semDecisao?.length ? { consultasSemDecisao: semDecisao } : {}),
        ...(idsForaDoNovoHorario?.length ? { consultasForaDoNovoHorario: idsForaDoNovoHorario } : {}),
      },
    });

    if (!decisao) return atualizada;
    const veTelefone = nivelDo(ctx.leitor, 'filiados') !== 'SEM_ACESSO';
    return {
      ...atualizada,
      consultas: {
        /*
          `papel` e `jaEraResponsavel` (14/09/2026): a tela oferecia "Avisar pelo
          WhatsApp" para toda passada, com "Quem vai atender agora é o Dr.
          Murilo" — e, quando quem saiu só atuava junto, quem continua atendendo
          é a responsável de antes. O que vale é o que a transação gravou.
        */
        passadas: decisao.passadas.map(({ c, feita }) => ({
          id: c.consulta.id,
          inicio: c.consulta.inicio.toISOString(),
          papel: feita.papel,
          jaEraResponsavel: feita.jaEraResponsavel,
          filiado: this.filiadoParaTela(c.consulta.filiado, veTelefone),
        })),
        mantidas: decisao.mantidas,
        ignoradas: decisao.ignoradas,
      },
    };
  }

  /**
   * Remove uma escala. As consultas NÃO mudam (D17): a tela avisa antes quais
   * ficam na agenda de quem estava no plantão, e a auditoria carimba os ids —
   * excluir também é um caminho que decide deixar as consultas onde estão.
   */
  async remover(id: string, ctx: Ctx, agora = new Date()) {
    const escala = await this.prisma.escalaAdvogado.findUnique({
      where: { id },
      select: {
        id: true, data: true, horaInicio: true, horaFim: true, advogadoId: true,
        advogado: { select: { nome: true, nomeExibicao: true } },
      },
    });
    if (!escala) throw new NotFoundException('Escala não encontrada.');

    const dia = textoDaColuna(escala.data);
    const consultas = await this.consultasClassificadas(this.prisma, escala, dia, dia < diaBR(agora));
    await this.prisma.escalaAdvogado.delete({ where: { id } });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'EscalaAdvogado',
      entidadeId: id,
      descricao: `Escala de ${escala.advogado.nome} (${dia}) removida`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        advogadoId: escala.advogadoId, data: dia, horaInicio: escala.horaInicio, horaFim: escala.horaFim,
        consultasQueFicaram: consultas.filter((c) => c.noHorario).map((c) => c.consulta.id),
      },
    });
    return { ok: true };
  }
}

/** A frase da recusa de pessoa inativa — a mesma no cadastro, na troca e na prévia. */
function fraseDeInativo(p: { nome: string; nomeExibicao: string | null }): string {
  return `O cadastro de ${p.nomeExibicao?.trim() || p.nome} está inativo; não dá para escalar quem não usa mais o sistema.`;
}
