import { Injectable } from '@nestjs/common';
import { AcaoAuditoria, TipoAcaoProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PartesService } from './partes.service';
import { SugestaoFiliadoService, type CandidatoFiliado } from './sugestao-filiado.service';
import { FILTRO_RAPIDO } from './processos.service';
import { tenant } from '../../tenant/tenant.config';

/**
 * A FILA "SEM FILIADO VINCULADO", RESOLVIDA DE UMA VEZ.
 *
 * Ela tem 29 processos, e resolver um por um custa: abrir o processo, ir na
 * aba, procurar o nome que a busca não acha, desistir. Foi assim que ela
 * cresceu. O que faltava não era um botão a mais — era ver os 29 lado a lado,
 * cada um já com o candidato ao lado do nome dos autos.
 *
 * ELA NÃO É HOMOGÊNEA, e tratar tudo como o mesmo problema era o erro. Medido
 * na produção em 04/09/2026, os 29 casos são de três espécies:
 *
 *   22  PESSOAS que precisam de vínculo — o caso para o qual a fila existe.
 *    5  O PRÓPRIO SINDICATO ou outra entidade no polo ativo (SENATEPI,
 *       SINDHOSPI, SINSEP, "Profissionais de Enfermagem de Palmeirais-PI").
 *       Não existe filiado dono: são ações institucionais marcadas como
 *       INDIVIDUAL por engano, e o conserto é mudar o TIPO, não vincular
 *       ninguém.
 *    2  EMPRESA no polo ativo (uma contabilidade). Mesma coisa.
 *
 * Sem separar as espécies, a fila nunca zera: sobram sempre os casos que não
 * têm resposta possível, e uma fila que não zera a equipe aprende a ignorar.
 *
 * O QUE ELA NÃO FAZ: decidir. Cada linha é uma escolha explícita de quem lê —
 * o serviço só junta a informação para que a escolha leve um segundo em vez de
 * cinco minutos. Ver `SugestaoFiliadoService` para por que nome nunca vincula
 * sozinho.
 */

/** Palavras que denunciam pessoa jurídica ou entidade no polo ativo. */
const RE_NAO_E_PESSOA =
  /\b(SINDICATO|SINDSERM|SINDHOSPI|SINSEP|SENATEPI|FEDERACAO|CONFEDERACAO|ASSOCIACAO|MUNICIPIO|ESTADO|UNIAO|MINISTERIO|FUNDACAO|INSTITUTO|AUTARQUIA|PREFEITURA|SECRETARIA|CONSELHO|CAMARA|EMPRESA|LTDA|EIRELI|S\/A|ME$|EPP|HOSPITAL|CLINICA|BANCO|COOPERATIVA|PROFISSIONAIS DE)\b/;

const semAcento = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export type EspecieDoCaso = 'PESSOA' | 'ENTIDADE';

export interface CasoSemFiliado {
  processoId: string;
  numeroCNJ: string | null;
  titulo: string | null;
  categoria: string | null;
  /** A parte do polo ativo que ainda não aponta para um cadastro. */
  parteId: string | null;
  nomeNosAutos: string | null;
  /** Réu principal — ajuda a reconhecer o caso sem abrir o processo. */
  adversario: string | null;
  especie: EspecieDoCaso;
  candidatos: CandidatoFiliado[];
}

export interface DecisaoDeVinculo {
  /** Vincular esta parte a este filiado. */
  parteId?: string;
  filiadoId?: string;
  /** Ou: reclassificar o processo como ação institucional. */
  processoId?: string;
  marcarInstitucional?: boolean;
}

type Ctx = { userId?: string; ip?: string; userAgent?: string };

