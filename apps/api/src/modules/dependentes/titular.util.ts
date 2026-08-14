import { SituacaoFiliado, StatusColaborador } from '@prisma/client';

/**
 * O TITULAR DE UM DEPENDENTE — filiado ou colaborador — visto por quem só
 * precisa saber se ele autoriza a entrada.
 *
 * POR QUE ESTA FUNÇÃO EXISTE. O dependente passou a ter dois tipos de titular
 * (ver o model `Dependente`), e três lugares perguntam a mesma coisa: a
 * portaria (`AcessosService`), o check-in de eventos (`PresencasService`) e a
 * listagem da ficha. Sem um lugar só, o primeiro ajuste feito num deles — um
 * status novo, uma regra de contrato vencido — não chegaria aos outros dois, e
 * a portaria e a assembleia passariam a discordar sobre a mesma pessoa.
 *
 * A REGRA DO COLABORADOR É A DELE, não uma cópia da do filiado: além do status,
 * vale o vencimento do contrato — o mesmo que já barra o próprio colaborador em
 * `doColaborador`. Terceirizado com contrato vencido não entra, e a família
 * dele também não.
 */

const STATUS_COLABORADOR: Record<StatusColaborador, string> = {
  ATIVO: 'ativo',
  INATIVO: 'inativo',
  AFASTADO: 'afastado',
  FERIAS: 'de férias',
  DESLIGADO: 'desligado',
};

export interface TitularParaLiberacao {
  filiado?: { situacao: SituacaoFiliado } | null;
  colaborador?: { status: StatusColaborador; vencimentoContrato: Date | null } | null;
}

export interface SituacaoDoTitular {
  /** O titular autoriza a entrada de quem depende dele. */
  liberado: boolean;
  /** Por que NÃO autoriza. Nulo quando autoriza — o chamador compõe a mensagem. */
  motivo: string | null;
}

export function situacaoDoTitular(
  d: TitularParaLiberacao,
  agora = new Date(),
): SituacaoDoTitular {
  if (d.filiado) {
    const ativo = d.filiado.situacao === SituacaoFiliado.ATIVO;
    return { liberado: ativo, motivo: ativo ? null : 'Filiado responsável inativo' };
  }

  if (d.colaborador) {
    const c = d.colaborador;
    if (c.status !== StatusColaborador.ATIVO)
      return { liberado: false, motivo: `Colaborador responsável ${STATUS_COLABORADOR[c.status]}` };
    if (c.vencimentoContrato && c.vencimentoContrato < agora)
      return { liberado: false, motivo: 'Contrato do colaborador responsável fora de vigência' };
    return { liberado: true, motivo: null };
  }

  /**
   * SEM TITULAR — não deveria acontecer: o CHECK `dependentes_um_titular` no
   * banco recusa a linha órfã. Fica aqui porque o tipo do Prisma permite os dois
   * nulos, e "liberado por omissão" seria o pior default possível na portaria.
   */
  return { liberado: false, motivo: 'Dependente sem titular no cadastro' };
}

/** Como o titular aparece na tela de conferência da portaria. */
export function rotuloDoTitular(d: {
  filiado?: { nomeCompleto: string } | null;
  colaborador?: { nome: string } | null;
}): string | null {
  if (d.filiado) return d.filiado.nomeCompleto;
  if (d.colaborador) return d.colaborador.nome;
  return null;
}
