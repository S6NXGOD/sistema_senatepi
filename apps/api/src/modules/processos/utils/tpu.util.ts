/**
 * Códigos da TPU (Tabela Processual Unificada do CNJ) que mudam o que a equipe
 * precisa fazer.
 *
 * POR QUE ESTE ARQUIVO EXISTE, SE JÁ HÁ UM CLASSIFICADOR
 * `audiencia.util.ts` responde "isto vira atividade na agenda?" — decisão de
 * AUTOMAÇÃO, conservadora de propósito: na dúvida, não cria tarefa. Aqui a
 * pergunta é outra: "isto merece o olho de alguém?". Um ato pode não gerar
 * tarefa e ainda assim precisar de atenção, e juntar as duas perguntas na mesma
 * tabela faria uma estragar a outra — afrouxar para sinalizar mais encheria a
 * agenda de tarefas falsas.
 *
 * MAS AS DUAS PERGUNTAS TÊM DE CONVERGIR, E NÃO CONVERGIAM.
 * Medição na produção em 25/08/2026, com 41 processos e 3.018 movimentos:
 *
 *   · a listagem mostrava 11 selos "Prazo sem tarefa";
 *   · NENHUM deles tinha menos de 15 dias; dez passavam de 30; o mais velho
 *     tinha 252 dias.
 *
 * O selo só mostrava o que a automação já havia decidido NÃO fazer — porque a
 * automação tem janela de 30 dias e o selo não tinha janela nenhuma. Um aviso
 * que só acende para coisa velha ensina a equipe a não olhar para ele, e aí ele
 * deixa de funcionar justamente no dia em que aponta algo real.
 *
 * As três correções que este arquivo carrega:
 *
 *  1. TODO ATO VENCE. Prazo vale 30 dias (a mesma janela da automação, para que
 *     selo e robô não possam divergir por construção); decisão vale 90. Passou,
 *     não é pendência — é história, e história se lê na linha do tempo.
 *
 *  2. O CÓDIGO 60 DEIXOU DE VALER SOZINHO. "Expedição de documento" era 509 dos
 *     1.131 atos críticos (45%) e gerou ZERO tarefas em toda a vida do sistema.
 *     O complemento explica: 397× "Outros documentos" e 90× "Certidão" — contra
 *     10 mandados e 1 ofício. Certidão não abre prazo. Agora o complemento
 *     decide, e o ato só conta quando nomeia um documento que de fato cita ou
 *     intima alguém.
 *
 *  3. A FAMÍLIA DO JULGAMENTO ESTAVA PELA METADE. 219 "Procedência" estava na
 *     tabela; 220 "Improcedência", 221 "Procedência em Parte" e os sete irmãos
 *     não estavam. Na produção: 6 processos com julgamento reconhecido contra
 *     21 com julgamento invisível. Ganhar em parte é o desfecho mais comum do
 *     acervo e era exatamente o que não acendia luz nenhuma.
 *
 * A LISTA É CURTA DE PROPÓSITO. Só entra código cujo nome foi CONFERIDO contra a
 * API pública do CNJ (`movimentos.codigo` → `movimentos.nome`), em processos
 * reais do TJPI e do TRT22. Palpite pela tabela publicada não entra: na
 * conferência, o código 581 — que eu esperava ser "Citação" — é "Documento", e
 * teria virado alarme falso em toda ficha.
 *
 * COMO ACRESCENTAR UM CÓDIGO
 * Consulte antes o nome real:
 *   POST api_publica_<tribunal>/_search
 *   {"size":50,"query":{"terms":{"movimentos.codigo":[<codigo>]}},
 *    "_source":["movimentos"]}
 * Se o código não aparecer na amostra, ele não é usado por aquele tribunal —
 * e não vale a pena adivinhar o significado.
 */

/** Grau de atenção que o ato exige. */
export type NivelAtencao = 'URGENTE' | 'PRAZO' | 'DECISAO' | 'ENCERRAMENTO';

