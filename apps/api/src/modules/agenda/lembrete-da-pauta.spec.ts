import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/permissions/permissions.guard';
import { AgendaService } from './agenda.service';
import { AgendaController } from './agenda.controller';

/**
 * O LEMBRETE DA AUDIÊNCIA — o único aviso do sistema que interrompe a tela.
 *
 * "Mostrar no dia da audiência um pop-up na tela do advogado responsável para
 * lembrá-lo de entrar, com um botão rápido." — o dono.
 *
 * A regra desta base é que aviso é ESTADO e mora na faixa, que de propósito
 * não fala do dia de hoje: faixa que aparece todo dia vira cabeçalho e
 * ninguém lê. Audiência é a exceção — faltar é revelia. O que impede o
 * lembrete de virar o sino que foi removido em 12/09/2026 é a JANELA, e é ela
 * que este arquivo prende.
 */
describe('a pauta que está começando', () => {
  const ADMIN = { id: 'u1', role: 'ADMINISTRADOR', permissoes: {} } as never;

  function montar(resposta: unknown) {
    const onde: Record<string, unknown>[] = [];
    const prisma = {
      compromisso: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          onde.push(where);
          return resposta;
        }),
      },
    };
    const svc = new AgendaService(prisma as never, {} as never, {} as never);
    return { svc, onde };
  }

  it('devolve nada quando não há pauta na janela', async () => {
    const { svc } = montar(null);
    await expect(svc.pautaDeAgora(ADMIN)).resolves.toEqual({ pauta: null });
  });

  /**
   * A JANELA É DO SERVIDOR. O contêiner roda em UTC e o navegador no fuso de
   * quem olha; perguntar ao cliente "é agora?" é a família de defeito que já
   * fez 26 de 28 formatações desta base mostrarem o dia errado.
   */
  it('procura só o que começa em até 30 minutos e ainda não terminou', async () => {
    const { svc, onde } = montar(null);
    const antes = Date.now();
    await svc.pautaDeAgora(ADMIN);
    const w = onde[0] as {
      responsavelId: string;
      inicio: { lte: Date };
      fim: { gte: Date };
      tipo: { in: string[] };
    };
    expect(w.responsavelId).toBe('u1');
    expect(w.tipo.in).toEqual(['AUDIENCIA', 'PERICIA']);
    const teto = w.inicio.lte.getTime() - antes;
    expect(teto).toBeGreaterThanOrEqual(29 * 60_000);
    expect(teto).toBeLessThanOrEqual(31 * 60_000);
    // O limite de baixo é o FIM do ato, e não o início: às 10h20 ainda vale
    // lembrar de uma audiência das 10h que dura uma hora.
    expect(w.fim.gte.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('conta os minutos que faltam, e eles ficam negativos depois de começar', async () => {
    const daquiAPouco = new Date(Date.now() + 12 * 60_000);
    const { svc } = montar({
      id: 'k1', titulo: 'Audiência una — X', inicio: daquiAPouco,
      fim: new Date(daquiAPouco.getTime() + 3_600_000), local: 'Vara', linkReuniao: null, processo: null,
    });
    const r = await svc.pautaDeAgora(ADMIN);
    expect(r.pauta?.faltamMinutos).toBe(12);

    const jaComecou = new Date(Date.now() - 8 * 60_000);
    const { svc: svc2 } = montar({
      id: 'k2', titulo: 'Audiência', inicio: jaComecou,
      fim: new Date(jaComecou.getTime() + 3_600_000), local: null, linkReuniao: null, processo: null,
    });
    expect((await svc2.pautaDeAgora(ADMIN)).pauta?.faltamMinutos).toBe(-8);
  });

  /** Sem a agenda, não há lembrete — e a rota não vai ao banco à toa. */
  it('quem não vê a agenda não recebe nada', async () => {
    const { svc, onde } = montar(null);
    const r = await svc.pautaDeAgora({ id: 'u9', role: 'TRIAGEM', permissoes: { agenda: 'SEM_ACESSO' } } as never);
    expect(r).toEqual({ pauta: null });
    expect(onde).toHaveLength(0);
  });

  /**
   * A ROTA VEM ANTES DE `@Get(':id')` NO ARQUIVO. Declarada depois, o Nest
   * casaria "pauta-de-agora" como um id e a rota sumiria sem erro nenhum — o
   * defeito que já derrubou a ficha do processo neste repositório.
   */
  it('a rota literal é declarada antes da rota com parâmetro', () => {
    const bruto = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'agenda.controller.ts'), 'utf8',
    ) as string;
    /*
      SEM OS COMENTÁRIOS, e a primeira versão deste teste caiu nisso: quatro
      rotas deste arquivo EXPLICAM na prosa que vêm "antes de `@Get(':id')`",
      e o `indexOf` achava a frase do comentário lá em cima. O teste reprovava
      com a ordem certa. É a sexta vez que uma asserção desta base bate no
      português em vez do código.
    */
    const codigo = bruto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const literal = codigo.indexOf("@Get('pauta-de-agora')");
    const parametro = codigo.indexOf("@Get(':id')");
    expect(literal).toBeGreaterThan(0);
    expect(parametro).toBeGreaterThan(0);
    expect(literal).toBeLessThan(parametro);
  });

  /** É leitura de agenda: VISUALIZAR basta, e a matriz continua mandando. */
  it('a matriz governa a rota, como em todo o resto do módulo', () => {
    const guard = new PermissionsGuard(new Reflector());
    const ctx = (role: string, permissoes: Record<string, string>) =>
      ({
        getHandler: () => AgendaController.prototype.pautaDeAgora,
        getClass: () => AgendaController,
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET', user: { id: 'u1', role, permissoes } }) }),
      }) as never;
    expect(guard.canActivate(ctx('ADVOGADO', { agenda: 'VISUALIZAR' }))).toBe(true);
    expect(() => guard.canActivate(ctx('ADVOGADO', { agenda: 'SEM_ACESSO' }))).toThrow();
  });
});
