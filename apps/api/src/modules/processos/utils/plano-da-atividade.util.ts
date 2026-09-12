import { NpuUtils } from './npu.util';
import { proximoHorarioUtilBR, somarDiasUteisEmCalendario } from './data-br.util';
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
  /** `@db.Date` — já é um dia de calendário à meia-noite UTC. */
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
  const atrasado = calculado < agora;
  /*
    `proximoHorarioUtilBR` faz duas coisas que fixar a hora à mão não fazia:
    crava as nove da manhã de TERESINA (e não do fuso do contêiner) e garante
    que o horário seja futuro.

    (A chamada antiga não é citada aqui de propósito: existe um teste que proíbe
    o nome dela no fonte, e ele não distingue código de explicação.)
  */
  const inicio = proximoHorarioUtilBR(atrasado ? agora : calculado);

  /*
    URGÊNCIA EXIGE PUBLICAÇÃO RECENTE — e a trava veio de uma medição.

    Na primeira ingestão de um processo o DJEN entrega o histórico inteiro dele.
    Em 03/09/2026 quatro processos trouxeram 136 publicações de uma vez, e SETE
    viraram atividade urgente com o mesmo motivo e o mesmo dia. Sete urgências
    simultâneas não são sete prioridades — são zero.

    Quinze dias é a régua do prazo recursal (art. 1.003 do CPC): passado ele, o
    que havia a perder já se perdeu. A tarefa continua existindo, sem gritar.
  */
  const idadeDias = Math.floor((agora.getTime() - c.dataDisponibilizacao.getTime()) / 86_400_000);
  const recente = idadeDias <= diasAtoRecente;
  const prazoCurto = (c.prazoMencionadoDias ?? 99) <= 5;
  const urgente = recente && (atrasado || prazoCurto);

  /*
    A DESCRIÇÃO DIZ O QUE FAZER. O TEOR MORA NO BLOCO PRÓPRIO.

    Ela já embutiu o texto integral da publicação — era a saída quando a gaveta
    não tinha onde mostrá-lo. Agora que tem, embutir duplica: o mesmo teor na
    descrição E no bloco, e com duas publicações irmãs, três vezes.
  */
  const descricao =
    `Processo ${NpuUtils.formatar(numeroCNJ) || '(rascunho)'}` +
    `${c.nomeOrgao ? ` — ${c.nomeOrgao}` : ''}.` +
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
