import { nomeDeExibicao, primeiroNome } from './escalas';

const adv = (nomeExibicao: string | null, nome = 'Fallback Sobrenome') =>
  ({ id: 'a1', nome, nomeExibicao } as Parameters<typeof primeiroNome>[0]);

/**
 * "Dra." NÃO É UM NOME.
 *
 * Visto numa tela real: no detalhe da atividade, o bloco "Plantão do dia"
 * listava duas linhas — "Dra." e "Dr." — com horário ao lado e nenhum nome.
 * Dois advogados de plantão apareciam como duas linhas indistinguíveis, e a
 * escala mostrava "Dra. -09:00" na célula do calendário.
 *
 * A causa: `primeiroNome` pegava o primeiro token de `nomeExibicao`, e o padrão
 * de nomes deste acervo é "Dra. Shérad" / "Dr. Murilo". O primeiro token é o
 * TRATAMENTO.
 */
describe('primeiroNome pula o tratamento', () => {
  it('"Dra. Shérad" vira "Shérad", não "Dra."', () => {
    expect(primeiroNome(adv('Dra. Shérad'))).toBe('Shérad');
  });

  it('"Dr. Murilo Marcones" vira "Murilo"', () => {
    expect(primeiroNome(adv('Dr. Murilo Marcones'))).toBe('Murilo');
  });

  it('nome sem tratamento continua funcionando', () => {
    expect(primeiroNome(adv('Shérad Araújo'))).toBe('Shérad');
  });

  it('não se importa com caixa, acento ou ponto', () => {
    expect(primeiroNome(adv('DRA Shérad'))).toBe('Shérad');
    expect(primeiroNome(adv('dra. Shérad'))).toBe('Shérad');
    expect(primeiroNome(adv('Sra. Jaqueline'))).toBe('Jaqueline');
    expect(primeiroNome(adv('Profa. Margareth'))).toBe('Margareth');
  });

  /**
   * Cadastro incompleto não pode virar linha em branco: uma linha vazia na
   * escala some da tela sem explicar por quê, que é pior que um rótulo feio.
   */
  it('só tratamento e mais nada devolve o que existe', () => {
    expect(primeiroNome(adv('Dr.'))).toBe('Dr.');
  });

  it('cai para `nome` quando não há `nomeExibicao`', () => {
    expect(primeiroNome(adv(null, 'Dr. Carlos Henrique'))).toBe('Carlos');
  });

  /**
   * A palavra do meio não é tratamento. "Ana Dra Silva" é bizarro, mas o
   * primeiro token já é nome e a busca para nele — a função não sai varrendo.
   */
  it('não confunde nome com tratamento no meio', () => {
    expect(primeiroNome(adv('Ana Dra Silva'))).toBe('Ana');
  });
});

/**
 * Onde há largura, o nome de exibição vai INTEIRO — "Dra. Shérad" é como a
 * pessoa é chamada, e encurtar sem necessidade só tira informação. É o que o
 * plantão do detalhe usa agora, numa linha de ~300px com `truncate`.
 */
describe('nomeDeExibicao', () => {
  it('mantém o tratamento', () => {
    expect(nomeDeExibicao(adv('Dra. Shérad'))).toBe('Dra. Shérad');
  });

  it('cai para `nome` quando não há apelido', () => {
    expect(nomeDeExibicao(adv(null, 'Carlos Henrique de Alencar'))).toBe('Carlos Henrique de Alencar');
  });
});
