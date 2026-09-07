import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * O SERVIDOR NÃO SABE QUE HORAS SÃO AQUI — e já errou duas vezes por isso.
 *
 * O contêiner do Railway roda em UTC: nada define `TZ` no `railway.json`, no
 * Nixpacks nem no `main.ts`. Toda função de `Date` que lê o fuso do PROCESSO
 * (`setHours`, `getDay`, `getDate`) responde em UTC no ar e em UTC-3 nesta
 * máquina. A suíte inteira ficava verde e a produção ficava errada.
 *
 * Duas vezes, com dados medidos:
 *
 * 1. `setHours(9, 0, 0, 0)` nos robôs e no encaminhamento de atendimento.
 *    Medido em 07/09/2026: **16 compromissos gravados às 06:00 de Brasília**,
 *    quatro deles "Consulta Jurídica". O advogado chega às oito e a consulta
 *    já está duas horas atrasada.
 *
 * 2. `diasUteisEntre` contava o dia com `getDate()`/`getDay()`. No ar, o dia
 *    virava às 21h de Brasília: daí à meia-noite a conta devolvia um dia a
 *    mais e a faixa do painel disparava uma noite antes da hora.
 *
 * O teste anterior a este olhava DOIS arquivos por nome. Foi por isso que o
 * caminho de atendimentos escapou. Este varre `src` inteiro: a regra é do
 * projeto, não de um módulo.
 */
const RAIZ = resolve(__dirname, '..');

function arquivosDeCodigo(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDeCodigo(caminho, achados);
    else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) achados.push(caminho);
  }
  return achados;
}

/**
 * Sem comentários: vários arquivos EXPLICAM por que o `setHours` saiu, e a
 * explicação não pode fazer o teste acusar justamente o que ela documenta.
 */
const semComentarios = (fonte: string) =>
  fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !/^\s*(\*|\/\/)/.test(linha))
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');

const CODIGO = arquivosDeCodigo(RAIZ).map((caminho) => ({
  arquivo: relative(RAIZ, caminho).split('\\').join('/'),
  fonte: semComentarios(readFileSync(caminho, 'utf8')),
}));

describe('nenhum horário nasce no fuso do contêiner', () => {
  /** O teste precisa estar realmente lendo o projeto, e não uma pasta vazia. */
  it('a varredura enxerga o código', () => {
    expect(CODIGO.length).toBeGreaterThan(50);
    expect(CODIGO.map((c) => c.arquivo)).toContain('modules/atendimentos/atendimentos.service.ts');
  });

  it('ninguém marca "nove da manhã" com setHours', () => {
    const culpados = CODIGO.filter((c) => /setHours\(\s*9\b/.test(c.fonte)).map((c) => c.arquivo);
    expect(culpados).toEqual([]);
  });

  /** Quem agenda usa o helper único, que sabe o fuso e pula o fim de semana. */
  it('o encaminhamento de atendimento usa o horário daqui', () => {
    const alvo = CODIGO.find((c) => c.arquivo === 'modules/atendimentos/atendimentos.service.ts')!;
    expect(alvo.fonte).toContain('proximoHorarioUtilBR(');
  });

  /**
   * A conta de dias úteis não pode voltar a ler o relógio do processo: o dia
   * dela vem de `diaBR`, que é onde o offset do Brasil mora.
   */
  it('a conta de dias úteis pergunta o dia a data-br.util', () => {
    const alvo = CODIGO.find((c) => c.arquivo === 'modules/dashboard/dias-uteis.ts')!;
    expect(alvo.fonte).toContain('diaBR(');
    expect(alvo.fonte).not.toContain('.getDay()');
    expect(alvo.fonte).not.toContain('.getDate()');
    expect(alvo.fonte).not.toContain('.getFullYear()');
  });
});
