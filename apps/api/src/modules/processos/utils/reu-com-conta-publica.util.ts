import { PrismaService } from '../../../prisma/prisma.service';
import { parteAdversaria } from '../../dashboard/adversario.util';
import {
  type Folga,
  type LeituraPessoal,
  type SituacaoFiscal,
  avisoDoCalendario,
  folgaAtePrudencial,
  oQueIssoSignifica,
  situacaoFiscal,
} from '../../municipios/leitura-fiscal.util';

/**
 * A SITUAÇÃO FISCAL DO RÉU, DENTRO DO PROCESSO — 22/09/2026.
 *
 * O PEDIDO DO DONO: "Não seria interessante de vez em quando aparecer uma
 * notícia aos advogados com uma orientação — por exemplo, se houver processos
 * para respeitar o piso em tal cidade, mostrar se estão ou não amparados pela
 * LRF."
 *
 * O DIAGNÓSTICO, e ele não é "falta dado do SICONFI". A extração é madura:
 * `leitura-fiscal.util` já classifica a situação, já calcula a folga em reais
 * até o PRUDENCIAL (e não até o teto, que exagera), já conhece as exceções do
 * art. 22 e já avisa do art. 21 no fim do mandato. O que falta é que nada disso
 * chega a quem trabalha o caso: Contas Públicas é uma tela que ninguém abre com
 * um processo na mão.
 *
 * MEDIDO NA PRODUÇÃO em 22/09/2026: **52 dos 191 processos não arquivados** têm
 * uma parte ligada a um ente do IBGE — 27%. Teresina responde por 11 deles e
 * tem R$ 512 milhões de folga até o teto; o Governo do Piauí, por 9.
 *
 * O SISTEMA NÃO RECOMENDA, e aqui isso é mais importante que em qualquer outro
 * lugar do projeto. Ele mostra o NÚMERO (quanto o ente gasta, qual o limite) e
 * NOMEIA O ARGUMENTO que a outra parte vai levantar. Quem decide a tese é o
 * advogado. A frase do art. 22 vem de `oQueIssoSignifica`, que já traz as
 * exceções por escrito — inclusive "o que decorre de sentença judicial ou de
 * lei", que é justamente o que a prefeitura omite ao dizer "estou no prudencial,
 * não posso pagar o piso".
 */

export interface ContaPublicaDoReu {
  codigoIBGE: number;
  nome: string;
  uf: string | null;
  esfera: string;
  situacao: SituacaoFiscal;
  /** A frase do art. 22 para esta situação, com as exceções. */
  oQueSignifica: string;
  percentualRcl: number | null;
  limitePrudencial: number | null;
  limiteMaximo: number | null;
  /** Quanto ainda cabe, em reais, antes do limite prudencial. */
  folga: Folga | null;
  /**
   * Fim de mandato / ano eleitoral, quando for o caso.
   *
   * Vem inteiro de `avisoDoCalendario`, sem reescrever nada: o art. 21 torna
   * NULO o aumento concedido nos 180 dias finais do mandato, esteja o ente
   * dentro ou fora dos limites. Um processo que discute reajuste contra uma
   * prefeitura em setembro de 2026 precisa dessa linha tanto quanto do
   * percentual.
   */
  aviso: { fimDeMandato: boolean; posse: Date; texto: string } | null;
  exercicio: number | null;
  quadrimestre: number | null;
  /**
   * Quando o Tesouro foi consultado. Nulo separa "o ente não publicou" (culpa
   * dele, e é argumento) de "ainda não perguntamos" (atraso nosso).
   */
  consultadoEm: Date | null;
}

export interface EnteDoReu {
  codigo: number;
  nome: string;
  uf: string | null;
  esfera: string;
  /**
   * `despesaPessoal` entra junto porque `folgaAtePrudencial` calcula os reais
   * a partir dela e do percentual — e é o número que serve numa negociação
   * ("há R$ X de espaço abaixo do limite"), não a diferença em pontos.
   */
  indicador:
    | (LeituraPessoal & {
        despesaPessoal: number | null;
        exercicio?: number | null;
        quadrimestre?: number | null;
      })
    | null;
  consultadoEm?: Date | null;
}

/**
 * Monta o bloco a partir do ente já carregado.
 *
 * SEM ENTE, SEM BLOCO — e isso é a maioria dos processos. Um bloco que aparece
 * vazio dizendo "sem informação fiscal" seria ruído em 139 das 191 fichas.
 */
