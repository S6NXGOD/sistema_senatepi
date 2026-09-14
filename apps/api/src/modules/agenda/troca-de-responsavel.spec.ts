import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StatusCompromisso } from '@prisma/client';
import { ORIGEM_RESERVA } from './equipe.util';
import { passarConsultaEmTransacao } from './troca-de-responsavel';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A CONSULTA PASSA DE UMA PESSOA PARA OUTRA NO MESMO PAPEL — e ninguém mais some.
 *
 * O caso da troca de plantão (D16 da rodada 3, 14/09/2026): a Dra. Shérad passa
 * o plantão de 15/09 ao Dr. Murilo, com as consultas. `sincronizarEquipe` APAGA
 * quem não estiver na lista que recebe; quem montasse a lista só com quem entra
 * derrubaria o colega escolhido por gente e a reserva do robô.
 *
 * O banco falso guarda a equipe em memória, roda o `sincronizarEquipe` de
 * verdade e recusa dois principais na mesma atividade, como o índice parcial
 * `compromisso_um_principal` do Postgres. Filtro que ele não conhece quebra.
 */

const { PENDENTE, EM_ANDAMENTO, CONCLUIDO, CANCELADO } = StatusCompromisso;

interface LinhaDaEquipe {
  compromissoId: string;
  usuarioId: string;
  principal: boolean;
  origem: string | null;
}

const PESSOAS = [
  { id: 'u-sherad', nome: 'Shérad Maria Alves', nomeExibicao: 'Dra. Shérad', ativo: true },
  { id: 'u-murilo', nome: 'Murilo Sousa Lima', nomeExibicao: 'Dr. Murilo', ativo: true },
  { id: 'u-margareth', nome: 'Margareth Costa', nomeExibicao: 'Dra. Margareth', ativo: true },
  { id: 'u-tiago', nome: 'Tiago Rocha', nomeExibicao: null, ativo: true },
  { id: 'u-antigo', nome: 'Antônio Paz', nomeExibicao: 'Dr. Antônio', ativo: false },
];

function bancoFalso(inicial: {
  status?: StatusCompromisso;
  responsavelId: string;
  equipe: Omit<LinhaDaEquipe, 'compromissoId'>[];
}) {
  const ID = 'consulta-15-09-9h';
  const compromisso = { id: ID, status: inicial.status ?? PENDENTE, responsavelId: inicial.responsavelId };
  let equipe: LinhaDaEquipe[] = inicial.equipe.map((e) => ({ compromissoId: ID, ...e }));
  let escritas = 0;

  const casaLinha = (l: LinhaDaEquipe, where: Record<string, any>) =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === 'compromissoId' || campo === 'principal' || campo === 'origem') {
        return (l as any)[campo] === cond;
      }
      if (campo === 'usuarioId') {
        if (typeof cond === 'string') return l.usuarioId === cond;
        if (cond.notIn) return !cond.notIn.includes(l.usuarioId);
        if (cond.in) return cond.in.includes(l.usuarioId);
      }
      throw new Error(`O banco falso não conhece o filtro "${campo}".`);
    });

  const conferirIndice = () => {
    if (equipe.filter((e) => e.principal).length > 1) {
      throw new Error('violação do índice compromisso_um_principal: dois principais');
    }
  };

  const tx: any = {
    compromisso: {
      findUnique: async ({ where }: any) => (where.id === ID ? { ...compromisso } : null),
      update: async ({ where, data }: any) => {
        escritas++;
        expect(where.id).toBe(ID);
        Object.assign(compromisso, data);
        return { ...compromisso };
      },
    },
    user: {
      findMany: async ({ where }: any) => PESSOAS.filter((p) => where.id.in.includes(p.id)),
    },
    compromissoResponsavel: {
      findMany: async ({ where }: any) => equipe.filter((l) => casaLinha(l, where)).map((l) => ({ ...l })),
      findFirst: async ({ where }: any) => {
        const l = equipe.find((x) => casaLinha(x, where));
        return l ? { ...l } : null;
      },
      deleteMany: async ({ where }: any) => {
        escritas++;
        const antes = equipe.length;
        equipe = equipe.filter((l) => !casaLinha(l, where));
        return { count: antes - equipe.length };
      },
      updateMany: async ({ where, data }: any) => {
        escritas++;
        const alvo = equipe.filter((l) => casaLinha(l, where));
        alvo.forEach((l) => Object.assign(l, data));
        conferirIndice();
        return { count: alvo.length };
      },
      upsert: async ({ where, create, update }: any) => {
        escritas++;
        const { compromissoId, usuarioId } = where.compromissoId_usuarioId;
        const achada = equipe.find((l) => l.compromissoId === compromissoId && l.usuarioId === usuarioId);
        if (achada) Object.assign(achada, update);
        else equipe.push({ origem: null, ...create });
        conferirIndice();
        return {};
      },
    },
  };

  return {
    tx,
    ID,
    compromisso,
    /** A equipe como a tela mostraria: o principal primeiro. */
    equipe: () =>
      [...equipe]
        .sort((a, b) => Number(b.principal) - Number(a.principal) || a.usuarioId.localeCompare(b.usuarioId))
        .map(({ usuarioId, principal, origem }) => ({ usuarioId, principal, origem })),
    escritas: () => escritas,
  };
}

