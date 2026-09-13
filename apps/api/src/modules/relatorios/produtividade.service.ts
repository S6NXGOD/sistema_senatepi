import { Injectable } from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { diaBR, inicioDoDiaBR, mesBR } from '../processos/utils/data-br.util';
import { ultimoUsoReal } from '../dashboard/ultimo-acesso.util';
import { SELECAO_DAS_ABERTAS, abertasDeAlguem, contarAbertasPorPessoa } from './abertas-da-pessoa.util';

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

/**
 * A PARTIR DE QUANDO "PUBLICAÇÕES DECIDIDAS" É FATO GRAVADO.
 *
 * Até 13/09/2026 a conta deduzia: "proposta endereçada à pessoa que virou
 * tarefa". Aceitar não trocava o destinatário, e a proposta ignorada por três
 * dias vira tarefa sozinha — então ignorar a caixa AUMENTAVA as decididas. Agora
 * `aceitar()` e `recusar()` gravam quem decidiu e quando
 * (`tarefaDecididaPor/Em`); a escalada do robô não grava. Não há como saber
 * quem aceitou antes disso: período anterior a esta data soma zero, e a tela
 * não compara Decididas atravessando a data.
 */
export const DECISAO_GRAVADA_DESDE = '2026-09-13';

const DIA_MS = 24 * 3_600_000;

/**
 * QUEM ENTRA NO USO — o alcance da aba, do CSV e das fotos do PDF.
 *
 * Uma regra só para as três rotas: a gestão recebe as contas ativas; qualquer
 * outro perfil com acesso a relatórios, só a si mesmo. Se as fotos tivessem uma
 * cópia desta conta, bastaria uma divergência para o advogado receber o rosto
 * do colega.
 */
export function quemEntraNoUso(usuario: { id: string; role: UserRole | string }): Prisma.UserWhereInput {
  return VEEM_A_CASA.has(String(usuario.role)) ? { ativo: true } : { id: usuario.id };
}

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
    /**
     * Estoque de agora, pela régua `daPessoa`: responde pela atividade ou foi
     * posta nela por gente. Reserva do robô não entra.
     */
    abertas: number;
    atrasadas: number;
  };
  publicacoes: {
    /** Propostas do Diário que a pessoa aceitou ou recusou no período (fato gravado desde `DECISAO_GRAVADA_DESDE`). */
    decididas: number;
    /** Propostas endereçadas à pessoa esperando decisão agora. */
    esperando: number;
  };
  /** `andamentos`: só os lançados à mão (origem nula) — ver `montar`. */
  processos: { cadastrados: number; andamentos: number; documentos: number };
  filiados: { cadastrados: number; fichasAtualizadas: number };
  atendimentos: number;
  /**
   * MÊS A MÊS, para o PDF de um ano inteiro — os dias de uso e o trabalho que
   * tem data. Só os meses do período, em ordem; mês parado vem com zeros, que é
   * informação (férias, afastamento), e não buraco no gráfico.
   */
  porMes: MesDeUso[];
}

