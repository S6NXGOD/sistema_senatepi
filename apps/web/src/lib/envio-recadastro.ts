import { tenant } from '@/tenant.config';

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

export type DesafioDoLink = 'CPF_NASCIMENTO' | 'COREN' | 'NENHUM';

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
 * CPF não estranha. Sem confirmação possível (desafio NENHUM), ela vira o
 * pedido de não encaminhar: quem tiver o link entra direto.
 */
export function mensagemDoLink(entrada: {
  primeiroNome: string | null | undefined;
  url: string;
  expiraEm: string | Date;
  desafio: DesafioDoLink;
}): string {
  const nome = nomeParaSaudacao(entrada.primeiroNome);
  const validade = validadeCurta(entrada.expiraEm);

  const confirmacao =
    entrada.desafio === 'CPF_NASCIMENTO'
      ? 'Para confirmar que é você, vamos pedir o seu CPF e a sua data de nascimento.'
      : entrada.desafio === 'COREN'
        ? 'Para confirmar que é você, vamos pedir o número do seu COREN.'
        : 'Este link é pessoal: não encaminhe.';

  return [
    `Olá${nome ? `, ${nome}` : ''}. Aqui é do ${tenant.sigla}.`,
    'Para atualizar o seu cadastro no sindicato, abra este link:',
    entrada.url,
    validade
      ? `Ele vale até ${validade} e só pode ser usado uma vez.`
      : 'Ele só pode ser usado uma vez.',
    confirmacao,
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
 * QUAL CONFIRMAÇÃO O LINK VAI PEDIR — prevista antes de chamar a API.
 *
 * Espelho da decisão do servidor na geração: CPF e nascimento, os dois; senão o
 * COREN, se a instalação usa o campo; senão nenhuma. Serve só para a tela
 * mostrar o aviso de "não encaminhe" ANTES do primeiro toque em WhatsApp — a
 * resposta da rota de envio traz o desafio de verdade, e ela é que vale depois.
 */
export function desafioPrevisto(
  filiado: { cpf?: string | null; dataNascimento?: string | null; numeroCoren?: string | null },
  corenVisivel: boolean,
): DesafioDoLink {
  const tem = (v: string | null | undefined) => !!(v ?? '').trim();
  if (tem(filiado.cpf) && tem(filiado.dataNascimento)) return 'CPF_NASCIMENTO';
  if (corenVisivel && tem(filiado.numeroCoren)) return 'COREN';
  return 'NENHUM';
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
