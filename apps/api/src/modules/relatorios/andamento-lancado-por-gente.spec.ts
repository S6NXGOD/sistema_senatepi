import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { ProcessosCsvService } from '../importacao/processos-csv.service';

/**
 * "ANDAMENTOS INTERNOS" CONTAM SÓ O LANÇAMENTO FEITO POR GENTE (13/09/2026).
 *
 * Os Relatórios contam `movimentacoes_internas` com autor e `origem` nula. Isso
 * só é verdade enquanto todo caminho que escreve em nome de alguém sem ter sido
 * lançamento dela DISSER a origem. Um caminho novo que esqueça volta a inflar o
 * número sem nada acusar — por isso a varredura abaixo conta os pontos de
 * escrita e exige que cada um esteja classificado.
 */

const SRC = path.resolve(__dirname, '../..');

describe('a planilha grava a origem da nota', () => {
  it('a nota da importação sai com origem IMPORTACAO, em nome de quem subiu', async () => {
    const criar = jest.fn(async () => ({}));
    const prisma = {
      processo: {
        findUnique: jest.fn(async () => ({ id: 'p1', ultimoMovimentoEm: new Date('2026-08-01T12:00:00Z') })),
      },
      movimentacaoInterna: { create: criar },
    };
    const servico = new ProcessosCsvService(prisma as never, {} as never, {} as never);
    const registrar = (
      servico as unknown as { registrarAndamento: (l: unknown, autorId?: string) => Promise<void> }
    ).registrarAndamento.bind(servico);

    await registrar({ npu: '0000001-00.2026.5.22.0001', andamento: 'Aguarda sentença.', andamentoData: '' }, 'u1');

    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0]).toEqual([
      {
        data: expect.objectContaining({
          processoId: 'p1', autorId: 'u1', origem: 'IMPORTACAO', origemSistema: false,
        }),
      },
    ]);
  });
});

/* ---------- a varredura dos pontos de escrita ---------- */

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) return arquivosTs(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** O argumento de cada `movimentacaoInterna.create(`, com os parênteses casados. */
function escritas(src: string): string[] {
  const saida: string[] = [];
  const marca = 'movimentacaoInterna.create(';
  let i = src.indexOf(marca);
  while (i !== -1) {
    let prof = 1;
    let j = i + marca.length;
    while (j < src.length && prof > 0) {
      if (src[j] === '(') prof++;
      else if (src[j] === ')') prof--;
      j++;
    }
    saida.push(src.slice(i, j));
    i = src.indexOf(marca, j);
  }
  return saida;
}

type Classe = 'ROBO' | 'COM_ORIGEM' | 'LANCAMENTO_MANUAL';

function classificar(trecho: string): Classe {
  if (/origemSistema:\s*true/.test(trecho)) return 'ROBO';
  if (/\borigem:\s*['"A-Za-z]/.test(trecho)) return 'COM_ORIGEM';
  return 'LANCAMENTO_MANUAL';
}

describe('todo caminho que escreve andamento diz de onde veio', () => {
  const pontos = arquivosTs(SRC).flatMap((arq) =>
    escritas(semComentarios(readFileSync(arq, 'utf8'))).map((trecho) => ({
      arquivo: path.relative(SRC, arq).replace(/\\/g, '/'),
      classe: classificar(trecho),
      trecho,
    })),
  );

  it('encontra os pontos de escrita (o teste não passa por varrer nada)', () => {
    expect(pontos.length).toBeGreaterThanOrEqual(6);
  });

  /**
   * O ÚNICO lançamento manual é a rota da ficha do processo: é exatamente o que
   * os Relatórios querem contar. Qualquer outro caminho sem `origem` nem
   * `origemSistema` é um irmão esquecido.
   */
  it('só a ficha do processo lança sem origem', () => {
    const manuais = pontos.filter((p) => p.classe === 'LANCAMENTO_MANUAL').map((p) => p.arquivo);
    expect(manuais).toEqual(['modules/processos/movimentacoes.service.ts']);
  });

  it('a importação grava IMPORTACAO', () => {
    const daPlanilha = pontos.filter((p) => p.arquivo === 'modules/importacao/processos-csv.service.ts');
    expect(daPlanilha).toHaveLength(1);
    expect(daPlanilha[0].trecho).toContain("origem: 'IMPORTACAO'");
  });

  /** O eco da conclusão e a conversa que abre o caso pré-processual (literais do backfill da A0). */
  it('a agenda grava CONCLUSAO e CONVERSAO', () => {
    const daAgenda = pontos.filter((p) => p.arquivo === 'modules/agenda/agenda.service.ts');
    expect(daAgenda.map((p) => p.classe)).toEqual(daAgenda.map(() => 'COM_ORIGEM'));
    const texto = daAgenda.map((p) => p.trecho).join('\n');
    expect(texto).toContain("'CONCLUSAO'");
    expect(texto).toContain("'CONVERSAO'");
  });
});
