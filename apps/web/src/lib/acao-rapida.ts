/**
 * AÇÃO RÁPIDA DO PAINEL — qual botão cada linha oferece, e o que ele faz.
 *
 * O PAINEL ERA UMA SEGUNDA IMPLEMENTAÇÃO DE "CONCLUIR". Havia uma tabela escrita
 * à mão no front (`DESFECHO_RAPIDO`), tirada de 41 conclusões, com menos
 * informação que o modal da agenda. Ela produzia desfecho falso por falta de
 * opção: reunião sem deliberação só podia fechar "com encaminhamentos" (e criava
 * em silêncio uma tarefa obrigatória na agenda de alguém), prazo de análise só
 * podia virar "Peça protocolada", a tarefa "Cadastrar ação do Diário" fechava
 * como "Cumprida" sem ação nenhuma cadastrada.
 *
 * Agora o painel lê o CATÁLOGO da API (`GET /compromissos/desfechos/:tipo`), o
 * mesmo do modal, e UMA regra decide o botão:
 *
 *   o primário é a PRIMEIRA opção do catálogo que não tem `acao` nem `alerta`.
 *
 * O catálogo já declara que a primeira opção é a esperada. Se ela cria
 * seguimento, abre processo ou é um resultado ruim, não existe um toque honesto:
 * o botão vira "Concluir" e abre a folha com todas as opções.
 *
 * Tudo aqui é função pura, para o botão e a prévia lerem a mesma regra que o
 * teste confere com valores.
 */
import { temHoraMarcada, podeDesfazerConclusao, type DesfechoOpcao, type ConcluirResposta } from './agenda';

/** O fuso de Teresina, o mesmo de `data-br.util` na API. */
const FUSO_BR = 'America/Fortaleza';

/** Mínimo de caracteres da observação — o mesmo do modal da agenda. */
export const MINIMO_DA_OBSERVACAO = 3;

/**
 * A opção de um toque do tipo, ou `null` quando o tipo não tem uma honesta.
 *
 * Só a PRIMEIRA opção é candidata. Pular para a segunda "porque a primeira cria
 * seguimento" seria escolher pela pessoa o desfecho menos provável — é assim
 * que a reunião com encaminhamentos virava "sem deliberação" por conveniência.
 */
export function primarioDoCatalogo(opcoes: readonly DesfechoOpcao[] | null | undefined): DesfechoOpcao | null {
  const primeira = opcoes?.[0];
  if (!primeira) return null;
  if (primeira.acao || primeira.alerta) return null;
  return primeira;
}

/** Por que a linha abre a folha em vez de concluir no toque. */
export type MotivoDaFolha =
  /** O catálogo ainda não chegou (ou falhou): nunca se conclui às cegas. */
  | 'CARREGANDO'
  /** O tipo não tem primário (reunião, audiência, perícia…). */
  | 'SEM_PRIMARIO'
  /** O primário exige observação: a folha abre com ele marcado e o campo à vista. */
  | 'OBSERVACAO'
  /** A atividade é de outra pessoa: a folha abre com o aviso de quem é dona. */
  | 'DE_OUTRA_PESSOA';

export type BotaoDaLinha =
  /** Quem não edita a agenda não recebe botão — a API recusaria com 403. */
  | { tipo: 'NENHUM' }
  /** A tarefa do robô "Cadastrar ação do Diário": o gesto é cadastrar, não fechar. */
  | { tipo: 'CADASTRAR'; href: string }
  | { tipo: 'UM_TOQUE'; opcao: DesfechoOpcao }
  | { tipo: 'FOLHA'; opcao: DesfechoOpcao | null; motivo: MotivoDaFolha };

export function hrefDeCadastro(numeroCNJ: string): string {
  return `/processos?cadastrar=${encodeURIComponent(numeroCNJ)}`;
}

/**
 * O BOTÃO DA LINHA — a decisão inteira num lugar só.
 *
 * A ordem das perguntas é a ordem do risco:
 *  1. pode gravar na agenda? Senão, nada;
 *  2. é a tarefa de cadastro do robô? Então o primário é CADASTRAR (a tarefa
 *     fecha sozinha quando a ação entra no acervo). Sem permissão de cadastrar
 *     processo, não há um toque: fechar como "Cumprida" é o desfecho falso;
 *  3. o catálogo chegou? Sem ele, só a folha;
 *  4. há primário honesto? Senão, só a folha;
 *  5. é de outra pessoa? A folha, com o aviso — um toque a mais só neste caso;
 *  6. exige observação? A folha, já com a opção marcada;
 *  7. um toque.
 */
export function botaoDaLinha(p: {
  opcoes: readonly DesfechoOpcao[] | null | undefined;
  podeEditarAgenda: boolean;
  ehDeOutraPessoa: boolean;
  sugestaoDeCadastro?: { numeroCNJ: string } | null;
  podeCadastrarProcesso: boolean;
}): BotaoDaLinha {
  if (!p.podeEditarAgenda) return { tipo: 'NENHUM' };
  if (p.sugestaoDeCadastro?.numeroCNJ) {
    if (p.podeCadastrarProcesso) {
      return { tipo: 'CADASTRAR', href: hrefDeCadastro(p.sugestaoDeCadastro.numeroCNJ) };
    }
    return { tipo: 'FOLHA', opcao: null, motivo: 'SEM_PRIMARIO' };
  }
  if (!p.opcoes || p.opcoes.length === 0) return { tipo: 'FOLHA', opcao: null, motivo: 'CARREGANDO' };
  const primario = primarioDoCatalogo(p.opcoes);
  if (!primario) return { tipo: 'FOLHA', opcao: null, motivo: 'SEM_PRIMARIO' };
  if (p.ehDeOutraPessoa) return { tipo: 'FOLHA', opcao: primario, motivo: 'DE_OUTRA_PESSOA' };
  if (primario.exigeObs) return { tipo: 'FOLHA', opcao: primario, motivo: 'OBSERVACAO' };
  return { tipo: 'UM_TOQUE', opcao: primario };
}

