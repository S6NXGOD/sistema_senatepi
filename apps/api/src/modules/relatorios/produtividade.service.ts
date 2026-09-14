import { Injectable } from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { diaBR, inicioDoDiaBR, instanteDoTextoBR, mesBR, semanaBR } from '../processos/utils/data-br.util';
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
  /**
   * Quando a conta foi criada (ISO de `users.created_at`). Serve só para o PDF
   * decidir "Sem comparação: a conta foi criada em …". Medido em 14/09/2026: as
   * contas nasceram entre 04/08 e 11/09 — o "antes 0" do Dr. Murilo (conta de
   * 21/08) era conta que não existia, e não queda de uso.
   */
  contaCriadaEm: string;
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
    /**
     * As concluídas do período por TIPO de atividade (ver `concluidasPorTipo`).
     * A soma de `concluidas` aqui é exatamente `agenda.concluidas`.
     */
    porTipo: TipoConcluido[];
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
  /**
   * SEMANA A SEMANA, para o PDF de até 13 semanas (14/09/2026). Medido na
   * produção: no máximo 8 concluídas por pessoa por semana — acima de 13
   * semanas as colunas ficam finas demais, e o PDF usa `porMes`.
   *
   * Uma entrada por semana de `Produtividade.semanas`, na ordem; semana parada
   * vem com zeros, no mesmo desenho de `porMes`. Sai das MESMAS linhas que os
   * totais, pela mesma soma (`contarPor`): somar as semanas dá o total.
   */
  porSemana: SemanaDeUso[];
}

/** O trabalho com data, somado num intervalo de tempo — a parte comum de mês e semana. */
interface TrabalhoNoTempo {
  diasComUso: number;
  concluidas: number;
  /** Das concluídas do intervalo, as que fecharam no dia marcado ou antes. */
  noDiaMarcado: number;
  andamentos: number;
  atendimentos: number;
  /** Pelos nomes fixos de `REGISTROS`, com a data da própria auditoria. */
  processosCadastrados: number;
  documentos: number;
  filiadosCadastrados: number;
}

export interface MesDeUso extends TrabalhoNoTempo {
  /** AAAA-MM, em Teresina. */
  mes: string;
}

export interface SemanaDeUso extends TrabalhoNoTempo {
  /** A segunda-feira da semana (AAAA-MM-DD, em Teresina), por `semanaBR`. */
  semana: string;
  /**
   * Quantos dias desta semana estão dentro do período: 7 no meio, menos nas
   * pontas. É o que deixa o PDF dizer "a primeira semana começa em 14/08" sem
   * refazer a conta de datas.
   */
  diasNoPeriodo: number;
}

/**
 * Concluídas de um tipo de atividade. `tipo` é o slug guardado no compromisso;
 * `nome` é o nome ATUAL em tipos_evento (tipo é cadastrável, pode ter sido
 * renomeado ou ocultado), ou `NOME_DO_TIPO_SEM_CADASTRO` se a linha sumiu.
 */
export interface TipoConcluido {
  tipo: string;
  nome: string;
  concluidas: number;
  noDiaMarcado: number;
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
  /** As segundas-feiras (AAAA-MM-DD, Teresina) das semanas que o período toca, na ordem. */
  semanas: string[];
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

/**
 * As semanas que os dias tocam, pela segunda-feira, na ordem. De 14/08/2026
 * (sexta) a 13/09/2026 (domingo) dá 10/08 a 07/09: cinco semanas, a primeira
 * com 3 dias dentro do período.
 */
export function semanasDoPeriodo(dias: string[]): string[] {
  return [...new Set(dias.map((dia) => semanaBR(instanteDoTextoBR(dia))))];
}

/** A chave pessoa + intervalo nos mapas de `contarPor`. */
export const naChave = (id: string, intervalo: string) => `${id}|${intervalo}`;

/**
 * UMA SOMA SÓ PARA MÊS E SEMANA (14/09/2026).
 *
 * Era `contarNoMes`, com `mesBR` escrito dentro. O semana a semana precisava da
 * mesma conta com outra chave de tempo, e uma cópia com `semanaBR` seria a
 * segunda implementação de "quanto a pessoa fez naquele intervalo" — as duas
 * divergiriam em silêncio na primeira mudança de regra. O intervalo agora é
 * parâmetro (`mesBR` ou `semanaBR`, os dois de data-br.util).
 *
 * Linha sem pessoa ou sem data não conta, como antes.
 */
export function contarPor<T>(
  linhas: readonly T[],
  quem: (l: T) => string | null,
  quando: (l: T) => Date | null,
  intervalo: (d: Date) => string,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    const id = quem(l);
    const data = quando(l);
    if (!id || !data) continue;
    const chave = naChave(id, intervalo(data));
    mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
  }
  return mapa;
}

