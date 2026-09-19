import { Prisma } from '@prisma/client';
import {
  limitesDoDia,
  recorteAberto,
  recorteAtrasadas,
  recortePassaramDaHora,
  recorteSeteDias,
} from '../agenda/recortes.util';
import {
  filaDoAtendimento,
  situacaoDoEncaminhamento,
  type ConsultaDoEncaminhamento,
  type FilaCalculada,
  type SituacaoDoEncaminhamento,
} from '../atendimentos/encaminhamento.util';
import { celularParaWhatsApp } from '../recadastramento/whatsapp.util';

/**
 * AS REGRAS DO PAINEL QUE SE PROVAM COM VALORES — fora do `dashboard.module.ts`.
 *
 * O módulo do painel tem 2.300 linhas e quase todos os testes dele leem o texto
 * do arquivo. Foi assim que "Atrasadas 3" abria a aba Hoje, "Urgentes" contava
 * só a semana e a carga da equipe contava um número que o clique não mostrava,
 * com todos os testes verdes (auditoria de 12/09/2026). O que decide número mora
 * aqui, em funções puras, e o spec aplica cada `where` a linhas de verdade.
 */

const TIPO_PRAZO = 'PRAZO';
const TIPO_AUDIENCIA = 'AUDIENCIA';

// ---------------------------------------------------------------------------
// Os recortes da agenda que o painel conta
// ---------------------------------------------------------------------------

/**
 * O NÚMERO E O LINK SAEM DO MESMO LUGAR.
 *
 * Cada contador do painel abre uma aba da agenda (C11). Até 13/09/2026 o painel
 * escrevia os intervalos à mão e a agenda recortava no navegador, e os dois
 * discordavam: "Urgentes" contava só as da semana e a aba "Em aberto" mostrava
 * também a urgente que ficou para trás; "Prazos esta semana" somava audiência e
 * o link abria só prazo. Agora cada número é o recorte da agenda
 * (`recortes.util`) com o mesmo filtro que a URL leva:
 *
 *   atrasadas         aba=atrasadas (+ pessoa=eu)
 *   passaramDaHora    parte de aba=atencao
 *   prazosSemana      aba=7dias&tipo=PRAZO
 *   minhasAudiencias  aba=7dias&tipo=AUDIENCIA&pessoa=eu
 *   urgentes          aba=aberto&urgentes=1 (+ pessoa=eu)
 *
 * `meu` é a régua `daPessoa` do advogado, ou vazio para quem vê a casa. Tudo vai
 * dentro de `AND`: `daPessoa` traz um `OR`, e dois `OR` no mesmo objeto se
 * sobrescrevem sem erro.
 */
export function wheresDoPainel(meu: Prisma.CompromissoWhereInput, agora: Date) {
  const { hojeIni, hojeFim, fimDosSeteDias } = limitesDoDia(agora);
  const doEscopo = (...partes: Prisma.CompromissoWhereInput[]): Prisma.CompromissoWhereInput => ({
    AND: [meu, ...partes],
  });
  return {
    hojeIni,
    hojeFim,
    fimDosSeteDias,
    atrasadas: doEscopo(recorteAtrasadas(agora)),
    passaramDaHora: doEscopo(recortePassaramDaHora(agora)),
    prazosSemana: doEscopo({ tipo: TIPO_PRAZO }, recorteSeteDias(agora)),
    minhasAudiencias: doEscopo({ tipo: TIPO_AUDIENCIA }, recorteSeteDias(agora)),
    /*
      O SELO DO BLOCO "AUDIÊNCIAS DA SEMANA" — o que o "Ver" dele abre:
      aba=7dias&tipo=AUDIENCIA (+ pessoa=eu para o advogado).

      O selo contava os itens da lista (abertas de hoje em diante, cortadas em
      8) e o cartão "Minhas audiências", na mesma tela, contava o recorte de 7
      dias: numa segunda com uma audiência de sexta ainda aberta e outra
      concluída hoje, um dizia 4 e o outro 2 (revisão de 13/09/2026). É a mesma
      conta de `minhasAudiencias`; o nome separado é para a gestão, que conta a
      casa inteira e não "as minhas".
    */
    audienciasSemanaTotal: doEscopo({ tipo: TIPO_AUDIENCIA }, recorteSeteDias(agora)),
    /*
      URGENTE EM ABERTO, SEM CORTE DE DATA. Contava só início entre hoje e sete
      dias: a urgente que ficou para trás — a que mais pede alguém — saía da
      conta e continuava na aba que o número abre.
    */
    urgentes: doEscopo(recorteAberto(), { urgente: true }),
    /** O quadro do dia: qualquer situação, para a concluída às 10h continuar nele. */
    atividadesHoje: doEscopo({ inicio: { gte: hojeIni, lt: hojeFim } }),
    /** De amanhã ao sétimo dia, em aberto. Audiência tem bloco próprio. */
    proximasAtividades: doEscopo(
      recorteAberto(),
      { tipo: { not: TIPO_AUDIENCIA } },
      { inicio: { gte: hojeFim, lt: fimDosSeteDias } },
    ),
    audienciasSemana: doEscopo(
      recorteAberto(),
      { tipo: TIPO_AUDIENCIA },
      { inicio: { gte: hojeIni, lt: fimDosSeteDias } },
    ),
  };
}

