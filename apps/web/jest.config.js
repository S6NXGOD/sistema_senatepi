/*
  O TESTE RODA NO FUSO DA PRODUÇÃO — e a produção do web é o NAVEGADOR.

  Ao contrário da API, este código executa na máquina de quem abre a tela, e
  quem abre a tela está no Brasil. Rótulos como "hoje"/"ontem" (`desde()`) são
  calculados com a hora local de propósito — é o que a pessoa espera ler.

  Sem esta linha a suíte passava aqui (UTC-3) e falhava no CI, que é ubuntu em
  UTC: oito testes de `desde.spec.ts` viravam vermelhos por um fuso que nenhum
  usuário tem. Fixar o fuso do Brasil faz o teste reproduzir o navegador real.
*/
process.env.TZ = 'America/Fortaleza';

/**
 * O front passa a ter testes.
 *
 * Não havia nenhum: toda lógica pura do web era verificada à mão. A derivação
 * da paleta é o caso que forçou a decisão — ela promete contraste AA para
 * qualquer cor que a pessoa escolher, e promessa sem teste é chute.
 *
 * Mesma convenção da API e de `@core/infra`, de propósito: quem mexer aqui não
 * aprende uma terceira forma de testar. `npm test --workspaces` (o que a CI
 * roda) já passa por aqui.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  rootDir: '.',
  testRegex: '.*\.spec\.tsx?$',
  transform: { '^.+\.(t|j)sx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/.next', '/e2e/'],
};
