import type { DesafioRecadastramento } from '@prisma/client';
import { FUSO_BR } from '../processos/utils/data-br.util';

/**
 * MANDAR O LINK SEM MATAR O QUE JÁ FOI MANDADO.
 *
 * O PROBLEMA (auditoria de 12/09/2026). O banco guarda só o hash do token, então
 * o link aparecia uma única vez, na geração. Um botão "Enviar" ingênuo teria de
 * gerar a cada clique — e gerar revoga o anterior. O filiado abriria o link que
 * recebeu no WhatsApp e leria "Este link foi cancelado". Com duas pessoas do
 * balcão mandando para o mesmo filiado, a segunda cancelaria a primeira em
 * silêncio.
 *
 * A SAÍDA, sem guardar segredo novo: o token dos links novos é derivado do id
 * do link por HMAC (ver `LinkRecadastramentoService.tokenDoLink`). Para
 * reapresentar, recalcula-se o token e confere-se contra o hash gravado. Link
 * antigo (token aleatório) não bate, e aí se gera um novo — transição única,
 * porque eles vencem em 24h.
 *
 * Tudo o que DECIDE mora aqui, puro, para ser testado com valores.
 */

export const MEIOS_DE_ENVIO = ['WHATSAPP', 'COMPARTILHAR', 'COPIAR', 'EMAIL'] as const;
export type MeioDeEnvio = (typeof MEIOS_DE_ENVIO)[number];

/**
 * LINK QUASE VENCIDO NÃO SE REAPROVEITA.
 *
 * Mandar pelo WhatsApp um link que morre em 20 minutos é mandar um link que o
 * filiado vai abrir já cancelado. Com menos de 2 horas de vida, gera-se outro
 * (que revoga este — que morreria de qualquer jeito).
 */
export const VIDA_MINIMA_PARA_REAPROVEITAR_MS = 2 * 3_600_000;

/**
 * TRÊS TOQUES NO MESMO BOTÃO NÃO SÃO TRÊS ATOS.
 *
 * O mesmo (link, meio, pessoa) dentro de 10 minutos não gera linha nova na
 * auditoria: quem copiou a mensagem duas vezes porque o primeiro colar falhou
 * não preparou dois envios.
 */
export const JANELA_SEM_REPETIR_REGISTRO_MS = 10 * 60_000;

export interface LinkCandidato {
  id: string;
  tokenHash: string;
  /** O desafio gravado quando o link nasceu. */
  desafio: DesafioRecadastramento;
  expiraEm: Date;
  usadoEm: Date | null;
  revogadoEm: Date | null;
  createdAt: Date;
}

export type PlanoDeEnvio =
  | { acao: 'REAPROVEITAR'; link: LinkCandidato }
  | { acao: 'GERAR'; motivo: 'SEM_LINK_ATIVO' | 'LINK_ANTIGO' | 'DESAFIO_MUDOU' | 'PERTO_DE_VENCER' };

/**
 * REAPROVEITAR o link vivo mais recente, se o token dele puder ser reapresentado,
 * pedir o mesmo desafio que o cadastro pede hoje e ainda tiver vida útil; GERAR
 * nos demais casos.
 *
 * `hashDoTokenDerivado(id)` é o sha256 do token que o HMAC daria para aquele id.
 * Vem de fora para que esta função não precise conhecer a chave.
 *
 * `desafioAtual` é o que `definirDesafio` dá para o cadastro AGORA.
 */
export function planejarEnvio(entrada: {
  links: LinkCandidato[];
  agora: Date;
  hashDoTokenDerivado: (linkId: string) => string;
  desafioAtual: DesafioRecadastramento;
}): PlanoDeEnvio {
  const { links, agora, hashDoTokenDerivado, desafioAtual } = entrada;
  const vivo = links
    .filter((l) => !l.usadoEm && !l.revogadoEm && l.expiraEm.getTime() > agora.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (!vivo) return { acao: 'GERAR', motivo: 'SEM_LINK_ATIVO' };
  // Link de antes da derivação: o token era aleatório e não existe mais em lugar nenhum.
  if (hashDoTokenDerivado(vivo.id) !== vivo.tokenHash) return { acao: 'GERAR', motivo: 'LINK_ANTIGO' };
  /*
    O DESAFIO É O DE HOJE, NÃO O DA GERAÇÃO (13/09/2026).

    O desafio fica gravado no link. Um cadastro sem CPF recebe link NENHUM; a
    equipe completa CPF e nascimento e toca "WhatsApp" de novo — e o reaproveitado
    seguiria abrindo sem pedir nada por até 22h. Ao contrário também: link
    CPF_NASCIMENTO de um cadastro cujo nascimento foi apagado nunca confere, e
    só serviria para queimar em 5 tentativas. Desafio diferente, link novo.
  */
  if (vivo.desafio !== desafioAtual) return { acao: 'GERAR', motivo: 'DESAFIO_MUDOU' };
  if (vivo.expiraEm.getTime() - agora.getTime() < VIDA_MINIMA_PARA_REAPROVEITAR_MS) {
    return { acao: 'GERAR', motivo: 'PERTO_DE_VENCER' };
  }
  return { acao: 'REAPROVEITAR', link: vivo };
}

/** Grava a linha de "preparado para envio"? Não, se a mesma pessoa já gravou há menos de 10 min. */
export function deveRegistrarPreparo(ultimoRegistroEm: Date | null | undefined, agora: Date): boolean {
  if (!ultimoRegistroEm) return true;
  return agora.getTime() - ultimoRegistroEm.getTime() >= JANELA_SEM_REPETIR_REGISTRO_MS;
}

/** E-mail com cara de e-mail (mesma régua da consulta de medição), aparado; senão `null`. */
export function emailUtilizavel(email: string | null | undefined): string | null {
  const e = (email ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** O primeiro nome, para a mensagem ("Olá, Maria"). */
export function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? '';
}

const COMO_SAIU: Record<MeioDeEnvio, string> = {
  WHATSAPP: 'por WhatsApp',
  COMPARTILHAR: 'pelo compartilhamento do aparelho',
  COPIAR: 'copiando a mensagem',
  EMAIL: 'por e-mail',
};

/** "13/09 às 15h20", no fuso de Teresina — o contêiner roda em UTC. */
export function validadeCurta(d: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_BR,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')} às ${p('hour')}h${p('minute')}`;
}

/**
 * A FRASE DA AUDITORIA. Diz PREPARADO, nunca "enviado": o wa.me só abre a
 * conversa no aparelho de quem clicou, e o sistema não sabe se a mensagem saiu.
 */
export function fraseDoPreparo(entrada: {
  nome: string;
  meio: MeioDeEnvio;
  reaproveitado: boolean;
  expiraEm: Date;
}): string {
  const origem = entrada.reaproveitado ? 'o mesmo link que já estava ativo' : 'link novo';
  return (
    `Link de recadastramento de ${entrada.nome} preparado para envio ${COMO_SAIU[entrada.meio]} ` +
    `(${origem}; vale até ${validadeCurta(entrada.expiraEm)})`
  );
}
