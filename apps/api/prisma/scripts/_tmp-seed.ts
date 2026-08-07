/** Cria uma audiência designada RECENTE, como o TRT22 devolveria. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const p = await prisma.processo.findFirst({ where: { numeroCNJ: { not: null }, statusInterno: 'ATIVO' }, select: { id: true, numeroCNJ: true } });
  const i = await prisma.processoInstancia.findFirst({ where: { processoId: p!.id }, select: { id: true } });
  const m = await prisma.movimentacaoProcessual.create({
    data: {
      processoId: p!.id, instanciaId: i!.id, dataMovimento: new Date(),
      descricao: 'de Instrução', codigoMovimento: 12749, detalhe: 'Juiz(a) · designada',
      complementos: [{ descricao: 'dirigida_por', nome: 'Juiz(a)' }, { descricao: 'situacao_da_audiencia', nome: 'designada' }],
      ehAudiencia: true,
    },
    select: { id: true },
  });
  console.log('processo', p!.numeroCNJ, '| movimentação criada', m.id);
})().finally(() => prisma.$disconnect());