// ---------------------------------------------------------------------------
// Cadastros a completar
// ---------------------------------------------------------------------------

/** Uma linha da consulta de `cadastrosACompletar`, já com os nomes do SQL. */
export interface LinhaDoCadastroACompletar {
  id: string;
  nome: string;
  telefone: string | null;
  telefoneSecundario: string | null;
  cpf: string | null;
  nascimento: Date | null;
  motivo: string;
  /** O vencimento do link vivo (não usado, não revogado, não vencido), ou nulo. */
  linkAtivoAte: Date | null;
  /** O `usado_em` mais recente. */
  respondeuPeloLinkEm: Date | null;
}

const semTexto = (t: string | null | undefined) => !(t ?? '').trim();

/**
 * O QUE A LINHA DO CARTÃO DIZ — estado, nunca evento.
 *
 * TELEFONE: falta só quando os DOIS campos estão vazios. A importação grava o
 * "celular" da planilha no secundário e 383 filiados ativos só têm número ali
 * (medido em 12/09/2026); o cartão pedia "falta telefone" de quem tinha.
 *
 * `temCelular` é a mesma régua do botão de WhatsApp (`celularParaWhatsApp`, com
 * a tabela de casos do web): fixo não conta. O número em si não viaja — o cartão
 * só precisa saber se o botão faz sentido.
 *
 * LINK: "ativo até" só enquanto vale; a consulta já filtra, e a conferência
 * aqui é para uma linha que vença entre a consulta e a resposta não sair como
 * ativa. Não existe "enviado": o sistema não sabe se a mensagem saiu.
 */
export function itemDoCadastroACompletar(l: LinhaDoCadastroACompletar, agora: Date) {
  const ate = l.linkAtivoAte ? new Date(l.linkAtivoAte) : null;
  return {
    id: l.id,
    nome: l.nome,
    motivo: l.motivo,
    /** O que falta, na ordem em que atrapalha. */
    falta: [
      semTexto(l.telefone) && semTexto(l.telefoneSecundario) && 'telefone',
      semTexto(l.cpf) && 'CPF',
      !l.nascimento && 'nascimento',
    ].filter(Boolean) as string[],
    temCelular: celularParaWhatsApp(l.telefone, l.telefoneSecundario) !== null,
    linkAtivoAte: ate && ate.getTime() > agora.getTime() ? ate : null,
    respondeuPeloLinkEm: l.respondeuPeloLinkEm ? new Date(l.respondeuPeloLinkEm) : null,
  };
}

// ---------------------------------------------------------------------------
// Atendimentos pendentes
// ---------------------------------------------------------------------------

/** O que a regra do cartão precisa de cada atendimento. */
export interface AtendimentoParaOCartao {
  /** A leitura do painel já filtra pendentes; ausente, conta como PENDENTE. */
  status?: string;
  desfecho: string | null;
  createdAt: Date;
  compromissos: ConsultaDoEncaminhamento[];
}

