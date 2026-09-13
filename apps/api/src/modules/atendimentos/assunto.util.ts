import { BadRequestException } from '@nestjs/common';
import { AssuntoAtendimento, CanalAtendimento } from '@prisma/client';

/**
 * RÓTULOS DO ATENDIMENTO NO SERVIDOR — para o que o servidor escreve.
 *
 * A tela tem os seus (`CANAL_LABEL`, `ASSUNTO_LABEL` no web). Estes existem
 * porque há texto que nasce aqui e fica gravado ou é mostrado cru: a frase da
 * auditoria e a linha do tempo do dossiê, que dizia "Atendimento #12
 * (WHATSAPP)" com o valor do enum.
 *
 * `Record<Enum, string>` de propósito: um valor novo no enum quebra a
 * compilação aqui, em vez de sair "(VIDEO)" na tela de alguém.
 */
export const ROTULO_CANAL: Record<CanalAtendimento, string> = {
  PRESENCIAL: 'Presencial',
  WHATSAPP: 'WhatsApp',
  TELEFONE: 'Telefone',
  EMAIL: 'E-mail',
  SITE: 'Site',
};

export const ROTULO_ASSUNTO: Record<AssuntoAtendimento, string> = {
  ANDAMENTO_PROCESSO: 'Andamento de processo',
  DUVIDA_TRABALHISTA: 'Dúvida trabalhista',
  REMUNERACAO: 'Remuneração',
  PROGRESSAO_NIVEL: 'Progressão de nível',
  ADICIONAIS: 'Adicionais',
  JORNADA_ESCALA: 'Jornada e escala',
  ASSEDIO_RETALIACAO: 'Assédio e retaliação',
  CONTRATO_VINCULO: 'Contrato e vínculo',
  FERIAS_LICENCAS: 'Férias e licenças',
  BENEFICIOS_SINDICAIS: 'Benefícios sindicais',
  FINANCEIRO_SINDICAL: 'Financeiro sindical',
  OUTRO: 'Outro',
};

export const ASSUNTO_OUTRO_MIN = 3;
export const ASSUNTO_OUTRO_MAX = 80;

export const MENSAGEM_ASSUNTO_OUTRO =
  'Diga em poucas palavras qual é o assunto (de 3 a 80 caracteres).';

/**
 * O PAR (assunto, "qual assunto?") QUE PODE IR AO BANCO — uma regra só, usada
 * na criação e na reclassificação.
 *
 * "Outro" sozinho não diz nada a quem lê o relatório: a diretoria via "Outro: 9"
 * e ninguém sabia se valia criar "Aposentadoria". Então Outro exige o texto
 * curto. E o texto só existe quando o assunto é Outro: um Outro reclassificado
 * como Remuneração não pode carregar "aposentadoria" escondido na coluna, que
 * os Relatórios leriam como se ainda fosse Outro.
 *
 * O teto de 80 é também o do banco (`VARCHAR(80)`): passar dali daria erro do
 * Postgres em vez desta frase.
 */
export function assuntoGravavel(
  assunto: AssuntoAtendimento | null | undefined,
  assuntoOutro: string | null | undefined,
): { assunto: AssuntoAtendimento | null; assuntoOutro: string | null } {
  if (!assunto) return { assunto: null, assuntoOutro: null };
  if (assunto !== AssuntoAtendimento.OUTRO) return { assunto, assuntoOutro: null };

  // Espaços repetidos colapsados: "  plano   de saúde " e "plano de saúde" são
  // o mesmo assunto para quem agrupa depois.
  const texto = (assuntoOutro ?? '').replace(/\s+/g, ' ').trim();
  if (texto.length < ASSUNTO_OUTRO_MIN || texto.length > ASSUNTO_OUTRO_MAX) {
    throw new BadRequestException(MENSAGEM_ASSUNTO_OUTRO);
  }
  return { assunto, assuntoOutro: texto };
}

/** "Remuneração", "Outro: aposentadoria" ou "sem assunto" — para a frase da auditoria. */
export function descreverAssunto(
  assunto: AssuntoAtendimento | null | undefined,
  assuntoOutro?: string | null,
): string {
  if (!assunto) return 'sem assunto';
  if (assunto === AssuntoAtendimento.OUTRO && assuntoOutro) return `Outro: ${assuntoOutro}`;
  return ROTULO_ASSUNTO[assunto];
}
