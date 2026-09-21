import { V } from '@/lib/vocabulario';

/**
 * O CADASTRO ESTÁ FURADO — e a triagem tem de ser cobrada disso na hora.
 *
 * "Se o atendimento/triagem for atender um filiado e ver que o cadastro dele
 * tá muito incompleto, mandar um aviso para a triagem falando algo como:
 * 'Atualize os dados desse filiado, pois estão muito desatualizados e podemos
 * precisar um dia'. (...) Temos que ser mais incisivos com isso para que a
 * triagem sempre seja induzida a pedir o filiado para se recadastrar." — o
 * dono, 21/09/2026.
 *
 * O MOMENTO É O ÚNICO QUE FUNCIONA. Medido na produção: 62% dos filiados
 * ativos não têm CPF. Uma fila de "cadastros a completar" no painel existe
 * desde 12/09 e depende de alguém decidir trabalhar nela; o atendimento é o
 * instante em que a pessoa ESTÁ do outro lado da linha, com o telefone na mão.
 * Pedir ali custa uma frase; pedir depois custa uma ligação.
 *
 * OS TRÊS CAMPOS SÃO OS MESMOS DO PAINEL (`itemDoCadastroACompletar`, na API):
 * telefone, CPF e nascimento. Uma segunda lista de "o que falta" divergiria da
 * primeira no dia em que alguém mexesse numa só.
 *
 * TELEFONE FALTA SÓ QUANDO OS DOIS CAMPOS ESTÃO VAZIOS: a importação gravou o
 * celular da planilha no secundário, e 383 ativos só têm número ali.
 */
export interface CadastroDoFiliado {
  cpf?: string | null;
  telefone?: string | null;
  telefoneSecundario?: string | null;
  dataNascimento?: string | null;
  email?: string | null;
}

export type CampoQueFalta = 'CPF' | 'telefone' | 'data de nascimento' | 'e-mail';

const vazio = (t: string | null | undefined) => !(t ?? '').trim();

/**
 * O QUE FALTA, na ordem em que atrapalha.
 *
 * CPF primeiro porque é ele que liga a pessoa ao processo ([[filiado da
 * parte]]: CPF vincula sozinho, nome só sugere) e é o que mais falta. E-mail
 * por último: é o único dos quatro que não impede nada hoje.
 */
export function oQueFaltaNoCadastro(f: CadastroDoFiliado | null | undefined): CampoQueFalta[] {
  if (!f) return [];
  /*
    CAMPO QUE NÃO VEIO NO PAYLOAD NÃO É CAMPO QUE FALTA — e a diferença não é
    teórica. A gaveta do atendimento monta o filiado a partir do dossiê, que não
    traz `dataNascimento`: sem esta guarda, TODO atendimento acusaria falta de
    data de nascimento, inclusive o de quem tem. Aviso que mente uma vez deixa
    de ser lido nas outras.

    `in` e não `!= null`: quem manda o campo com `null` está dizendo "olhei, e
    está vazio"; quem não manda está dizendo "não perguntei".
  */
  const perguntou = (campo: keyof CadastroDoFiliado) => campo in f;
  return [
    perguntou('cpf') && vazio(f.cpf) && ('CPF' as const),
    perguntou('telefone') &&
      vazio(f.telefone) &&
      vazio(f.telefoneSecundario) &&
      ('telefone' as const),
    perguntou('dataNascimento') && !f.dataNascimento && ('data de nascimento' as const),
    perguntou('email') && vazio(f.email) && ('e-mail' as const),
  ].filter(Boolean) as CampoQueFalta[];
}

/**
 * QUÃO FURADO ESTÁ — e é isto que decide o tom do aviso.
 *
 * `CRITICO` quando falta CPF ou telefone: sem CPF não dá para achar a pessoa
 * nos autos, e sem telefone não dá para avisá-la de nada. `INCOMPLETO` é o
 * resto — pede, mas não grita. Nada faltando não desenha aviso nenhum: um
 * aviso que aparece sempre é cabeçalho, e cabeçalho ninguém lê.
 */
export type GravidadeDoCadastro = 'OK' | 'INCOMPLETO' | 'CRITICO';

export function gravidadeDoCadastro(faltando: CampoQueFalta[]): GravidadeDoCadastro {
  if (!faltando.length) return 'OK';
  return faltando.includes('CPF') || faltando.includes('telefone') ? 'CRITICO' : 'INCOMPLETO';
}

/** "CPF e telefone" · "CPF, telefone e data de nascimento" — a vírgula e o "e". */
export function listarEmPortugues(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * A FRASE DO AVISO — o que falta, e por que isso importa um dia.
 *
 * O dono escreveu o tom que queria: "Atualize os dados desse filiado, pois
 * estão muito desatualizados e podemos precisar um dia". A frase daqui diz a
 * mesma coisa sendo específica, porque "desatualizado" não diz o que fazer e
 * "falta o CPF" diz.
 *
 * E ELA NÃO CULPA NINGUÉM. Quem está lendo não foi quem deixou o campo vazio —
 * a maior parte veio da carga do sistema antigo. O sujeito da frase é o
 * cadastro, nunca a pessoa que atende.
 */
export function fraseDoCadastroIncompleto(faltando: CampoQueFalta[]): string {
  if (!faltando.length) return '';
  const lista = listarEmPortugues(faltando);
  const critico = faltando.includes('CPF') || faltando.includes('telefone');
  return critico
    ? `Falta ${lista} no cadastro. Aproveite que o ${V.filiado} está aí e peça a atualização — sem esses dados não dá para achar a pessoa nos autos nem avisá-la de um prazo.`
    : `Falta ${lista} no cadastro. Aproveite o contato e peça a atualização.`;
}

/**
 * O QUE O LINK DE RECADASTRAMENTO RESOLVE — e o que ele NÃO resolve.
 *
 * "Caso o filiado não tenha CPF no cadastro, o filiado poderá colocar." Pode:
 * o formulário público pede os dados que faltam. Só que o link é ENVIADO por
 * WhatsApp ou e-mail — sem telefone e sem e-mail não há por onde mandar, e aí
 * a única saída é o presencial. A tela precisa saber disso antes de oferecer
 * um botão que não leva a lugar nenhum.
 */
export function podeMandarLink(f: CadastroDoFiliado | null | undefined): boolean {
  if (!f) return false;
  return !vazio(f.telefone) || !vazio(f.telefoneSecundario) || !vazio(f.email);
}