describe('quem sai respondia pela consulta', () => {
  it('quem entra passa a responder; o colega escolhido por gente e a reserva do robô ficam', async () => {
    const b = bancoFalso({
      responsavelId: 'u-sherad',
      equipe: [
        { usuarioId: 'u-sherad', principal: true, origem: null },
        { usuarioId: 'u-margareth', principal: false, origem: null },
        { usuarioId: 'u-tiago', principal: false, origem: ORIGEM_RESERVA },
      ],
    });

    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-murilo' });

    expect(r).toEqual({ papel: 'RESPONSAVEL', jaEraResponsavel: false, deNome: 'Dra. Shérad', paraNome: 'Dr. Murilo' });
    expect(b.equipe()).toEqual([
      { usuarioId: 'u-murilo', principal: true, origem: null },
      { usuarioId: 'u-margareth', principal: false, origem: null },
      { usuarioId: 'u-tiago', principal: false, origem: ORIGEM_RESERVA },
    ]);
    // O atalho acompanha a tabela: o painel e a agenda do Dr. Murilo passam a mostrar a consulta.
    expect(b.compromisso.responsavelId).toBe('u-murilo');
  });

  it('quem entra era reserva do robô: vira responsável, uma linha só, e a marca de reserva sai', async () => {
    const b = bancoFalso({
      responsavelId: 'u-sherad',
      equipe: [
        { usuarioId: 'u-sherad', principal: true, origem: null },
        { usuarioId: 'u-tiago', principal: false, origem: ORIGEM_RESERVA },
      ],
    });

    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-tiago' });

    // Sem nome de exibição, o nome do cadastro.
    expect(r).toEqual({ papel: 'RESPONSAVEL', jaEraResponsavel: false, deNome: 'Dra. Shérad', paraNome: 'Tiago Rocha' });
    expect(b.equipe()).toEqual([{ usuarioId: 'u-tiago', principal: true, origem: null }]);
    expect(b.compromisso.responsavelId).toBe('u-tiago');
  });

  it('atividade de carga antiga, sem a linha do responsável: o atalho diz quem responde', async () => {
    const b = bancoFalso({
      responsavelId: 'u-sherad',
      equipe: [{ usuarioId: 'u-margareth', principal: false, origem: null }],
    });

    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-murilo' });

    expect(r.papel).toBe('RESPONSAVEL');
    expect(b.equipe()).toEqual([
      { usuarioId: 'u-murilo', principal: true, origem: null },
      { usuarioId: 'u-margareth', principal: false, origem: null },
    ]);
    expect(b.compromisso.responsavelId).toBe('u-murilo');
  });

  it('consulta em andamento também passa (a regra de quem pode passar é de quem chama)', async () => {
    const b = bancoFalso({
      status: EM_ANDAMENTO,
      responsavelId: 'u-sherad',
      equipe: [{ usuarioId: 'u-sherad', principal: true, origem: null }],
    });
    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-murilo' });
    expect(r.papel).toBe('RESPONSAVEL');
  });
});

