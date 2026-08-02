import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AcaoAuditoria, ModoVotacao, SituacaoFiliado, StatusPauta, TipoHistoricoFiliado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { mascararCpf } from '../../common/utils/matricula.util';
import { termosDeBusca } from '../../common/utils/busca.util';
import { AuditService } from '../../common/audit/audit.service';

/**
 * Lista de presença para consumo em TELA (e planilha).
 *
 * Existe separada da consulta genérica de `presencas` porque o recorte de
 * dados é diferente: aqui o CPF sai mascarado e o IP não sai. O endereço IP
 * tem finalidade probatória — pertence ao dossiê, documento de circulação
 * restrita — e não a uma tela que fica aberta no telão durante a assembleia.
 * Exibir dado pessoal sem finalidade é o que a LGPD chama de excesso
 * (art. 6º, III — necessidade).
 */
@Injectable()
export class PresencaListaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Vincula uma presença ao cadastro do filiado — a resolução pela mesa.
   *
   * Existe porque 70% da base histórica não tem CPF: quando o autoatendimento
   * não consegue identificar com segurança (nome repetido, cadastro ausente),
   * ele registra a presença SEM vínculo e deixa a decisão para um humano.
   * Adivinhar entre homônimos seria dar o voto de uma pessoa a outra — e a
   * base tem 1.309 grupos de nomes repetidos.
   *
   * Vincular é o que habilita a pessoa a votar e a contar para o quórum:
   * enquanto ninguém confirmou que ela é associada, ela é visitante.
   */
  async vincular(
    eventoId: string,
    presencaId: string,
    filiadoId: string,
    autor?: string,
  ) {
    const [presenca, filiado] = await Promise.all([
      this.prisma.presenca.findFirst({
        where: { id: presencaId, eventoId },
        select: { id: true, filiadoId: true, cpfInformado: true, nomeSnapshot: true },
      }),
      this.prisma.filiado.findUnique({
        where: { id: filiadoId },
        select: { id: true, nomeCompleto: true, matricula: true, cpf: true, situacao: true },
      }),
    ]);
    if (!presenca) throw new NotFoundException('Presença não encontrada neste evento.');
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');
    if (presenca.filiadoId) {
      throw new ConflictException('Esta presença já está vinculada a um cadastro.');
    }

    // Uma presença por filiado no evento — é o mesmo unique que impede entrada
    // duplicada. Vincular a quem já entrou criaria dois registros da mesma
    // pessoa e inflaria o quórum.
    const jaPresente = await this.prisma.presenca.findFirst({
      where: { eventoId, filiadoId },
      select: { id: true },
    });
    if (jaPresente) {
      throw new ConflictException(
        `${filiado.nomeCompleto} já consta como presente neste evento.`,
      );
    }

    const cpf = presenca.cpfInformado;
    // Aproveita para completar o cadastro, mas só se estiver vazio: sobrescrever
    // um CPF existente com o que alguém digitou seria corromper o cadastro.
    const podeGravarCpf = !!cpf && !filiado.cpf;

    await this.prisma.$transaction(async (tx) => {
      await tx.presenca.update({
        where: { id: presencaId },
        data: { filiadoId, nomeSnapshot: filiado.nomeCompleto },
      });

      if (podeGravarCpf) {
        await tx.filiado.update({ where: { id: filiadoId }, data: { cpf } });
      }

      await tx.filiadoHistorico.create({
        data: {
          filiadoId,
          tipo: TipoHistoricoFiliado.ALTERACAO,
          descricao:
            `Presença em evento confirmada pela mesa (registro estava sem vínculo, ` +
            `informado como "${presenca.nomeSnapshot}").` +
            (podeGravarCpf ? ' O CPF informado foi gravado no cadastro, que estava vazio.' : ''),
          autor,
          metadata: { eventoId, presencaId, cpfGravado: podeGravarCpf },
        },
      });
    });

    await this.audit.registrar({
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Presenca',
      entidadeId: presencaId,
      descricao:
        `Presença vinculada a ${filiado.nomeCompleto} (${filiado.matricula}) pela mesa.` +
        (podeGravarCpf ? ' CPF gravado no cadastro.' : ''),
      metadata: { eventoId, filiadoId, cpfGravado: podeGravarCpf },
    });

    return {
      ok: true,
      cpfGravado: podeGravarCpf,
      filiado: { nome: filiado.nomeCompleto, matricula: filiado.matricula },
    };
  }

  /**
   * Candidatos a vincular a uma presença — busca pelo nome informado.
   *
   * Reusa a busca normalizada da listagem de filiados (ignora acento, caixa e
   * ordem das palavras), que é a mesma que a secretaria já usa no dia a dia.
   */
  async candidatos(eventoId: string, presencaId: string) {
    const presenca = await this.prisma.presenca.findFirst({
      where: { id: presencaId, eventoId },
      select: { nomeSnapshot: true, cpfInformado: true },
    });
    if (!presenca) throw new NotFoundException('Presença não encontrada neste evento.');

    const termos = termosDeBusca(presenca.nomeSnapshot);
    if (termos.length === 0) return { nomeInformado: presenca.nomeSnapshot, candidatos: [] };

    const candidatos = await this.prisma.filiado.findMany({
      where: {
        situacao: SituacaoFiliado.ATIVO,
        AND: termos.map((t) => ({ buscaNormalizada: { contains: t } })),
        // Quem já está presente não é candidato — evita o erro antes do clique.
        NOT: { presencas: { some: { eventoId } } },
      },
      select: {
        id: true, nomeCompleto: true, matricula: true, cpf: true,
        cidade: true, dataNascimento: true,
      },
      take: 20,
    });

    return {
      nomeInformado: presenca.nomeSnapshot,
      cpfInformado: presenca.cpfInformado ? mascararCpf(presenca.cpfInformado) : null,
      candidatos: candidatos.map((c) => ({
        id: c.id,
        nome: c.nomeCompleto,
        matricula: c.matricula,
        temCpf: !!c.cpf,
        cidade: c.cidade,
        nascimento: c.dataNascimento,
      })),
    };
  }

  async listar(eventoId: string) {
    const evento = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const presencas = await this.prisma.presenca.findMany({
      where: { eventoId },
      orderBy: { registradoEm: 'asc' },
      select: {
        id: true,
        nomeSnapshot: true,
        registradoEm: true,
        origem: true,
        cpfInformado: true,
        tipoPessoa: true,
        filiadoId: true,
        filiado: { select: { matricula: true, cpf: true } },
      },
    });

    return presencas.map((p) => ({
      presencaId: p.id,
      filiadoId: p.filiadoId,
      nome: p.nomeSnapshot,
      matricula: p.filiado?.matricula ?? '—',
      // Mascarado sempre. O CPF completo já está no cadastro do filiado, para
      // quem tem acesso a ele; repeti-lo aqui só aumenta a exposição.
      cpf: p.cpfInformado || p.filiado?.cpf ? mascararCpf(p.cpfInformado ?? p.filiado!.cpf!) : '—',
      registradoEm: p.registradoEm,
      origem: p.origem,
      tipoPessoa: p.tipoPessoa,
      // Sem vinculo = nao vota e nao conta para quorum ate a mesa confirmar.
      identificado: !!p.filiadoId,
    }));
  }

  /**
   * CSV da presença, cruzado com a participação nas votações.
   *
   * A coluna "votou em N pauta(s)" é o que torna a planilha útil: presença
   * sozinha não distingue quem ficou até o fim de quem entrou e saiu. Em
   * pautas NOMINAIS o voto de cada um também entra — em pautas secretas isso
   * não existe nem aqui, por construção.
   */
  async csv(eventoId: string): Promise<string> {
    const [lista, pautas] = await Promise.all([
      this.listar(eventoId),
      this.prisma.pautaVotacao.findMany({
        where: { eventoId, status: StatusPauta.ENCERRADA },
        orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, titulo: true, modo: true, opcoes: true,
          habilitacoes: { select: { filiadoId: true } },
          votos: { select: { filiadoId: true, opcaoId: true } },
        },
      }),
    ]);

    const rotuloDaOpcao = (p: (typeof pautas)[number], opcaoId: string) =>
      ((p.opcoes as unknown as { id: string; rotulo: string }[]) ?? [])
        .find((o) => o.id === opcaoId)?.rotulo ?? opcaoId;

    const cabecalho = [
      'Nome', 'Matrícula', 'CPF', 'Data/hora', 'Origem', 'Votações em que votou',
      ...pautas.map((p) => `${p.titulo}${p.modo === ModoVotacao.SECRETA ? ' (secreta)' : ''}`),
    ];

    const linhas = lista.map((pessoa) => {
      const votouEm = pautas.filter((p) =>
        p.habilitacoes.some((h) => h.filiadoId === pessoa.filiadoId),
      );

      const porPauta = pautas.map((p) => {
        const habilitado = p.habilitacoes.some((h) => h.filiadoId === pessoa.filiadoId);
        if (!habilitado) return 'não votou';
        if (p.modo === ModoVotacao.SECRETA) return 'votou (secreto)';
        const voto = p.votos.find((v) => v.filiadoId === pessoa.filiadoId);
        return voto ? rotuloDaOpcao(p, voto.opcaoId) : 'votou';
      });

      return [
        pessoa.nome,
        pessoa.matricula,
        pessoa.cpf,
        new Date(pessoa.registradoEm).toLocaleString('pt-BR'),
        pessoa.origem.replace(/_/g, ' ').toLowerCase(),
        String(votouEm.length),
        ...porPauta,
      ];
    });

    return [cabecalho, ...linhas].map((l) => l.map(this.campo).join(';')).join('\r\n');
  }

  /**
   * Separador `;` e não `,`: o Excel em português usa vírgula como decimal e
   * abre CSV com vírgula tudo numa coluna só.
   */
  private campo(v: string): string {
    const s = String(v ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
}
