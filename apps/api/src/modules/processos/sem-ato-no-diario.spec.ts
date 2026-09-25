import { StatusProcesso } from '@prisma/client';
import { DjenSyncService } from './djen-sync.service';

/**
 * "SERÁ SE O DJEN ESTÁ DEIXANDO ALGUÉM DE FORA?" — a pergunta do dono,
 * 25/09/2026, e a resposta medida contra a produção tem duas metades opostas.
 *
 * POR OAB NÃO DEIXA NINGUÉM DE FORA. Dos 157 processos vivos, **ZERO** estão
 * sem um advogado com OAB consultável na equipe. A Dra. Lara Cortez continua
 * sem OAB no cadastro, mas não é a principal de nenhum dos dois processos dela
 * e os dois têm outros quatro advogados com OAB — nenhum prazo depende dela.
 * (Eu tinha escrito em 07/09 que eram "dois processos cujo prazo não é
 * anunciado". Estava errado, e o comentário foi corrigido.)
 *
 * POR PROCESSO DEIXA OITO. Desses 157, **8 nunca receberam um único ato**, e o
 * histórico dos oito já foi lido — em 15/09 — e voltou vazio. Três têm história
 * longa:
 *
 *   0001077-39.2016.5.22.0004  TRT22  319 andamentos desde 2016, 0 publicações
 *   0801494-24.2022.8.18.0031  TJPI   132 andamentos,            0 publicações
 *   0800249-51.2022.8.18.0039  TJPI    47 andamentos,            0 publicações
 *
 * E ISSO ERA INVISÍVEL PELO MESMO MOTIVO DE SEMPRE: não é falha. A consulta
 * funciona, a OAB é válida, o número é lido toda noite — o Diário é que não tem
 * ato daquele processo. Nem todo tribunal manda tudo para o DJEN. A ficha de
 * cada um deles dizia exatamente o mesmo que a dos outros 149: "Acompanhado no
 * Diário pela OAB de Fulano e pelo número do processo".
 */
describe('vivosSemAtoNoDiario — onde o Diário nunca trouxe nada', () => {
  function montar(processos: { id: string; numeroCNJ: string | null; movs: number }[]) {
    const onde: Record<string, unknown>[] = [];
    const prisma = {
      processo: {
        count: jest.fn(async (args: { where: Record<string, unknown> }) => {
          onde.push(args.where);
          return processos.length;
        }),
        findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
          onde.push(args.where);
          return processos.map((p) => ({
            id: p.id,
            numeroCNJ: p.numeroCNJ,
            _count: { movimentacoes: p.movs },
          }));
        }),
      },
    };
    const svc = Object.create(DjenSyncService.prototype) as DjenSyncService;
    Object.assign(svc, { prisma });
    return { svc, onde };
  }

  /** O caso real da produção, com os três de história longa no meio dos oito. */
  const OITO = [
    { id: 'p1', numeroCNJ: '00010773920165220004', movs: 319 },
    { id: 'p2', numeroCNJ: '08014942420228180031', movs: 132 },
    { id: 'p3', numeroCNJ: '08002495120228180039', movs: 47 },
    { id: 'p4', numeroCNJ: '08004699720248180065', movs: 22 },
    { id: 'p5', numeroCNJ: '08009966620258180048', movs: 19 },
    { id: 'p6', numeroCNJ: '08007559020268180102', movs: 11 },
    { id: 'p7', numeroCNJ: '08551926420268180140', movs: 5 },
    { id: 'p8', numeroCNJ: '08564909120268180140', movs: 0 },
  ];

  it('conta todos e devolve o total sem corte', async () => {
    const { svc } = montar(OITO);
    await expect(svc.vivosSemAtoNoDiario()).resolves.toMatchObject({ total: 8 });
  });

  /**
   * O QUE SEPARA O CASO NOVO DO CASO SURDO É A CONTAGEM DE ANDAMENTOS.
   *
   * Zero publicações num processo cadastrado ontem é normal — não houve ato.
   * Zero num processo com 319 andamentos desde 2016 quer dizer outra coisa: o
   * Diário não é a via dele. Por isso a ordem é por andamento, e não por
   * cadastro: quem abre a lista precisa ver primeiro o que não se explica.
   */
  it('o de mais andamentos vem primeiro — é o que menos se explica', async () => {
    const { svc } = montar(OITO);
    const r = await svc.vivosSemAtoNoDiario();
    expect(r.exemplos.map((e) => e.movimentacoes)).toEqual([319, 132, 47, 22, 19, 11, 5, 0]);
    expect(r.exemplos[0].numeroCNJ).toBe('00010773920165220004');
  });

  it('o corte é só da lista; o total continua dizendo quantos são', async () => {
    const { svc } = montar(OITO);
    const r = await svc.vivosSemAtoNoDiario(3);
    expect(r.exemplos).toHaveLength(3);
    expect(r.total).toBe(8);
  });

  /**
   * ANTES DE PERGUNTAR, "NADA CHEGOU" É "AINDA NÃO PROCURAMOS".
   *
   * Sem `djenHistoricoLidoEm`, o processo está apenas na fila do robô, e
   * listá-lo aqui seria transformar a própria fila de trabalho em acusação — o
   * mesmo erro do alarme que contradizia o robô. O filtro exige o histórico
   * lido, e este teste prova que ele vai ao banco, não que a linha existe.
   */
  it('só entra quem já teve o histórico lido, está vivo e tem zero atos', async () => {
    const { svc, onde } = montar([]);
    await svc.vivosSemAtoNoDiario();
    for (const w of onde) {
      expect(w).toMatchObject({
        comunicacoes: { none: {} },
        djenHistoricoLidoEm: { not: null },
      });
      expect((w.statusInterno as { in: StatusProcesso[] }).in).toEqual(
        expect.arrayContaining([StatusProcesso.ATIVO, StatusProcesso.PENDENTE]),
      );
    }
  });

  /** Processo dormente não é acompanhamento: encerrado não entra na conta. */
  it('o filtro de status é o mesmo "vivo" da varredura, sem encerrado', async () => {
    const { svc, onde } = montar([]);
    await svc.vivosSemAtoNoDiario();
    const vivos = (onde[0].statusInterno as { in: StatusProcesso[] }).in;
    expect(vivos).not.toContain(StatusProcesso.ENCERRADO);
    expect(vivos).not.toContain(StatusProcesso.ARQUIVADO);
  });

  /** Acervo saudável não vira faixa: zero é zero, e a tela some. */
  it('sem nenhum caso, devolve total zero e lista vazia', async () => {
    const { svc } = montar([]);
    await expect(svc.vivosSemAtoNoDiario()).resolves.toEqual({ total: 0, exemplos: [] });
  });
});