export interface AtoCritico {
  nivel: NivelAtencao;
  /** Como o ato é chamado na ficha — o nome da TPU costuma ser burocrático. */
  rotulo: string;
}

/**
 * POR QUANTOS DIAS O ATO AINDA PEDE AÇÃO.
 *
 * Não é a validade jurídica do prazo — é por quanto tempo faz sentido a LISTA
 * cobrar providência. Depois disso o ato continua na linha do tempo, com o
 * mesmo rótulo; só para de ocupar o lugar de pendência.
 *
 *  · URGENTE (30) — tutela concedida há mais de um mês já produziu efeito ou já
 *    foi cassada; o que estiver pendente dela virou outra coisa.
 *  · PRAZO (30) — casado de propósito com a janela da automação de prazos
 *    (`dispararAutomacao`). Enquanto os dois números forem O MESMO, "ato dentro
 *    da janela sem tarefa" significa que o robô falhou — que é exatamente o que
 *    o selo deve denunciar. Se algum dia divergirem, o selo volta a mentir.
 *  · DECISAO (90) — sentença e acórdão sobrevivem ao prazo recursal: há o
 *    filiado para avisar, cálculo para conferir, execução para iniciar. Três
 *    meses é o limite em que ainda se pode chamar isso de pendência; passou
 *    disso, o problema não é a decisão, é o processo estar parado — e para isso
 *    existe o aviso de dormência, que é honesto sobre o que está dizendo.
 *  · ENCERRAMENTO (0) — nunca vira aviso. Baixa e trânsito em julgado não pedem
 *    providência e virariam alarme permanente em todo processo arquivado.
 */
export const VALIDADE_DIAS: Record<NivelAtencao, number> = {
  URGENTE: 30,
  PRAZO: 30,
  DECISAO: 90,
  ENCERRAMENTO: 0,
};

/**
 * O código 60 ("Expedição de documento") só conta quando o COMPLEMENTO nomeia
 * um documento que efetivamente alcança alguém.
 *
 * Conferido na produção — os sete valores que o TJPI e o TRT22 usam, com
 * frequência real: "Outros documentos" (397), "Certidão" (90), "Mandado" (10),
 * "Aviso de recebimento (AR)" (6), "Acórdão" (1), "Informações" (1),
 * "Ofício" (1). Os dois primeiros somam 96% e nenhum abre prazo para ninguém:
 * certidão é registro de cartório, e "outros documentos" não diz nada.
 *
 * Fora da lista, sem exceção: um complemento ausente NÃO passa. Antes o ato
 * valia por si e era o maior gerador de selo falso do sistema — na dúvida,
 * agora ele cala.
 */
const RE_DOCUMENTO_QUE_INTIMA =
  /(MANDADO|OFICIO|OFÍCIO|CARTA|CITAC|CITAÇ|INTIMAC|INTIMAÇ|AVISO DE RECEBIMENTO|\bAR\b|PRECATORIA|PRECATÓRIA|EDITAL|ALVARA|ALVARÁ)/i;

/** O ato 60 depende do complemento; os demais valem pelo código. */
const DEPENDE_DO_COMPLEMENTO = new Set([60]);

