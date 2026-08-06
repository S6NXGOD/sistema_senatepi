/**
 * FORÇAR LOGOUT DE TODOS — ferramenta pontual, NÃO é rotina.
 *
 * QUANDO USAR
 *  - uma conta administrativa foi usada para demonstração no aparelho de
 *    outra pessoa e precisa sair de lá;
 *  - usuários novos foram criados e cada um deve entrar com a própria conta;
 *  - suspeita de credencial exposta.
 *
 * O QUE ELE FAZ, E POR QUE SÃO DUAS COISAS
 *  1. Marca `sessoes_validas_apos = agora` em cada usuário. O token de acesso é
 *     um JWT autocontido e válido por 30 dias — apagar sessão do banco não o
 *     invalida. É esta marca que o `JwtStrategy` compara com o `iat` do token e
 *     que torna o corte imediato.
 *  2. Apaga TODOS os refresh tokens. Sem isso, o app receberia 401, pediria
 *     refresh, ganharia um token novo (com `iat` posterior ao corte) e
 *     continuaria logado — o corte não teria efeito nenhum.
 *
 * O QUE ELE NÃO FAZ
 * Não apaga, não desativa e não altera dado de ninguém. Depois de rodar, todos
 * entram normalmente com a própria senha.
 *
 * COMO RODAR
 *   npm run forcar-logout -w @senatepi/api           → pede confirmação
 *   npm run forcar-logout -w @senatepi/api -- --sim  → sem perguntar (deploy)
 *
 * Em produção (Railway), rodar no shell do serviço da API, onde a
 * `DATABASE_URL` já está no ambiente.
 */
import { PrismaClient } from '@prisma/client';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const prisma = new PrismaClient();

async function main() {
  const semPerguntar = process.argv.includes('--sim') || process.argv.includes('-y');

  const [usuarios, sessoes] = await Promise.all([
    prisma.user.count({ where: { ativo: true } }),
    prisma.refreshToken.count(),
  ]);

  console.log('');
  console.log('  FORÇAR LOGOUT DE TODOS');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Usuários ativos afetados : ${usuarios}`);
  console.log(`  Sessões a encerrar       : ${sessoes}`);
  console.log('');
  console.log('  Todos serão desconectados de todos os aparelhos e precisarão');
  console.log('  entrar de novo. Nenhum dado é apagado ou alterado.');
  console.log('');

  if (!semPerguntar) {
    const rl = createInterface({ input: stdin, output: stdout });
    const resposta = await rl.question('  Confirmar? digite SIM: ');
    rl.close();
    if (resposta.trim().toUpperCase() !== 'SIM') {
      console.log('\n  Cancelado — nada foi alterado.\n');
      return;
    }
  }

  const agora = new Date();

  // Ordem importa: o corte entra ANTES de apagar as sessões. Se as sessões
  // caíssem primeiro, um app que pedisse refresh nesse intervalo levaria um
  // token novo — que, sem o corte gravado, continuaria válido.
  const marcados = await prisma.user.updateMany({ data: { sessoesValidasApos: agora } });
  const apagadas = await prisma.refreshToken.deleteMany();

  console.log('');
  console.log(`  ✓ ${marcados.count} usuário(s) com sessões cortadas em ${agora.toLocaleString('pt-BR')}`);
  console.log(`  ✓ ${apagadas.count} sessão(ões) apagada(s)`);
  console.log('');
  console.log('  Quem estiver com o app aberto será levado à tela de login na');
  console.log('  próxima ação. Reabrir o app também basta.');
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n  ✗ Falha ao forçar logout:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
