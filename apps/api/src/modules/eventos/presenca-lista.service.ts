import { Injectable, NotFoundException } from '@nestjs/common';
import { ModoVotacao, StatusPauta } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { mascararCpf } from '../../common/utils/matricula.util';

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
  constructor(private readonly prisma: PrismaService) {}

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