export const ATOS_CRITICOS: ReadonlyMap<number, AtoCritico> = new Map<number, AtoCritico>([
  // ---- Ação hoje: a tutela muda o que se pode fazer AGORA ----
  [785, { nivel: 'URGENTE', rotulo: 'Antecipação de tutela' }],

  // ---- Prazo correndo: o que não pode passar batido ----
  [92, { nivel: 'PRAZO', rotulo: 'Publicação' }],
  [1061, { nivel: 'PRAZO', rotulo: 'Disponibilização no Diário' }],
  // Condicionado ao complemento — ver RE_DOCUMENTO_QUE_INTIMA.
  [60, { nivel: 'PRAZO', rotulo: 'Documento expedido' }],

  // ---- Decisão a ler ----
  // A família inteira, e não só a procedência. Os rótulos fogem do nome da TPU
  // quando ele é ambíguo para quem não é do foro: "Não-Provimento" vira
  // "Recurso negado", que é o que a pessoa precisa entender em meio segundo.
  [219, { nivel: 'DECISAO', rotulo: 'Procedência' }],
  [220, { nivel: 'DECISAO', rotulo: 'Improcedência' }],
  [221, { nivel: 'DECISAO', rotulo: 'Procedência em parte' }],
  [237, { nivel: 'DECISAO', rotulo: 'Recurso provido' }],
  [238, { nivel: 'DECISAO', rotulo: 'Recurso provido em parte' }],
  [239, { nivel: 'DECISAO', rotulo: 'Recurso negado' }],
  [235, { nivel: 'DECISAO', rotulo: 'Recurso não conhecido' }],
  [236, { nivel: 'DECISAO', rotulo: 'Seguimento negado' }],
  [242, { nivel: 'DECISAO', rotulo: 'Conhecido em parte e negado' }],
  [198, { nivel: 'DECISAO', rotulo: 'Embargos acolhidos' }],
  [200, { nivel: 'DECISAO', rotulo: 'Embargos rejeitados' }],

  // ---- Fim de linha: muda o acompanhamento ----
  [22, { nivel: 'ENCERRAMENTO', rotulo: 'Baixa definitiva' }],
  [246, { nivel: 'ENCERRAMENTO', rotulo: 'Arquivamento definitivo' }],
  [848, { nivel: 'ENCERRAMENTO', rotulo: 'Trânsito em julgado' }],
  [893, { nivel: 'ENCERRAMENTO', rotulo: 'Desarquivamento' }],
  [196, { nivel: 'ENCERRAMENTO', rotulo: 'Execução extinta' }],
]);

/**
 * DELIBERADAMENTE FORA — documentado para ninguém acrescentar achando que foi
 * esquecimento:
 *
 *  1051 "Decurso de Prazo"  — é o FIM de um prazo, não a abertura de um.
 *                             Sinalizar pediria ação sobre algo que já acabou.
 *  11010 "Mero expediente"  — por definição não decide nada; entraria como
 *                             ruído em praticamente todo processo.
 *  581 "Documento"          — nome genérico demais para significar algo.
 *  51 "Conclusão"           — etapa interna do cartório.
 *  26 "Distribuição"        — acontece uma vez, no começo, e já é visível.
 *  970 "Audiência"          — a agenda já cuida, com regra própria e mais
 *                             cuidadosa (ver audiencia.util.ts).
 *  85 "Petição"             — 466 ocorrências na produção, o campeão isolado
 *                             entre os não classificados. É a peça de QUALQUER
 *                             um dos lados, inclusive a nossa: sinalizar
 *                             transformaria o próprio protocolo do escritório
 *                             em pendência a resolver.
 *  11384 "Liquidação iniciada" e 11385 "Execução iniciada" — importantes, e por
 *                             isso mesmo JÁ APARECEM: mudam a fase do processo
 *                             para "Execução" (fase.util.ts) e entram nos
 *                             marcos da ficha. Um terceiro aviso para o mesmo
 *                             fato seria repetição, não ênfase.
 */
export const CODIGOS_IGNORADOS_DE_PROPOSITO = [
  1051, 11010, 581, 51, 26, 970, 85, 11384, 11385,
] as const;

/**
 * O QUE O ATO É — sem juízo de validade nem de complemento.
 *
 * Use para ROTULAR histórico: a linha do tempo mostra "Procedência" num
 * julgamento de 2019 e está certa em mostrar. Para decidir se algo ainda pede
 * providência, use `atoAcionavel` — os dois nomes existem separados justamente
 * porque confundi-los foi o defeito que originou tudo isto.
 */
export function atoCritico(codigo: number | null | undefined): AtoCritico | null {
  return codigo == null ? null : (ATOS_CRITICOS.get(codigo) ?? null);
}

