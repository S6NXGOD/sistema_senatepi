import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { marcarNadaMudou } from '../../common/audit/audit.contexto';
import { AlteracaoDeCampo, diferencaDeCampos } from '../../common/audit/audit.diff';
import { diaDeCalendarioBR, mesBR } from '../processos/utils/data-br.util';
import { AtualizarEscalaDto, CriarEscalasDto, ListEscalasQueryDto } from './dto/escalas.dto';
import {
  dataDaColuna, diaCurto, ehDataPuraValida, faixaValida, fraseDaSobreposicao,
  PlantaoGravado, pessoaNoInicio, procurarSobreposicao, textoDaColuna,
} from './escalas.regras';

interface Ctx {
  userId?: string;
  ip?: string;
  userAgent?: string;
}

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
      select: { id: true, nome: true, nomeExibicao: true, ativo: true },
    });
    if (!pessoa) throw new BadRequestException('Pessoa não encontrada para a escala.');
    /*
      INATIVO NÃO ENTRA NA ESCALA. O seletor da tela só lista ativos, mas o POST
      aceitava qualquer id: dava para escalar, pela API, quem já saiu da casa, e
      o plantão apareceria no painel e nos chips da triagem para uma pessoa que
      não vai atender.
    */
    if (!pessoa.ativo) {
      throw new BadRequestException(
        `O cadastro de ${pessoa.nomeExibicao?.trim() || pessoa.nome} está inativo; não dá para escalar quem não usa mais o sistema.`,
      );
    }
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
   */
  async atualizar(id: string, dto: AtualizarEscalaDto, ctx: Ctx) {
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
    /*
      SÓ QUEM ENTRA precisa estar ativo. Corrigir o horário de um plantão antigo
      de quem foi desativado depois é arrumar o histórico, não escalar alguém.
    */
    const quem = troca ? await this.pessoaEscalavel(depois.advogadoId) : atual.advogado;

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

    const atualizada = await this.prisma.escalaAdvogado.update({
      where: { id },
      data: depois,
      select: escalaSel,
    });

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
    const descricao = troca
      ? `${pessoaNoInicio(quem)} assumiu o plantão de ${diaCurto(dia)} no lugar de ${atual.advogado.nome}` +
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
      },
    });
    return atualizada;
  }

  async remover(id: string, ctx: Ctx) {
    const escala = await this.prisma.escalaAdvogado.findUnique({
      where: { id },
      select: {
        id: true, data: true, horaInicio: true, horaFim: true, advogadoId: true,
        advogado: { select: { nome: true } },
      },
    });
    if (!escala) throw new NotFoundException('Escala não encontrada.');

    await this.prisma.escalaAdvogado.delete({ where: { id } });
    const dia = textoDaColuna(escala.data);
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
      },
    });
    return { ok: true };
  }
}
