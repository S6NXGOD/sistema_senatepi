import { NpuUtils } from './npu.util';
import {
  diaDeCalendarioBR, noveDaManhaDoDiaDeCalendario, proximoHorarioUtilBR,
  proximoHorarioUtilDoDiaDeCalendario, somarDiasUteisEmCalendario,
} from './data-br.util';
import { PROVIDENCIAS, diasParaLembrete, type Providencia } from './providencia.util';

/**
 * O QUE A PUBLICAÇÃO VAI VIRAR — calculado uma vez, lido por dois.
 *
 * POR QUE ESTA FUNÇÃO EXISTE
 * ---------------------------------------------------------------------------
 * A tela do painel passou a oferecer "Criar tarefa" direto da publicação, e o
 * pedido veio junto: "não tenho nenhum preview de como ela vai ficar". Tem
 * razão — criar às cegas uma tarefa com data, urgência e dono que a pessoa não
 * viu é pedir que ela confie e depois confira.
 *
 * Só que a prévia não pode ser uma SEGUNDA implementação da regra. Esta base já
 * pagou caro por regra duplicada: três leitores do campo `polo` com três
 * critérios, `tipoAcao` derivado num caminho e não no irmão, a consulta do
 * Diário com uma lista de status escrita à mão ao lado da canônica. Uma prévia
 * que calcula "quase igual" é pior que nenhuma — ela promete e erra.
 *
 * Então o cálculo saiu de dentro de `criarAtividade` e virou isto: uma função
 * PURA, sem banco e sem relógio próprio (`agora` entra por parâmetro, que é o
 * que a torna testável). A criação monta o registro a partir daqui; a prévia
 * mostra exatamente o mesmo objeto. Se a regra mudar, muda para os dois.
 *
 * O QUE **NÃO** ESTÁ AQUI: quem responde. O dono depende do banco (a secretaria
 * de plantão, o `principal` do processo) e por isso continua no serviço — mas
 * a prévia o recebe pronto e o mostra pelo nome, que é o que interessa a quem
 * vai clicar.
 */

/** Publicação, reduzida ao que decide a tarefa. */
export interface PublicacaoParaPlano {
  texto?: string | null;
  link?: string | null;
  nomeOrgao: string | null;
  /**
   * UM DIA DE CALENDÁRIO — meia-noite UTC, como o Postgres materializa `date`.
   *
   * A publicação do DJEN (`@db.Date`) já chega assim. Quem trouxer um INSTANTE
   * — `movimentacoes.dataMovimento` é `DateTime` e carrega a hora do ato —
   * converte antes com `diaDeCalendarioBR`. Não é preciosismo: 5.388 das 20.569
   * movimentações da produção (26%) foram praticadas entre 21h e 23h59 de
   * Teresina, ou seja, já no dia seguinte em UTC. Sem a conversão, a contagem
   * de dias úteis começa do dia errado em uma a cada quatro.
   */
  dataDisponibilizacao: Date;
  providencia: Providencia;
  prazoMencionadoDias: number | null;
}

export interface PlanoDaAtividade {
  titulo: string;
  /** Slug do tipo de evento (AUDIENCIA, PRAZO, CONTATO…). */
  tipo: string;
  /** Quando a tarefa cai na agenda — 9h de Teresina, nunca no passado. */
  inicio: Date;
  descricao: string;
  urgente: boolean;
  /** Nunca vazio quando `urgente` — a marca sem motivo é a pior da tela. */
  urgenteMotivo: string | null;
  /** O prazo calculado já venceu quando a publicação chegou? */
  atrasado: boolean;
  /** Idade da publicação em dias corridos. */
  idadeDias: number;
  /** Dias úteis que a providência pede, já considerando o prazo do texto. */
  diasDoLembrete: number;
}

/**
 * Monta o plano. `agora` e `diasAtoRecente` entram de fora para o teste não
 * depender do relógio nem importar o serviço que define a régua.
 */
