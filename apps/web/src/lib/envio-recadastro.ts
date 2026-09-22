import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';
import type { DesafioRecadastramento } from '@/lib/recadastro';

/**
 * MANDAR O LINK DE RECADASTRAMENTO — o texto e as decisões, puros.
 *
 * O sistema não tem canal de saída (sem SMTP, sem API de WhatsApp). O que existe
 * é o aparelho de quem está no balcão: o `wa.me`, o compartilhamento do celular,
 * a área de transferência e o `mailto:`. Tudo o que DECIDE o que sai por eles
 * mora aqui, para ser testado com valores; o componente
 * `EnviarLinkRecadastro` só executa.
 *
 * SEM EMOJI. Mensagem com link e emoji é a cara do golpe que o filiado aprendeu
 * a ignorar — e é exatamente o que ele não pode ignorar aqui.
 */

/** O mesmo tipo da página pública: uma lista só de desafios no web. */
export type DesafioDoLink = DesafioRecadastramento;

/** O fuso de Teresina. O navegador pode estar em qualquer um; o link vence no daqui. */
export const FUSO_DO_SINDICATO = 'America/Fortaleza';

/** "13/09 às 15h20", no fuso de Teresina — a mesma forma que a auditoria da API escreve. */
export function validadeCurta(expiraEm: string | Date): string {
  const d = expiraEm instanceof Date ? expiraEm : new Date(expiraEm);
  if (Number.isNaN(d.getTime())) return '';
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_DO_SINDICATO,
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
 * "MARIA" → "Maria"; "maria de fátima" → "Maria".
 *
 * O primeiro nome vem do cadastro, e metade da base foi importada em caixa alta.
 * "Olá, MARIA." soa como cobrança automática.
 */
export function nomeParaSaudacao(primeiroNome: string | null | undefined): string {
  const palavra = (primeiroNome ?? '').trim().split(/\s+/)[0] ?? '';
  if (!palavra) return '';
  const minusculo = palavra.toLocaleLowerCase('pt-BR');
  return minusculo.charAt(0).toLocaleUpperCase('pt-BR') + minusculo.slice(1);
}

/**
 * A MENSAGEM QUE O FILIADO RECEBE.
 *
 * O link fica numa linha só dele: com ponto ou vírgula colados, alguns
 * aplicativos incluem o sinal no endereço e o link abre quebrado.
 *
 * A linha da confirmação diz o que vai ser pedido — quem sabe que vão pedir o
 * CPF não estranha. Sem confirmação possível (desafio NENHUM, só em link antigo
 * reaproveitado), ela vira o pedido de não encaminhar: quem tiver o link entra
 * direto.
 *
 * UM DADO SÓ (CPF ou data de nascimento, desde 14/09/2026): diz o que vai ser
 * pedido E pede para não encaminhar. CPF e data são conhecidos pela família;
 * protegem do link parado no celular errado, não de parente.
 */
export function mensagemDoLink(entrada: {
  primeiroNome: string | null | undefined;
  url: string;
  expiraEm: string | Date;
  desafio: DesafioDoLink;
}): string {
  const nome = nomeParaSaudacao(entrada.primeiroNome);
  const validade = validadeCurta(entrada.expiraEm);
  const naoEncaminhe = 'Este link é pessoal: não encaminhe.';

  const confirmacao: string[] =
    entrada.desafio === 'CPF_NASCIMENTO'
      ? ['Para confirmar que é você, vamos pedir o seu CPF e a sua data de nascimento.']
      : entrada.desafio === 'COREN'
        ? ['Para confirmar que é você, vamos pedir o número do seu COREN.']
        : entrada.desafio === 'CPF'
          ? ['Para confirmar que é você, vamos pedir o seu CPF.', naoEncaminhe]
          : entrada.desafio === 'NASCIMENTO'
            ? ['Para confirmar que é você, vamos pedir a sua data de nascimento.', naoEncaminhe]
            : [naoEncaminhe];

  return [
    `Olá${nome ? `, ${nome}` : ''}. Aqui é do ${tenant.sigla}.`,
    'Para atualizar o seu cadastro no sindicato, abra este link:',
    entrada.url,
    validade
      ? `Ele vale até ${validade} e só pode ser usado uma vez.`
      : 'Ele só pode ser usado uma vez.',
    ...confirmacao,
    'Não pedimos senha nem pagamento por este link.',
  ].join('\n');
}

/** Assunto do e-mail. */
export function assuntoDoEmail(): string {
  return `Atualização do seu cadastro no ${tenant.sigla}`;
}

/**
 * `mailto:` com assunto e corpo.
 *
 * `encodeURIComponent`, e não `URLSearchParams`: este troca espaço por "+", e
 * o programa de e-mail escreve o "+" literalmente no texto.
 */
export function linkEmail(email: string, assunto: string, corpo: string): string {
  return (
    `mailto:${encodeURIComponent(email.trim())}` +
    `?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`
  );
}

/**
 * E-mail com cara de e-mail, aparado; senão `null`. A MESMA régua da API
 * (`emailUtilizavel` do envio): o botão só aparece quando a rota também
 * aceitaria.
 */
export function emailUtilizavel(email: string | null | undefined): string | null {
  const e = (email ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/**
 * O AVISO DA TELA DE ENVIO — decidido pela API, nunca adivinhado aqui.
 *
 * Até 13/09/2026 a tela recalculava o desafio com uma cópia da regra
 * (`desafioPrevisto`). Com a hierarquia nova (CPF válido, data plausível, COREN
 * só onde o campo existe) a cópia erraria antes do primeiro toque: diria "abre
 * sem confirmação" e a API pediria o CPF, ou o contrário. Agora a tela pergunta
 * a prévia (`GET .../link-recadastramento/previa`) e só traduz a resposta.
 *
 *  · NADA: CPF + nascimento ou COREN. Os botões ficam como estão.
 *  · UM_FATOR: CPF ou nascimento sozinhos. Aviso âmbar, botões como estão.
 *  · SEM_CONFIRMACAO: `podeGerar` falso. A API recusaria o link (400), então
 *    os botões somem e a caixa diz o que fazer.
 *
 * `podeGerar` manda sobre o desafio: se a API disser que não gera, não gera,
 * mesmo que venha um valor que este web não conhece.
 *
 * O PORQUÊ DO "NÃO GERA" (14/09/2026). A caixa dizia "não tem CPF nem data de
 * nascimento" para todo `podeGerar` falso, e havia dois casos em que era falso:
 * o desfiliado com CPF e data gravados (o que falta é reativar) e o CPF gravado
 * que não confere, que a ficha mostra enquanto a caixa dizia que ele não existe.
 * A prévia passou a mandar `motivo` e `cpfGravadoInvalido`, opcionais porque a
 * API antiga não manda; sem eles, fica o texto de antes. `porta` nula esconde
 * o botão: gravar dado na ficha não reativa ninguém.
 *
 * QUAL PORTA ABRE A FICHA (15/09/2026). O botão abria sempre o recadastramento
 * presencial, e lá CPF e nascimento JÁ GRAVADOS ficam somente leitura (a API
 * ainda descarta a troca em `protegerImutaveis`). Com o CPF que não confere, ou
 * a data implausível (01/01/1900), a pessoa não conseguia fazer o que a caixa
 * mandava e ainda gravava um recadastramento presencial à toa. Dado gravado
 * errado se corrige na EDIÇÃO da ficha, que não passa por essa trava; dado
 * que falta se completa no presencial, onde campo vazio fica aberto.
 */
export type PortaDaFicha = 'EDITAR' | 'RECADASTRAR';

export type AvisoDoEnvio =
  | { tipo: 'NADA' }
  | { tipo: 'UM_FATOR'; texto: string }
  /**
   * FICHA EM BRANCO: o link PEDE os dados em vez de conferir (22/09/2026).
   *
   * Variante própria, e não `UM_FATOR` com outro texto, porque a semântica é
   * outra: em UM_FATOR o link confere um dado que o cadastro TEM; aqui não há
   * nada com o que conferir, e o link coleta. Quem ler o código daqui a um ano
   * precisa ver essa diferença no nome.
   */
  | { tipo: 'PEDE_AO_FILIADO'; titulo: string; texto: string }
  | { tipo: 'SEM_CONFIRMACAO'; titulo: string; texto: string; porta: PortaDaFicha | null };

export interface PreviaDoEnvio {
  desafio: string;
  podeGerar: boolean;
  motivo?: 'DESFILIADO' | 'SEM_CONFIRMACAO' | null;
  cpfGravadoInvalido?: boolean;
  /** Data gravada antes de 1920 ou de menos de 14 anos. Opcional pela janela de troca. */
  nascimentoGravadoInvalido?: boolean;
}

export function avisoDoEnvio(previa: PreviaDoEnvio, corenVisivel: boolean): AvisoDoEnvio {
  const titulo = 'O link abriria sem confirmar quem é';
  const volte = 'e volte aqui: o link passa a pedir essa confirmação.';
  if (!previa.podeGerar && previa.motivo === 'DESFILIADO') {
    return {
      tipo: 'SEM_CONFIRMACAO',
      titulo: 'Este cadastro está desfiliado',
      texto: 'Reative o cadastro antes de pedir o recadastramento.',
      porta: null,
    };
  }
  if (!previa.podeGerar && previa.cpfGravadoInvalido && previa.nascimentoGravadoInvalido) {
    return {
      tipo: 'SEM_CONFIRMACAO',
      titulo,
      texto: `O CPF e a data de nascimento gravados na ficha não conferem. Corrija os dois na ficha ${volte}`,
      porta: 'EDITAR',
    };
  }
  if (!previa.podeGerar && previa.cpfGravadoInvalido) {
    return {
      tipo: 'SEM_CONFIRMACAO',
      titulo,
      texto: `O CPF gravado na ficha não confere. Corrija o CPF na ficha ${volte}`,
      porta: 'EDITAR',
    };
  }
  if (!previa.podeGerar && previa.nascimentoGravadoInvalido) {
    return {
      tipo: 'SEM_CONFIRMACAO',
      titulo,
      texto:
        'A data de nascimento gravada na ficha não é plausível (antes de 1920 ou de menos de 14 anos). ' +
        `Corrija a data na ficha ${volte}`,
      porta: 'EDITAR',
    };
  }
  if (!previa.podeGerar) {
    return {
      tipo: 'SEM_CONFIRMACAO',
      titulo,
      texto:
        `Este cadastro não tem CPF nem data de nascimento${corenVisivel ? ', nem COREN' : ''}. ` +
        `Pergunte os dois ao ${V.filiado}, grave na ficha ${volte}`,
      porta: 'RECADASTRAR',
    };
  }
  /*
    O CICLO QUE ISTO QUEBRA — 22/09/2026.

    "Como faço para deixar de depender isso do atendimento. Quero jogar essa
    responsabilidade ao filiado também. Com validador."

    Ele está certo, e o ciclo era real: o link exigia CPF ou nascimento gravado,
    e estava vazio justamente porque ninguém coletou — 5.007 ativos assim. A
    caixa antiga mandava a Triagem perguntar na conversa, gravar na ficha e
    voltar. Todo o trabalho num lado só.

    Agora o link abre e pede os dois AO FILIADO, com validação de dígito
    verificador e recusa de CPF que já é de outra ficha. A caixa deixou de
    bloquear e passou a explicar — e continua dizendo "mande só para ele",
    porque para uma ficha vazia o que protege é o token e o canal.
  */
  if (previa.desafio === 'IDENTIFICACAO') {
    return {
      tipo: 'PEDE_AO_FILIADO',
      titulo: `O próprio ${V.filiado} vai informar os dados`,
      texto:
        'Este cadastro não tem CPF nem data de nascimento, então o link pede os dois a ele — ' +
        'confere o CPF dígito por dígito e recusa um que já seja de outra ficha. ' +
        'Você não precisa perguntar nada antes. Como não há o que conferir contra a ficha, ' +
        'mande só para ele; a equipe revisa o que chegar.',
    };
  }
  if (previa.desafio === 'CPF') {
    return {
      tipo: 'UM_FATOR',
      texto: `Este link vai pedir só o CPF para confirmar que é o ${V.filiado}. Mande só para ele.`,
    };
  }
  if (previa.desafio === 'NASCIMENTO') {
    return {
      tipo: 'UM_FATOR',
      texto: `Este link vai pedir só a data de nascimento para confirmar que é o ${V.filiado}. Mande só para ele.`,
    };
  }
  return { tipo: 'NADA' };
}

/** Para onde o botão da caixa leva, pela porta que o aviso escolheu. */
export function caminhoDaPorta(porta: PortaDaFicha, filiadoId: string): string {
  return porta === 'EDITAR' ? `/filiados/${filiadoId}/editar` : `/filiados/${filiadoId}/recadastrar`;
}

/** "Corrigir" quando o dado está gravado errado; "Completar" quando falta. */
export function rotuloDaPorta(porta: PortaDaFicha): string {
  return porta === 'EDITAR' ? 'Corrigir na ficha' : 'Completar a ficha';
}

/**
 * O ERRO DO TOQUE, com o tom certo (15/09/2026).
 *
 * A recusa "Este cadastro não tem como confirmar a identidade…" chegava em
 * VERMELHO quando a prévia tinha falhado ou ficado velha. É regra do cadastro
 * (falta dado, está desfiliado), não falha do sistema: a API responde 4xx com
 * a frase pronta, e isso é âmbar. Vermelho fica para o que ninguém na tela
 * resolve sozinho: servidor fora (5xx) ou sem resposta.
 */
export interface ErroDoEnvio {
  texto: string;
  tom: 'AVISO' | 'ERRO';
}

export function erroDoEnvio(e: unknown): ErroDoEnvio {
  const resposta = (e as { response?: { status?: unknown; data?: { message?: unknown } } })?.response;
  const msg = resposta?.data?.message;
  const texto =
    Array.isArray(msg) && typeof msg[0] === 'string'
      ? msg[0]
      : typeof msg === 'string' && msg.trim()
        ? msg
        : null;
  const status = typeof resposta?.status === 'number' ? resposta.status : null;
  const regra = status !== null && status >= 400 && status < 500 && texto !== null;
  return {
    texto: texto ?? 'Não foi possível preparar o link. Tente de novo.',
    tom: regra ? 'AVISO' : 'ERRO',
  };
}

/**
 * O ESTADO DO LINK DEPOIS DO TOQUE — em frase.
 *
 * Diz o que o sistema SABE: qual link está valendo e se é o mesmo de antes.
 * Nunca "enviado": o `wa.me` só abre a conversa, e ninguém aqui sabe se a
 * mensagem saiu.
 */
export function estadoDoLink(entrada: {
  expiraEm: string | Date;
  reaproveitado: boolean;
  haviaLinkAtivo: boolean;
}): string {
  const validade = validadeCurta(entrada.expiraEm);
  const vale = validade ? `Link ativo até ${validade}` : 'Link ativo';
  if (entrada.reaproveitado) return `${vale}. É o mesmo que já estava valendo.`;
  if (entrada.haviaLinkAtivo) return `${vale}. É um link novo: o anterior deixou de abrir.`;
  return `${vale}. É um link novo.`;
}