export interface MesDeUso {
  /** AAAA-MM, em Teresina. */
  mes: string;
  diasComUso: number;
  concluidas: number;
  andamentos: number;
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
  /** Os meses do período (AAAA-MM), na ordem. */
  meses: string[];
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

/** Os meses que os dias atravessam, na ordem — de 13/08 a 12/09 dá agosto e setembro. */
export function mesesDoPeriodo(dias: string[]): string[] {
  return [...new Set(dias.map((d) => d.slice(0, 7)))];
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
      where: quemEntraNoUso(usuario),
      select: {
        id: true, nome: true, nomeExibicao: true, role: true,
        avatarUrl: true, avatarKey: true, ultimoLoginEm: true,
      },
    });
    const ids = usuarios.map((u) => u.id);

    /*
      A FRASE QUE EXPLICA CADA NÚMERO MORA NO WEB, e anda junto com estes where.

      O PDF e a aba "Como ler estes números" leem `LEGENDA_DO_USO`, em
      apps/web/src/lib/produtividade.ts (13/09/2026). Mudou o que uma consulta
      abaixo conta (quem entra, qual origem, qual data)? A linha da legenda muda
      no mesmo commit — senão o relatório passa a explicar uma conta que não é
      mais a dele.
    */
    const [
      auditoria,
      sessoes,
      ultimaSessao,
      ultimaAcao,
      concluidas,
      criadas,
      abertas,
      decididas,
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
      /*
        EM ABERTO E ATRASADAS pela régua do sino e do painel (`daPessoa`): uma
        leitura só das abertas de qualquer pessoa da lista, com a equipe, e a
        soma em memória. Eram dois groupBy por `responsavelId`, e a mesma pessoa
        tinha um número no painel e outro aqui.
      */
      this.prisma.compromisso.findMany({
        where: abertasDeAlguem(ids),
        select: SELECAO_DAS_ABERTAS,
      }),
      /*
        DECIDIDAS = quem aceitou ou recusou de fato, gravado na decisão. A
        tarefa que o robô criou porque ninguém respondeu não tem autor e não
        entra; a aceita por um colega conta para o colega.
      */
      this.prisma.comunicacaoDjen.groupBy({
        by: ['tarefaDecididaPor'],
        where: { tarefaDecididaPor: { in: ids }, tarefaDecididaEm: noPeriodo },
        _count: { _all: true },
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
      /*
        ANDAMENTO LANÇADO POR GENTE — `origem` nula.

        Concluir atividade ligada a processo grava uma nota em nome de quem
        concluiu, e cada linha de planilha importada grava outra em nome de quem
        subiu o arquivo. Medido em 12/09/2026: de 106 andamentos com autor em
        90 dias, 17 (16%) eram só o eco da conclusão — a mesma entrega contava
        em Concluídas e em Andamentos. Essas notas nascem com `origem`
        (CONCLUSAO, CONVERSAO, IMPORTACAO) e ficam fora; o que o robô escreve
        (`origemSistema`) já não tinha autor.

        Linha a linha, e não agrupado: o PDF de um ano precisa do MÊS de cada uma.
      */
      this.prisma.movimentacaoInterna.findMany({
        where: { autorId: { in: ids }, createdAt: noPeriodo, origem: null, origemSistema: false },
        select: { autorId: true, createdAt: true },
      }),
      this.prisma.atendimento.findMany({
        where: { atendentePorId: { in: ids }, createdAt: noPeriodo },
        select: { atendentePorId: true, createdAt: true },
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
    const abertasDe = contarAbertasPorPessoa(abertas, hojeIni);
    const decididasDe = porId(decididas, (l) => l.tarefaDecididaPor, (l) => l._count._all);
    const esperandoDe = porId(esperando, (l) => l.tarefaPropostaPara, (l) => l._count._all);
    const andamentosDe = porId(andamentos, (l) => l.autorId, () => 1);
    const atendimentosDe = porId(atendimentos, (l) => l.atendentePorId, () => 1);

    /* MÊS A MÊS — a mesma contagem, com o mês de Teresina na chave. */
    const meses = mesesDoPeriodo(diasDoPeriodo(inicio, fim));
    const noMes = (id: string, mes: string) => `${id}|${mes}`;
    const contarNoMes = <T,>(
      linhas: T[],
      quem: (l: T) => string | null,
      quando: (l: T) => Date | null,
    ) => {
      const mapa = new Map<string, number>();
      for (const l of linhas) {
        const id = quem(l);
        const data = quando(l);
        if (!id || !data) continue;
        const chave = noMes(id, mesBR(data));
        mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
      }
      return mapa;
    };
    const concluidasNoMes = contarNoMes(concluidas, (l) => l.concluidoPor, (l) => l.concluidoEm);
    const andamentosNoMes = contarNoMes(andamentos, (l) => l.autorId, (l) => l.createdAt);
    const atendimentosNoMes = contarNoMes(atendimentos, (l) => l.atendentePorId, (l) => l.createdAt);
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
            abertas: abertasDe.get(u.id)?.abertas ?? 0,
            atrasadas: abertasDe.get(u.id)?.atrasadas ?? 0,
          },
          publicacoes: {
            decididas: decididasDe.get(u.id) ?? 0,
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
          porMes: meses.map((mes) => ({
            mes,
            diasComUso: dias.filter((d) => d.startsWith(mes)).length,
            concluidas: concluidasNoMes.get(noMes(u.id, mes)) ?? 0,
            andamentos: andamentosNoMes.get(noMes(u.id, mes)) ?? 0,
            atendimentos: atendimentosNoMes.get(noMes(u.id, mes)) ?? 0,
          })),
        };
      }),
    );

    return {
      periodo: { de: inicio.toISOString(), ate: fim.toISOString() },
      escopo,
      dias: diasDoPeriodo(inicio, fim),
      meses,
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