export function planejarAtividade(
  c: PublicacaoParaPlano,
  numeroCNJ: string | null,
  agora: Date,
  diasAtoRecente: number,
): PlanoDaAtividade {
  const spec = PROVIDENCIAS[c.providencia as Exclude<Providencia, 'NENHUMA'>];
  const dias = diasParaLembrete(spec, c.prazoMencionadoDias);

  /*
    `dataDisponibilizacao` é `@db.Date`: JÁ é um dia de calendário à meia-noite
    UTC, que é exatamente o que `somarDiasUteisEmCalendario` espera. NÃO passe
    por `diaDeCalendarioBR` aqui — isso trataria a meia-noite UTC como instante
    e voltaria um dia, que é o mesmo erro do cartão da escala.
  */
  const calculado = somarDiasUteisEmCalendario(c.dataDisponibilizacao, dias);
  /*
    O DIA CALCULADO VIRA INSTANTE AQUI, E SÓ AQUI.

    `calculado` é um DIA (meia-noite UTC). Entregá-lo a `proximoHorarioUtilBR`,
    que espera um instante, voltava 24 horas — meia-noite UTC do dia 9 é 21h do
    dia 8 em Teresina. Toda atividade do Diário nascia um dia antes do prazo que
    a própria descrição anunciava, e a régua de 5 dias úteis entregava 4.

    A tradução passou a ter nome (`...DoDiaDeCalendario`) justamente para não
    depender de ninguém lembrar dela na próxima vez.
  */
  const alvo = noveDaManhaDoDiaDeCalendario(calculado);
  const atrasado = alvo < agora;
  /*
    `proximoHorarioUtilDoDiaDeCalendario` faz duas coisas que fixar a hora à mão
    não fazia: crava as nove da manhã de TERESINA (e não do fuso do contêiner) e
    garante que o horário seja futuro.

    (A chamada antiga não é citada aqui de propósito: existe um teste que proíbe
    o nome dela no fonte, e ele não distingue código de explicação.)
  */
  const inicio = atrasado
    ? proximoHorarioUtilBR(agora, agora)
    : proximoHorarioUtilDoDiaDeCalendario(calculado, agora);

  /*
    URGÊNCIA EXIGE PUBLICAÇÃO RECENTE — e a trava veio de uma medição.

    Na primeira ingestão de um processo o DJEN entrega o histórico inteiro dele.
    Em 03/09/2026 quatro processos trouxeram 136 publicações de uma vez, e SETE
    viraram atividade urgente com o mesmo motivo e o mesmo dia. Sete urgências
    simultâneas não são sete prioridades — são zero.

    Quinze dias é a régua do prazo recursal (art. 1.003 do CPC): passado ele, o
    que havia a perder já se perdeu. A tarefa continua existindo, sem gritar.
  */
  /*
    IDADE É DIFERENÇA DE DIAS, NÃO DE HORAS. Contar `(agora − dia) / 24h` fazia
    a idade virar às 21h de Teresina, junto com o dia em UTC: o ato de hoje
    passava a ter "1 dia" às nove da noite, e na fronteira dos 15 dias isso
    ligava e desligava a urgência conforme a hora em que a varredura rodasse.
  */
  const idadeDias = Math.round(
    (diaDeCalendarioBR(agora).getTime() - c.dataDisponibilizacao.getTime()) / 86_400_000,
  );
  const recente = idadeDias <= diasAtoRecente;
  const prazoCurto = (c.prazoMencionadoDias ?? 99) <= 5;
  const urgente = recente && (atrasado || prazoCurto);

  /*
    A DESCRIÇÃO DIZ O QUE FAZER. O TEOR MORA NO BLOCO PRÓPRIO.

    Ela já embutiu o texto integral da publicação — era a saída quando a gaveta
    não tinha onde mostrá-lo. Agora que tem, embutir duplica: o mesmo teor na
    descrição E no bloco, e com duas publicações irmãs, três vezes.
  */
  /*
    A DATA NÃO É O VENCIMENTO, E A TAREFA PRECISA DIZER ISSO (18/09/2026).

    A pergunta veio do dono olhando a agenda: "seg., 21/09 09:00 Elaborar
    manifestação — está correto ser assim no futuro? Ela é criada na data
    limite?". Não é: 21/09 são cinco dias úteis depois da publicação de 14/09, e
    o ato falava em prazo de 8 dias. Só que a tarefa não dizia NADA disso — nem
    o prazo que o ato menciona, nem que aquela data é o dia de sentar.

    Quem abre a agenda vê uma data e um título. Sem esta linha, a única leitura
    possível é "o prazo é dia 21" — e é exatamente a leitura errada, porque o
    sistema NÃO calcula vencimento (a contagem depende de dia útil forense,
    feriado da comarca, forma de intimação e suspensão).

    Só entra quando o ato menciona prazo: sem prazo escrito não há ambiguidade a
    desfazer, e uma linha em toda tarefa vira ruído que se aprende a pular.
  */
  const linhaDoPrazo =
    c.prazoMencionadoDias != null
      ? `\nO ato menciona prazo de ${c.prazoMencionadoDias} dia(s). A data acima é o dia ` +
        'reservado para fazer, com folga — a contagem do prazo processual é do advogado.'
      : '';

  const descricao =
    `Processo ${NpuUtils.formatar(numeroCNJ) || '(rascunho)'}` +
    `${c.nomeOrgao ? ` — ${c.nomeOrgao}` : ''}.` +
    linhaDoPrazo +
    (atrasado
      ? `\n⚠ Publicação de ${idadeDias} dia(s) atrás — o prazo calculado já venceu. ` +
        `${recente ? 'Confira com urgência.' : 'Confira sem alarme o que ficou pendente.'}`
      : '');

  return {
    titulo: spec.titulo,
    tipo: spec.tipo,
    inicio,
    descricao,
    urgente,
    urgenteMotivo: urgente
      ? atrasado
        ? `Publicação de ${idadeDias} dia(s) atrás e o prazo já venceu — confira o que ficou pendente.`
        : `A publicação menciona prazo de ${c.prazoMencionadoDias} dia(s).`
      : null,
    atrasado,
    idadeDias,
    diasDoLembrete: dias,
  };
}
