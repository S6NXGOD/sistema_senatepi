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
   * A JANELA DA PORTARIA é um dia de calendário daqui. Lida no fuso do processo,
   * ela começava às 21h da véspera e terminava às 20h59 do dia pedido — trazia
   * três horas da noite anterior e perdia as três últimas de expediente.
   */
  it('o histórico de acessos usa o dia daqui', () => {
    const alvo = CODIGO.find((c) => c.arquivo === 'modules/acessos/acessos.module.ts')!;
    expect(alvo.fonte).toContain('inicioDoDiaBR(');
    expect(alvo.fonte).not.toContain('setHours(0, 0, 0, 0)');
  });

  /** Mês e idade também: o painel conta o mês de Brasília, não o do servidor. */
  it('mês e idade vêm do calendário daqui', () => {
    const painel = CODIGO.find((c) => c.arquivo === 'modules/dashboard/dashboard.module.ts')!;
    expect(painel.fonte).toContain('inicioDoMesBR(');
    expect(painel.fonte).toContain('mesBR(');
    expect(painel.fonte).not.toContain('.getMonth()');

    const dep = CODIGO.find((c) => c.arquivo === 'modules/dependentes/dependentes.module.ts')!;
    expect(dep.fonte).toContain('idadeEmAnosBR(');
    expect(dep.fonte).not.toContain('.getFullYear()');
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

/**
 * A TRAVA GLOBAL — e ela nasceu porque as travas por ARQUIVO não bastaram.
 *
 * Os testes acima nomeiam alvos: "o encaminhamento de atendimento usa o horário
 * daqui", "o histórico de acessos usa o dia daqui". Cada um deles entrou DEPOIS
 * de um estrago, e cada um cobre exatamente o arquivo que já quebrou. Arquivo
 * novo passa batido — foi assim que o caminho de atendimentos escapou da versão
 * anterior deste teste, que olhava dois arquivos por nome.
 *
 * A regra é do PROJETO: o contêiner roda em UTC, então nenhum código do
 * servidor pode ler o relógio do processo nem formatar sem dizer o fuso.
 * `data-br.util.ts` é a única casa dessas regras — é lá que o offset mora, e é
 * de lá que todo mundo importa.
 *
 * Auditado em 10/09/2026, antes desta trava existir:
 *
 *   leituras do relógio do processo ......  3 arquivos
 *     · carteirinhas ... `getFullYear()` no número e na validade (vira às 21h
 *       de 31/12: carteirinha de 2026 numerada CART-2027)
 *     · importação ..... o mesmo
 *     · prazos ......... `somarDiasUteis` pulava fim de semana com `getDay()`;
 *       medido com TZ=UTC, 113 de 2.000 movimentações (5,7%) davam prazo
 *       diferente do correto, o exemplo errando por DOIS dias
 *
 *   formatação sem fuso .................. 26 de 28 chamadas
 *     PDF de carteirinha, PDF de certificado, dossiê do processo, CSV da
 *     auditoria, lista de presença, descrição de tarefa do robô. Um
 *     `toLocaleString` desses mostrava 17:04 num documento emitido às 14:04.
 */
describe('a regra de fuso é do projeto, não de um arquivo', () => {
  /** `getUTCDay` e irmãos NÃO casam: a regex exige o método sem o `UTC`. */
  const RELOGIO_DO_PROCESSO =
    /\.(setHours|setMinutes|setDate|setMonth|setFullYear|getHours|getDay|getDate|getMonth|getFullYear)\(/;
  const FORMATACAO = /\.toLocale(Date|Time)?String\(/;

  /** A única casa das regras de fuso — é ela que pode usar as primitivas. */
  const CASA_DO_FUSO = 'modules/processos/utils/data-br.util.ts';

  it('a varredura enxerga o código e conhece a casa do fuso', () => {
    expect(CODIGO.length).toBeGreaterThan(50);
    expect(CODIGO.map((c) => c.arquivo)).toContain(CASA_DO_FUSO);
  });

  it('ninguém lê o relógio do processo fora de data-br.util', () => {
    const culpados = CODIGO.filter(
      (c) => c.arquivo !== CASA_DO_FUSO && RELOGIO_DO_PROCESSO.test(c.fonte),
    ).map((c) => c.arquivo);
    expect(culpados).toEqual([]);
  });

  /**
   * Formatar sem `timeZone` é ler o relógio do processo por outro caminho — e
   * foi o mais numeroso dos dois (26 de 28). Todo mundo passa pelos
   * formatadores de `data-br.util`, que fixam o fuso.
   */
  it('ninguém formata data fora de data-br.util', () => {
    const culpados = CODIGO.filter(
      (c) => c.arquivo !== CASA_DO_FUSO && FORMATACAO.test(c.fonte),
    ).map((c) => c.arquivo);
    expect(culpados).toEqual([]);
  });

  /** E a casa do fuso realmente fixa o fuso em tudo que formata. */
  it('os formatadores oficiais dizem o fuso', () => {
    const casa = CODIGO.find((c) => c.arquivo === CASA_DO_FUSO)!;
    const chamadas = casa.fonte.match(/\.toLocale(Date|Time)?String\(/g) ?? [];
    expect(chamadas.length).toBeGreaterThan(0);
    expect(casa.fonte.match(/timeZone: FUSO_BR/g)?.length).toBe(chamadas.length);
    // Uma grafia só: `America/Sao_Paulo` convivia com `America/Fortaleza`.
    expect(casa.fonte).toContain("export const FUSO_BR = 'America/Fortaleza'");
  });

  /**
   * DIA DE CALENDÁRIO x INSTANTE — a ambiguidade que custou 5,7% dos prazos.
   *
   * `somarDiasUteisEmCalendario` exige um dia à meia-noite UTC e lê o dia da
   * semana com `getUTCDay`. Quem tem instante converte com `diaDeCalendarioBR`;
   * quem tem coluna `date` passa direto (ela JÁ é um dia de calendário).
   */
  it('a soma de dias úteis exige dia de calendário, e lê o dia em UTC', () => {
    const casa = CODIGO.find((c) => c.arquivo === CASA_DO_FUSO)!;
    expect(casa.fonte).toContain('export function somarDiasUteisEmCalendario(diaBase: Date');
    expect(casa.fonte).toContain('d.getUTCDay()');

    const prazos = CODIGO.find(
      (c) => c.arquivo === 'modules/processos/automacao-prazos.service.ts',
    )!;
    // Instante: converte antes.
    expect(prazos.fonte).toContain('diaDeCalendarioBR(mov.dataMovimento)');

    const correlacao = CODIGO.find(
      (c) => c.arquivo === 'modules/processos/correlacao.service.ts',
    )!;
    // Coluna `date`: passa direto — converter aqui voltaria um dia.
    expect(correlacao.fonte).toContain('somarDiasUteisEmCalendario(c.dataDisponibilizacao');
    expect(correlacao.fonte).not.toContain('diaDeCalendarioBR(c.dataDisponibilizacao');
  });
});

