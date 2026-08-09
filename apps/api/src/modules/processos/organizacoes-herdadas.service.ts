import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { tenant } from '../../tenant/tenant.config';

/**
 * TIRA DO CADASTRO OS EMPREGADORES DE OUTRO SINDICATO.
 *
 * O DEFEITO, encontrado no SINDSERM em uso real. A migration
 * `20260802120000_locais_trabalho_e_modalidade` semeia oito empregadores da
 * ENFERMAGEM — HGV, HUT, PRONTOCARE, Maternidade Evangelina Rosa, Natan
 * Portella, SESAPI (que é ESTADUAL) — para o combobox do SENATEPI já nascer
 * útil. Migration não sabe de qual cliente é o banco: **todo cliente novo nasce
 * com os hospitais do SENATEPI dentro**. O SINDSERM, sindicato de servidores
 * MUNICIPAIS, abriu a tela de organizações e encontrou PRONTOCARE ali. E ainda
 * "FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA", que DUPLICA a "Fundação Municipal
 * de Saúde" da carga própria do SINDSERM — duas linhas para o mesmo órgão.
 *
 * É a mesma família de defeito que já custou caro duas vezes: a parte
 * institucional semeada com o nome do SENATEPI em SQL, e a colônia de férias
 * criada em cliente que não tem colônia. Migration é o lugar errado para dado
 * de um cliente.
 *
 * A MIGRATION NÃO PODE SER REESCRITA — já rodou em produção. Quem passa a
 * mandar é `tenant.empregadoresIniciais`.
 *
 * O QUE ESTE SERVIÇO APAGA, e só isto:
 *  · linha cujo nome está na lista SEMEADA PELA MIGRATION (não qualquer linha);
 *  · que esta instalação NÃO declara em `empregadoresIniciais`;
 *  · que não é a parte institucional;
 *  · e que NINGUÉM usa — zero vínculos e zero participações em processo.
 *
 * As quatro condições juntas. A última é a que torna a remoção segura: se
 * alguém já ligou um filiado ou um processo àquela organização, ela deixou de
 * ser lixo herdado e virou dado do cliente — e aí fica, mesmo parecendo fora de
 * lugar. Corrigir cadastro é decisão de pessoa; o robô só recolhe o que nunca
 * foi usado.
 *
 * Roda no boot e é idempotente: na segunda vez não há mais o que remover.
 */

/**
 * A lista exata que a migration insere. Escrita aqui porque é ELA que este
 * serviço recolhe — copiar da migration é de propósito: se um dia alguém
 * acrescentar um nome lá, este arquivo continua removendo só o que conhece, em
 * vez de varrer o cadastro por heurística.
 */
const SEMEADOS_PELA_MIGRATION = [
  'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA',
  'SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ',
  'HOSPITAL UNIVERSITÁRIO DA UFPI',
  'MATERNIDADE DONA EVANGELINA ROSA',
  'HOSPITAL GETÚLIO VARGAS',
  'HOSPITAL DE URGÊNCIA DE TERESINA',
  'INSTITUTO DE DOENÇAS TROPICAIS NATAN PORTELLA',
  'PRONTOCARE',
];

@Injectable()
export class OrganizacoesHerdadasService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrganizacoesHerdadasService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const reconhecidos = new Set((tenant.empregadoresIniciais ?? []).map((n) => n.toUpperCase()));
    const aRecolher = SEMEADOS_PELA_MIGRATION.filter((n) => !reconhecidos.has(n.toUpperCase()));
    if (aRecolher.length === 0) return; // o SENATEPI declara todos: nada a fazer

    try {
      const candidatas = await this.prisma.parteExterna.findMany({
        where: {
          nome: { in: aRecolher, mode: 'insensitive' },
          institucional: false,
          // Zero uso: é o que separa "lixo herdado" de "dado do cliente".
          vinculos: { none: {} },
          participacoes: { none: {} },
        },
        select: { id: true, nome: true },
      });
      if (candidatas.length === 0) return;

      await this.prisma.parteExterna.deleteMany({
        where: { id: { in: candidatas.map((c) => c.id) } },
      });

      this.logger.warn(
        `${candidatas.length} organização(ões) de OUTRO sindicato removida(s) do cadastro — ` +
          `semeadas por migration e nunca usadas nesta instalação: ` +
          `${candidatas.map((c) => c.nome).join('; ')}.`,
      );
    } catch (e) {
      // Falha aqui não derruba o boot: o efeito é um cadastro com linha a mais,
      // e não um sistema fora do ar.
      this.logger.error('Falha ao recolher organizações herdadas.', e as Error);
    }
  }
}