/** O nome de um tipo cujo slug não tem mais linha em tipos_evento. */
export const NOME_DO_TIPO_SEM_CADASTRO = 'Outro tipo';

/**
 * CONCLUÍDAS POR TIPO DE ATIVIDADE — de uma pessoa, no período.
 *
 * A ordem é por volume e depois pelo nome, e isso NÃO contradiz a regra de não
 * ordenar por volume: aqui se ordenam TIPOS de atividade de uma mesma pessoa
 * (prazo, audiência, reunião), nunca pessoas. Só entram tipos com concluída.
 *
 * O nome é o atual: tipos são cadastráveis e podem ter sido renomeados ou
 * ocultados (ocultar não apaga a linha). Slug sem linha vira "Outro tipo".
 */
export function concluidasPorTipo(
  minhas: readonly { tipo: string; concluidoEm: Date | null; inicio: Date }[],
  nomes: ReadonlyMap<string, string>,
): TipoConcluido[] {
  const porSlug = new Map<string, TipoConcluido>();
  for (const c of minhas) {
    const atual = porSlug.get(c.tipo) ?? {
      tipo: c.tipo,
      nome: nomes.get(c.tipo) ?? NOME_DO_TIPO_SEM_CADASTRO,
      concluidas: 0,
      noDiaMarcado: 0,
    };
    // A mesma régua do total: toda concluída conta, e "no dia" exige a data.
    atual.concluidas += 1;
    if (c.concluidoEm && concluidaNoDia(c.concluidoEm, c.inicio)) atual.noDiaMarcado += 1;
    porSlug.set(c.tipo, atual);
  }
  const tipos = [...porSlug.values()];
  return tipos.sort(
    (a, b) =>
      b.concluidas - a.concluidas || a.nome.localeCompare(b.nome, 'pt-BR') || a.tipo.localeCompare(b.tipo),
  );
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
        avatarUrl: true, avatarKey: true, ultimoLoginEm: true, createdAt: true,
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
      tipos,
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
        // `tipo` para "por tipo": o mesmo SELECT, uma coluna a mais (14/09/2026).
        select: { concluidoPor: true, concluidoEm: true, inicio: true, tipo: true },
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
      /*
        O NOME DE CADA TIPO DE ATIVIDADE, para "por tipo". Dezenas de linhas em
        tipos_evento. Sem filtro de `ativo`: tipo oculto não apaga a linha, e a
        concluída dele continua tendo nome.
      */
      this.prisma.tipoCompromisso.findMany({ select: { slug: true, nome: true } }),
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

    /*
      MÊS A MÊS E SEMANA A SEMANA — as MESMAS linhas dos totais, pela MESMA soma
      (`contarPor`), trocando só a chave de tempo (`mesBR` ou `semanaBR`). Somar
      as semanas de uma pessoa dá o total dela, e o teste prova com valores.

      Processos, documentos e filiados saem da auditoria já lida, que traz a
      data, pelos nomes fixos de `REGISTROS`. Criadas e decididas ficam fora do
      tempo de propósito (14/09/2026): são groupBy, e dar a elas uma data
      exigiria ler linha a linha só para um gráfico que não as usa.
    */
    const todosOsDias = diasDoPeriodo(inicio, fim);
    const meses = mesesDoPeriodo(todosOsDias);
    const semanas = semanasDoPeriodo(todosOsDias);
    const doRegistro = (regra: { acao: AcaoAuditoria; entidade: string }) =>
      auditoria.filter((a) => a.acao === regra.acao && a.entidade === regra.entidade);
    const concluidasNoDia = concluidas.filter((c) => c.concluidoEm && concluidaNoDia(c.concluidoEm, c.inicio));
    const usoPorDia = [...diasDe].flatMap(([id, ds]) => [...ds].map((dia) => ({ id, dia })));
    const trabalhoPor = (intervalo: (d: Date) => string) => {
      const usou = contarPor(usoPorDia, (l) => l.id, (l) => instanteDoTextoBR(l.dia), intervalo);
      const feitas = contarPor(concluidas, (l) => l.concluidoPor, (l) => l.concluidoEm, intervalo);
      const noDia = contarPor(concluidasNoDia, (l) => l.concluidoPor, (l) => l.concluidoEm, intervalo);
      const notas = contarPor(andamentos, (l) => l.autorId, (l) => l.createdAt, intervalo);
      const atendidos = contarPor(atendimentos, (l) => l.atendentePorId, (l) => l.createdAt, intervalo);
      const daAuditoria = (regra: { acao: AcaoAuditoria; entidade: string }) =>
        contarPor(doRegistro(regra), (l) => l.userId, (l) => l.createdAt, intervalo);
      const processosCadastrados = daAuditoria(REGISTROS.processoCadastrado);
      const documentos = daAuditoria(REGISTROS.documentoAnexado);
      const filiadosCadastrados = daAuditoria(REGISTROS.filiadoCadastrado);
      return (id: string, chave: string): TrabalhoNoTempo => {
        const k = naChave(id, chave);
        return {
          diasComUso: usou.get(k) ?? 0,
          concluidas: feitas.get(k) ?? 0,
          noDiaMarcado: noDia.get(k) ?? 0,
          andamentos: notas.get(k) ?? 0,
          atendimentos: atendidos.get(k) ?? 0,
          processosCadastrados: processosCadastrados.get(k) ?? 0,
          documentos: documentos.get(k) ?? 0,
          filiadosCadastrados: filiadosCadastrados.get(k) ?? 0,
        };
      };
    };
    const noMes = trabalhoPor(mesBR);
    const naSemana = trabalhoPor(semanaBR);
    // Quantos dias do período caem em cada semana: a mesma soma, com o período no lugar da pessoa.
    const DO_PERIODO = 'periodo';
    const diasNaSemana = contarPor(todosOsDias, () => DO_PERIODO, instanteDoTextoBR, semanaBR);
    const nomeDoTipo = new Map(tipos.map((t) => [t.slug, t.nome]));
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
          contaCriadaEm: u.createdAt.toISOString(),
          diasComUso: dias.length,
          diasAtivos: dias,
          agenda: {
            concluidas: minhas.length,
            noDiaMarcado: minhas.filter((c) => c.concluidoEm && concluidaNoDia(c.concluidoEm, c.inicio)).length,
            criadas: criadasDe.get(u.id) ?? 0,
            abertas: abertasDe.get(u.id)?.abertas ?? 0,
            atrasadas: abertasDe.get(u.id)?.atrasadas ?? 0,
            porTipo: concluidasPorTipo(minhas, nomeDoTipo),
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
          porMes: meses.map((mes): MesDeUso => ({ mes, ...noMes(u.id, mes) })),
          porSemana: semanas.map((semana): SemanaDeUso => ({
            semana,
            diasNoPeriodo: diasNaSemana.get(naChave(DO_PERIODO, semana)) ?? 0,
            ...naSemana(u.id, semana),
          })),
        };
      }),
    );

    return {
      periodo: { de: inicio.toISOString(), ate: fim.toISOString() },
      escopo,
      dias: todosOsDias,
      meses,
      semanas,
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
