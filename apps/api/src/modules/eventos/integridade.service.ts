import { mascararCpf } from '@core/infra';
import { Injectable, NotFoundException } from '@nestjs/common';
import { OrigemPresenca } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * INTEGRIDADE DA ASSEMBLEIA — o que a mesa precisa olhar antes de homologar.
 *
 * POR QUE ISTO EXISTE
 * -------------------------------------------------------------------------
 * O check-in remoto é liberado por CPF, e CPF não é segredo: está na folha de
 * pagamento, em documento entregue a terceiros e em vazamentos públicos. Quem
 * tem o CPF de um associado consegue registrar a presença dele e, com o
 * `presencaId` devolvido, VOTAR no lugar dele. Não há, hoje, um segundo fator
 * que impeça isso — e trocar o fator no meio de uma eleição em andamento
 * deixaria de fora o associado legítimo, que é um estrago maior que o ataque.
 *
 * A resposta possível AGORA é a que a auditoria eleitoral sempre usou:
 * não impedir às cegas, mas TORNAR VISÍVEL. Este serviço não escreve nada, não
 * bloqueia ninguém e não muda o fluxo de voto — ele só lê o que o sistema já
 * grava (IP, horário, origem) e mostra à mesa os padrões que merecem um olhar.
 *
 * O QUE ELE NÃO É
 * -------------------------------------------------------------------------
 * NÃO é prova de fraude, e a tela precisa dizer isso. IP repetido tem
 * explicação inocente na maioria das vezes: marido e mulher no mesmo Wi-Fi, o
 * plantão inteiro de um hospital saindo pelo mesmo NAT, a sede do sindicato com
 * um computador emprestado para quem não tem celular. Tratar coincidência como
 * culpa anularia voto legítimo — que é exatamente o dano que se quer evitar.
 *
 * O uso correto é: a mesa olha, pergunta, e decide com o que souber do caso.
 */

/** Acima disto, um mesmo endereço deixa de ser "casal" e vira pergunta. */
const IP_SUSPEITO_A_PARTIR_DE = 3;

/**
 * Janela para "rajada": check-ins do mesmo IP separados por menos que isto
 * sugerem automação, não pessoas digitando.
 */
const SEGUNDOS_ENTRE_CHECKINS_SUSPEITO = 20;

export interface PresencaAgrupada {
  presencaId: string;
  nome: string;
  matricula: string | null;
  cpfMascarado: string | null;
  registradoEm: Date;
  identificado: boolean;
  votou: boolean;
}

export interface GrupoIp {
  ip: string;
  quantidade: number;
  /** Menor intervalo entre dois check-ins do grupo, em segundos. */
  menorIntervaloSegundos: number | null;
  /** Rajada = intervalo curto demais para ter sido digitado por pessoas. */
  pareceAutomacao: boolean;
  participantes: PresencaAgrupada[];
}

