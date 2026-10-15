import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomacaoPrazosService } from './automacao-prazos.service';
import {
  MOTIVOS_SEM_PAUTA,
  lerPautaNoDiario,
  type MotivoSemPauta,
} from './utils/audiencia-do-diario.util';
import { formatarDataHoraBR } from './utils/data-br.util';

/**
 * A AUDIÊNCIA VEM DO DIÁRIO — a automação que faltava, e por que faltava.
 *
 * O sistema já tinha a máquina inteira de pauta: classificador, radar, criador
 * de compromisso, aviso ao filiado dois dias úteis antes e tarefa de preparo.
 * Nunca produziu uma audiência. Medido na produção em 15/10/2026:
 *
 *   movimentações do DataJud marcadas como audiência ...... 265
 *   dessas, com DATA ........................................ 0
 *   compromissos de audiência criados pelo robô ............. 0
 *   compromissos de audiência na agenda (todos à mão) ....... 3
 *
 * A máquina estava faminta, não quebrada: **o DataJud não manda a data**. Ele
 * manda o rótulo ("Inicial", "de Instrução") e o complemento ("Juiz(a) ·
 * designada"). Das 265, zero têm data na descrição, zero têm teor.
 *
 * Quem manda é o DIÁRIO, que chega em D+0 e com o texto inteiro. Rodando o
 * leitor sobre as 2.487 publicações reais: **98 designam audiência**, 77
 * distintas, 83 com link de sala virtual.
 *
 * ESTE SERVIÇO É A PONTE. Lê as publicações que ainda não viraram pauta,
 * extrai data/hora/modalidade/link e entrega para `agendarPauta` — o MESMO
 * criador do lado DataJud, com as mesmas travas (não duplica no dia, avisa o
 * filiado, cria o preparo, nunca nasce vencida).
 *
 * O QUE ELE NÃO FAZ, de propósito:
 *
 *  · não agenda pauta no PASSADO. Compromisso que nasce vencido é ruído, e no
 *    acervo de hoje 96 das 98 já aconteceram — o valor desta automação é para
 *    a frente;
 *  · não inventa quando não tem certeza. Sem data perto do verbo, a publicação
 *    fica com o motivo carimbado e some da fila; o radar continua mostrando
 *    que ela existe, para uma pessoa olhar;
 *  · não escreve na dispensa humana (`tarefaDispensadaEm` só é lida aqui).
 *    Carimbo do robô é coluna do robô — a lição de 17/09/2026.
 */
@Injectable()
export class AudienciasDoDiarioService {
  private readonly logger = new Logger(AudienciasDoDiarioService.name);

