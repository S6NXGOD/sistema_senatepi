import {
  MODULOS as API_MODULOS,
  MODULO_KEYS as API_KEYS,
  MODULOS_QUE_SO_O_ADMINISTRADOR_CONCEDE as API_SO_ADMIN,
  PRESETS_PERFIL as API_PRESETS,
  nivelEfetivo as nivelApi,
} from '../../../api/src/common/permissions/permissoes.constants';
import {
  MODULOS,
  MODULO_KEYS,
  MODULOS_QUE_SO_O_ADMINISTRADOR_CONCEDE,
  PRESETS_PERFIL,
  nivelEfetivo,
  type ModuloKey,
} from './permissoes';

/**
 * AS DUAS CÓPIAS DA MATRIZ, COMPARADAS — e até 06/10/2026 nada as comparava.
 *
 * A política de permissão existe DUAS VEZES nesta base: em
 * `api/src/common/permissions/permissoes.constants.ts`, que decide de verdade,
 * e em `web/src/lib/permissoes.ts`, que decide o que a tela mostra. O arquivo
 * do web diz, na primeira linha, "mantém em sincronia com o backend" — e até
 * aqui essa sincronia era uma promessa escrita num comentário.
 *
 * O MODO DE FALHAR É SILENCIOSO E PIOR QUE UM ERRO. Divergir para MAIS no web
 * mostra um botão que a API recusa com 403 (a pessoa preenche o formulário
 * inteiro para perder o trabalho). Divergir para MENOS esconde uma tela que a
 * pessoa tem direito de abrir — e ela não tem como descobrir que existe.
 *
 * Foi assim que `recibos` nasceu: um módulo novo, com chave, preset e lista do
 * tenant em quatro arquivos. Esquecer um deles é o caso normal, não o excepcional.
 */

const PERFIS = ['ADMINISTRADOR', 'COORDENACAO', 'ADVOGADO', 'TRIAGEM'] as const;

describe('o espelho das permissões bate com o original', () => {
  it('os módulos são os mesmos, na mesma ordem', () => {
    expect(MODULO_KEYS).toEqual(API_KEYS);
  });

  /** Grupo diferente muda o lugar na tela de permissões, não o que ela faz. */
  it('cada módulo está no mesmo grupo dos dois lados', () => {
    const grupo = (ms: { key: string; grupo: string }[]) =>
      Object.fromEntries(ms.map((m) => [m.key, m.grupo]));
    expect(grupo(MODULOS)).toEqual(grupo(API_MODULOS));
  });

  it.each(PERFIS)('o preset de %s é idêntico', (perfil) => {
    expect(PRESETS_PERFIL[perfil]).toEqual(API_PRESETS[perfil]);
  });

  /** Lista divergente = tela deixa o gerente conceder o que a API vai recusar. */
  it('os módulos que só o Administrador concede são os mesmos', () => {
    expect([...MODULOS_QUE_SO_O_ADMINISTRADOR_CONCEDE]).toEqual([...API_SO_ADMIN]);
  });

  /**
   * A RESOLUÇÃO TAMBÉM, e não só a tabela: as duas funções têm o mesmo nome e
   * foram escritas duas vezes. A do web ainda tem um ramo a mais (perfil
   * desconhecido cai em TRIAGEM) que a da API não tem.
   */
  it.each(PERFIS)('nivelEfetivo responde igual para %s, módulo a módulo', (perfil) => {
    for (const modulo of MODULO_KEYS) {
      expect(`${modulo}=${nivelEfetivo(perfil, null, modulo)}`).toBe(
        `${modulo}=${nivelApi(perfil as never, null, modulo)}`,
      );
      // E com matriz própria mandando o contrário do preset.
      expect(nivelEfetivo(perfil, { [modulo]: 'EDITAR' }, modulo)).toBe(
        nivelApi(perfil as never, { [modulo]: 'EDITAR' }, modulo),
      );
    }
  });
});

/**
 * O MÓDULO NOVO, E O QUE ELE ABRE — escrito por extenso, porque mudança de
 * permissão que ninguém consegue enumerar é mudança que ninguém consegue
 * revisar.
 */
