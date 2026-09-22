import { tenant } from '../../tenant/tenant.config';

/**
 * QUEM ESTÁ DE CADA LADO DO PROCESSO — as regras puras, fora do módulo Nest.
 *
 * MORAVAM DENTRO DE `dashboard.module.ts`, e mudaram de casa em 22/09/2026 por
 * um motivo concreto: a ficha do processo passou a precisar de
 * `parteAdversaria` para achar o ente público do outro lado, e importar o
 * ARQUIVO DO MÓDULO criou uma dependência circular
 * (ProcessosModule → DashboardModule → ProcessosModule). A aplicação não subiu:
 *
 *   ERROR [ExceptionHandler] A circular dependency has been detected inside
 *   ProcessosModule.
 *
 * E OS TESTES PASSARAM — todos. O jest importa as funções soltas e nunca monta
 * o grafo de módulos do Nest; quem reprovou foi o `npm run dev`. É o mesmo
 * motivo de `caixa-de-propostas.service` carregar a regra com `require`
 * preguiçoso: aquele contorno existia por causa deste ciclo, e agora não
 * precisa mais existir.
 *
 * Aqui não há decorador nem provider: é um arquivo de funções. Importá-lo não
 * arrasta módulo nenhum.
 */

/** O formato mínimo que a régua do adversário precisa ler de uma parte. */
export interface ParteParaAdversario {
  nome: string;
  polo: string;
  principal: boolean;
  parteExternaId: string | null;
  /** Parte ligada a um filiado: o lado de quem representamos, quando o sindicato não é parte. */
  filiadoId?: string | null;
  /** O cadastro canônico, quando a parte está ligada a um. */
  parteExterna?: { nomeFantasia: string | null } | null;
}

/**
 * A PARTE ADVERSÁRIA — a régua inteira, devolvendo a PARTE.
 *
 * Extraída de `adversarioDoProcesso` em 22/09/2026, sem mudar uma vírgula da
 * decisão. O motivo: a ficha do processo passou a precisar do ENTE PÚBLICO do
 * outro lado (para ler a situação fiscal dele no SICONFI), e o nome não leva o
 * `enteCodigo` junto. Escrever "quem é o adversário" uma segunda vez ali seria
 * a segunda implementação da mesma regra, livre para divergir — o erro que a
 * prévia do recadastramento já custou uma vez.
 *
 * Agora há uma régua e duas leituras: quem quer o NOME chama
 * `adversarioDoProcesso`; quem quer a PARTE chama esta.
 */
export function parteAdversaria<T extends ParteParaAdversario>(
  partes: T[],
  idDoSindicato: string | null,
): T | null {
  const nosso = partes.find((p) => ehONossoSindicato(p, idDoSindicato));

  /*
    DE QUE LADO ESTAMOS — e quem está do outro. Quatro casos, nesta ordem:

    1. O sindicato é parte: o adversário é o outro polo. Autor na esmagadora
       maioria, réu em alguns.
    2. O sindicato não é parte, mas uma parte está LIGADA A UM FILIADO: é a
       ação dele, que conduzimos, e o adversário é o outro polo. É o que acerta
       quando o filiado é o RÉU — o inquérito para apuração de falta grave que a
       empresa move contra o dirigente sindical, a cobrança contra o empregado.
    3. Sem nenhuma das duas marcas, o adversário é o polo PASSIVO: quem move a
       ação que o sindicato conduz é a pessoa. Conferido em 12/09/2026 nas 31
       ações em que só representamos: em todas, a pessoa no ativo e a empresa ou
       o ente no passivo, e nenhuma pessoa no passivo. A regra antiga devolvia
       "a primeira parte", que era a própria filiada em 20 de 26 ações ativas.
    4. Sem passivo nenhum, NINGUÉM. Era "sobra tudo" — e sobrava a filiada: 4
       casos pré-processuais, ainda sem réu cadastrado, diriam que a pessoa que
       defendemos é a parte contrária. Linha vazia é honesta; nome errado, não.
  */
  const doFiliado = nosso ? undefined : partes.find((p) => p.filiadoId);
  const nossoLado = nosso?.polo ?? doFiliado?.polo;
  const candidatos = nossoLado
    ? partes.filter((p) => p.polo !== nossoLado)
    : partes.filter((p) => p.polo === 'PASSIVO');
  if (!candidatos.length) return null;

  // A parte PRINCIPAL do polo, quando marcada; senão a primeira.
  return candidatos.find((p) => p.principal) ?? candidatos[0];
}

/**
 * CONTRA QUEM É O PROCESSO — o NOME, que é o que o painel mostra.
 *
 * "De quem é" tem resposta ruim nesta base — só 4 dos 127 processos têm filiado
 * vinculado, e o sindicato é o polo ativo em 93 deles. Repetir o nome do
 * próprio sindicato em toda linha do painel não informa nada; o réu informa:
 * FMS/THE, Unimed, Hapvida.
 */
export function adversarioDoProcesso(
  partes: ParteParaAdversario[],
  idDoSindicato: string | null,
): string | null {
  const parte = parteAdversaria(partes, idDoSindicato);
  return parte ? nomeCurtoDaParte(parte) : null;
}