/**
 * 0 — ninguém decidiu nada: sem desfecho.
 * 1 — é com a triagem: a fila TRIAGEM de `filaDoAtendimento` (falta concluir,
 *     consulta cancelada, consulta sem registro há 2 dias úteis, sem consulta).
 * 2 — aguardando a consulta: a fila CONSULTA.
 *
 * Até 15/09/2026 o grupo 1 incluía a consulta ATENDIDA (hoje o atendimento fecha
 * sozinho) e a que FICOU PARA TRÁS no dia seguinte (hoje ela espera 2 dias úteis
 * na agenda do advogado antes de voltar à triagem). A régua é a mesma função
 * da lista e da gaveta, e as três telas não discordam.
 */
export function grupoDoAtendimento(desfecho: string | null, fila: FilaCalculada | null): 0 | 1 | 2 {
  if (!desfecho) return 0;
  return fila?.fila === 'CONSULTA' ? 2 : 1;
}

/**
 * QUANTOS ESTÃO COM A TRIAGEM E QUANTOS AGUARDAM A CONSULTA (15/09/2026, E3).
 *
 * O KPI contava todo atendimento pendente e pintava tudo de trabalho da triagem;
 * o #13 e o #14 de 14/09 entravam na conta sem nada a fazer além de esperar. A
 * soma das duas filas é o antigo `atendimentosPendentes`, que continua na
 * resposta por uma versão (janela de troca). Com `atendenteId`, só os que essa
 * pessoa registrou: é o "Comigo, com a triagem" do balcão.
 */
export function contarFilas(
  itens: (AtendimentoParaOCartao & { atendentePorId?: string | null })[],
  agora: Date,
  atendenteId?: string,
): { comATriagem: number; aguardandoConsulta: number } {
  let comATriagem = 0;
  let aguardandoConsulta = 0;
  for (const a of itens) {
    if (atendenteId !== undefined && a.atendentePorId !== atendenteId) continue;
    const fila = filaDoAtendimento({ status: a.status ?? 'PENDENTE', desfecho: a.desfecho }, a.compromissos, agora);
    if (fila?.fila === 'TRIAGEM') comATriagem++;
    else if (fila?.fila === 'CONSULTA') aguardandoConsulta++;
  }
  return { comATriagem, aguardandoConsulta };
}

/**
 * O CARTÃO "ATENDIMENTOS PENDENTES" — o estado da consulta e a ordem de quem age.
 *
 * O cartão pintava "Pendente" em tudo e ordenava por data: o atendimento cuja
 * consulta já foi atendida (e só falta fechar) ficava atrás de um encaminhado
 * ontem que está correndo bem. O estado sai de `situacaoDoEncaminhamento`, a
 * MESMA função da lista e da gaveta de Atendimentos, com o mesmo `agora` — as
 * três telas não discordam. Dentro de cada grupo, o mais recente primeiro, como
 * antes. As consultas cruas não saem na resposta.
 */
export function cartaoDeAtendimentosPendentes<T extends AtendimentoParaOCartao>(
  itens: T[],
  agora: Date,
  limite = 6,
): (Omit<T, 'compromissos'> & { encaminhamento?: SituacaoDoEncaminhamento; fila: FilaCalculada | null })[] {
  return itens
    .map(({ compromissos, ...resto }) => {
      const encaminhamento = situacaoDoEncaminhamento(compromissos, agora);
      // A barra âmbar do cartão sai daqui: âmbar só na fila TRIAGEM (E3).
      const fila = filaDoAtendimento({ status: resto.status ?? 'PENDENTE', desfecho: resto.desfecho }, compromissos, agora);
      return {
        item: { ...resto, ...(encaminhamento ? { encaminhamento } : {}), fila },
        grupo: grupoDoAtendimento(resto.desfecho, fila),
        criadoEm: new Date(resto.createdAt).getTime(),
      };
    })
    .sort((a, b) => a.grupo - b.grupo || b.criadoEm - a.criadoEm)
    .slice(0, limite)
    .map((x) => x.item);
}

// ---------------------------------------------------------------------------
// Carga da equipe
// ---------------------------------------------------------------------------

/**
 * EM ORDEM ALFABÉTICA (D8). Ordenar pessoas por atraso é um pódio ao contrário;
 * o número ao lado do nome já diz o que é preciso.
 */
