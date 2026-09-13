import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  baseDaAba,
  caminhoDe,
  decidirAtualizacao,
  lerVersao,
  mostrarAviso,
  trocouDeTela,
  versaoCurta,
  versaoUtil,
} from './versao-no-ar';

/**
 * O AVISO DE VERSÃO NOVA VIGIAVA O SERVIÇO ERRADO.
 *
 * Comparava o `/api/health` (a API) com a primeira resposta que recebeu. Web e
 * API sobem do mesmo push sem ordem: o aviso gritava antes de a web nova existir,
 * a recarga entregava a tela velha, e dali em diante calava — enquanto a aba
 * seguia desenhando o sino que já tinha saído do sistema. E "Agora não" calava a
 * aba para sempre, inclusive nos deploys seguintes.
 *
 * A regra agora é pura e testada com valores; o componente só a consulta.
 */

describe('o carimbo do build', () => {
  it('corta como a rota /versao: 7 caracteres, e "dev" sem a variável', () => {
    expect(versaoCurta('5abf7d9c0e1f2a3b4c5d')).toBe('5abf7d9');
    expect(versaoCurta('abc')).toBe('abc');
    expect(versaoCurta(undefined)).toBe('dev');
    expect(versaoCurta(null)).toBe('dev');
  });
});

describe('o que conta como versão', () => {
  it.each<[unknown, string | null]>([
    ['5abf7d9', '5abf7d9'],
    [' 5abf7d9 ', '5abf7d9'],
    ['dev', null],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
    [42, null],
    ['<!doctype html>', null],
    ['a'.repeat(41), null],
  ])('%p → %p', (entrada, esperado) => {
    expect(versaoUtil(entrada)).toBe(esperado);
  });

  it('lê o corpo do /versao e trata qualquer outro formato como "não sei"', () => {
    expect(lerVersao({ servico: 'web', versao: '5abf7d9', tenant: 'senatepi' })).toBe('5abf7d9');
    expect(lerVersao({ versao: 'dev' })).toBeNull();
    expect(lerVersao({})).toBeNull();
    expect(lerVersao([])).toBeNull();
    expect(lerVersao('5abf7d9')).toBeNull();
    expect(lerVersao(null)).toBeNull();
  });
});

describe('quando atualizar', () => {
  const A = 'aaaaaaa';
  const B = 'bbbbbbb';

  it.each<[string, Parameters<typeof decidirAtualizacao>[0], ReturnType<typeof decidirAtualizacao>]>([
    ['iguais, na mesma tela', { doBuild: A, noAr: A, trocouDeTela: false }, 'nada'],
    ['iguais, trocando de tela', { doBuild: A, noAr: A, trocouDeTela: true }, 'nada'],
    ['build sem carimbo (dev)', { doBuild: 'dev', noAr: B, trocouDeTela: true }, 'nada'],
    ['servidor sem carimbo (dev)', { doBuild: A, noAr: 'dev', trocouDeTela: true }, 'nada'],
    ['falha de rede: nenhuma resposta', { doBuild: A, noAr: null, trocouDeTela: true }, 'nada'],
    ['nenhum dos lados', { doBuild: undefined, noAr: undefined, trocouDeTela: false }, 'nada'],
    ['diferente, na mesma tela', { doBuild: A, noAr: B, trocouDeTela: false }, 'oferecer'],
    ['diferente, trocando de tela', { doBuild: A, noAr: B, trocouDeTela: true }, 'recarregar'],
    // SHA não tem ordem: voltar o deploy também é "diferente".
    ['servidor voltou para uma versão anterior', { doBuild: B, noAr: A, trocouDeTela: false }, 'oferecer'],
  ])('%s', (_caso, situacao, esperado) => {
    expect(decidirAtualizacao(situacao)).toBe(esperado);
  });

  it('não recarrega em laço: depois de recarregar para uma versão, só oferece', () => {
    // A aba recarregou para B e o servidor ainda entregou o código A (troca no meio).
    expect(decidirAtualizacao({ doBuild: A, noAr: B, trocouDeTela: true, jaRecarregouPara: B })).toBe('oferecer');
    // A recarga anterior foi para outra versão: esta é nova, então vale recarregar.
    expect(decidirAtualizacao({ doBuild: A, noAr: B, trocouDeTela: true, jaRecarregouPara: 'ccccccc' })).toBe(
      'recarregar',
    );
  });
});