@Injectable()
export class IntegridadeAssembleiaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Agrupa as presenças REMOTAS por endereço de origem.
   *
   * Só o autoatendimento entra: o check-in presencial por QR é feito pela
   * própria mesa, de um único aparelho, e apareceria aqui como o maior "grupo
   * suspeito" da lista — ruído puro, escondendo o que interessa.
   */
  async presencasPorOrigem(eventoId: string): Promise<{
    evento: { id: string; nome: string };
    totalRemotas: number;
    gruposSuspeitos: GrupoIp[];
    semIp: number;
  }> {
    const evento = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: { id: true, nome: true },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const presencas = await this.prisma.presenca.findMany({
      where: { eventoId, origem: OrigemPresenca.AUTOATENDIMENTO_VIRTUAL },
      orderBy: { registradoEm: 'asc' },
      select: {
        id: true, ip: true, registradoEm: true, nomeSnapshot: true,
        cpfInformado: true, filiadoId: true,
        filiado: { select: { matricula: true } },
      },
    });

    // Quem já votou em ALGUMA pauta deste evento — é o que separa "presença
    // estranha" de "voto que precisa ser olhado antes da homologação".
    const votantes = new Set(
      (
        await this.prisma.votoHabilitacao.findMany({
          where: { pauta: { eventoId } },
          select: { filiadoId: true },
        })
      ).map((v) => v.filiadoId),
    );

    const porIp = new Map<string, typeof presencas>();
    let semIp = 0;
    for (const p of presencas) {
      if (!p.ip) {
        semIp++;
        continue;
      }
      const lista = porIp.get(p.ip) ?? [];
      lista.push(p);
      porIp.set(p.ip, lista);
    }

    const grupos: GrupoIp[] = [];
    for (const [ip, lista] of porIp) {
      if (lista.length < IP_SUSPEITO_A_PARTIR_DE) continue;

      // A lista já vem ordenada por horário — o menor intervalo é entre vizinhos.
      let menor: number | null = null;
      for (let i = 1; i < lista.length; i++) {
        const dif = Math.round(
          (lista[i].registradoEm.getTime() - lista[i - 1].registradoEm.getTime()) / 1000,
        );
        if (menor === null || dif < menor) menor = dif;
      }

      grupos.push({
        ip,
        quantidade: lista.length,
        menorIntervaloSegundos: menor,
        pareceAutomacao: menor !== null && menor <= SEGUNDOS_ENTRE_CHECKINS_SUSPEITO,
        participantes: lista.map((p) => ({
          presencaId: p.id,
          nome: p.nomeSnapshot,
          matricula: p.filiado?.matricula ?? null,
          // LGPD: a mesa precisa reconhecer a pessoa, não ler o documento dela.
          cpfMascarado: p.cpfInformado ? mascararCpf(p.cpfInformado) : null,
          registradoEm: p.registradoEm,
          identificado: !!p.filiadoId,
          votou: !!p.filiadoId && votantes.has(p.filiadoId),
        })),
      });
    }

    // O que parece automação vem primeiro; depois os grupos maiores. É a ordem
    // em que a mesa deve gastar o tempo dela.
    grupos.sort((a, b) => {
      if (a.pareceAutomacao !== b.pareceAutomacao) return a.pareceAutomacao ? -1 : 1;
      return b.quantidade - a.quantidade;
    });

    return {
      evento,
      totalRemotas: presencas.length,
      gruposSuspeitos: grupos,
      semIp,
    };
  }

  /**
   * Resumo de uma linha para o topo do painel da mesa.
   *
   * Serve para o caso normal — nenhuma anomalia — não exigir que ninguém abra
   * uma tela e interprete uma tabela vazia. "Nada a revisar" é uma resposta, e
   * ela precisa ser dada.
   */
  async resumoIntegridade(eventoId: string) {
    const dados = await this.presencasPorOrigem(eventoId);
    const emGrupo = dados.gruposSuspeitos.reduce((s, g) => s + g.quantidade, 0);
    const comVoto = dados.gruposSuspeitos.reduce(
      (s, g) => s + g.participantes.filter((p) => p.votou).length,
      0,
    );
    const automacao = dados.gruposSuspeitos.filter((g) => g.pareceAutomacao).length;

    return {
      totalRemotas: dados.totalRemotas,
      gruposSuspeitos: dados.gruposSuspeitos.length,
      presencasEmGrupo: emGrupo,
      votosEmGrupo: comVoto,
      gruposComCaraDeAutomacao: automacao,
      /**
       * A frase que a tela mostra. Escrita aqui, e não no front, porque ela é a
       * interpretação do dado — e interpretação divergindo entre API e tela é
       * como um alerta vira ruído.
       */
      veredito:
        automacao > 0
          ? 'Há check-ins em rajada do mesmo endereço — confira antes de homologar.'
          : dados.gruposSuspeitos.length > 0
            ? 'Há endereços com vários participantes. Costuma ser família ou rede compartilhada; confira os maiores.'
            : 'Nenhum padrão fora do comum nas presenças remotas.',
    };
  }
}
