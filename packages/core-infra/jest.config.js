/**
 * O pacote testa a si mesmo.
 *
 * Mesma configuração da API de propósito: quem mexer aqui não precisa aprender
 * uma segunda convenção de teste. `npm test --workspaces` (o que a CI roda)
 * passa por este arquivo automaticamente.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