describe('a base da aba', () => {
  it('é o carimbo do build quando ele existe, e a primeira resposta só na falta dele', () => {
    expect(baseDaAba('aaaaaaa', 'bbbbbbb')).toBe('aaaaaaa');
    expect(baseDaAba('dev', 'bbbbbbb')).toBe('bbbbbbb');
    expect(baseDaAba(undefined, 'bbbbbbb')).toBe('bbbbbbb');
    expect(baseDaAba('dev', 'dev')).toBeNull();
  });

  it('na reserva, a base não anda com as respostas seguintes — senão nunca avisaria', () => {
    let base = baseDaAba('dev', null);
    expect(base).toBeNull();
    base = baseDaAba(base, 'aaaaaaa'); // primeira resposta útil
    base = baseDaAba(base, 'bbbbbbb'); // saiu deploy
    expect(base).toBe('aaaaaaa');
    expect(decidirAtualizacao({ doBuild: base, noAr: 'bbbbbbb', trocouDeTela: false })).toBe('oferecer');
  });
});

describe('o cartão e o "Agora não"', () => {
  it('aparece só quando há o que oferecer', () => {
    expect(mostrarAviso({ decisao: 'oferecer', noAr: 'bbbbbbb', dispensadaVersao: null })).toBe(true);
    expect(mostrarAviso({ decisao: 'nada', noAr: 'bbbbbbb', dispensadaVersao: null })).toBe(false);
    expect(mostrarAviso({ decisao: 'recarregar', noAr: 'bbbbbbb', dispensadaVersao: null })).toBe(false);
  });

  it('dispensar vale para ESTA versão; a seguinte avisa de novo', () => {
    expect(mostrarAviso({ decisao: 'oferecer', noAr: 'bbbbbbb', dispensadaVersao: 'bbbbbbb' })).toBe(false);
    expect(mostrarAviso({ decisao: 'oferecer', noAr: 'ccccccc', dispensadaVersao: 'bbbbbbb' })).toBe(true);
  });
});

describe('trocar de tela é mudar o caminho, não a query', () => {
  it.each<[string | null, string | null, boolean]>([
    ['/agenda', '/agenda?compromisso=c1', false],
    ['/agenda?aba=hoje', '/agenda', false],
    ['/processos?cadastrar=00012345620268180001', '/processos', false],
    ['/agenda', '/agenda/', false],
    ['/', '/#topo', false],
    ['/agenda', '/processos', true],
    ['/filiados/f1', '/filiados/f1/editar', true],
    ['/login', '/dashboard', true],
    [null, '/agenda', false],
    ['/agenda', null, false],
  ])('%p → %p: %p', (anterior, atual, esperado) => {
    expect(trocouDeTela(anterior, atual)).toBe(esperado);
  });

  it('o caminho sai limpo', () => {
    expect(caminhoDe('/processos?cadastrar=1#x')).toBe('/processos');
    expect(caminhoDe('/agenda//')).toBe('/agenda');
    expect(caminhoDe('/')).toBe('/');
    expect(caminhoDe('')).toBe('/');
    expect(caminhoDe('?aba=hoje')).toBe('/');
  });
});

/**
 * Travas de ESTRUTURA (código, sem comentários): o que nenhum teste de valor
 * enxerga, porque mora na ligação entre o componente, o build e a regra.
 */
describe('o aviso e o build ligados à regra', () => {
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const COMPONENTE = semComentarios(
    readFileSync(path.resolve(__dirname, '../components/avisos/nova-versao.tsx'), 'utf8'),
  );
  const CONFIG = semComentarios(readFileSync(path.resolve(__dirname, '../../next.config.ts'), 'utf8'));

  it('vigia o /versao da própria web, sem passar pela API', () => {
    expect(COMPONENTE).toContain("fetch('/versao'");
    expect(COMPONENTE).not.toMatch(/from '@\/lib\/api'/);
    expect(COMPONENTE).not.toContain("'/health'");
  });

  /**
   * O Next só troca pelo valor o acesso LITERAL `process.env.X`. Desestruturar
   * `process.env` deixaria `undefined` no navegador, e o aviso viveria na reserva.
   */
  it('o build carimba a versão e o componente a lê por extenso', () => {
    expect(CONFIG).toMatch(/VERSAO_DO_BUILD:\s*versaoCurta\(process\.env\.RAILWAY_GIT_COMMIT_SHA\)/);
    expect(COMPONENTE).toContain('process.env.VERSAO_DO_BUILD');
  });

  /**
   * Recarregar por intervalo ou ao voltar para a aba perderia o formulário de
   * quem saiu para copiar um CPF. Só há dois lugares: o botão e a troca de tela.
   */
  it('recarrega só no botão e na troca de tela', () => {
    expect(COMPONENTE.match(/window\.location\.reload\(\)/g)).toHaveLength(2);
    expect(COMPONENTE).toContain('decidirAtualizacao(');
    expect(COMPONENTE).toContain('trocouDeTela(');
    expect(COMPONENTE).toContain('mostrarAviso(');
  });
});
