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
    // O teste de conformidade compara a configuração da API com a da TELA — as
    // duas listas de módulos e campos são mantidas à mão em arquivos
    // diferentes, e é exatamente o par que diverge sem ninguém notar. Os
    // arquivos de tenant do web só têm imports de TIPO, então carregam aqui.
    '^@/(.*)$': '<rootDir>/../web/src/$1',
  },
  transform: {
    // `tsconfig.spec.json` acrescenta o alias `@/` apontando para a TELA, que
    // só o teste de conformidade usa. Ele fica fora do tsconfig da aplicação
    // para que nenhum serviço da API consiga importar código do front.
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
};