export function emOrdemAlfabetica<T extends { advogado: { nome: string; nomeExibicao: string | null } }>(
  itens: T[],
): T[] {
  const nomeDe = (p: T['advogado']) => p.nomeExibicao || p.nome;
  return [...itens].sort((a, b) => nomeDe(a.advogado).localeCompare(nomeDe(b.advogado), 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Saúde das fontes
// ---------------------------------------------------------------------------

/**
 * SÓ AS CHAMADAS AO TRIBUNAL — sem a linha de resumo da rodada do DataJud.
 *
 * Desde 13/09/2026 a varredura das 02:00 grava, além de uma linha por processo,
 * uma linha por RODADA, com `processo_id` e `numero_cnj` nulos (a DJEN e o
 * SICONFI já gravavam a sua). Sem este corte:
 *  · `ok24`/`falhas24` somariam uma "chamada" que não existiu, e uma rodada
 *    interrompida contaria como consulta recusada;
 *  · em `falhasDatajud24h`, o `DISTINCT ON (COALESCE(processo_id, numero_cnj))`
 *    juntaria todas as rodadas sob NULL, e a faixa listaria "processo com falha"
 *    sem processo e sem NPU.
 * O corte vale só para o DataJud: nas outras fontes a linha de resumo sempre
 * esteve na conta, e mudá-las agora mudaria número sem pedido.
 */
export const SO_CHAMADAS_AO_TRIBUNAL = Prisma.sql`NOT (fonte = 'DATAJUD' AND processo_id IS NULL AND numero_cnj IS NULL)`;

/**
 * A LINHA QUE PROVA QUE A VARREDURA RODOU — tudo, menos o resumo de rodada que falhou.
 *
 * `robo.ultimaSync` pega a linha mais recente do DataJud, e a linha de resumo
 * entrou nela de propósito: "rodada sem alvo" (sucesso) é o robô ter rodado.
 * Só que "Rodada interrompida" também é linha de resumo, com `sucesso = false`
 * e sem nenhuma consulta. Com a leitura dos elegíveis quebrando toda noite, o
 * aviso dizia EM_DIA para sempre, porque a linha da quebra tinha menos de 36 h
 * (revisão de 13/09/2026). Antes da linha de resumo não havia linha nenhuma, e o
 * painel acusava ATRASADO.
 *
 * A linha de processo que falhou continua valendo: o robô rodou e o CNJ recusou,
 * e isso tem aviso próprio. Escrito com `OR` de `not: null` e não com `NOT`: é a
 * forma que não depende de como o Prisma distribui a negação.
 */
/**
 * O COMEÇO DA MENSAGEM DA "RODADA SEM ALVO" — a única linha de resumo que diz
 * "rodou e não havia o que consultar".
 *
 * `saudeDasFontes` usa isto para não acusar NAO_RODOU numa base sem processo
 * elegível. Não basta `sucesso`: a "Rodada pulada" (outra varredura detinha a
 * trava) também é gravada com sucesso, e uma trava presa noite após noite é
 * exatamente o "não executou" que a faixa precisa dizer. A frase nasce em
 * `linhaDeResumoDatajud`, e o spec amarra as duas com valores.
 */
export const PREFIXO_RODADA_SEM_ALVO = 'Rodada sem alvo';

export const LINHA_QUE_PROVA_QUE_RODOU: Prisma.LogSincronizacaoDatajudWhereInput = {
  OR: [{ processoId: { not: null } }, { numeroCNJ: { not: null } }, { sucesso: true }],
};

/**
 * O MOVIMENTO NO DIÁRIO — a única leitura de gráfico que o advogado tem.
 *
 * "Não há mais gráficos e informações que deveriam aparecer para os advogados?"
 * — o dono, 18/09/2026, e a pergunta tinha resposta medida: a Triagem tinha
 * QUATRO gráficos no painel (canal, 14 dias, crescimento, quadro) e o advogado,
 * ZERO. Os quatro falam de atendimento e filiação, que não são trabalho dele.
 *
 * ESCOLHI O DIÁRIO, e não o DataJud, por causa do que a produção mostrou no
 * mesmo dia: nos acervos dos NOVE advogados, o DataJud entregou 0 movimentações
 * em 7 dias (a base pública atrasa 62 dias na mediana), enquanto o DJEN entregou
 * 19 atos para um deles e 26 para a casa. O que se move é o Diário.
 *
 * TRÊS DECISÕES QUE O NÚMERO PRECISA RESPEITAR:
 *
 * 1. CONTA ATOS, NÃO CÓPIAS. O DJEN manda uma linha por destinatário e o `link`
 *    é a identidade do documento — a mesma régua do contador de 7 dias do
 *    painel. Sem isso, um ato que intima quatro advogados vira quatro barras.
 * 2. A SEMANA É DATA PURA. `data_disponibilizacao` é `@db.Date`; ler o dia com
 *    o fuso de Teresina volta 24h e joga a publicação de segunda para a semana
 *    anterior. Por isso `semanaDaDataPura`, nunca `semanaBR`.
 * 3. SEMANA VAZIA APARECE. Um buraco de recesso é informação; pular a semana
 *    encosta duas barras distantes e mente sobre o ritmo.
 */
export interface LinhaDoDiario {
  link: string | null;
  providencia: string | null;
  dataDisponibilizacao: Date;
}

export interface MovimentoNoDiario {
  /** Uma entrada por semana, da mais ANTIGA para a mais nova. Inclui as zeradas. */
  semanas: { semana: string; total: number }[];
  /** Atos no período inteiro, sem as cópias. */
  total: number;
  /** A maior barra — a tela precisa dela para a escala, e 0 nunca divide. */
  pico: number;
  /**
   * O QUE PEDIRAM, em ordem. `NENHUMA` fica de fora: é o edital e a lista de
   * distribuição, que chegam às dezenas e não pedem nada de ninguém (18 dos 114
   * atos do maior acervo). A lista não soma o total, e a tela não promete isso.
   */
  providencias: { chave: string; total: number }[];
}

export function movimentoNoDiario(
  linhas: readonly LinhaDoDiario[],
  semanaDe: (d: Date) => string,
  semanaAtual: string,
  quantasSemanas = 8,
): MovimentoNoDiario {
  /*
    A DEDUPLICAÇÃO É POR ATO, e o desempate importa: duas cópias do mesmo
    documento podem ter providências diferentes se o robô classificou em
    momentos diferentes. Fica a PRIMEIRA que não for nula — é o mesmo texto,
    e uma providência conhecida vale mais que um nulo.
  */
  const atos = new Map<string, LinhaDoDiario>();
  linhas.forEach((l, i) => {
    const chave = l.link ?? `sem-link-${i}`;
    const anterior = atos.get(chave);
    if (!anterior) atos.set(chave, l);
    else if (!anterior.providencia && l.providencia) atos.set(chave, l);
  });

  /* As `quantasSemanas` segundas-feiras até a de hoje, inclusive. */
  const SEMANA_MS = 7 * 24 * 3_600_000;
  const base = Date.parse(`${semanaAtual}T00:00:00.000Z`);
  const grade = Array.from({ length: quantasSemanas }, (_, i) =>
    new Date(base - (quantasSemanas - 1 - i) * SEMANA_MS).toISOString().slice(0, 10),
  );
  const contagem = new Map(grade.map((s) => [s, 0]));

  const porProvidencia = new Map<string, number>();
  let total = 0;
  for (const ato of atos.values()) {
    const s = semanaDe(ato.dataDisponibilizacao);
    // Fora da grade é ruído de consulta (linha mais velha que o corte): não
    // entra no total, senão a soma das barras não bate com o número escrito.
    if (!contagem.has(s)) continue;
    contagem.set(s, contagem.get(s)! + 1);
    total += 1;
    const p = ato.providencia;
    if (p && p !== 'NENHUMA') porProvidencia.set(p, (porProvidencia.get(p) ?? 0) + 1);
  }

  const semanas = grade.map((semana) => ({ semana, total: contagem.get(semana)! }));
  return {
    semanas,
    total,
    pico: Math.max(0, ...semanas.map((s) => s.total)),
    providencias: [...porProvidencia.entries()]
      .map(([chave, t]) => ({ chave, total: t }))
      /* Empate resolvido pelo nome: sem isso a ordem muda a cada consulta e a
         lista "pula" entre dois recarregamentos iguais. */
      .sort((a, b) => b.total - a.total || a.chave.localeCompare(b.chave))
      .slice(0, 4),
  };
}
