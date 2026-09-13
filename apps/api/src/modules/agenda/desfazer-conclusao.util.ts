import { StatusCompromisso } from '@prisma/client';

/**
 * DESFAZER A CONCLUSÃO — por dois minutos, só para quem concluiu, e só quando
 * não há efeito colateral que desfazer não saiba desfazer.
 *
 * O painel passou a concluir em um toque (D1). Um toque errado exigia abrir a
 * agenda, reabrir e concluir de novo — e reabrir não tira o andamento que a
 * conclusão escreveu no processo. O toast "Peça protocolada · Desfazer" dura 8
 * segundos na tela; o servidor aceita até 120, para cobrir rede lenta e o
 * celular que dormiu no meio.
 *
 * O QUE NÃO SE DESFAZ AQUI, e por quê:
 *  · seguimento criado — já é uma atividade na agenda de alguém, talvez aberta;
 *  · caso pré-processual aberto — desfazer não apaga processo (só Administrador
 *    apaga, e com os olhos no que apaga);
 *  · vínculo com processo — trocou o processo da atividade;
 *  · providência anterior substituída — reabriria uma tarefa que outra pessoa
 *    pode já ter visto cancelada.
 * Para esses, o caminho continua sendo Reabrir, que é explícito.
 */

export const JANELA_DO_DESFAZER_MS = 120_000;

/** O que a conclusão anotou no histórico (`compromissos_historico.metadata`). */
export interface RegistroDaConclusao {
  metadata: {
    /** O `concluidoEm` que ESTA conclusão gravou, em ISO — é o que prova que o registro é dela. */
    concluidoEm?: string | null;
    de?: string | null;
    seguimentoCriado?: string | null;
    preProcessualCriado?: string | null;
    processoAntes?: string | null;
    processoDepois?: string | null;
    substituidas?: string[] | null;
    andamentoId?: string | null;
  } | null;
}

/**
 * O andamento que a conclusão escreveu no processo, lido do histórico dela.
 * Conclusão anterior a 13/09/2026 não anotava — devolve nulo, e a próxima
 * conclusão cria um novo, como sempre fez.
 */
export function andamentoDaConclusao(registro: RegistroDaConclusao | null): string | null {
  const id = registro?.metadata?.andamentoId;
  return typeof id === 'string' && id ? id : null;
}

export type DecisaoDoDesfazer =
  | { ok: true; voltarPara: StatusCompromisso; andamentoId: string | null }
  | { ok: false; motivo: string };

const REABRA = 'Para voltar atrás, reabra a atividade.';

export function podeDesfazerConclusao(
  atividade: { status: StatusCompromisso; concluidoEm: Date | null; concluidoPor: string | null },
  conclusao: RegistroDaConclusao | null,
  usuarioId: string | undefined,
  agora: Date = new Date(),
): DecisaoDoDesfazer {
  if (atividade.status !== StatusCompromisso.CONCLUIDO) {
    return { ok: false, motivo: 'Esta atividade não está concluída.' };
  }
  if (!usuarioId || atividade.concluidoPor !== usuarioId) {
    return { ok: false, motivo: `Só quem concluiu pode desfazer. ${REABRA}` };
  }
  if (!atividade.concluidoEm || agora.getTime() - atividade.concluidoEm.getTime() > JANELA_DO_DESFAZER_MS) {
    return { ok: false, motivo: `O tempo para desfazer acabou (2 minutos). ${REABRA}` };
  }
  /*
    O registro tem de ser DESTA conclusão. Se o histórico dela falhou (ele
    nunca derruba a operação), o último CONCLUIDO seria de uma conclusão
    anterior — e os efeitos dela não são os desta. A prova é o carimbo gravado
    nos dois lugares, e não o relógio: o `created_at` do histórico sai do
    relógio do banco, o `concluido_em` do relógio do contêiner.
  */
  if (!conclusao?.metadata || conclusao.metadata.concluidoEm !== atividade.concluidoEm.toISOString()) {
    return { ok: false, motivo: `Não achei o registro desta conclusão. ${REABRA}` };
  }
  const m = conclusao.metadata;
  if (m.seguimentoCriado) {
    return { ok: false, motivo: `Esta conclusão já agendou uma atividade de seguimento. ${REABRA}` };
  }
  if (m.preProcessualCriado) {
    return { ok: false, motivo: `Esta conclusão abriu um caso pré-processual, e desfazer não apaga processo. ${REABRA}` };
  }
  if ((m.processoAntes ?? null) !== (m.processoDepois ?? null)) {
    return { ok: false, motivo: `Esta conclusão vinculou a atividade a um processo. ${REABRA}` };
  }
  if (m.substituidas?.length) {
    return { ok: false, motivo: `Esta conclusão substituiu uma providência anterior. ${REABRA}` };
  }
  const voltarPara =
    m.de === StatusCompromisso.EM_ANDAMENTO ? StatusCompromisso.EM_ANDAMENTO : StatusCompromisso.PENDENTE;
  return { ok: true, voltarPara, andamentoId: m.andamentoId ?? null };
}
