import { diasPossiveis } from '@core/infra';
import { DesafioRecadastramento } from '@prisma/client';
import { campoVisivel } from '../../tenant/tenant.config';
import { cpfValido } from '../importacao/mapeamento.util';

/**
 * O QUE O LINK PEDE PARA CONFIRMAR QUE É O FILIADO — a regra inteira, pura.
 *
 * POR QUE MUDOU (14/09/2026). A regra antiga só olhava se o valor EXISTIA:
 * CPF E nascimento davam CPF_NASCIMENTO; senão COREN; senão NENHUM, e o link
 * abria direto. Medido na base ativa em 13–14/09/2026:
 *
 *   | desafio        | ativos | com atendimento ou processo |
 *   | CPF_NASCIMENTO |    520 |  8 |
 *   | CPF            |  1.768 |  4 |
 *   | COREN          |      6 |  0 |
 *   | NASCIMENTO     |      6 |  0 |
 *   | MATRICULA      |      0 |  0 |   (não entra: ninguém cairia nele)
 *   | NENHUM         |  5.007 |  9 |
 *
 * Os 1.768 que só têm CPF recebiam link SEM confirmação nenhuma, embora o CPF
 * sozinho já barrasse o encaminhamento acidental. E o link NENHUM não só expunha
 * o cadastro inteiro: deixava quem o recebeu gravar o CPF e o nascimento que o
 * PRÓXIMO link ia pedir (campo vazio passa, depois trava) — o filiado verdadeiro
 * queimaria o link dele em 5 tentativas.
 *
 * O QUE ISTO NÃO É. CPF sozinho e data sozinha são fatores de CONHECIMENTO
 * semipúblico (autos, contracheque, família). Protegem do link encaminhado ou
 * mandado para a pessoa errada; não protegem de parente ou colega mal-intencionado.
 * Não é autenticação, e não se vende como tal.
 */

/** A frase da recusa, igual em `gerar` e em `prepararEnvio` (e a tela a mostra como veio). */
export const RECUSA_SEM_CONFIRMACAO =
  'Este cadastro não tem como confirmar a identidade pelo link. ' +
  'Grave o CPF e a data de nascimento na ficha e mande o link de novo.';

export interface CadastroDoDesafio {
  cpf: string | null;
  dataNascimento: Date | null;
  numeroCoren: string | null;
}

export interface RespostaDoDesafio {
  cpf?: string;
  dataNascimento?: string;
  coren?: string;
}

/** Nascimento antes disto é placeholder de carga, não gente viva recadastrando. */
const NASCIMENTO_MINIMO_MS = Date.UTC(1920, 0, 1);
/** Menos de 14 anos não trabalha, não é filiado — a data está errada. */
const IDADE_MINIMA_ANOS = 14;

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * CPF QUE SERVE PARA PERGUNTAR: exatamente 11 dígitos GRAVADOS e dígito
 * verificador certo.
 *
 * Não completa zeros à esquerda (o `limparCpf` da importação completa): um CPF
 * gravado com 10 dígitos nunca bate com os 11 que o filiado digita, e perguntar
 * por ele seria montar um desafio impossível — 5 recusas e o link bloqueado,
 * sem a equipe ver o motivo. CPF com dígito errado está gravado errado; o que o
 * filiado sabe de cor é o certo.
 */
export function cpfUtil(cpf: string | null | undefined): boolean {
  const d = soDigitos(cpf);
  return d.length === 11 && cpfValido(d);
}

/** Data que o filiado consegue repetir: de 1920 para cá e de pelo menos 14 anos atrás. */
export function nascimentoUtil(data: Date | null | undefined, agora: Date = new Date()): boolean {
  if (!data || Number.isNaN(data.getTime())) return false;
  const limite = new Date(agora.getTime());
  limite.setUTCFullYear(limite.getUTCFullYear() - IDADE_MINIMA_ANOS);
  return data.getTime() >= NASCIMENTO_MINIMO_MS && data.getTime() <= limite.getTime();
}

/**
 * A HIERARQUIA, do mais forte para o mais fraco:
 *
 *   1. CPF_NASCIMENTO — CPF útil E nascimento útil;
 *   2. CPF            — CPF útil sem nascimento útil;
 *   3. COREN          — sem CPF útil, com COREN, e só onde o campo aparece;
 *   4. NASCIMENTO     — só o nascimento útil;
 *   5. NENHUM         — nada: o link NÃO É GERADO (ver `podeGerarLink`).
 *
 * COREN desceu um degrau: CPF sem nascimento com COREN dava COREN e passa a dar
 * CPF, que o filiado sabe de cor e é menos público que o registro do conselho.
 *
 * CPF ou data que existem mas não servem DESCEM na hierarquia em vez de gerar um
 * desafio que nunca confere.
 *
 * `corenVisivel` vem de fora para o teste exercitar os dois sindicatos; no
 * SINDSERM o COREN é oculto e nunca vira desafio, mesmo que um dado importado
 * o traga (pedir número de conselho de enfermagem a servidor público).
 */
