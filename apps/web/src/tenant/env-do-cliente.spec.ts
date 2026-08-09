import { chavesDoClienteEm, conferirEnvLocal } from './env-do-cliente';

/**
 * A trava do `.env.local` nasceu de um defeito real: um `next build` do SINDSERM
 * herdou a `NEXT_PUBLIC_API_URL` do SENATEPI de um arquivo genérico e o front
 * subiu falando com a API do sindicato errado.
 *
 * Estes testes existem porque a trava é fácil de afrouxar sem querer — basta
 * alguém "consertar" o parser e deixar passar `export FOO=`, ou trocar a regra
 * de PRESENÇA por DIVERGÊNCIA, que era a versão fraca original.
 */
describe('chaves de cliente num arquivo de ambiente', () => {
  it('acha as duas chaves proibidas', () => {
    const env = 'NEXT_PUBLIC_TENANT=senatepi\nNEXT_PUBLIC_API_URL=http://localhost:3333/api';
    expect(chavesDoClienteEm(env)).toEqual(['NEXT_PUBLIC_TENANT', 'NEXT_PUBLIC_API_URL']);
  });

  it('ignora o que está comentado', () => {
    // Deixar o exemplo comentado ao lado da variável é hábito comum; reprovar
    // por causa dele ensinaria a apagar o comentário, não a arrumar o arquivo.
    expect(chavesDoClienteEm('# NEXT_PUBLIC_TENANT=senatepi')).toEqual([]);
    expect(chavesDoClienteEm('   #NEXT_PUBLIC_API_URL=x')).toEqual([]);
  });

  it('aceita a forma `export FOO=`, que o dotenv também aceita', () => {
    expect(chavesDoClienteEm('export NEXT_PUBLIC_TENANT=sindserm')).toEqual(['NEXT_PUBLIC_TENANT']);
  });

  it('não confunde chave que apenas começa igual', () => {
    const env = 'NEXT_PUBLIC_TENANT_ANTIGO=x\nNEXT_PUBLIC_API_URL_ANTIGA=y';
    expect(chavesDoClienteEm(env)).toEqual([]);
  });

  it('não repete a mesma chave declarada duas vezes', () => {
    expect(chavesDoClienteEm('NEXT_PUBLIC_TENANT=a\nNEXT_PUBLIC_TENANT=b')).toEqual([
      'NEXT_PUBLIC_TENANT',
    ]);
  });
});

describe('a trava do build', () => {
  it('reprova quando o arquivo genérico traz chave de cliente', () => {
    const erro = conferirEnvLocal('NEXT_PUBLIC_TENANT=senatepi', 'sindserm');
    expect(erro).toContain('NEXT_PUBLIC_TENANT');
    expect(erro).toContain('sindserm');
  });

  /**
   * A REGRA É PRESENÇA, NÃO DIVERGÊNCIA — este é o teste que trava a decisão.
   *
   * A versão fraca só reclamava quando o cliente do arquivo era OUTRO. Aqui o
   * `.env.local` diz "senatepi" e o build é do "senatepi": os valores concordam,
   * e mesmo assim tem de reprovar. Enquanto a chave morar num arquivo genérico,
   * o build do PRÓXIMO cliente vai herdá-la.
   */
  it('reprova mesmo quando o cliente do arquivo é o mesmo do build', () => {
    expect(conferirEnvLocal('NEXT_PUBLIC_TENANT=senatepi', 'senatepi')).not.toBeNull();
  });

  it('reprova só com a URL, sem o tenant — o furo da versão fraca', () => {
    const erro = conferirEnvLocal('NEXT_PUBLIC_API_URL=http://localhost:3333/api', 'sindserm');
    expect(erro).toContain('NEXT_PUBLIC_API_URL');
  });

  it('aprova arquivo só com chave que serve a qualquer cliente', () => {
    expect(conferirEnvLocal('NEXT_PUBLIC_DEBUG=1\nANALYZE=false', 'senatepi')).toBeNull();
  });

  it('aprova quando não há .env.local', () => {
    expect(conferirEnvLocal(null, 'senatepi')).toBeNull();
  });

  /**
   * `next build` avulso, sem cliente: o `distDir` é o `.next` neutro e não há
   * cliente para contaminar. Reprovar aqui só atrapalharia quem roda um build
   * de verificação.
   */
  it('não opina quando o build não declara cliente', () => {
    expect(conferirEnvLocal('NEXT_PUBLIC_TENANT=senatepi', '')).toBeNull();
  });

  it('a mensagem diz para onde mover, com o nome do arquivo certo', () => {
    const erro = conferirEnvLocal('NEXT_PUBLIC_TENANT=senatepi', 'sindserm');
    expect(erro).toContain('apps/web/.env.sindserm');
  });
});