export function contaPublicaDoReu(
  ente: EnteDoReu | null | undefined,
  agora = new Date(),
): ContaPublicaDoReu | null {
  if (!ente) return null;

  const leitura = ente.indicador ?? null;
  const situacao = situacaoFiscal(leitura, ente.consultadoEm ?? null);
  const calendario = avisoDoCalendario(ente.esfera, agora);

  return {
    codigoIBGE: ente.codigo,
    nome: ente.nome,
    uf: ente.uf,
    esfera: ente.esfera,
    situacao,
    oQueSignifica: oQueIssoSignifica(situacao),
    percentualRcl: leitura?.percentualRcl ?? null,
    limitePrudencial: leitura?.limitePrudencial ?? null,
    limiteMaximo: leitura?.limiteMaximo ?? null,
    folga: leitura ? folgaAtePrudencial(leitura, situacao) : null,
    aviso: calendario,
    exercicio: leitura?.exercicio ?? null,
    quadrimestre: leitura?.quadrimestre ?? null,
    consultadoEm: ente.consultadoEm ?? null,
  };
}

/**
 * VALE A PENA MOSTRAR?
 *
 * `NAO_CONSULTADO` é atraso NOSSO, não fato do processo: pendurar na ficha do
 * caso uma linha dizendo "ainda não buscamos" não ajuda o advogado e ainda
 * parece defeito do processo. Some da ficha e continua aparecendo em Contas
 * Públicas, que é onde essa pendência é de quem olha.
 *
 * `SEM_DADO` FICA, e é o contrário: o ente não publicou o RGF, e isso é
 * irregularidade dele — é argumento, não lacuna.
 */
export function valeMostrarNaFicha(conta: ContaPublicaDoReu | null): boolean {
  return !!conta && conta.situacao !== 'NAO_CONSULTADO';
}

/** O mínimo que a busca precisa ler de uma parte do processo. */
export interface ParteComEnte {
  nome: string;
  polo: string;
  principal: boolean;
  parteExternaId: string | null;
  filiadoId?: string | null;
  parteExterna?: {
    nomeFantasia: string | null;
    institucional?: boolean;
    enteCodigo?: number | null;
  } | null;
}

/**
 * A CONTA PÚBLICA DE QUEM ESTÁ DO OUTRO LADO — uma função, dois chamadores.
 *
 * A ficha do processo carrega por DOIS caminhos (`/processos/:id` e
 * `/processos/:id/dossie`, que é o que a gaveta abre). Escrever isto no serviço
 * de um deles fez o bloco não aparecer na tela enquanto a API respondia
 * certinho no outro — e nenhum teste unitário pegaria, porque os dois estavam
 * "certos" cada um no seu canto.
 *
 * A RÉGUA DE QUEM É O ADVERSÁRIO NÃO É REESCRITA: `parteAdversaria` é a mesma
 * que o painel usa para dizer "contra quem litigamos".
 *
 * O ID DO SINDICATO SAI DAS PRÓPRIAS PARTES — a organização institucional é uma
 * só e já viaja no include; buscá-la de novo seria uma consulta a mais por
 * ficha para saber o que já está na mão.
 */
export async function buscarContaPublicaDoReu(
  prisma: PrismaService,
  partes: ParteComEnte[],
  agora = new Date(),
): Promise<ContaPublicaDoReu | null> {
  const idDoSindicato =
    partes.find((p) => p.parteExterna?.institucional)?.parteExternaId ?? null;
  const adversaria = parteAdversaria(partes, idDoSindicato);
  const codigo = adversaria?.parteExterna?.enteCodigo ?? null;
  if (!codigo) return null;

  const ente = await prisma.ente.findUnique({
    where: { codigo },
    select: {
      codigo: true,
      nome: true,
      uf: true,
      esfera: true,
      siconfiConsultadoEm: true,
      // A tabela guarda uma linha por exercício/quadrimestre: vale a mais nova.
      indicadoresPessoal: {
        orderBy: [{ exercicio: 'desc' }, { quadrimestre: 'desc' }],
        take: 1,
      },
    },
  });
  if (!ente) return null;

  const i = ente.indicadoresPessoal[0];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const conta = contaPublicaDoReu(
    {
      codigo: ente.codigo,
      nome: ente.nome,
      uf: ente.uf,
      esfera: ente.esfera,
      consultadoEm: ente.siconfiConsultadoEm,
      indicador: i
        ? {
            percentualRcl: num(i.percentualRcl),
            limiteMaximo: num(i.limiteMaximo),
            limitePrudencial: num(i.limitePrudencial),
            limiteAlerta: num(i.limiteAlerta),
            despesaPessoal: num(i.despesaPessoal),
            exercicio: i.exercicio,
            quadrimestre: i.quadrimestre,
          }
        : null,
    },
    agora,
  );
  return valeMostrarNaFicha(conta) ? conta : null;
}
