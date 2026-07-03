import {
  PrismaClient,
  UserRole,
  Sexo,
  EstadoCivil,
  FormacaoProfissional,
  SituacaoFiliado,
  TipoDependente,
  StatusGenerico,
  StatusFuncionario,
  TipoFuncionario,
  TipoPrestador,
  TipoEvento,
  StatusEvento,
} from '@prisma/client';
import { seedColonia } from './seed-colonia';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do SENATEPI...');

  // ---- Usuários (um por perfil) ----
  const senhaPadrao = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'senatepi@2026', 12);
  const usuarios = [
    { nome: 'Administrador', email: 'admin@senatepi.org.br', role: UserRole.ADMIN },
    { nome: 'Diretoria', email: 'diretoria@senatepi.org.br', role: UserRole.DIRETORIA },
    { nome: 'Funcionário', email: 'funcionario@senatepi.org.br', role: UserRole.FUNCIONARIO },
    { nome: 'Recepção', email: 'recepcao@senatepi.org.br', role: UserRole.RECEPCAO },
  ];
  for (const u of usuarios) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, senhaHash: senhaPadrao },
    });
  }
  console.log(`✓ ${usuarios.length} usuários criados (senha via SEED_ADMIN_PASSWORD)`);

  // ---- Filiado de exemplo + dependentes + carteirinha ----
  const filiado = await prisma.filiado.upsert({
    where: { cpf: '12345678901' },
    update: {},
    create: {
      matricula: 'SEN-2026-000001',
      nomeCompleto: 'Maria da Silva Santos',
      cpf: '12345678901',
      rg: '1234567',
      ufRg: 'PI',
      dataNascimento: new Date('1988-04-12'),
      sexo: Sexo.FEMININO,
      estadoCivil: EstadoCivil.CASADO,
      naturalidade: 'Teresina/PI',
      telefonePrincipal: '(86) 99999-0001',
      email: 'maria.santos@example.com',
      cep: '64000-000',
      endereco: 'Av. Frei Serafim',
      numero: '1000',
      bairro: 'Centro',
      cidade: 'Teresina',
      estado: 'PI',
      formacao: FormacaoProfissional.ENFERMEIRO,
      numeroCoren: 'COREN-PI 123456',
      dataAdmissao: new Date('2015-02-01'),
      situacao: SituacaoFiliado.ATIVO,
      aprovadoEm: new Date(),
      qrToken: randomUUID(),
      vinculos: {
        create: [
          { empresa: 'Hospital Getúlio Vargas', cargo: 'Enfermeira', matricula: 'HGV-998', ordem: 1 },
        ],
      },
      dependentes: {
        create: [
          {
            tipo: TipoDependente.CONJUGE,
            nome: 'João da Silva Santos',
            cpf: '98765432100',
            dataNascimento: new Date('1985-09-20'),
            qrToken: randomUUID(),
          },
          {
            tipo: TipoDependente.FILHO,
            nome: 'Ana da Silva Santos',
            dataNascimento: new Date('2012-06-15'),
            qrToken: randomUUID(),
          },
        ],
      },
    },
  });

  await prisma.carteirinha.upsert({
    where: { filiadoId: filiado.id },
    update: {},
    create: {
      filiadoId: filiado.id,
      numero: 'CART-2026-000001',
      validaAte: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });
  console.log('✓ Filiado de exemplo + 2 dependentes + carteirinha');

  // ---- Funcionário e prestador ----
  await prisma.funcionario.upsert({
    where: { cpf: '11122233344' },
    update: {},
    create: {
      matricula: 'FUNC-2026-000001',
      nome: 'Carlos Pereira',
      cpf: '11122233344',
      dataNascimento: new Date('1990-03-10'),
      dataAdmissao: new Date('2020-05-01'),
      telefone: '(86) 99888-1122',
      cargo: 'Assistente Administrativo',
      departamento: 'Administração',
      tipo: TipoFuncionario.FUNCIONARIO,
      status: StatusFuncionario.ATIVO,
      qrToken: randomUUID(),
    },
  });

  await prisma.prestador.upsert({
    where: { cpfCnpj: '12345678000199' },
    update: {},
    create: {
      nome: 'Limpeza Total LTDA',
      tipoPessoa: TipoPrestador.PESSOA_JURIDICA,
      cpfCnpj: '12345678000199',
      empresa: 'Limpeza Total LTDA',
      telefone: '(86) 3000-0000',
      contratoNumero: 'CT-2026-01',
      vigenciaInicio: new Date('2026-01-01'),
      vigenciaFim: new Date('2026-12-31'),
      status: StatusGenerico.ATIVO,
      qrToken: randomUUID(),
    },
  });
  console.log('✓ Funcionário e prestador de exemplo');

  // ---- Evento ----
  await prisma.evento.create({
    data: {
      nome: 'Assembleia Geral Ordinária 2026',
      descricao: 'Assembleia anual de prestação de contas',
      local: 'Auditório SENATEPI - Teresina/PI',
      dataInicio: new Date('2026-07-15T18:00:00'),
      capacidadeMaxima: 300,
      tipo: TipoEvento.ASSEMBLEIA,
      status: StatusEvento.AGENDADO,
    },
  });
  console.log('✓ Evento de exemplo');

  // ---- Colônia de Férias (inventário + Temporada Julho 2026) ----
  await seedColonia(prisma);

  console.log('✅ Seed concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