@Injectable()
export class VinculosPendentesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partes: PartesService,
    private readonly sugestoes: SugestaoFiliadoService,
    private readonly audit: AuditService,
  ) {}

  async listar(): Promise<CasoSemFiliado[]> {
    const processos = await this.prisma.processo.findMany({
      where: FILTRO_RAPIDO.semFiliado(),
      select: {
        id: true, numeroCNJ: true, titulo: true, categoria: true,
        partes: {
          select: { id: true, nome: true, polo: true, principal: true, documento: true, filiadoId: true },
          orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const casos: CasoSemFiliado[] = [];
    for (const p of processos) {
      const ativas = p.partes.filter((x) => x.polo === 'ATIVO');
      const parte = ativas.find((x) => !x.filiadoId) ?? null;
      const nome = parte?.nome ?? null;
      const passivo = p.partes.find((x) => x.polo === 'PASSIVO');

      /*
        A ESPÉCIE SAI DO NOME, e é uma leitura, não um veredito: a tela mostra
        a que grupo o caso pertence e a pessoa pode discordar. Basta UMA parte
        ativa ser entidade para o caso não ser de filiado — é o que acontece
        quando o sindicato litiga ao lado de um grupo ("Profissionais de
        Enfermagem de Palmeirais-PI E o SENATEPI").
      */
      const pareceEntidade =
        ativas.length === 0 || ativas.some((x) => RE_NAO_E_PESSOA.test(semAcento(x.nome)));

      casos.push({
        processoId: p.id,
        numeroCNJ: p.numeroCNJ,
        titulo: p.titulo,
        categoria: p.categoria ? String(p.categoria) : null,
        parteId: parte?.id ?? null,
        nomeNosAutos: nome,
        adversario: passivo?.nome ?? null,
        especie: pareceEntidade ? 'ENTIDADE' : 'PESSOA',
        // Procurar candidato para o próprio sindicato seria gastar consulta
        // para oferecer uma resposta errada.
        candidatos:
          pareceEntidade || !nome ? [] : await this.sugestoes.paraNome(nome, parte?.documento),
      });
    }
    return casos;
  }

  /**
   * Aplica as decisões tomadas na tela, uma a uma.
   *
   * NÃO É TRANSAÇÃO ÚNICA de propósito: são operações independentes sobre
   * processos diferentes, e um erro em uma (filiado já vinculado em outra
   * parte, por exemplo) não é motivo para desfazer as vinte que deram certo. O
   * retorno diz o que passou e o que não passou, e a tela mostra as duas
   * listas.
   */
  async aplicar(decisoes: DecisaoDeVinculo[], ctx: Ctx) {
    const feitas: string[] = [];
    const falhas: { alvo: string; motivo: string }[] = [];

    for (const d of decisoes) {
      try {
        if (d.marcarInstitucional && d.processoId) {
          await this.marcarInstitucional(d.processoId, ctx);
          feitas.push(d.processoId);
        } else if (d.parteId && d.filiadoId) {
          await this.partes.vincularFiliado(d.parteId, d.filiadoId, ctx);
          feitas.push(d.parteId);
        } else {
          falhas.push({ alvo: d.parteId ?? d.processoId ?? '?', motivo: 'Decisão incompleta.' });
        }
      } catch (e: unknown) {
        falhas.push({
          alvo: d.parteId ?? d.processoId ?? '?',
          motivo: e instanceof Error ? e.message : 'Falha ao aplicar.',
        });
      }
    }
    return { aplicadas: feitas.length, falhas };
  }

  /**
   * O processo passa a ser AÇÃO INSTITUCIONAL — que é o que ele sempre foi.
   *
   * Isso o tira da fila pela porta certa: `FILTRO_RAPIDO.semFiliado()` só olha
   * INDIVIDUAL, porque na ação institucional o sindicato figura em nome da
   * categoria e não existe filiado "dono". Cobrar o vínculo ali seria forçar um
   * dado que não existe.
   *
   * Se o polo ativo estiver vazio, entra o cadastro institucional do sindicato
   * — senão o processo sai de uma fila ("sem filiado") e cai em outra ("sem
   * parte"), o que não é progresso nenhum.
   */
  private async marcarInstitucional(processoId: string, ctx: Ctx) {
    const proc = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, numeroCNJ: true, tipoAcao: true, partes: { select: { polo: true } } },
    });
    if (!proc) throw new Error('Processo não encontrado.');

    await this.prisma.processo.update({
      where: { id: processoId },
      data: { tipoAcao: TipoAcaoProcesso.INSTITUCIONAL },
    });

    if (!proc.partes.some((x) => x.polo === 'ATIVO')) {
      const institucional = await this.partes.parteInstitucional();
      if (institucional) {
        await this.partes.adicionar(
          processoId,
          { polo: 'ATIVO', parteExternaId: institucional.id, principal: true },
          ctx,
        );
      }
    }

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Processo',
      entidadeId: processoId,
      descricao: `Processo ${proc.numeroCNJ ?? ''} reclassificado como ação institucional do ${tenant.sigla} — não há filiado a vincular`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { de: String(proc.tipoAcao), para: 'INSTITUCIONAL', origem: 'fila-de-vinculos' },
    });
  }
}
