import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import { conferirEnvLocal } from './src/tenant/env-do-cliente';
import { versaoCurta } from './src/lib/versao-no-ar';

/**
 * CADA SINDICATO TEM O SEU DIRETÓRIO DE BUILD.
 *
 * O Next guarda build e cache em `.next`. Com um diretório só, dois clientes
 * na mesma máquina brigam por ele de dois jeitos, e os dois já aconteceram:
 *
 *  1. Rodar `npm run dev` (SENATEPI) e `npm run dev:sindserm` ao mesmo tempo
 *     faz os dois escreverem no mesmo lugar e um corromper os chunks do outro.
 *  2. Construir para um cliente e depois para o outro reaproveitava o CSS do
 *     anterior — o SINDSERM saía VERDE, porque o Tailwind compila a paleta
 *     dentro do CSS e o cache a devolvia intacta.
 *
 * `.next-senatepi` e `.next-sindserm` resolvem os dois de uma vez: são caches
 * separados, então não há o que reaproveitar errado nem o que corromper.
 *
 * Sem a variável (um `next build` avulso), volta a ser `.next` — nada quebra
 * para quem não usa o mecanismo.
 *
 * ---
 *
 * POR QUE ESTE ARQUIVO É `.ts` E NÃO `.js`
 *
 * Para poder importar `conferirEnvLocal` do módulo que tem teste. A alternativa
 * era reescrever a regra aqui dentro, à mão — e uma trava duplicada é uma trava
 * que diverge da sua própria definição na primeira correção feita só de um lado.
 */
const tenant = process.env.NEXT_PUBLIC_TENANT?.trim().toLowerCase() ?? '';

/**
 * TRAVA: arquivo de ambiente GENÉRICO não pode carregar chave de UM cliente.
 *
 * O Next lê o `.env.local` antes de chegar aqui, então uma chave que falte na
 * linha de comando é silenciosamente preenchida por ele. Foi assim que um
 * `next build` do SINDSERM saiu apontando para a API do SENATEPI: o sintoma foi
 * "Network Error" numa tela azul, aparentemente correta, e a causa levou uma
 * investigação inteira para aparecer.
 *
 * Por isso a conferência lê o ARQUIVO, e não `process.env` — em `process.env` o
 * estrago já aconteceu e os dois valores são indistinguíveis.
 *
 * Falhar o build é o ponto. Este projeto já decidiu, no `TENANT` da API e nos
 * segredos de produção, que serviço que não sobe é problema de 30 segundos e
 * cliente trocado em silêncio é problema de semanas. Aqui vale igual.
 */
function lerSeExistir(caminho: string): string | null {
  try {
    return readFileSync(caminho, 'utf8');
  } catch {
    return null; // não existe (o caso normal em produção) — nada a conferir
  }
}

const problema = conferirEnvLocal(lerSeExistir(join(__dirname, '.env.local')), tenant);
if (problema) {
  throw new Error(`\n\n  Configuração de desenvolvimento inválida.\n\n  ${problema}\n`);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: tenant ? `.next-${tenant}` : '.next',
  /**
   * O BUILD SABE QUAL VERSÃO ELE É.
   *
   * O Next troca `process.env.VERSAO_DO_BUILD` pelo valor na hora do build, dentro
   * do JavaScript que vai para o navegador. Uma aba aberta carrega consigo o SHA
   * do código que está rodando nela, e o aviso de versão nova
   * (`components/avisos/nova-versao.tsx`) compara com o que o `/versao` responde
   * agora. Sem isto a aba só saberia "o que estava no ar quando abriu" — e uma aba
   * aberta na janela de troca do deploy nasceria achando que é a nova.
   *
   * O corte vem de `versaoCurta`, o mesmo formato da rota `/versao`. Fora do
   * Railway sai 'dev', que o aviso trata como "não sei" (e cai na reserva: a
   * primeira resposta do `/versao` vira a base).
   */
  env: {
    VERSAO_DO_BUILD: versaoCurta(process.env.RAILWAY_GIT_COMMIT_SHA),
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
