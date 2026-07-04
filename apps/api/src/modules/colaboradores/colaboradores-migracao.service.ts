import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  StatusColaborador,
  TipoFuncionario,
  TipoVinculo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Unificação: migra os cadastros legados de Funcionários (e Prestadores pessoa
 * física) para o novo modelo de Colaboradores.
 *
 * Idempotente e NÃO-destrutivo: só cria o Colaborador quando ainda não existe um
 * com o mesmo CPF; os registros originais NÃO são apagados (Presenças/QR e
 * Documentos ainda os referenciam — evita quebrar o histórico de check-in).
 * Cargos/Departamentos são derivados dos textos livres (tabelas de domínio).
 */
@Injectable()
export class ColaboradoresMigracaoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ColaboradoresMigracaoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const funcs = await this.migrarFuncionarios();
      const prests = await this.migrarPrestadoresPF();
      if (funcs + prests > 0)
        this.logger.log(`Unificação: ${funcs} funcionário(s) e ${prests} prestador(es) PF migrados para colaboradores.`);
    } catch (e) {
      // Uma falha aqui não deve derrubar o boot da API.
      this.logger.error('Falha ao migrar funcionários/prestadores para colaboradores.', e as Error);
    }
  }

  private mapTipo(tipo: TipoFuncionario): TipoVinculo {
    switch (tipo) {
      case TipoFuncionario.PRESTADOR_SERVICO:
        return TipoVinculo.PJ;
      case TipoFuncionario.ESTAGIARIO:
        return TipoVinculo.ESTAGIO;
      case TipoFuncionario.TERCEIRIZADO:
        return TipoVinculo.TERCEIRIZADO;
      default:
        return TipoVinculo.CLT;
    }
  }

  /** Garante (upsert) um domínio pelo nome e devolve o id. */
  private async cargoId(nome: string): Promise<string> {
    const n = (nome || 'Não informado').trim() || 'Não informado';
    const c = await this.prisma.cargo.upsert({ where: { nome: n }, update: {}, create: { nome: n } });
    return c.id;
  }
  private async departamentoId(nome: string): Promise<string> {
    const n = (nome || 'Não informado').trim() || 'Não informado';
    const d = await this.prisma.departamento.upsert({ where: { nome: n }, update: {}, create: { nome: n } });
    return d.id;
  }

  private async cpfDisponivel(cpf: string): Promise<boolean> {
    if (cpf.length !== 11) return false;
    const existe = await this.prisma.colaborador.findUnique({ where: { cpf }, select: { id: true } });
    return !existe;
  }

  private async migrarFuncionarios(): Promise<number> {
    const funcionarios = await this.prisma.funcionario.findMany();
    let migrados = 0;
    for (const f of funcionarios) {
      const cpf = f.cpf.replace(/\D/g, '');
      if (!(await this.cpfDisponivel(cpf))) continue;

      await this.prisma.colaborador.create({
        data: {
          nome: f.nome,
          cpf,
          tipoVinculo: this.mapTipo(f.tipo),
          // Os valores de StatusFuncionario coincidem com StatusColaborador.
          status: f.status as unknown as StatusColaborador,
          dataNascimento: f.dataNascimento,
          telefone: f.telefone,
          email: f.email,
          dataAdmissao: f.dataAdmissao,
          cep: f.cep,
          logradouro: f.endereco,
          numero: f.numero,
          bairro: f.bairro,
          cidade: f.cidade,
          uf: f.estado,
          cargoId: await this.cargoId(f.cargo ?? ''),
          departamentoId: await this.departamentoId(f.departamento ?? ''),
        },
      });
      migrados++;
    }
    return migrados;
  }

  private async migrarPrestadoresPF(): Promise<number> {
    const prestadores = await this.prisma.prestador.findMany();
    let migrados = 0;
    for (const p of prestadores) {
      const cpf = p.cpfCnpj.replace(/\D/g, '');
      // Só pessoa física (11 dígitos) — PJ é empresa, não colaborador.
      if (!(await this.cpfDisponivel(cpf))) continue;

      await this.prisma.colaborador.create({
        data: {
          nome: p.nome,
          cpf,
          tipoVinculo: TipoVinculo.TERCEIRIZADO,
          status: p.status === 'ATIVO' ? StatusColaborador.ATIVO : StatusColaborador.INATIVO,
          telefone: p.telefone,
          email: p.email,
          vencimentoContrato: p.vigenciaFim,
          cargoId: await this.cargoId('Prestador de Serviço'),
          departamentoId: await this.departamentoId('Terceirizados'),
        },
      });
      migrados++;
    }
    return migrados;
  }
}
