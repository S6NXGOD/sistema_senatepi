import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { alteracoesDoRegistro, valorLegivel } from '@/lib/auditoria';
import type { RegistroAuditoria } from '@/lib/auditoria';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const registro = (metadata: unknown): RegistroAuditoria =>
  ({ metadata } as RegistroAuditoria);

/**
 * "DR. MURILO ALTEROU." ALTEROU O QUÊ? ESTAVA COMO ANTES?
 *
 * A tela mostrava o verbo e o módulo. Quem vem à auditoria vem com a pergunta
 * inteira, e ela só se responde com o "de → para".
 */
describe('as alterações de um registro', () => {
  it('sai do metadata quando o serviço gravou', () => {
    const r = registro({
      alteracoes: [{ campo: 'cidade', label: 'Cidade', de: 'BOM JESUS', para: 'TERESINA' }],
    });
    expect(alteracoesDoRegistro(r)).toHaveLength(1);
  });

  /** Registro antigo não tem o campo — e a tela não pode quebrar por isso. */
  it.each([null, {}, { rota: '/x' }, { alteracoes: 'nao e lista' }])(
    'aguenta metadata sem alterações (%p)',
    (meta) => {
      expect(alteracoesDoRegistro(registro(meta))).toEqual([]);
    },
  );

  it('descarta linha malformada em vez de renderizar lixo', () => {
    expect(alteracoesDoRegistro(registro({ alteracoes: [null, { campo: 'ok', label: 'Ok', de: 1, para: 2 }] })))
      .toHaveLength(1);
  });
});

/**
 * O VALOR EM PORTUGUÊS — tradução NA LEITURA, como a das frases.
 *
 * O banco guarda `DESFILIADO`, e está certo que guarde: código não muda quando
 * o rótulo muda. Mas ninguém audita lendo SCREAMING_SNAKE_CASE.
 */
describe('o valor legível', () => {
  it.each([
    ['DESFILIADO', 'Desfiliado'],
    ['EM_ANDAMENTO', 'Em andamento'],
    ['PRE_PROCESSUAL', 'Pré-processual'],
    ['COORDENACAO', 'Coordenação'],
  ])('%s vira %s', (cru, esperado) => {
    expect(valorLegivel(cru)).toBe(esperado);
  });

  /** Código sem tradução vira algo legível, sem inventar significado. */
  it('o código desconhecido não fica gritando', () => {
    expect(valorLegivel('MOTIVO_QUALQUER_NOVO')).toBe('Motivo qualquer novo');
  });

  /** Texto comum passa intacto — nome de pessoa não é enum. */
  it('não mexe em texto de gente', () => {
    expect(valorLegivel('Sala 2')).toBe('Sala 2');
    expect(valorLegivel('BOM JESUS')).toBe('BOM JESUS');
  });

  it('o vazio é dito, e não deixado em branco', () => {
    expect(valorLegivel(null)).toBe('(vazio)');
    expect(valorLegivel('')).toBe('(vazio)');
    expect(valorLegivel([])).toBe('(nenhuma)');
  });

  it('booleano vira Sim/Não e lista vira enumeração', () => {
    expect(valorLegivel(true)).toBe('Sim');
    expect(valorLegivel(false)).toBe('Não');
    expect(valorLegivel(['A', 'B'])).toBe('A, B');
  });

  it('a data vira data', () => {
    expect(valorLegivel('2026-09-04T14:30:00.000Z')).toMatch(/04\/09\/2026/);
  });
});

/**
 * AS MUDANÇAS SÃO O CONTEÚDO DO REGISTRO, não detalhe técnico — escondê-las
 * atrás de uma seta é devolver à pessoa a pergunta que ela veio fazer.
 */
describe('a tela mostra o antes e o depois', () => {
  const TELA = lerCodigo('page.tsx');

  it('até três ficam à vista na própria linha', () => {
    expect(TELA).toContain('const visiveis = alteracoes.slice(0, 3);');
    expect(TELA).toContain('valorLegivel(a.de)');
    expect(TELA).toContain('valorLegivel(a.para)');
  });

  it('o resto abre junto com o detalhe, em tabela', () => {
    expect(TELA).toContain('e mais {escondidas} campo');
    expect(TELA).toContain('O que mudou');
    expect(TELA).toContain('<th className="px-2 py-1 font-medium">Antes</th>');
  });

  /** O valor antigo riscado diz "isto não vale mais" sem precisar de legenda. */
  it('o valor antigo aparece riscado', () => {
    expect(TELA).toContain('line-through');
  });
});
