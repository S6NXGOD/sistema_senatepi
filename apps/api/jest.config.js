/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // Nos testes, `@core/infra` aponta para o FONTE, não para `dist/`.
  // Sem isto o jest carregaria o build anterior do pacote: quem editasse o
  // core e rodasse os testes da API estaria testando a versão velha — e
  // passaria verde por engano.
  moduleNameMapper: {
    '^@core/infra$': '<rootDir>/../../packages/core-infra/src/index.ts',
  },
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
};
