import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { ATENCAO_COR, ATENCAO_LABEL } from './movimentacoes';

/**
 * O FRONT ESPELHA OS NÍVEIS DO BACK — E O ESPELHO TEM DE ESTAR INTEIRO.
 *
 * Todo defeito desta área nasceu do mesmo jeito: a mesma verdade escrita em
 * dois lugares, e um deles envelhecendo sozinho. Foi assim que a lista passou
 * meses mostrando "Prazo sem tarefa" para atos de até 252 dias enquanto a ficha
 * do mesmo processo, que tinha janela de 30 dias, não mostrava nada.
 *
 * A REGRA continua só no servidor — `atoAcionavel`, em `tpu.util.ts`. O front
 * não decide se um ato pede providência; ele só sabe pintar o que recebe. Mas
 * "só pintar" ainda exige conhecer TODOS os níveis: um nível novo no back sem
 * entrada aqui não quebra o build, não quebra a tela, e simplesmente aparece
 * sem cor e sem nome — o pior tipo de falha, a silenciosa.
 *
 * Por isso este teste lê o arquivo do back. Duplicar a lista num import faria
 * os dois lados mudarem juntos por acidente, que é justamente o que não se
 * quer garantir.
 */
const TPU = readFileSync(
  path.join(__dirname, '..', '..', '..', 'api', 'src', 'modules', 'processos', 'utils', 'tpu.util.ts'),
  'utf8',
);

/** Os níveis declarados no `type NivelAtencao` do back. */
function niveisDoBack(): string[] {
  const m = TPU.match(/export type NivelAtencao =([^;]+);/);
  if (!m) throw new Error('type NivelAtencao não encontrado em tpu.util.ts');
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

describe('níveis de atenção espelhados do back', () => {
  it('o back declara os níveis que esperamos (o teste não olha para o vazio)', () => {
    const niveis = niveisDoBack();
    expect(niveis.length).toBeGreaterThanOrEqual(4);
    expect(niveis).toContain('URGENTE');
    expect(niveis).toContain('PRAZO');
    expect(niveis).toContain('DECISAO');
    expect(niveis).toContain('ENCERRAMENTO');
  });

  it('todo nível do back tem rótulo em português no front', () => {
    for (const nivel of niveisDoBack()) {
      expect(ATENCAO_LABEL[nivel]).toBeTruthy();
    }
  });

  it('todo nível do back tem cor no front', () => {
    for (const nivel of niveisDoBack()) {
      expect(ATENCAO_COR[nivel]).toBeTruthy();
    }
  });

  it('o front não inventa nível que o back não conhece', () => {
    const niveis = niveisDoBack();
    for (const chave of Object.keys(ATENCAO_LABEL)) {
      expect(niveis).toContain(chave);
    }
  });

  /**
   * VERMELHO É UM SÓ. Se dois níveis dividissem a cor de alarme, nenhum dos
   * dois seria alarme — que é exatamente a doença que este trabalho tratou na
   * listagem (onze selos de prazo, nenhum verdadeiro).
   */
  it('só um nível usa a cor de alarme', () => {
    const vermelhos = Object.entries(ATENCAO_COR).filter(([, cor]) => cor === 'red');
    expect(vermelhos.map(([n]) => n)).toEqual(['URGENTE']);
  });
});

/**
 * O SELO DA LISTAGEM tem o seu próprio mapa de aparência, e ele carrega um
 * nível a mais: `PARADO`, que não vem de ato nenhum — vem da ausência deles.
 * Ele entrou quando os selos de prazo ganharam validade e dez avisos sumiram de
 * uma vez; sumir sem substituto faria a inércia parecer normalidade.
 */
describe('selo da listagem', () => {
  const PAGINA = readFileSync(
    path.join(__dirname, '..', 'app', '(dashboard)', 'processos', 'page.tsx'),
    'utf8',
  );

  const aparencia = PAGINA.slice(
    PAGINA.indexOf('function SeloDeAlerta'),
    PAGINA.indexOf('function CelulaPartes'),
  );

  it('o componente existe', () => {
    expect(aparencia.length).toBeGreaterThan(400);
  });

  it('cobre todos os níveis do back mais o PARADO', () => {
    for (const nivel of niveisDoBack()) {
      // ENCERRAMENTO nunca chega à lista (`atoAcionavel` o descarta), então é o
      // único que pode faltar — e falta de propósito.
      if (nivel === 'ENCERRAMENTO') continue;
      expect(aparencia).toContain(`${nivel}: {`);
    }
    expect(aparencia).toContain('PARADO: {');
  });

  it('PARADO não tem cor de alarme — é informação, não cobrança', () => {
    const bloco = aparencia.slice(aparencia.indexOf('PARADO: {'));
    expect(bloco).toContain('bg-muted');
    expect(bloco).not.toMatch(/PARADO: \{[\s\S]{0,200}bg-(red|amber)-/);
  });
});
