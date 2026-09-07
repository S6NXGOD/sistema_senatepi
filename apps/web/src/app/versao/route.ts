import { NextResponse } from 'next/server';

/**
 * QUAL BUILD DA TELA ESTÁ NO AR.
 *
 * A API responde `versao` no `/api/health` desde sempre, e é por ela que todo
 * deploy é conferido. A WEB não respondia nada — e web e API sobem como dois
 * serviços separados no Railway, cada um com o seu tempo de build. Verificar só
 * a API é verificar metade: já aconteceu de o conserto ser de frontend e a única
 * confirmação possível ser abrir a tela e olhar.
 *
 * Pior: sem isto não dá para saber se a JANELA DE TROCA está aberta — o momento
 * em que a tela nova conversa com o contêiner velho (ou o contrário), que é a
 * razão de as migrações serem só aditivas. Com as duas versões visíveis, dá para
 * ver a janela em vez de supor que ela já fechou.
 *
 * Rota PÚBLICA e sem dado nenhum além do SHA curto, que é público no repositório
 * — nada de variável de ambiente, nome de host ou contagem de nada.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      servico: 'web',
      versao: (process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev').slice(0, 7),
      tenant: process.env.NEXT_PUBLIC_TENANT ?? 'senatepi',
      timestamp: new Date().toISOString(),
    },
    // Sem cache: uma versão em cache é pior do que versão nenhuma.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
