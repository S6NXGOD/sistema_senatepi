import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CronExpression } from '@nestjs/schedule';
import { CronTime } from 'cron';

/**
 * TODO `@Cron` DISPARA NA HORA DE TERESINA — e só um dos quatro era testado.
 *
 * O contêiner roda em UTC. `@Cron('0 2 * * *')` sem `timeZone` dispara às 02:00
 * do PROCESSO, que são 23:00 do dia anterior aqui. Foi o que aconteceu com o
 * cron de vencimentos, que marcou parcelas como vencidas às 21:00 da véspera.
 *
 * Até 13/09/2026 só `vencimento-no-fuso.spec.ts` exigia o fuso, e só para o
 * cron dele. DataJud, DJEN e Municípios estavam certos por cuidado, não por
 * teste — e o comentário de `municipios-cron.service.ts` jurava que havia um
 * teste que não existia (auditoria dos robôs, 13/09/2026).
 *
 * Este varre `src` inteiro, como `fuso-do-servidor.spec.ts`: a regra é do
 * projeto, não de um módulo.
 */
const RAIZ = resolve(__dirname, '..');
const FUSO = 'America/Fortaleza';

function arquivosDeCodigo(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDeCodigo(caminho, achados);
    else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) achados.push(caminho);
  }
  return achados;
}

/**
 * Sem comentários: vários arquivos EXPLICAM o `@Cron(` que deu errado, e a
 * explicação não pode virar um quinto cron na contagem.
 */
const semComentarios = (fonte: string) =>
  fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !/^\s*(\*|\/\/)/.test(linha))
    .map((linha) => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');

const CODIGO = arquivosDeCodigo(RAIZ).map((caminho) => ({
  arquivo: relative(RAIZ, caminho).split('\\').join('/'),
  fonte: semComentarios(readFileSync(caminho, 'utf8')),
}));

interface CronDeclarado {
  arquivo: string;
  /** Tudo o que está entre os parênteses do decorador. */
  argumentos: string;
}

/** Cada `@Cron(...)` do código, com os argumentos inteiros (parênteses casados). */
function cronsDeclarados(): CronDeclarado[] {
  const achados: CronDeclarado[] = [];
  for (const { arquivo, fonte } of CODIGO) {
    const decorador = /@Cron\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = decorador.exec(fonte))) {
      let profundidade = 1;
      let i = m.index + m[0].length;
      const inicio = i;
      while (i < fonte.length && profundidade > 0) {
        if (fonte[i] === '(') profundidade++;
        else if (fonte[i] === ')') profundidade--;
        i++;
      }
      achados.push({ arquivo, argumentos: fonte.slice(inicio, i - 1) });
    }
  }
  return achados;
}

const CRONS = cronsDeclarados();

/** O fuso declarado, aceitando o literal ou a constante oficial. */
function fusoDeclarado(argumentos: string): string | null {
  const m = argumentos.match(/timeZone:\s*(?:'([^']+)'|"([^"]+)"|(FUSO_BR)\b)/);
  if (!m) return null;
  return m[3] ? FUSO : (m[1] ?? m[2]);
}

/** A expressão do cron: literal entre aspas ou `CronExpression.X`. */
function expressaoDeclarada(argumentos: string): string {
  const literal = argumentos.match(/^\s*['"]([^'"]+)['"]/);
  if (literal) return literal[1];
  const constante = argumentos.match(/^\s*CronExpression\.(\w+)/);
  if (constante) return (CronExpression as Record<string, string>)[constante[1]];
  throw new Error(`Expressão de cron não reconhecida: ${argumentos.slice(0, 60)}`);
}

/**
 * A HORA DE TERESINA QUE CADA ROTINA PROMETE — e por que é esta.
 *
 *  00:00 vencimentos (o dia de calendário vira aqui, não em Greenwich)
 *  02:00 DataJud · 03:00 Municípios/SICONFI · 05:00 DJEN (três horas depois do
 *  DataJud, para a publicação achar o andamento já gravado)
 */
const HORA_EM_TERESINA: Record<string, number> = {
  'modules/cobrancas/cobrancas-cron.service.ts': 0,
  'modules/processos/processos-cron.service.ts': 2,
  'modules/municipios/municipios-cron.service.ts': 3,
  'modules/processos/djen-cron.service.ts': 5,
};

describe('todo @Cron dispara no fuso de Teresina', () => {
  /** O teste precisa estar lendo o projeto, e não uma pasta vazia. */
  it('a varredura enxerga o código', () => {
    expect(CODIGO.length).toBeGreaterThan(50);
    expect(CODIGO.map((c) => c.arquivo)).toContain('modules/processos/processos-cron.service.ts');
  });

  it('cada @Cron declara timeZone de Teresina — a contagem dos dois bate', () => {
    const semFuso = CRONS.filter((c) => fusoDeclarado(c.argumentos) !== FUSO).map((c) => c.arquivo);
    expect(semFuso).toEqual([]);
    const comFuso = CRONS.filter((c) => fusoDeclarado(c.argumentos) === FUSO).length;
    expect(comFuso).toBe(CRONS.length);
  });

  /**
   * EXATAMENTE QUATRO. Um quinto cron não está errado por existir — mas obriga
   * alguém a olhar a hora dele, a trava, o módulo e o rastro no log antes de
   * acrescentá-lo a esta lista.
   */
  it('são exatamente quatro, e são estes', () => {
    expect(CRONS.map((c) => c.arquivo).sort()).toEqual(Object.keys(HORA_EM_TERESINA).sort());
    expect(CRONS).toHaveLength(4);
  });

  /**
   * NÃO BASTA TER A PALAVRA `timeZone`: a hora calculada pela própria biblioteca
   * do agendador, com o que está declarado, tem de ser a de Teresina — e três
   * horas depois em UTC, que é o relógio do contêiner.
   */
  it.each(Object.entries(HORA_EM_TERESINA))('%s dispara às %i:00 de Teresina', (arquivo, hora) => {
    const cron = CRONS.find((c) => c.arquivo === arquivo)!;
    const proximo = new CronTime(expressaoDeclarada(cron.argumentos), fusoDeclarado(cron.argumentos)!).sendAt();
    expect(proximo.setZone(FUSO).hour).toBe(hora);
    expect(proximo.setZone(FUSO).minute).toBe(0);
    expect(proximo.toUTC().hour).toBe((hora + 3) % 24);
  });

  /** O porquê em números: sem o fuso, a rotina das 02:00 roda às 23:00 da véspera. */
  it('sem o fuso, no relógio do contêiner, a rotina das 02:00 cairia às 23:00 daqui', () => {
    const noConteiner = new CronTime('0 2 * * *', 'UTC').sendAt();
    expect(noConteiner.setZone(FUSO).hour).toBe(23);
  });
});
