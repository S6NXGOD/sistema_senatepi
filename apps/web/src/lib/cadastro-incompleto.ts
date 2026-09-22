
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
  /**
   * OS DOIS NOMES DO MESMO CAMPO — e o bug que eles causaram (21/09/2026).
   *
   * No banco a coluna é `telefone_principal`, e a API devolve
   * `telefonePrincipal`. A ficha do dossiê usa esse nome; outros pontos do
   * sistema falam em `telefone`. Esta régua só conhecia `telefone`, e o
   * resultado apareceu na tela do dono: uma filiada COM telefone cadastrado, e
   * o botão "Mandar link de recadastro" escondido, com o rodapé dizendo "sem
   * telefone e sem e-mail não há para onde mandar o link".
   *
   * Pior: como `'telefone' in f` era falso, a régua nem acusava a falta — o
   * defeito ficava mudo dos dois lados. Aceitar os dois nomes é a correção
   * honesta; normalizar só um obrigaria cada chamador a lembrar qual.
   */
  telefone?: string | null;
  telefonePrincipal?: string | null;
  telefoneSecundario?: string | null;
  dataNascimento?: string | null;
  email?: string | null;
}

/** O telefone, venha ele com o nome que vier. */
const telefoneDe = (f: CadastroDoFiliado) => f.telefone ?? f.telefonePrincipal ?? null;

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
  const perguntou = (...campos: (keyof CadastroDoFiliado)[]) => campos.some((c) => c in f);
  return [
    perguntou('cpf') && vazio(f.cpf) && ('CPF' as const),
    perguntou('telefone', 'telefonePrincipal') &&
      vazio(telefoneDe(f)) &&
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
 * POR QUE ISSO FAZ FALTA — a metade da frase que vem depois do travessão.
 *
 * O aviso tem duas partes e elas têm donos diferentes: o que falta é FATO
 * (`listarEmPortugues`), e por que faz falta é CONSEQUÊNCIA. Separar as duas
 * deixa a tela montar a frase do jeito dela — a gaveta do atendimento mostra
 * só o fato, que é onde o espaço é curto; o modal mostra as duas.
 *
 * E A FRASE NÃO CULPA NINGUÉM. Quem está lendo não foi quem deixou o campo
 * vazio: a maior parte veio da carga do sistema antigo. O sujeito é o cadastro,
 * nunca a pessoa que atende.
 */
export function porQueFazFalta(faltando: CampoQueFalta[]): string {
  const critico = faltando.includes('CPF') || faltando.includes('telefone');
  return critico
    ? 'sem esses dados não dá para achar a pessoa nos autos nem avisá-la de um prazo.'
    : 'aproveite o contato e peça a atualização.';
}

/*
  `podeMandarLink` SAIU, e a regra dela estava errada — 22/09/2026.

  Ela respondia "sem telefone e sem e-mail não há para onde mandar o link", e o
  aviso escondia a saída inteira quando o cadastro não tinha nenhum dos dois.

  É falso. O link não é ENVIADO pelo sistema: a tela de envio gera o endereço e
  oferece **Copiar mensagem**, **Copiar só o link** e **Compartilhar**, além do
  atalho de WhatsApp. Só o atalho precisa do número — o resto é copiar e colar,
  que é exatamente o que a triagem faz, porque ela já está na conversa do
  WhatsApp com a pessoa (o canal da esmagadora maioria dos atendimentos).

  Ou seja: a regra escondia a saída mais útil justamente no caso em que o
  telefone falta no cadastro E está na tela de quem atende.

  Quem decide se o link pode existir é o servidor, que conhece o desafio da
  ficha (CPF+nascimento > CPF > COREN > nascimento; sem nenhum, não gera) e
  devolve o motivo. Adivinhar isso aqui seria uma segunda cópia da regra, livre
  para divergir — o mesmo erro que `desafioPrevisto` já custou uma vez.
*/
