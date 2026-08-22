import { ehRotaDeEdicao } from './gate-de-permissao';
import { moduloDaRota } from './nav-items';
import { nivelEfetivo } from '@/lib/permissoes';

/**
 * A PERMISSÃO VALE PELA ROTA — e este teste existe porque o gate por BOTÃO já
 * falhou duas vezes na mesma funcionalidade.
 *
 * Um advogado com "Colaboradores: só visualizar" enxergava o botão Editar na
 * ficha do colaborador. Eu tinha escondido o lápis na LISTAGEM e não na ficha;
 * enquanto o gate for botão a botão, cada tela nova precisa lembrar, e a
 * próxima esquece. Aqui a regra é da rota, e vale para tela que ainda nem
 * existe.
 *
 * Front NÃO protege nada — quem barra é a API, que desde 21/08 exige EDITAR em
 * todo POST/PATCH via `@Modulo`. Este gate serve para a pessoa saber ANTES, em
 * vez de preencher um formulário inteiro e levar 403 no fim.
 */
describe('rota de edição', () => {
  it.each([
    ['/colaboradores/abc/editar'],
    ['/colaboradores/novo'],
    ['/filiados/novo'],
    ['/filiados/importar'],
    ['/cobrancas/nova'],
  ])('%s é rota de escrita', (rota) => {
    expect(ehRotaDeEdicao(rota)).toBe(true);
  });

  it.each([
    ['/colaboradores'],
    ['/colaboradores/abc'],
    ['/filiados'],
    ['/processos'],
    ['/dashboard'],
  ])('%s é rota de leitura', (rota) => {
    expect(ehRotaDeEdicao(rota)).toBe(false);
  });

  /** A query string não pode transformar leitura em escrita, nem o contrário. */
  it('ignora a query string', () => {
    expect(ehRotaDeEdicao('/processos?preProcessuais=1')).toBe(false);
    expect(ehRotaDeEdicao('/filiados/novo?origem=triagem')).toBe(true);
  });
});

/**
 * O caso concreto que voltou duas vezes: a Dra. Shérad, advogada, com
 * `colaboradores` rebaixado para VISUALIZAR pela tela de permissões.
 */
describe('o caso relatado', () => {
  const advogadaSoLeitura = {
    role: 'ADVOGADO' as const,
    permissoes: { colaboradores: 'VISUALIZAR' as const },
  };

  const decidir = (rota: string, u: { role: string; permissoes: unknown }) => {
    const modulo = moduloDaRota(rota);
    if (!modulo) return 'passa';
    const nivel = nivelEfetivo(u.role, u.permissoes, modulo);
    if (nivel === 'SEM_ACESSO') return 'sem acesso';
    if (nivel === 'VISUALIZAR' && ehRotaDeEdicao(rota)) return 'só leitura';
    return 'passa';
  };

  it('abre a FICHA do colaborador', () => {
    expect(decidir('/colaboradores/abc', advogadaSoLeitura)).toBe('passa');
  });

  it('mas NÃO abre a edição', () => {
    expect(decidir('/colaboradores/abc/editar', advogadaSoLeitura)).toBe('só leitura');
  });

  it('nem o cadastro novo', () => {
    expect(decidir('/colaboradores/novo', advogadaSoLeitura)).toBe('só leitura');
  });

  /** Com SEM_ACESSO nem a ficha abre — hoje a leitura passava direto. */
  it('com SEM_ACESSO, nem a ficha', () => {
    expect(decidir('/colaboradores/abc', { role: 'ADVOGADO', permissoes: {} })).toBe('sem acesso');
  });

  /** E onde ela PODE editar, nada muda. */
  it('processos, onde o advogado edita, seguem abertos', () => {
    expect(decidir('/processos', advogadaSoLeitura)).toBe('passa');
  });

  it('o administrador passa em tudo', () => {
    expect(decidir('/colaboradores/abc/editar', { role: 'ADMINISTRADOR', permissoes: {} })).toBe('passa');
  });
});