/** O texto do botão: o desfecho que será gravado, nunca um "Concluir" que esconde qual. */
export function rotuloDoBotao(b: BotaoDaLinha): string {
  switch (b.tipo) {
    case 'NENHUM':
      return '';
    case 'CADASTRAR':
      return 'Cadastrar';
    case 'UM_TOQUE':
      return b.opcao.label;
    case 'FOLHA':
      return b.opcao?.label ?? 'Concluir';
  }
}

/** O dia de calendário de Teresina de um instante. */
function diaBR(instante: number): string {
  return new Date(instante - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * INICIAR (▷) NO PAINEL — só onde cronômetro significa alguma coisa.
 *
 * Medido em 12/09/2026: consulta passou por Iniciar em 18 de 22 conclusões e
 * reunião em 5 de 5; prazo em 4 de 12 e acompanhamento em 0 de 3. Cronometrar a
 * tarefa de quinta que vem não mede nada. Então: tipo com hora marcada, de HOJE
 * (dia de Teresina) e ainda pendente.
 */
export function podeIniciarNoPainel(
  c: { tipo: string; status: string; inicio: string },
  agora: number = Date.now(),
): boolean {
  if (c.status !== 'PENDENTE') return false;
  if (!temHoraMarcada(c.tipo)) return false;
  const inicio = new Date(c.inicio).getTime();
  if (!Number.isFinite(inicio)) return false;
  return diaBR(inicio) === diaBR(agora);
}

export function observacaoValida(texto: string | null | undefined): boolean {
  return (texto ?? '').trim().length >= MINIMO_DA_OBSERVACAO;
}

/** "seg., 15/09" no fuso de Teresina. */
function diaCurto(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: FUSO_BR });
}

/**
 * A PRÉVIA DO SEGUIMENTO — o que o desfecho vai criar, dito antes do clique.
 *
 * A data é a que o SERVIDOR calculou (`sugeridoPara`, dia útil às 9h de
 * Teresina). Somar `emDias` aqui seria uma segunda implementação da regra — e
 * errava no fim de semana, porque o servidor pula sábado e domingo. Sem a data
 * (API de antes, na janela de troca), a prévia não promete dia nenhum.
 */
export function previaDoSeguimento(
  opcao: Pick<DesfechoOpcao, 'acao' | 'seguimento'> | null | undefined,
  responsavel: { nome: string; nomeExibicao?: string | null } | null | undefined,
): string | null {
  if (!opcao || opcao.acao !== 'CRIAR_ATIVIDADE' || !opcao.seguimento) return null;
  const { titulo, sugeridoPara } = opcao.seguimento;
  const dia = sugeridoPara ? diaCurto(sugeridoPara) : null;
  const quem = responsavel ? responsavel.nomeExibicao || responsavel.nome.split(/\s+/)[0] : null;
  return [
    `Vai criar: «${titulo}»`,
    dia ? ` em ${dia}` : '',
    quem ? `, para ${quem}` : '',
    '.',
  ].join('');
}

/** A opção pede escolher processo — isso não cabe na folha, vai para o modal completo. */
export function pedeModalCompleto(opcao: Pick<DesfechoOpcao, 'acao'> | null | undefined): boolean {
  return opcao?.acao === 'VINCULAR_PROCESSO' || opcao?.acao === 'CRIAR_PROCESSO';
}

/**
 * O AVISO DEPOIS DE CONCLUIR — e se ele oferece "Desfazer".
 *
 * O toast dizia só "Concluída." mesmo quando a API tinha acabado de criar uma
 * tarefa na agenda de alguém. Agora ele diz o que foi gravado e o que nasceu
 * junto. Desfazer só aparece quando a conclusão não criou nada (a regra é a da
 * API, espelhada em `podeDesfazerConclusao`): desfazer um seguimento que já
 * está na agenda de outra pessoa não é um toque, é uma conversa.
 */
export function avisoDeConcluida(
  resposta: Pick<ConcluirResposta, 'seguimentoCriado' | 'preProcessualCriado' | 'desfecho'> & {
    concluidoEm?: string | null;
  },
  rotulo: string,
  agora: number = Date.now(),
): { texto: string; desfazer: boolean } {
  if (resposta.preProcessualCriado) {
    return { texto: `${rotulo}. O caso foi aberto em fase pré-processual.`, desfazer: false };
  }
  if (resposta.seguimentoCriado) {
    const dia = diaCurto(resposta.seguimentoCriado.inicio);
    return {
      texto: `${rotulo}. Tarefa criada: «${resposta.seguimentoCriado.titulo}»${dia ? ` para ${dia}` : ''}.`,
      desfazer: false,
    };
  }
  return { texto: rotulo, desfazer: podeDesfazerConclusao(resposta, agora) };
}

/** Quanto tempo o "Desfazer" fica na tela (D6). A API aceita até 120 s. */
export const DURACAO_DO_DESFAZER_MS = 8_000;