  /**
   * Quantas publicações a rodada examina de uma vez.
   *
   * A varredura noturna já leva ~13 minutos de cota do CNJ; isto aqui não
   * consulta nada externo (lê o texto que já está no banco), mas um teto
   * mantém a etapa com fim conhecido quando alguém mandar reprocessar o
   * histórico inteiro.
   */
  private readonly TETO_POR_RODADA = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly automacao: AutomacaoPrazosService,
  ) {}

  /**
   * Varre as publicações sem pauta e agenda o que for audiência designada.
   *
   * `somenteFuturas` é o padrão: só vira compromisso o que ainda vai
   * acontecer. Com `false`, o histórico também é CARIMBADO (para sair da fila
   * e para o diagnóstico), mas continua sem virar agenda.
   */
  async varrer(
    opcoes: { somenteFuturas?: boolean; limite?: number; reexaminar?: boolean } = {},
  ): Promise<ResumoDaVarreduraDePautas> {
    const somenteFuturas = opcoes.somenteFuturas !== false;
    const resumo: ResumoDaVarreduraDePautas = {
      examinadas: 0, agendadas: 0, jaExistiam: 0, noPassado: 0, semPauta: 0,
      semProcesso: 0, semResponsavel: 0, derrubadas: 0, naoRessuscitadas: 0,
      porMotivo: {},
    };

    const candidatas = await this.prisma.comunicacaoDjen.findMany({
      where: {
        /*
          A FILA É O MEU PRÓPRIO CARIMBO, e não `compromissoId: null`.

          Uma publicação pode já ter gerado uma tarefa por outro caminho (a
          correlação, uma proposta aceita) e AINDA assim designar uma
          audiência que não está na agenda — na produção eram 5 assim. Olhar
          `compromissoId` faria o leitor pular justamente essas.

          Quem garante que ninguém é examinado duas vezes é o carimbo próprio;
          quem garante que a pauta não duplica é `pautaDoDia`, lá no criador.
        */
        ...(opcoes.reexaminar ? {} : { audienciaAvaliadaEm: null }),
        // Sem processo cadastrado não há a que pendurar a pauta.
        processoId: { not: null },
      },
      orderBy: { dataDisponibilizacao: 'desc' },
      take: Math.min(this.TETO_POR_RODADA, Math.max(1, opcoes.limite ?? this.TETO_POR_RODADA)),
      select: {
        id: true, texto: true, dataDisponibilizacao: true, nomeOrgao: true,
        numeroProcesso: true, processoId: true, compromissoId: true,
        processo: {
          select: {
            id: true, numeroCNJ: true, advogadoId: true, filiadoId: true,
            filiado: { select: { nomeCompleto: true } },
            /*
              AS PARTES SÃO O NOME DO CASO. `processos.filiado_id` é atalho
              derivado e está nulo em 177 dos 204 processos da produção: sem
              isto, 87% dos cartões diriam "Audiência inicial — filiado".
              Ver `nome-do-caso.util`.
            */
            partes: {
              select: {
                nome: true, polo: true, principal: true, filiadoId: true,
                filiado: { select: { nomeCompleto: true } },
                parteExterna: { select: { institucional: true } },
              },
            },
          },
        },
      },
    });

    const agora = new Date();
    for (const c of candidatas) {
      resumo.examinadas++;
      const leitura = lerPautaNoDiario(c.texto, c.dataDisponibilizacao);

      if (!leitura.pauta) {
        resumo.semPauta++;
        resumo.porMotivo[leitura.motivo] = (resumo.porMotivo[leitura.motivo] ?? 0) + 1;
        /*
          CANCELADA PELO JUÍZO — e aqui a automação faz a metade que faltava.

          Agendar sem saber desmarcar é pior do que não agendar: o advogado
          passa a confiar numa agenda que promete uma audiência que não vai
          acontecer. O lado DataJud já derrubava a pauta; o Diário é quem
          recebe a notícia PRIMEIRO (D+0, contra uma mediana de 62 dias).

          Só derruba o que ainda não aconteceu e o que o robô ou o radar
          marcaram: `cancelarPorSistema` grava o motivo e o histórico fica.
        */
        if (leitura.motivo === MOTIVOS_SEM_PAUTA.CANCELAMENTO && c.processoId) {
          resumo.derrubadas += await this.automacao.derrubarPautasAbertas(c.processoId, {
            desde: c.dataDisponibilizacao,
            motivo: `Pauta cancelada pelo juízo, conforme o Diário de ${diaDaPublicacao(c.dataDisponibilizacao)}.`,
          });
        }
        await this.carimbar(c.id, leitura.motivo);
        continue;
      }
      if (!c.processo) {
        resumo.semProcesso++;
        await this.carimbar(c.id, MOTIVO_SEM_PROCESSO);
        continue;
      }
      if (somenteFuturas && leitura.pauta.inicio <= agora) {
        resumo.noPassado++;
        await this.carimbar(c.id, MOTIVO_JA_ACONTECEU, leitura.pauta.inicio);
        continue;
      }

      const responsavelId = await this.donoDoCaso(c.processo.id, c.processo.advogadoId);
      if (!responsavelId) {
        resumo.semResponsavel++;
        await this.carimbar(c.id, MOTIVO_SEM_RESPONSAVEL);
        continue;
      }
      const secretariaId = await this.automacao.secretariaParaAviso();

      /*
        REMARCOU: A VELHA SAI ANTES DE A NOVA ENTRAR.

        "A audiência, anteriormente designada para 03/06/2026, foi REDESIGNADA
        para 28/05/2026 08:30" — se a de 03/06 ficar, o processo passa a ter
        duas audiências abertas, e a ERRADA é a que aparece primeiro no
        calendário para quem for em maio.

        `exceto` protege o dia da nova: sem ele, numa segunda rodada o leitor
        cancelaria a pauta que ele mesmo acabou de criar.
      */
      if (leitura.pauta.remarcacao) {
        resumo.derrubadas += await this.automacao.derrubarPautasAbertas(c.processo.id, {
          desde: c.dataDisponibilizacao,
          exceto: leitura.pauta.inicio,
          motivo:
            `Pauta remarcada pelo juízo para ${formatarDataHoraBR(leitura.pauta.inicio)}, ` +
            `conforme o Diário de ${diaDaPublicacao(c.dataDisponibilizacao)}.`,
        });
      }

      const r = await this.automacao.agendarPauta({
        processo: c.processo,
        tipo: leitura.pauta.tipo,
        inicio: leitura.pauta.inicio,
        qualificador: leitura.pauta.rotulo || null,
        horaPresumida: leitura.pauta.horaPresumida,
        // A lápide: um ato anterior ao cancelamento não ressuscita a pauta.
        atoPublicadoEm: c.dataDisponibilizacao,
        /*
          O LOCAL É O ÓRGÃO, e não um endereço extraído do texto. O ato diz
          "Vara do Trabalho Eletrônica - VTePNB" num campo estruturado que o
          CNJ já manda (`nomeOrgao`); tentar achar a rua dentro do teor seria
          chutar, e endereço errado na agenda manda alguém para o lugar errado.
          Na audiência virtual o que importa é o link, e ele vem do texto.
        */
        local: leitura.pauta.modalidade === 'VIRTUAL'
          ? `${c.nomeOrgao ?? 'Juízo'} · audiência virtual`
          : (c.nomeOrgao ?? null),
        link: leitura.pauta.link,
        origem: `na publicação do Diário de ${diaDaPublicacao(c.dataDisponibilizacao)}`,
        responsavelId,
        secretariaId,
      });

      if (r.compromissoId) {
        await this.prisma.comunicacaoDjen.update({
          where: { id: c.id },
          data: {
            /*
              Só ocupa o vínculo se ele estiver VAZIO. Quando a publicação já
              aponta para uma atividade criada por outro caminho, sobrescrever
              apagaria em silêncio a ligação entre o ato e aquele trabalho — e
              a ficha deixaria de mostrar de onde ele veio.
            */
            ...(c.compromissoId ? {} : { compromissoId: r.compromissoId }),
            /*
              CLASSIFICADA, e por isto a correlação não volta nela.

              Sem este carimbo a publicação ficaria com `providencia` nula
              para sempre: a correlação a pula por causa do `compromissoId`, e
              a tela de Publicações mostraria "audiência marcada" como ato não
              classificado. É o mesmo rótulo que o classificador de texto daria
              (`PREPARAR_AUDIENCIA`) — a diferença é que aqui ele vem com data.
            */
            providencia: 'PREPARAR_AUDIENCIA',
            audienciaAvaliadaEm: new Date(),
            audienciaEm: leitura.pauta.inicio,
          },
        });
      }
      if (!r.criou && !r.compromissoId) {
        /*
          A LÁPIDE SEGUROU. Alguém — o juízo ou uma pessoa — derrubou esta
          pauta DEPOIS deste ato, e relê-lo não a traz de volta. Conta
          separado de `jaExistiam`: "já estava na agenda" e "foi cancelada e
          eu não desfiz" são fatos opostos, e somá-los esconderia os dois.
        */
        resumo.naoRessuscitadas++;
        await this.carimbar(c.id, MOTIVO_JA_DERRUBADA, leitura.pauta.inicio);
        continue;
      }
      if (r.criou) {
        resumo.agendadas++;
        this.logger.log(
          `[PAUTA-DJEN] ${c.numeroProcesso}: ${leitura.pauta.tipo.toLowerCase()} ` +
            `${leitura.pauta.rotulo} em ${formatarDataHoraBR(leitura.pauta.inicio)} ` +
            `(${leitura.pauta.modalidade.toLowerCase()}) — agendada.`,
        );
      } else {
        resumo.jaExistiam++;
      }
    }

    if (resumo.examinadas) {
      this.logger.log(
        `[PAUTA-DJEN] ${resumo.examinadas} publicação(ões) examinada(s): ` +
          `${resumo.agendadas} agendada(s), ${resumo.jaExistiam} já na agenda, ` +
          `${resumo.noPassado} já aconteceram, ${resumo.semPauta} não são designação` +
          `${resumo.derrubadas ? `, ${resumo.derrubadas} pauta(s) derrubada(s)` : ''}.`,
      );
    }
    return resumo;
  }

  /**
   * O DONO DO CASO — o `principal` da equipe, e não o primeiro citado.
   *
   * `processos_advogados.principal` bate 131/131 na produção
   * (`senatepi-dono-do-caso`). O atalho `processo.advogadoId` é derivado e pode
   * ter sido recalculado; ele entra como segunda opção, e o Administrador mais
   * antigo como terceira — a mesma escada que o robô de prazos já usa.
   */
  private async donoDoCaso(processoId: string, advogadoIdDerivado: string | null) {
    const principal = await this.prisma.processoAdvogado.findFirst({
      where: { processoId, principal: true, advogado: { ativo: true } },
      select: { advogadoId: true },
    });
    return this.automacao.responsavelParaPauta(principal?.advogadoId ?? advogadoIdDerivado);
  }

  /**
   * CARIMBA A DECISÃO DO ROBÔ — nunca a dispensa de uma pessoa.
   *
   * Colunas próprias (`audiencia_avaliada_*`), separadas de
   * `tarefaDispensadaEm`, porque as duas têm efeitos opostos na tela: a da
   * pessoa cala o aviso; a do robô é o que torna o aviso necessário. Em
   * 17/09/2026 o robô escreveu na coluna de gente e 65 andamentos sumiram da
   * agenda E da tela no mesmo movimento.
   */
  private async carimbar(id: string, motivo: string, audienciaEm?: Date) {
    await this.prisma.comunicacaoDjen.update({
      where: { id },
      data: { audienciaAvaliadaEm: new Date(), audienciaAvaliadaMotivo: motivo, audienciaEm: audienciaEm ?? null },
    });
  }
}

