#!/usr/bin/env node
/**
 * SOBE UM SINDICATO EM DESENVOLVIMENTO.
 *
 *     npm run dev              → SENATEPI  (API 3333 · web 3000)
 *     npm run dev:sindserm     → SINDSERM  (API 3334 · web 3001)
 *
 * Os dois podem rodar AO MESMO TEMPO, lado a lado, cada um no seu banco.
 *
 * POR QUE UM SCRIPT EM NODE, e não variáveis na linha do npm: `TENANT=x npm
 * run dev` funciona no bash e falha no cmd do Windows, que é onde este projeto
 * é desenvolvido. Node roda igual nos dois.
 *
 * COMO ELE ACHA A CONFIGURAÇÃO DE CADA CLIENTE
 *
 *   apps/api/.env              base, comum a todos (segredos, storage…)
 *   apps/api/.env.<tenant>     só o que MUDA: banco e porta
 *   apps/web/.env.local        base do front
 *   apps/web/.env.<tenant>     só o que muda: porta da API
 *
 * O arquivo do tenant VENCE. Isso funciona sem gambiarra porque o
 * `ConfigModule` do Nest só grava em `process.env` a chave que ainda não
 * existe — o que já foi injetado aqui tem precedência.
 *
 * NENHUM `.env` vai para o git. Com dois sindicatos no mesmo repositório, um
 * segredo versionado expõe os dois.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const tenant = (process.argv[2] || 'senatepi').trim().toLowerCase();

/** Portas por cliente — precisam ser diferentes para os dois rodarem juntos. */
const PORTAS = {
  senatepi: { api: 3333, web: 3000 },
  sindserm: { api: 3334, web: 3001 },
};

const portas = PORTAS[tenant];
if (!portas) {
  console.error(
    `\n  Cliente "${tenant}" não tem portas definidas.\n` +
      `  Conhecidos: ${Object.keys(PORTAS).join(', ')}.\n` +
      `  Para acrescentar um, edite PORTAS em scripts/dev.js.\n`,
  );
  process.exit(1);
}

/** Lê um .env sem depender de pacote externo. Ignora comentário e linha vazia. */
function lerEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return {};
  const saida = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const i = limpa.indexOf('=');
    if (i < 1) continue;
    const chave = limpa.slice(0, i).trim();
    let valor = limpa.slice(i + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    saida[chave] = valor;
  }
  return saida;
}

const envApi = lerEnv(path.join(RAIZ, 'apps/api', `.env.${tenant}`));
const envWeb = lerEnv(path.join(RAIZ, 'apps/web', `.env.${tenant}`));

const arquivoApi = path.join(RAIZ, 'apps/api', `.env.${tenant}`);
if (tenant !== 'senatepi' && !fs.existsSync(arquivoApi)) {
  console.error(
    `\n  Falta ${path.relative(RAIZ, arquivoApi)}.\n` +
      `  Ele guarda o que muda neste cliente — DATABASE_URL e API_PORT.\n` +
      `  Veja o roteiro na §16 do PLAN-MONOREPO-CORE.md.\n`,
  );
  process.exit(1);
}

const base = {
  ...process.env,
  TENANT: tenant,
  NEXT_PUBLIC_TENANT: tenant,
};

const ambienteApi = {
  ...base,
  ...envApi,
  API_PORT: String(portas.api),
  /**
   * O CORS precisa apontar para o front DESTE cliente. Sem isto o navegador
   * bloqueia tudo e o sintoma é "a tela não carrega", sem erro no servidor —
   * `curl` não pega, porque CORS é regra de navegador.
   */
  CORS_ORIGINS: envApi.CORS_ORIGINS || `http://localhost:${portas.web}`,
};
const ambienteWeb = {
  ...base,
  ...envWeb,
  NEXT_PUBLIC_API_URL: envWeb.NEXT_PUBLIC_API_URL || `http://localhost:${portas.api}/api`,
  PORT: String(portas.web),
};

/**
 * O banco só aparece aqui quando vem do `.env.<tenant>`. Para o cliente que usa
 * o `.env` comum, quem lê o arquivo é o Nest — imprimir aspas vazias sugeriria
 * configuração faltando onde não há.
 */
const banco = ambienteApi.DATABASE_URL
  ? `banco "${ambienteApi.DATABASE_URL.replace(/^.*\//, '').replace(/\?.*$/, '')}"`
  : 'banco do .env';

console.log(
  `\n  ${tenant.toUpperCase()}  ·  API http://localhost:${portas.api}` +
    `  ·  web http://localhost:${portas.web}  ·  ${banco}\n`,
);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const filhos = [
  spawn(npm, ['run', 'start:dev', '-w', '@senatepi/api'], {
    cwd: RAIZ, env: ambienteApi, stdio: 'inherit', shell: process.platform === 'win32',
  }),
  /**
   * `next dev` direto, e não `npm run dev -w @senatepi/web`: o script do
   * workspace já traz `-p 3000`, e acrescentar outro `-p` gerava
   * `next dev -p 3000 -p 3000`. Funcionava por acidente — o Next fica com o
   * último — e teria dado a porta errada no dia em que a ordem mudasse.
   */
  spawn(npm, ['exec', '--', 'next', 'dev', '-p', String(portas.web)], {
    cwd: path.join(RAIZ, 'apps/web'),
    env: ambienteWeb,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
];

// Ctrl+C precisa derrubar os dois; sem isto sobra um processo segurando a porta.
const encerrar = () => filhos.forEach((f) => !f.killed && f.kill());
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
filhos.forEach((f) => f.on('exit', encerrar));