/** O que `atoAcionavel` precisa saber sobre a movimentação. */
export interface MovimentacaoAvaliavel {
  codigoMovimento: number | null;
  dataMovimento: Date;
  /** Complementos tabelados já achatados em texto (`montarDetalhe`). */
  detalhe?: string | null;
  /** Já virou atividade na agenda? Então não está solto. */
  compromissoId?: string | null;
  /** Uma pessoa disse "não é isso" ou "já resolvi por fora". */
  dispensadoEm?: Date | null;
}

/**
 * O ATO AINDA PEDE PROVIDÊNCIA?
 *
 * Uma única porta para todo aviso do sistema — lista, ficha e qualquer coisa
 * que venha depois. Ter uma só é o ponto: as regras estavam espalhadas em dois
 * lugares que discordavam, e o usuário via um aviso na lista que a ficha do
 * mesmo processo não mostrava.
 *
 * Devolve `null` quando o ato não conta, por qualquer um dos seis motivos: não
 * está no dicionário; é encerramento; o complemento o desqualifica; já virou
 * tarefa; foi dispensado por uma pessoa; ou venceu.
 */
export function atoAcionavel(
  mov: MovimentacaoAvaliavel,
  agora: Date = new Date(),
): AtoCritico | null {
  // Já tem dono (virou atividade) ou uma pessoa já disse que não é nada.
  if (mov.compromissoId || mov.dispensadoEm) return null;

  const ato = atoCritico(mov.codigoMovimento);
  if (!ato) return null;

  const validade = VALIDADE_DIAS[ato.nivel];
  if (validade <= 0) return null; // ENCERRAMENTO não vira aviso.

  // O complemento manda no código 60 — ver RE_DOCUMENTO_QUE_INTIMA.
  if (
    mov.codigoMovimento != null &&
    DEPENDE_DO_COMPLEMENTO.has(mov.codigoMovimento) &&
    !RE_DOCUMENTO_QUE_INTIMA.test(mov.detalhe ?? '')
  ) {
    return null;
  }

  const idadeDias = Math.floor((agora.getTime() - mov.dataMovimento.getTime()) / 86_400_000);
  // Data no futuro (fuso, typo do tribunal) não invalida — trata como de hoje.
  if (idadeDias > validade) return null;

  return ato;
}

/**
 * HÁ QUANTO TEMPO O PROCESSO NÃO SE MEXE — em dias, ou `null` se ainda é cedo.
 *
 * O QUE ISTO SUBSTITUI. Quando o selo de prazo ganhou validade, dez avisos
 * sumiram da lista de uma vez. Eles estavam MAL ROTULADOS, não eram mentira: um
 * processo cujo último ato foi uma publicação de 252 dias atrás merece o olho
 * de alguém — só que o problema dele não é "prazo sem tarefa", é estar parado.
 * Apagar o aviso errado sem colocar o certo no lugar seria perder informação
 * verdadeira, e o silêncio pareceria "está tudo bem".
 *
 * NOVENTA DIAS. Medido no acervo: 31 dos 38 processos vivos se moveram nos
 * últimos 90 dias, 6 não. Cortar em 30 acusaria quase metade da carteira (o
 * andamento normal de um processo tem meses de silêncio entre atos) e o aviso
 * viraria papel de parede; cortar em 180 deixaria passar meio ano de inércia.
 * Noventa dias é o ponto em que "ainda está tramitando" deixa de ser a
 * explicação mais provável.
 */
export const DIAS_ATE_DORMENTE = 90;

export function diasParado(
  ultimoMovimento: Date | null | undefined,
  agora: Date = new Date(),
): number | null {
  if (!ultimoMovimento) return null;
  const dias = Math.floor((agora.getTime() - ultimoMovimento.getTime()) / 86_400_000);
  return dias >= DIAS_ATE_DORMENTE ? dias : null;
}

/** Rótulo do nível, para a etiqueta na ficha. */
export const NIVEL_ATENCAO_LABEL: Record<NivelAtencao, string> = {
  URGENTE: 'Ação imediata',
  PRAZO: 'Prazo em curso',
  DECISAO: 'Decisão a analisar',
  ENCERRAMENTO: 'Mudança de fase',
};
