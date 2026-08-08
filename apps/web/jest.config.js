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
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/.next', '/e2e/'],
};
