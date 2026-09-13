/**
 * O LINK DA CHAMADA — espelho de `apps/api/src/common/link-reuniao.util.ts`.
 *
 * O servidor é quem decide o que grava; este espelho existe para o formulário
 * dizer "esse link não serve" ENQUANTO a pessoa cola, e não depois de salvar.
 * Os dois specs usam a MESMA tabela de casos (`link-reuniao.spec.ts` aqui):
 * se um lado mudar a regra, o outro reprova.
 *
 * A regra, em uma linha: extrai a primeira URL do texto colado (o convite do
 * Meet vem como "Participe: meet.google.com/abc-defg-hij"), põe https:// quando
 * falta, recusa tudo que não é https e o que passa de 500 caracteres, e dá nome
 * ao provedor (Google Meet, Zoom, Teams, Jitsi). Host desconhecido é aceito
 * como "Link da chamada" — o sindicato pode ter o próprio Jitsi.
 */
export const LIMITE_LINK_REUNIAO = 500;

export const PROVEDOR_DESCONHECIDO = 'Link da chamada';

export type LinkReuniao =
  | { ok: true; url: string; provedor: string }
  | { ok: false; erro: string };

const PROVEDORES: { casa: (host: string) => boolean; nome: string }[] = [
  { casa: (h) => h === 'meet.google.com', nome: 'Google Meet' },
  { casa: (h) => h === 'zoom.us' || h.endsWith('.zoom.us'), nome: 'Zoom' },
  { casa: (h) => h === 'teams.microsoft.com' || h === 'teams.live.com', nome: 'Teams' },
  { casa: (h) => h === 'meet.jit.si', nome: 'Jitsi' },
];

export const ERRO_LINK = {
  naoAchei:
    'Não achei um link nesse texto. Cole o endereço da chamada (ex.: meet.google.com/abc-defg-hij).',
  http: 'O link da chamada precisa começar com https:// — um endereço http:// não é seguro.',
  naoEChamada: 'Esse endereço não é um link de chamada. Cole o link que começa com https://.',
  longo: `O link passa de ${LIMITE_LINK_REUNIAO} caracteres. Cole só o endereço da chamada.`,
  comSenha: 'O link não pode trazer usuário e senha dentro do endereço.',
  invalido: 'Esse link não parece válido. Confira se ele foi copiado inteiro.',
} as const;

/** Esquemas que viram código ou arquivo no navegador — nunca são link de sala. */
const ESQUEMA_SEM_BARRAS = /^(javascript|data|vbscript|file|blob|about|mailto|tel|sms):/i;
/** `algo://` — só `https` passa. */
const COM_ESQUEMA = /^([a-z][a-z0-9+.-]*):\/\//i;
/** `meet.google.com/abc` sem protocolo: é assim que o convite do Meet vem. */
const SO_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;
/** Parêntese, aspas e o ponto final da frase em volta do link não são do link. */
const EM_VOLTA = /^[<(["']+|[>)\]"'.,;:!?]+$/g;

/** Nome do provedor pelo endereço — "Google Meet", "Zoom"… ou "Link da chamada". */
export function provedorDoLink(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PROVEDORES.find((p) => p.casa(host))?.nome ?? PROVEDOR_DESCONHECIDO;
  } catch {
    return PROVEDOR_DESCONHECIDO;
  }
}

function validar(candidato: string): LinkReuniao {
  if (candidato.length > LIMITE_LINK_REUNIAO) return { ok: false, erro: ERRO_LINK.longo };
  let u: URL;
  try {
    u = new URL(candidato);
  } catch {
    return { ok: false, erro: ERRO_LINK.invalido };
  }
  if (u.protocol !== 'https:') return { ok: false, erro: ERRO_LINK.http };
  if (u.username || u.password) return { ok: false, erro: ERRO_LINK.comSenha };
  if (!u.hostname.includes('.')) return { ok: false, erro: ERRO_LINK.invalido };
  const url = u.toString();
  if (url.length > LIMITE_LINK_REUNIAO) return { ok: false, erro: ERRO_LINK.longo };
  return { ok: true, url, provedor: provedorDoLink(url) };
}

/**
 * Normaliza o que a pessoa colou. `null` = campo vazio. A PRIMEIRA URL do texto
 * decide; esquema perigoso sem `//` (`javascript:`, `tel:`) é pulado e só vira
 * o motivo da recusa se não houver URL nenhuma.
 */
export function normalizarLinkReuniao(texto: string | null | undefined): LinkReuniao | null {
  const bruto = (texto ?? '').trim();
  if (!bruto) return null;

  let viuEsquemaPerigoso = false;
  for (const pedaco of bruto.split(/\s+/)) {
    const token = pedaco.replace(EM_VOLTA, '');
    if (!token) continue;
    if (ESQUEMA_SEM_BARRAS.test(token)) {
      viuEsquemaPerigoso = true;
      continue;
    }
    const esquema = COM_ESQUEMA.exec(token);
    if (esquema) {
      const nome = esquema[1].toLowerCase();
      if (nome === 'https') return validar(token);
      return { ok: false, erro: nome === 'http' ? ERRO_LINK.http : ERRO_LINK.naoEChamada };
    }
    if (SO_HOST.test(token)) return validar(`https://${token}`);
  }
  return { ok: false, erro: viuEsquemaPerigoso ? ERRO_LINK.naoEChamada : ERRO_LINK.naoAchei };
}

/**
 * Abre a chamada numa aba nova, sem dar à página aberta acesso a esta.
 *
 * Só abre o que passa pela MESMA regra: um link gravado antes da regra (ou
 * mexido no banco) que não seja https não vira clique.
 */
export function abrirChamada(link: string | null | undefined): boolean {
  const r = normalizarLinkReuniao(link);
  if (!r || !r.ok || typeof window === 'undefined') return false;
  window.open(r.url, '_blank', 'noopener,noreferrer');
  return true;
}
