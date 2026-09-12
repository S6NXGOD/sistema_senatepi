import { Injectable } from '@nestjs/common';
import { AcaoAuditoria, StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { diaBR, inicioDoDiaBR } from '../processos/utils/data-br.util';
import { ultimoUsoReal } from '../dashboard/ultimo-acesso.util';

/**
 * USO E PRODUTIVIDADE — quem usa o sistema e o que cada pessoa registrou nele.
 *
 * Pedido de 12/09/2026: "monitorar a produtividade de cada usuário no sistema,
 * por perfil". É instrumento de GESTÃO, e três decisões moldam o que sai daqui:
 *
 * 1. SÓ ENTRA O QUE É TRABALHO REGISTRADO, contado pela fonte certa. A
 *    auditoria guarda também o que o sistema faz sozinho quando alguém abre uma
 *    tela: "reavaliar instâncias" somava 335 registros em 90 dias, espalhados
 *    por doze pessoas. Contar registros de auditoria faria o número medir
 *    CLIQUE, e quem clica mais pareceria trabalhar mais. Por isso cada número
 *    tem nome e origem fixos (ver `REGISTROS`), e o total cru não sai.
 *
 * 2. NÃO EXISTE POSIÇÃO. A lista vem por perfil e, dentro dele, em ordem
 *    alfabética — nunca por volume. Um advogado com uma ação civil pública e
 *    outro com vinte execuções simples não são comparáveis pelo número de
 *    atividades, e a tela que ordena por volume ensina a equipe a produzir
 *    número. O que pede atenção (sem acesso há dias, atrasadas, publicação
 *    esperando) é destacado por COR, no lugar de cada um.
 *
 * 3. QUEM VÊ A CASA É A GESTÃO (administração e coordenação). Qualquer outro
 *    perfil com acesso a relatórios recebe só a própria linha.
 *
 * O QUE ESTES NÚMEROS NÃO MEDEM, e a tela diz: a qualidade do trabalho, a
 * dificuldade de cada caso, e tudo que acontece fora do sistema — audiência,
 * telefonema, atendimento que não foi registrado.
 */

/** A ordem dos grupos na tela: quem executa primeiro, quem administra por último. */
export const PERFIS_EM_ORDEM = ['ADVOGADO', 'COORDENACAO', 'TRIAGEM', 'ADMINISTRADOR'];

/** Quem vê a linha de todo mundo. */
export const VEEM_A_CASA = new Set(['ADMINISTRADOR', 'COORDENACAO']);

/** A partir de quantos dias sem uso a ausência vira informação para quem coordena. */
export const DIAS_PARA_NOTAR_AUSENCIA = 7;

/**
 * O QUE CONTA COMO TRABALHO REGISTRADO NA AUDITORIA — lista fechada.
 *
 * Um nome de registro por coisa, escolhido pela medição de 12/09/2026 (90 dias):
 *
 *   processo cadastrado .. `CREATE Processo` (186) — o registro de negócio; a
 *                          rota `/api/processos/importar` (43) é a mesma ação
 *                          vista pela porta, e contar as duas dobraria.
 *   documento anexado .... `CREATE AnexoDocumento` (55), pelo mesmo motivo que
 *                          deixa `/api/anexos` (40) de fora.
 *   filiado cadastrado ... `CREATE /api/filiados` (163) — o único registro dessa
 *                          ação.
 *   ficha atualizada ..... `UPDATE Filiado` (31) — o registro que diz quais
 *                          campos mudaram.
 */
export const REGISTROS = {
  processoCadastrado: { acao: AcaoAuditoria.CREATE, entidade: 'Processo' },
  documentoAnexado: { acao: AcaoAuditoria.CREATE, entidade: 'AnexoDocumento' },
  filiadoCadastrado: { acao: AcaoAuditoria.CREATE, entidade: '/api/filiados' },
  fichaAtualizada: { acao: AcaoAuditoria.UPDATE, entidade: 'Filiado' },
} as const;

const ABERTOS = [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO];
const DIA_MS = 24 * 3_600_000;

export interface LinhaDeUso {
  usuarioId: string;
  nome: string;
  perfil: string;
  avatarUrl: string | null;
  avatarKey: string | null;
  /** O último uso real: login, sessão renovada ou ação (ver `ultimoUsoReal`). */
  ultimoAcesso: string | null;
  /** Dias do período em que a pessoa usou o sistema. */
  diasComUso: number;
  /** Quais dias (AAAA-MM-DD, em Teresina) — é o que desenha a faixa. */
  diasAtivos: string[];
  agenda: {
    concluidas: number;
    /** Concluídas no dia marcado ou antes. Nunca "no prazo": o prazo processual o sistema não conhece. */
    noDiaMarcado: number;
    criadas: number;
    /** Estoque de agora, como responsável. */
    abertas: number;
    atrasadas: number;
  };
  publicacoes: {
    /** Propostas do Diário aceitas ou recusadas no período. */
    decididas: number;
    /** Propostas endereçadas à pessoa esperando decisão agora. */
    esperando: number;
  };
  processos: { cadastrados: number; andamentos: number; documentos: number };
  filiados: { cadastrados: number; fichasAtualizadas: number };
  atendimentos: number;
}

export interface ResumoDoPerfil {
  perfil: string;
  pessoas: number;
  /** Usaram o sistema ao menos um dia no período. */
  usaram: number;
  /** Com último acesso há `DIAS_PARA_NOTAR_AUSENCIA` dias ou mais. */
  semAcessoRecente: number;
  nuncaEntraram: number;
}

export interface Produtividade {
  periodo: { de: string; ate: string };
  escopo: 'GLOBAL' | 'PESSOAL';
  /** Todos os dias do período, em Teresina. */
  dias: string[];
  perfis: ResumoDoPerfil[];
  pessoas: LinhaDeUso[];
  geradoEm: string;
}

/** Os dias do período, em Teresina, do primeiro ao último. */
export function diasDoPeriodo(inicio: Date, fim: Date): string[] {
  const dias: string[] = [];
  for (let t = inicio.getTime(); t < fim.getTime(); t += DIA_MS) dias.push(diaBR(new Date(t)));
  return [...new Set(dias)];
}

/** Concluída no dia marcado ou antes — pela data de Teresina, e não pela hora. */
export function concluidaNoDia(concluidoEm: Date, inicio: Date): boolean {
  return diaBR(concluidoEm) <= diaBR(inicio);
}

/** Por perfil, depois por nome. NUNCA por volume — ver o comentário do topo. */
export function ordenarPessoas<T extends { perfil: string; nome: string }>(pessoas: T[]): T[] {
  const lugar = (perfil: string) => {
    const i = PERFIS_EM_ORDEM.indexOf(perfil);
    return i === -1 ? PERFIS_EM_ORDEM.length : i;
  };
  return [...pessoas].sort(
    (a, b) => lugar(a.perfil) - lugar(b.perfil) || a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

/** Dias inteiros desde o último acesso; nulo para quem nunca entrou. */
export function diasDesde(iso: string | null, agora: Date): number | null {
  if (!iso) return null;
  return Math.floor((agora.getTime() - new Date(iso).getTime()) / DIA_MS);
}

export function resumirPerfis(pessoas: LinhaDeUso[], agora: Date): ResumoDoPerfil[] {
  return PERFIS_EM_ORDEM.map((perfil) => {
    const doPerfil = pessoas.filter((p) => p.perfil === perfil);
    return {
      perfil,
      pessoas: doPerfil.length,
      usaram: doPerfil.filter((p) => p.diasComUso > 0).length,
      semAcessoRecente: doPerfil.filter((p) => (diasDesde(p.ultimoAcesso, agora) ?? -1) >= DIAS_PARA_NOTAR_AUSENCIA)
        .length,
      nuncaEntraram: doPerfil.filter((p) => !p.ultimoAcesso).length,
    };
  }).filter((r) => r.pessoas > 0);
}

@Injectable()
export class ProdutividadeService {
  constructor(private readonly prisma: PrismaService) {}

  async montar(
    de: Date,
    ate: Date,
    usuario: { id: string; role: UserRole | string },
  ): Promise<Produtividade> {
    const inicio = inicioDoDiaBR(de);
    const fim = new Date(inicioDoDiaBR(ate).getTime() + DIA_MS);
    const agora = new Date();
    const hojeIni = inicioDoDiaBR(agora);
    const escopo: Produtividade['escopo'] = VEEM_A_CASA.has(String(usuario.role)) ? 'GLOBAL' : 'PESSOAL';
    const noPeriodo = { gte: inicio, lt: fim };

    const usuarios = await this.prisma.user.findMany({
      where: escopo === 'GLOBAL' ? { ativo: true } : { id: usuario.id },
      select: {
        id: true, nome: true, nomeExibicao: true, role: true,
        avatarUrl: true, avatarKey: true, ultimoLoginEm: true,
      },
    });
    const ids = usuarios.map((u) => u.id);

    const [
      auditoria,
      sessoes,
      ultimaSessao,
      ultimaAcao,
      concluidas,
      criadas,
      abertas,
      atrasadas,
      recusadas,
      aceitas,
      esperando,
      andamentos,
      atendimentos,
    ] = await Promise.all([
      // A LINHA DE LOGIN FICA DE FORA: ela grava também a tentativa que falhou,
      // e quem só chegou à tela de senha não usou o sistema.
      this.prisma.auditoria.findMany({
        where: { userId: { in: ids }, acao: { not: AcaoAuditoria.LOGIN }, createdAt: noPeriodo },
        select: { userId: true, acao: true, entidade: true, createdAt: true },
      }),
      this.prisma.refreshToken.findMany({
        where: { userId: { in: ids }, createdAt: noPeriodo },
        select: { userId: true, createdAt: true },
      }),
      this.prisma.refreshToken.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { createdAt: true },
      }),
      this.prisma.auditoria.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, acao: { not: AcaoAuditoria.LOGIN } },
        _max: { createdAt: true },
      }),
      this.prisma.compromisso.findMany({
        where: { concluidoPor: { in: ids }, status: StatusCompromisso.CONCLUIDO, concluidoEm: noPeriodo },
        select: { concluidoPor: true, concluidoEm: true, inicio: true },
      }),
      this.prisma.compromisso.groupBy({
        by: ['criadoPor'],
        where: { criadoPor: { in: ids }, createdAt: noPeriodo },
        _count: { _all: true },
      }),
      this.prisma.compromisso.groupBy({
        by: ['responsavelId'],
        where: { responsavelId: { in: ids }, status: { in: ABERTOS } },
        _count: { _all: true },
      }),
      this.prisma.compromisso.groupBy({
        by: ['responsavelId'],
        where: { responsavelId: { in: ids }, status: { in: ABERTOS }, inicio: { lt: hojeIni } },
        _count: { _all: true },
      }),
      this.prisma.comunicacaoDjen.groupBy({
        by: ['tarefaPropostaPara'],
        where: {
          tarefaPropostaPara: { in: ids },
          tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO',
          tarefaDispensadaEm: noPeriodo,
        },
        _count: { _all: true },
      }),
      this.prisma.comunicacaoDjen.findMany({
        where: { tarefaPropostaPara: { in: ids }, compromisso: { createdAt: noPeriodo } },
        select: { tarefaPropostaPara: true },
      }),
      this.prisma.comunicacaoDjen.groupBy({
        by: ['tarefaPropostaPara'],
        where: {
          tarefaPropostaPara: { in: ids },
          tarefaPropostaEm: { not: null },
          compromissoId: null,
          tarefaDispensadaEm: null,
        },
        _count: { _all: true },
      }),
      this.prisma.movimentacaoInterna.groupBy({
        by: ['autorId'],
        where: { autorId: { in: ids }, createdAt: noPeriodo },
        _count: { _all: true },
      }),
      this.prisma.atendimento.groupBy({
        by: ['atendentePorId'],
        where: { atendentePorId: { in: ids }, createdAt: noPeriodo },
        _count: { _all: true },
      }),
    ]);

    /*
      DIA COM USO = alguma ação gravada OU a sessão renovada naquele dia.

      As duas fontes, e não uma: medido em 12/09/2026, uma advogada tinha 8 dias
      com ação e ZERO renovações de sessão no mês — a sessão dela durava —, e
      outra pessoa renovava sessão sem registrar ação nenhuma.
    */
    const diasDe = new Map<string, Set<string>>();
    const marcar = (id: string | null, quando: Date) => {
      if (!id) return;
      const dias = diasDe.get(id) ?? new Set<string>();
      dias.add(diaBR(quando));
      diasDe.set(id, dias);
    };
    auditoria.forEach((a) => marcar(a.userId, a.createdAt));
    sessoes.forEach((s) => marcar(s.userId, s.createdAt));

    const registros = new Map<string, number>();
    for (const a of auditoria) {
      const chave = `${a.userId}|${a.acao}|${a.entidade}`;
      registros.set(chave, (registros.get(chave) ?? 0) + 1);
    }
    const contar = (id: string, regra: { acao: AcaoAuditoria; entidade: string }) =>
      registros.get(`${id}|${regra.acao}|${regra.entidade}`) ?? 0;

    const porId = <T,>(linhas: T[], chave: (l: T) => string | null, valor: (l: T) => number) => {
      const mapa = new Map<string, number>();
      for (const l of linhas) {
        const k = chave(l);
        if (k) mapa.set(k, (mapa.get(k) ?? 0) + valor(l));
      }
      return mapa;
    };
    const criadasDe = porId(criadas, (l) => l.criadoPor, (l) => l._count._all);
    const abertasDe = porId(abertas, (l) => l.responsavelId, (l) => l._count._all);
    const atrasadasDe = porId(atrasadas, (l) => l.responsavelId, (l) => l._count._all);
    const recusadasDe = porId(recusadas, (l) => l.tarefaPropostaPara, (l) => l._count._all);
    const aceitasDe = porId(aceitas, (l) => l.tarefaPropostaPara, () => 1);
    const esperandoDe = porId(esperando, (l) => l.tarefaPropostaPara, (l) => l._count._all);
    const andamentosDe = porId(andamentos, (l) => l.autorId, (l) => l._count._all);
    const atendimentosDe = porId(atendimentos, (l) => l.atendentePorId, (l) => l._count._all);
    const sessaoDe = new Map(ultimaSessao.map((s) => [s.userId, s._max.createdAt]));
    const acaoDe = new Map(ultimaAcao.map((a) => [a.userId, a._max.createdAt]));

    const pessoas = ordenarPessoas(
      usuarios.map((u): LinhaDeUso => {
        const minhas = concluidas.filter((c) => c.concluidoPor === u.id);
        const dias = [...(diasDe.get(u.id) ?? [])].sort();
        return {
          usuarioId: u.id,
          nome: u.nomeExibicao || u.nome,
          perfil: u.role,
          avatarUrl: u.avatarUrl,
          avatarKey: u.avatarKey,
          ultimoAcesso:
            ultimoUsoReal(u.ultimoLoginEm, sessaoDe.get(u.id), acaoDe.get(u.id))?.toISOString() ?? null,
          diasComUso: dias.length,
          diasAtivos: dias,
          agenda: {
            concluidas: minhas.length,
            noDiaMarcado: minhas.filter((c) => c.concluidoEm && concluidaNoDia(c.concluidoEm, c.inicio)).length,
            criadas: criadasDe.get(u.id) ?? 0,
            abertas: abertasDe.get(u.id) ?? 0,
            atrasadas: atrasadasDe.get(u.id) ?? 0,
          },
          publicacoes: {
            decididas: (recusadasDe.get(u.id) ?? 0) + (aceitasDe.get(u.id) ?? 0),
            esperando: esperandoDe.get(u.id) ?? 0,
          },
          processos: {
            cadastrados: contar(u.id, REGISTROS.processoCadastrado),
            andamentos: andamentosDe.get(u.id) ?? 0,
            documentos: contar(u.id, REGISTROS.documentoAnexado),
          },
          filiados: {
            cadastrados: contar(u.id, REGISTROS.filiadoCadastrado),
            fichasAtualizadas: contar(u.id, REGISTROS.fichaAtualizada),
          },
          atendimentos: atendimentosDe.get(u.id) ?? 0,
        };
      }),
    );

    return {
      periodo: { de: inicio.toISOString(), ate: fim.toISOString() },
      escopo,
      dias: diasDoPeriodo(inicio, fim),
      perfis: escopo === 'GLOBAL' ? resumirPerfis(pessoas, agora) : [],
      pessoas,
      geradoEm: agora.toISOString(),
    };
  }
}

