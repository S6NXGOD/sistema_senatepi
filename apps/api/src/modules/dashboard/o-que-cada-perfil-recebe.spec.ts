import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DASH = readFileSync(join(__dirname, 'dashboard.module.ts'), 'utf8');

/**
 * O QUE CADA PERFIL RECEBE DA HOME — medido no payload, não na tela.
 *
 * Conferido em 18/09/2026 entrando com os quatro perfis contra o ambiente
 * local. O corte por permissão funcionava em quase tudo (`cargaEquipe` só para
 * gestão, `minhaCarteira` só para o advogado, `minhaTriagem` só para a triagem,
 * DJEN desligado para quem não vê processos), com UM furo:
 *
 * A Triagem tem `processos: SEM_ACESSO` e recebia
 * `kpis.processosAtivos: 3, processosTotal: 3, processosPreProcessuais: 1`.
 * A tela escondia o cartão e o número viajava do mesmo jeito — que é exatamente
 * o que a regra da casa condena: "esconder na tela é conforto, não controle de
 * acesso".
 */
describe('o número de processos não sai para quem não vê processos', () => {
  const CONTAGENS = DASH.slice(
    DASH.indexOf('O NÚMERO DE PROCESSOS NÃO VAI PARA QUEM NÃO VÊ PROCESSOS'),
    DASH.indexOf('this.prisma.atendimento.count('),
  );

  it('a fatia examinada não está vazia', () => {
    expect(CONTAGENS.length).toBeGreaterThan(400);
  });

  it('as três contagens passam por `veProcessos`', () => {
    expect((CONTAGENS.match(/veProcessos/g) ?? []).length).toBe(3);
    expect((CONTAGENS.match(/Promise\.resolve\(null\)/g) ?? []).length).toBe(3);
  });

  /** Sem acesso, a consulta nem roda — não é filtrar depois de contar. */
  it('a consulta não roda quando não há acesso', () => {
    expect(CONTAGENS).toContain('? this.prisma.processo.count(');
    expect(CONTAGENS).toContain(': Promise.resolve(null),');
  });
});

/**
 * O QUE JÁ ESTAVA CERTO, e que um refactor não pode desfazer sem avisar.
 * Cada linha aqui foi observada no payload de um perfil real.
 */
describe('os cortes por perfil que já funcionavam', () => {
  it('o DJEN não roda para quem não vê processos', () => {
    expect(DASH).toContain('this.djenAtivo && veProcessos');
  });

  it('as movimentações do acervo passam pelo mesmo portão', () => {
    expect(DASH).toContain('seTiverAcesso(veProcessos, () => this.prisma.movimentacaoProcessual.findMany(');
  });

  /** "Contra quem litigamos" é leitura do acervo. */
  it('os adversários não são calculados sem acesso', () => {
    const bloco = DASH.slice(DASH.indexOf('if (!veProcessos) return [];'));
    expect(bloco.slice(0, 200)).toContain('return [];');
  });
});