describe('quem sai atuava junto', () => {
  it('quem entra passa a atuar junto; o responsável não muda', async () => {
    const b = bancoFalso({
      responsavelId: 'u-margareth',
      equipe: [
        { usuarioId: 'u-margareth', principal: true, origem: null },
        { usuarioId: 'u-sherad', principal: false, origem: null },
        { usuarioId: 'u-tiago', principal: false, origem: ORIGEM_RESERVA },
      ],
    });

    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-murilo' });

    expect(r).toEqual({ papel: 'PARTICIPANTE', jaEraResponsavel: false, deNome: 'Dra. Shérad', paraNome: 'Dr. Murilo' });
    expect(b.equipe()).toEqual([
      { usuarioId: 'u-margareth', principal: true, origem: null },
      { usuarioId: 'u-murilo', principal: false, origem: null },
      { usuarioId: 'u-tiago', principal: false, origem: ORIGEM_RESERVA },
    ]);
    expect(b.compromisso.responsavelId).toBe('u-margareth');
  });

  it('quem entra já atuava junto: só sai quem sai, sem linha repetida', async () => {
    const b = bancoFalso({
      responsavelId: 'u-margareth',
      equipe: [
        { usuarioId: 'u-margareth', principal: true, origem: null },
        { usuarioId: 'u-sherad', principal: false, origem: null },
        { usuarioId: 'u-murilo', principal: false, origem: null },
      ],
    });

    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-murilo' });

    expect(r.jaEraResponsavel).toBe(false);
    expect(b.equipe()).toEqual([
      { usuarioId: 'u-margareth', principal: true, origem: null },
      { usuarioId: 'u-murilo', principal: false, origem: null },
    ]);
  });

  it('quem entra já era o responsável: fica sozinho, e a passagem diz que ele já respondia', async () => {
    // Revisão da rodada 3 (14/09/2026): a frase do histórico dizia que o Dr.
    // Murilo "atua junto" numa consulta em que ele é o responsável.
    const b = bancoFalso({
      responsavelId: 'u-murilo',
      equipe: [
        { usuarioId: 'u-murilo', principal: true, origem: null },
        { usuarioId: 'u-sherad', principal: false, origem: null },
      ],
    });

    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-murilo' });

    expect(r).toEqual({ papel: 'PARTICIPANTE', jaEraResponsavel: true, deNome: 'Dra. Shérad', paraNome: 'Dr. Murilo' });
    expect(b.equipe()).toEqual([{ usuarioId: 'u-murilo', principal: true, origem: null }]);
    expect(b.compromisso.responsavelId).toBe('u-murilo');
  });

  it('carga antiga sem a linha do principal: o atalho diz que quem entra já respondia', async () => {
    const b = bancoFalso({
      responsavelId: 'u-murilo',
      equipe: [{ usuarioId: 'u-sherad', principal: false, origem: null }],
    });

    const r = await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-murilo' });

    expect(r.jaEraResponsavel).toBe(true);
    expect(b.equipe()).toEqual([{ usuarioId: 'u-murilo', principal: true, origem: null }]);
  });

  it('quem entra era reserva: vira participante escolhido por gente', async () => {
    const b = bancoFalso({
      responsavelId: 'u-margareth',
      equipe: [
        { usuarioId: 'u-margareth', principal: true, origem: null },
        { usuarioId: 'u-sherad', principal: false, origem: null },
        { usuarioId: 'u-tiago', principal: false, origem: ORIGEM_RESERVA },
      ],
    });

    await passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, deId: 'u-sherad', paraId: 'u-tiago' });

    expect(b.equipe()).toEqual([
      { usuarioId: 'u-margareth', principal: true, origem: null },
      { usuarioId: 'u-tiago', principal: false, origem: null },
    ]);
  });
});

describe('o que não passa — e não escreve nada', () => {
  const equipePadrao = {
    responsavelId: 'u-sherad',
    equipe: [
      { usuarioId: 'u-sherad', principal: true, origem: null },
      { usuarioId: 'u-tiago', principal: false, origem: ORIGEM_RESERVA },
    ],
  };

  it.each<[string, Parameters<typeof bancoFalso>[0], { deId: string; paraId: string }, string]>([
    ['a mesma pessoa', equipePadrao, { deId: 'u-sherad', paraId: 'u-sherad' }, 'Quem sai e quem entra são a mesma pessoa.'],
    ['quem sai não está na consulta', equipePadrao, { deId: 'u-margareth', paraId: 'u-murilo' }, 'Dra. Margareth não está nesta atividade.'],
    [
      'quem sai é só reserva do robô',
      equipePadrao,
      { deId: 'u-tiago', paraId: 'u-murilo' },
      'Tiago Rocha está nesta atividade só como reserva posta pelo sistema. Não há o que passar.',
    ],
    [
      'quem entra saiu do sistema',
      equipePadrao,
      { deId: 'u-sherad', paraId: 'u-antigo' },
      'Dr. Antônio não está ativo no sistema e não pode assumir a consulta.',
    ],
    [
      'quem entra não existe',
      equipePadrao,
      { deId: 'u-sherad', paraId: 'u-fantasma' },
      'Quem entra não está ativo no sistema e não pode assumir a consulta.',
    ],
    [
      'consulta concluída',
      { ...equipePadrao, status: CONCLUIDO },
      { deId: 'u-sherad', paraId: 'u-murilo' },
      'Atividade concluída ou cancelada não muda de dono: o histórico diz quem cuidou dela.',
    ],
    [
      'consulta cancelada',
      { ...equipePadrao, status: CANCELADO },
      { deId: 'u-sherad', paraId: 'u-murilo' },
      'Atividade concluída ou cancelada não muda de dono: o histórico diz quem cuidou dela.',
    ],
  ])('%s', async (_caso, inicial, pedido, frase) => {
    const b = bancoFalso(inicial);
    const antes = b.equipe();
    const tentativa = passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, ...pedido });
    await expect(tentativa).rejects.toThrow(BadRequestException);
    await expect(passarConsultaEmTransacao(b.tx, { compromissoId: b.ID, ...pedido })).rejects.toThrow(frase);
    expect(b.escritas()).toBe(0);
    expect(b.equipe()).toEqual(antes);
    expect(b.compromisso.responsavelId).toBe('u-sherad');
  });

  it('consulta que não existe: 404', async () => {
    const b = bancoFalso(equipePadrao);
    await expect(
      passarConsultaEmTransacao(b.tx, { compromissoId: 'outra', deId: 'u-sherad', paraId: 'u-murilo' }),
    ).rejects.toThrow(NotFoundException);
    expect(b.escritas()).toBe(0);
  });
});