/**
 * A PLANILHA — `;` e BOM, como a da equipe, para o Excel em português abrir
 * com acento. Mesma ordem da tela: perfil, depois nome.
 */
export function csvDaProdutividade(p: Produtividade): string {
  const CRLF = String.fromCharCode(13, 10);
  const BOM = String.fromCharCode(0xfeff);
  const campo = (v: string | number | null) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const cabecalho = [
    'Pessoa', 'Perfil', 'Último acesso', 'Dias com uso', 'Atividades concluídas',
    'Concluídas no dia marcado', 'Atividades criadas', 'Em aberto', 'Atrasadas',
    'Publicações decididas', 'Publicações esperando', 'Processos cadastrados',
    'Andamentos internos', 'Documentos anexados', 'Filiados cadastrados',
    'Fichas atualizadas', 'Atendimentos',
  ];
  const linhas = p.pessoas.map((l) =>
    [
      l.nome, l.perfil, l.ultimoAcesso ? l.ultimoAcesso.slice(0, 10) : null, l.diasComUso,
      l.agenda.concluidas, l.agenda.noDiaMarcado, l.agenda.criadas, l.agenda.abertas,
      l.agenda.atrasadas, l.publicacoes.decididas, l.publicacoes.esperando,
      l.processos.cadastrados, l.processos.andamentos, l.processos.documentos,
      l.filiados.cadastrados, l.filiados.fichasAtualizadas, l.atendimentos,
    ]
      .map(campo)
      .join(';'),
  );
  return BOM + [cabecalho.map(campo).join(';'), ...linhas].join(CRLF) + CRLF;
}