/**
 * O NOME QUE CABE NA LINHA — fantasia quando há, dos autos quando não.
 *
 * O tribunal manda a razão social inteira e em maiúsculas: "FEDERAÇÃO DE
 * SINDICATOS DE TRABALHADORES TECNICO-ADMINISTRATIVOS EM INSTITUIÇÕES DE ENSINO
 * SUPERIOR PÚBLICAS DO BRASIL - FASUBRA" ocupa a linha toda do painel e some
 * truncada, dizendo menos que "FASUBRA".
 *
 * O nome de fantasia é do CADASTRO, escolhido por gente — não é abreviação
 * adivinhada. Sem ele, fica o nome dos autos, que é o que sempre foi.
 */
export function nomeCurtoDaParte(parte: {
  nome: string;
  parteExterna?: { nomeFantasia: string | null } | null;
}): string {
  const curto = parte.parteExterna?.nomeFantasia?.trim();
  return curto || parte.nome;
}

/**
 * A PARTE É O PRÓPRIO SINDICATO?
 *
 * A CHAVE É A ORGANIZAÇÃO CANÔNICA, resolvida pelo CNPJ do tenant — 226 das 263
 * partes cadastradas apontam para uma, e a do sindicato é uma só.
 *
 * Comparar NOME não serviria como regra principal: nas partes importadas dos
 * tribunais o sindicato figura como "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE
 * ENFERMAGEM DO ESTADO DO PIAUÍ", SEM a sigla — enquanto o DJEN o nomeia
 * "…DO ESTADO DO PIAUI - SENATEPI". Procurar a sigla erraria em 96 processos.
 *
 * E "começa com SINDICATO" seria pior ainda: disputa de representatividade
 * entre sindicatos existe, e a regra larga leria o adversário como sendo nós.
 *
 * O nome só entra como rede para as 33 partes que são texto solto, sem
 * organização vinculada, e aí exige a sigla — que é específica o bastante.
 */
export function ehONossoSindicato(
  parte: { nome: string; parteExternaId: string | null },
  idDoSindicato: string | null,
): boolean {
  if (idDoSindicato && parte.parteExternaId) return parte.parteExternaId === idDoSindicato;
  const limpo = parte.nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  return limpo.includes(tenant.sigla.toUpperCase());
}

/**
 * OS DOIS LADOS DA LINHA — e o cuidado de não escrever o mesmo nome duas vezes.
 *
 * QUANDO O SINDICATO É O RÉU, as duas regras apontam para a MESMA parte: o
 * autor é quem está no polo ativo, e o adversário é "o polo oposto ao nosso" —
 * que, sendo nós o passivo, também é o ativo. A tela imprimia
 * "FASUBRA × FASUBRA", com a razão social inteira repetida, e era isso que
 * fazia a linha ocupar duas alturas e parecer pesada.
 *
 * Com um nome só, a linha diz o mesmo: o selo "somos réu" ao lado já informa de
 * que lado estamos, e o adversário é a informação que distingue um processo do
 * outro.
 */
export function partesDaLinha(
  partes: Parameters<typeof adversarioDoProcesso>[0],
  idDoSindicato: string | null,
): { autor: string | null; adversario: string | null } {
  const adversario = adversarioDoProcesso(partes, idDoSindicato);
  const autor = autorQueInforma(partes, idDoSindicato);
  return { adversario, autor: autor && autor === adversario ? null : autor };
}

/**
 * DE QUEM É O PROCESSO — e o silêncio quando a resposta é "nosso".
 *
 * O autor é o próprio sindicato em 93 dos 127 processos: escrever "SENATEPI"
 * em toda linha do painel gasta espaço para dizer o que já se sabia. Aqui ele
 * só aparece quando é OUTRO — a filiada, o grupo de profissionais, o sindicato
 * parceiro —, que é justamente a linha em que a pergunta "de quem é isto?" tem
 * resposta útil.
 */
export function autorQueInforma(
  partes: { nome: string; polo: string; principal: boolean; parteExternaId: string | null }[],
  idDoSindicato: string | null,
): string | null {
  const ativa =
    partes.find((x) => x.polo === 'ATIVO' && x.principal) ?? partes.find((x) => x.polo === 'ATIVO');
  if (!ativa) return null;
  return ehONossoSindicato(ativa, idDoSindicato) ? null : nomeCurtoDaParte(ativa);
}

/**
 * EM QUE POLO NÓS ESTAMOS.
 *
 * Muda o que a publicação significa: a mesma "intimação para manifestar-se" é
 * ataque quando somos autor e defesa quando somos réu. A leitura sai das
 * partes; quando o sindicato não figura em nenhum polo (ação de filiado em que
 * ele é só o patrono), devolve nulo em vez de chutar.
 */
export function nossoPolo(
  partes: { nome: string; polo: string; principal: boolean; parteExternaId: string | null }[],
  idDoSindicato: string | null,
): 'ATIVO' | 'PASSIVO' | null {
  const nossa = partes.find((x) => ehONossoSindicato(x, idDoSindicato));
  if (!nossa) return null;
  return nossa.polo === 'ATIVO' || nossa.polo === 'PASSIVO' ? nossa.polo : null;
}
