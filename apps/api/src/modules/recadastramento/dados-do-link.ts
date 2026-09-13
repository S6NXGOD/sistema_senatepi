import {
  CAMPOS_DO_CADASTRO_PELO_LINK, CampoDoCadastroPeloLink, VinculoPeloLinkDto,
} from './dto/recadastro-publico.dto';

/**
 * O `data` DO RECADASTRO PELO LINK, montado campo a campo.
 *
 * Defesa em profundidade. O DTO já recusa o que não está na lista, mas ele só
 * vale se a rota continuar tipada com a CLASSE — foi uma interseção no tipo que
 * abriu o buraco. Se isso voltar a acontecer, o serviço ainda assim só copia os
 * campos daqui: `situacao`, `matricula` ou `cobrancas` não chegam ao Prisma nem
 * se vierem no objeto.
 */
export function camposDoLink(dto: Record<string, unknown>): Partial<Record<CampoDoCadastroPeloLink, unknown>> {
  const saida: Partial<Record<CampoDoCadastroPeloLink, unknown>> = {};
  for (const campo of CAMPOS_DO_CADASTRO_PELO_LINK) {
    if (dto[campo] !== undefined) saida[campo] = dto[campo];
  }
  return saida;
}

/** Vínculo como está no banco — só o que interessa herdar. */
export interface VinculoGravado {
  empresa: string;
  parteExternaId: string | null;
  cargo: string | null;
  lotacao: string | null;
  matricula: string | null;
  quadro: string | null;
  matriculaNormalizada: string | null;
  descontoEmFolha: boolean;
  ordem: number;
}

export interface VinculoParaCriar {
  empresa: string;
  parteExternaId: string | null;
  cargo: string | null;
  lotacao: string | null;
  matricula: string | null;
  quadro: string | null;
  matriculaNormalizada: string | null;
  descontoEmFolha: boolean;
  ordem: number;
}

const chaveDaEmpresa = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * A LISTA DE VÍNCULOS QUE O LINK GRAVA — sem apagar o que o filiado não vê.
 *
 * A lista enviada substitui a gravada (é assim que ele tira um emprego que não
 * tem mais). Mas a página pública só mostra empresa, cargo e matrícula, e a
 * substituição apagava junto o que a EQUIPE tinha registrado no vínculo: o
 * `descontoEmFolha` (em qual folha o financeiro desconta), a ligação com a
 * organização do cadastro, o quadro e a lotação.
 *
 * Regra: o vínculo enviado herda esses campos do vínculo gravado com o MESMO
 * empregador (sem acento, caixa ou espaço duplo), um para um. Empregador novo
 * nasce sem eles — o filiado não decide desconto em folha. A matrícula
 * normalizada só é herdada se a matrícula não mudou; mudou, fica nula (a
 * importação da folha recalcula).
 */
export function vinculosPeloLink(
  enviados: VinculoPeloLinkDto[],
  gravados: VinculoGravado[],
): VinculoParaCriar[] {
  const livres = [...gravados];
  return enviados.map((v, i) => {
    const chave = chaveDaEmpresa(v.empresa);
    const pos = livres.findIndex((g) => chaveDaEmpresa(g.empresa) === chave);
    const antes = pos >= 0 ? livres.splice(pos, 1)[0] : null;
    const matricula = v.matricula?.trim() || null;
    const mesmaMatricula = !!antes && (antes.matricula ?? null) === matricula;
    return {
      empresa: v.empresa.trim(),
      cargo: v.cargo?.trim() || null,
      matricula,
      // Não enviada = a página não mostra; enviada (mesmo vazia) = o filiado decidiu.
      lotacao: v.lotacao !== undefined ? v.lotacao.trim() || null : (antes?.lotacao ?? null),
      ordem: typeof v.ordem === 'number' ? v.ordem : i + 1,
      parteExternaId: antes?.parteExternaId ?? null,
      descontoEmFolha: antes?.descontoEmFolha ?? false,
      quadro: antes?.quadro ?? null,
      matriculaNormalizada: mesmaMatricula ? (antes!.matriculaNormalizada ?? null) : null,
    };
  });
}