export function definirDesafio(
  cadastro: CadastroDoDesafio,
  opcoes: { agora?: Date; corenVisivel?: boolean } = {},
): DesafioRecadastramento {
  const agora = opcoes.agora ?? new Date();
  const corenVisivel = opcoes.corenVisivel ?? campoVisivel('numeroCoren');
  const cpf = cpfUtil(cadastro.cpf);
  const nascimento = nascimentoUtil(cadastro.dataNascimento, agora);
  const coren = corenVisivel && !!cadastro.numeroCoren?.trim();

  if (cpf && nascimento) return DesafioRecadastramento.CPF_NASCIMENTO;
  if (cpf) return DesafioRecadastramento.CPF;
  if (coren) return DesafioRecadastramento.COREN;
  if (nascimento) return DesafioRecadastramento.NASCIMENTO;
  return DesafioRecadastramento.NENHUM;
}

/**
 * NENHUM NÃO SE GERA MAIS (14/09/2026). Em vez de um link sem confirmação, a
 * equipe pergunta CPF e nascimento na conversa em que já está, grava na ficha,
 * e o link passa a pedir a confirmação mais forte do sistema.
 *
 * Os links NENHUM que já estavam vivos na subida continuam abrindo até vencer
 * (24h; 3 links na história): `conferirResposta` segue aceitando.
 */
export function podeGerarLink(desafio: DesafioRecadastramento): boolean {
  return desafio !== DesafioRecadastramento.NENHUM;
}

/**
 * CONFERE A RESPOSTA — cada desafio lê SÓ o próprio campo.
 *
 * Isto não é detalhe, é a compatibilidade na janela de troca: a página pública
 * antiga (em cache no celular do filiado) manda CPF E data para qualquer desafio
 * que não seja COREN. Um link CPF aberto nela chega com a data que a pessoa
 * digitou num campo que o cadastro nem tem; se a conferência exigisse os dois,
 * o link nunca conferiria. Resposta vazia nunca confere.
 *
 * Valor de desafio que esta versão não conhece: falha FECHADA.
 */
export function conferirResposta(
  desafio: DesafioRecadastramento,
  cadastro: CadastroDoDesafio,
  resposta: RespostaDoDesafio,
): boolean {
  const cpfConfere = () => {
    const gravado = soDigitos(cadastro.cpf);
    return !!gravado && gravado === soDigitos(resposta.cpf);
  };
  // A data é comparada como DIA, aceitando as duas convenções que convivem na
  // base (meia-noite UTC e meia-noite de Brasília). Sem isso, um cadastro
  // gravado na convenção errada mostra 23/06 na ficha e exige 24/06 aqui —
  // o filiado digita o que vê e leva "dados não conferem".
  const nascimentoConfere = () =>
    !!resposta.dataNascimento &&
    diasPossiveis(cadastro.dataNascimento).includes(resposta.dataNascimento.slice(0, 10));

  switch (desafio) {
    case DesafioRecadastramento.NENHUM:
      return true;
    case DesafioRecadastramento.CPF_NASCIMENTO:
      return cpfConfere() && nascimentoConfere();
    case DesafioRecadastramento.CPF:
      return cpfConfere();
    case DesafioRecadastramento.NASCIMENTO:
      return nascimentoConfere();
    case DesafioRecadastramento.COREN: {
      const a = (cadastro.numeroCoren ?? '').replace(/\W/g, '').toUpperCase();
      const b = (resposta.coren ?? '').replace(/\W/g, '').toUpperCase();
      return !!a && a === b;
    }
    default:
      return false;
  }
}

/** Para frase de auditoria: o que o link pede, em português, nunca o código do enum. */
export const O_QUE_O_LINK_CONFIRMA: Record<DesafioRecadastramento, string> = {
  CPF_NASCIMENTO: 'confirma o CPF e a data de nascimento',
  CPF: 'confirma só o CPF',
  COREN: 'confirma só o COREN',
  NASCIMENTO: 'confirma só a data de nascimento',
  NENHUM: 'sem confirmação de identidade',
};

/**
 * A CONFIRMAÇÃO CARIMBADA NA OBSERVAÇÃO DO RECADASTRAMENTO.
 *
 * Sem coluna nova: a observação já é o que distingue o recadastro pelo link
 * (`origemDoRecadastramento` lê o começo, 'Recadastramento ONLINE'), e continua
 * começando igual. O miolo entre parênteses diz como o link confirmou quem era,
 * e `confirmacaoDoRecadastramento` lê de volta pela MESMA tabela — uma lista só
 * para escrever e ler.
 */
const MIOLO_DA_OBSERVACAO: Record<DesafioRecadastramento, string> = {
  CPF_NASCIMENTO: 'link; confirmado pelo CPF e pela data de nascimento',
  CPF: 'link; confirmado só pelo CPF',
  COREN: 'link; confirmado só pelo COREN',
  NASCIMENTO: 'link; confirmado só pela data de nascimento',
  NENHUM: 'link; sem confirmação de identidade',
};

const INICIO_DA_OBSERVACAO = 'Recadastramento ONLINE feito pelo próprio filiado';

export function observacaoDoRecadastramentoOnline(desafio: DesafioRecadastramento): string {
  return `${INICIO_DA_OBSERVACAO} (${MIOLO_DA_OBSERVACAO[desafio]}).`;
}

/**
 * Como o link confirmou a identidade, lido da observação. `null` para o
 * presencial e para o online de antes de 14/09/2026 ("(link)."), que não dizia.
 */
export function confirmacaoDoRecadastramento(
  observacao: string | null | undefined,
): DesafioRecadastramento | null {
  const texto = observacao ?? '';
  for (const desafio of Object.keys(MIOLO_DA_OBSERVACAO) as DesafioRecadastramento[]) {
    if (texto === observacaoDoRecadastramentoOnline(desafio)) return desafio;
  }
  return null;
}
