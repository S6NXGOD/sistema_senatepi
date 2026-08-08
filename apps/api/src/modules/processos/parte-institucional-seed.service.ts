import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { TipoParteExterna } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANTS, moduloAtivo, tenant } from '../../tenant/tenant.config';

/**
 * O PRÓPRIO SINDICATO, COMO PARTE DE PROCESSO.
 *
 * Toda ação institucional tem o sindicato no polo ativo, e o sistema o encontra
 * por `partes_externas.institucional = true`.
 *
 * POR QUE ISTO EXISTE. A linha era semeada por uma migration
 * (`20260801230000_processo_acao_institucional`) com o nome do SENATEPI
 * ESCRITO EM SQL. Migration não sabe de qual cliente é o banco — então o
 * SINDSERM nasceu com o SENATEPI no polo ativo, e todo processo importado lá
 * entraria com o sindicato errado no registro da ação. A migration não pode ser
 * reescrita (já rodou em produção); quem passa a mandar é este serviço.
 *
 * O QUE ELE FAZ, E O QUE NÃO FAZ:
 *  · não existe nenhuma → cria com os dados desta instalação;
 *  · existe e é a desta instalação → não encosta;
 *  · existe e é de OUTRO cliente registrado → corrige, e avisa alto.
 *
 * O terceiro caso é cirúrgico de propósito. Sobrescrever sempre apagaria a
 * correção que a secretaria fez pela tela de Partes — razão social e CNPJ são
 * editados lá justamente porque saem em petição. Só se mexe quando dá para
 * provar que a linha é de outro sindicato: a sigla é a de um cliente
 * registrado, e não a nossa.
 */
@Injectable()
export class ParteInstitucionalSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ParteInstitucionalSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    // A parte institucional só é usada em processo. Sem o módulo, não há o que
    // semear — a lição do seed da colônia, que criava dados de um módulo que o
    // cliente nem enxergava.
    if (!moduloAtivo('processos')) return;

    try {
      const atual = await this.prisma.parteExterna.findFirst({
        where: { institucional: true },
        select: { id: true, nome: true, nomeFantasia: true },
      });

      if (!atual) {
        await this.prisma.parteExterna.create({
          data: {
            tipo: TipoParteExterna.JURIDICA,
            nome: tenant.nome,
            nomeFantasia: tenant.sigla,
            // O CNPJ do tenant vem formatado; a coluna guarda só dígitos.
            documento: tenant.cnpj.replace(/\D/g, '') || null,
            cidade: tenant.endereco.cidade,
            uf: tenant.endereco.uf,
            institucional: true,
          },
        });
        this.logger.log(`Parte institucional criada: ${tenant.sigla}.`);
        return;
      }

      if (atual.nomeFantasia === tenant.sigla) return;

      /**
       * A sigla gravada é de outro sindicato REGISTRADO? Então não é correção
       * manual da secretaria — é a linha errada, e consertá-la é o certo.
       */
      const siglasDeOutros = Object.values(TENANTS)
        .filter((t) => t.id !== tenant.id)
        .map((t) => t.sigla);

      if (!atual.nomeFantasia || !siglasDeOutros.includes(atual.nomeFantasia)) return;

      await this.prisma.parteExterna.update({
        where: { id: atual.id },
        data: {
          nome: tenant.nome,
          nomeFantasia: tenant.sigla,
          documento: tenant.cnpj.replace(/\D/g, '') || null,
          cidade: tenant.endereco.cidade,
          uf: tenant.endereco.uf,
        },
      });
      this.logger.warn(
        `Parte institucional estava como "${atual.nomeFantasia}", de outro cliente. ` +
          `Corrigida para ${tenant.sigla}. Confira os processos importados antes desta correção.`,
      );
    } catch (e) {
      // Falha aqui não pode derrubar o boot: sem a parte institucional, o que
      // deixa de funcionar é a ação institucional — o resto do sistema segue.
      this.logger.error('Falha ao conferir a parte institucional.', e as Error);
    }
  }
}