describe('recibos entrou na matriz', () => {
  it('existe como chave própria, no grupo Operacional', () => {
    expect(MODULO_KEYS).toContain('recibos');
    expect(MODULOS.find((m) => m.key === 'recibos')?.grupo).toBe('Operacional');
  });

  /**
   * A TRIAGEM É O PONTO. Ela tem `cobrancas: SEM_ACESSO` no preset — se o
   * recibo fosse uma aba de Cobranças, quem pega o dinheiro no balcão não
   * poderia entregar o papel.
   */
  it('o balcão emite, e o advogado não', () => {
    expect(PRESETS_PERFIL.TRIAGEM.recibos).toBe('EDITAR');
    expect(PRESETS_PERFIL.TRIAGEM.cobrancas).toBe('SEM_ACESSO');
    expect(PRESETS_PERFIL.ADVOGADO.recibos).toBe('SEM_ACESSO');
    expect(PRESETS_PERFIL.COORDENACAO.recibos).toBe('EDITAR');
    expect(PRESETS_PERFIL.ADMINISTRADOR.recibos).toBe('EDITAR');
  });

  /**
   * OS 17 USUÁRIOS QUE JÁ TÊM MATRIZ PRÓPRIA (medido na produção em
   * 06/10/2026: 17 de 18 ativos) NÃO têm a chave `recibos` dentro dela — ela
   * não existia quando foram configurados.
   *
   * A regra de resolução é que salva: chave ausente CAI NO PRESET. Se
   * `nivelEfetivo` devolvesse SEM_ACESSO para chave ausente, o módulo novo
   * nasceria invisível para 17 das 18 pessoas, e o administrador teria de
   * reabrir dezessete fichas para "ligar" algo que já devia estar ligado.
   *
   * As matrizes abaixo são as REAIS da produção, recortadas.
   */
  it('quem já tem matriz própria sem a chave nova cai no preset', () => {
    const doIvo = {
      agenda: 'EDITAR', acessos: 'EDITAR', colonia: 'VISUALIZAR', escalas: 'EDITAR',
      eventos: 'VISUALIZAR', empresas: 'EDITAR', filiados: 'EDITAR', usuarios: 'SEM_ACESSO',
      auditoria: 'SEM_ACESSO', cobrancas: 'EDITAR', dashboard: 'EDITAR', processos: 'VISUALIZAR',
      duplicados: 'EDITAR', municipios: 'VISUALIZAR', relatorios: 'SEM_ACESSO',
      atendimentos: 'EDITAR', organizacoes: 'SEM_ACESSO', colaboradores: 'EDITAR',
    };
    expect(doIvo).not.toHaveProperty('recibos');
    expect(nivelEfetivo('TRIAGEM', doIvo, 'recibos')).toBe('EDITAR');
    expect(nivelApi('TRIAGEM' as never, doIvo, 'recibos')).toBe('EDITAR');

    const daLara = {
      agenda: 'EDITAR', escalas: 'VISUALIZAR', filiados: 'VISUALIZAR', cobrancas: 'SEM_ACESSO',
      dashboard: 'VISUALIZAR', processos: 'EDITAR', atendimentos: 'VISUALIZAR',
      organizacoes: 'EDITAR', colaboradores: 'SEM_ACESSO',
    };
    expect(nivelEfetivo('ADVOGADO', daLara, 'recibos')).toBe('SEM_ACESSO');
  });

  /** E o administrador alcança tudo, com matriz ou sem — inclusive o módulo novo. */
  it('o administrador não depende da matriz', () => {
    expect(nivelEfetivo('ADMINISTRADOR', { recibos: 'SEM_ACESSO' }, 'recibos')).toBe('EDITAR');
    expect(nivelApi('ADMINISTRADOR' as never, { recibos: 'SEM_ACESSO' }, 'recibos')).toBe('EDITAR');
  });

  /** Emitir é escrita: ver a lista não deixa ninguém gravar um número. */
  it('VISUALIZAR vê o acervo e não emite', () => {
    const so = nivelEfetivo('TRIAGEM', { recibos: 'VISUALIZAR' }, 'recibos' as ModuloKey);
    expect(so).toBe('VISUALIZAR');
  });
});