/** Publicação de audiência que o robô viu e não agendou — e por quê. */
export const MOTIVO_SEM_PROCESSO = 'SEM_PROCESSO_CADASTRADO';
export const MOTIVO_SEM_RESPONSAVEL = 'SEM_RESPONSAVEL';
export const MOTIVO_JA_ACONTECEU = 'JA_ACONTECEU';
/** O ato designa uma pauta que foi derrubada DEPOIS dele — não ressuscita. */
export const MOTIVO_JA_DERRUBADA = 'PAUTA_JA_DERRUBADA';

export interface ResumoDaVarreduraDePautas {
  examinadas: number;
  agendadas: number;
  jaExistiam: number;
  noPassado: number;
  semPauta: number;
  semProcesso: number;
  /** Tem pauta e processo, mas ninguém a quem entregar — nem advogado, nem Administrador. */
  semResponsavel: number;
  /** Pautas canceladas ou remarcadas pelo juízo que saíram da agenda. */
  derrubadas: number;
  /** Atos relidos cuja pauta já havia sido derrubada depois deles. */
  naoRessuscitadas: number;
  porMotivo: Partial<Record<MotivoSemPauta | string, number>>;
}

/** "13/10/2026" a partir de uma coluna `@db.Date` — sem deslocar por fuso. */
function diaDaPublicacao(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  const [a, m, dia] = iso.split('-');
  return `${dia}/${m}/${a}`;
}
