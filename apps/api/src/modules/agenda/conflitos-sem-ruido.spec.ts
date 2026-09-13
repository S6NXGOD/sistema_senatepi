import { StatusCompromisso } from '@prisma/client';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O AVISO DE CHOQUE SEM RUÍDO — provado com atividades, não com o texto do filtro.
 *
 * Dois avisos falsos ensinavam a equipe a ignorar o verdadeiro (auditoria de
 * 12/09/2026):
 *  · a RESERVA do robô — ser reserva de um "Elaborar manifestação" das 09:00
 *    fazia a audiência das 09:30 dizer "já há uma atividade nesse horário";
 *  · a TAREFA do robô sem hora marcada — as 9h dela são convenção.
 * E o formulário conferia só o responsável, não quem foi posto para atuar junto.
 *
 * O avaliador aplica o `where` com a semântica do banco, inclusive a de
 * `{ not: X }` NÃO trazer a linha nula (memória "not em coluna nula").
 */
interface Atividade {
  id: string;
  status: StatusCompromisso;
  tipo: string;
  origemAutomatica: boolean;
  responsavelId: string;
  inicio: Date;
  fim: Date;
  equipe: { usuarioId: string; origem: string | null }[];
}

function casa(a: any, w: Record<string, any>): boolean {
  return Object.entries(w).every(([campo, cond]) => {
    switch (campo) {
      case 'AND':
        return (Array.isArray(cond) ? cond : [cond]).every((x) => casa(a, x));
      case 'OR':
        return (cond as any[]).some((x) => casa(a, x));
      case 'NOT':
        return !(Array.isArray(cond) ? cond : [cond]).every((x) => casa(a, x));
      case 'status':
        return cond.in ? cond.in.includes(a.status) : a.status === cond;
      case 'id':
        return cond.not !== undefined ? a.id !== cond.not : a.id === cond;
      case 'tipo':
        return cond.notIn ? !cond.notIn.includes(a.tipo) : a.tipo === cond;
      case 'inicio':
        return (!cond.lt || a.inicio < cond.lt) && (!cond.gt || a.inicio > cond.gt);
      case 'fim':
        return (!cond.lt || a.fim < cond.lt) && (!cond.gt || a.fim > cond.gt);
      case 'equipe':
        return (a.equipe as any[]).some((e) => casa(e, cond.some));
      case 'origem':
        if (cond === null) return a.origem === null;
        if (typeof cond === 'object' && 'not' in cond) return a.origem !== null && a.origem !== cond.not;
        return a.origem === cond;
      case 'responsavelId':
      case 'usuarioId':
      case 'origemAutomatica':
        return a[campo] === cond;
      default:
        throw new Error(`O avaliador do teste não conhece o campo "${campo}".`);
    }
  });
}

const hora = (h: string) => new Date(`2026-09-15T${h}:00-03:00`);
const base = {
  status: StatusCompromisso.PENDENTE,
  origemAutomatica: false,
  inicio: hora('09:00'),
  fim: hora('10:00'),
  equipe: [],
};

const AGENDA: Atividade[] = [
  { ...base, id: 'audiencia-do-u1', tipo: 'AUDIENCIA', responsavelId: 'u1' },
  { ...base, id: 'reserva-do-u2', tipo: 'REUNIAO', responsavelId: 'u9', equipe: [{ usuarioId: 'u2', origem: 'AUTOMATICA' }] },
  { ...base, id: 'u3-atua-junto', tipo: 'REUNIAO', responsavelId: 'u9', equipe: [{ usuarioId: 'u3', origem: null }] },
  { ...base, id: 'tarefa-do-robo-u1', tipo: 'PRAZO', origemAutomatica: true, responsavelId: 'u1' },
  { ...base, id: 'audiencia-do-robo-u1', tipo: 'AUDIENCIA', origemAutomatica: true, responsavelId: 'u1' },
  { ...base, id: 'encosta-u1', tipo: 'REUNIAO', responsavelId: 'u1', inicio: hora('10:30'), fim: hora('11:00') },
  { ...base, id: 'concluida-u1', tipo: 'REUNIAO', responsavelId: 'u1', status: StatusCompromisso.CONCLUIDO },
  { ...base, id: 'de-outra-pessoa', tipo: 'AUDIENCIA', responsavelId: 'u8' },
  { ...base, id: 'a-propria', tipo: 'AUDIENCIA', responsavelId: 'u1' },
];

function montar() {
  const findMany = jest.fn(async (_args: any) => []);
  const prisma = { compromisso: { findMany } };
  const servico = new AgendaService(prisma as never, {} as never, {} as never);
  return { servico, findMany };
}

describe('conflitos: quem o formulário escolheu, sem reserva e sem tarefa do robô', () => {
  it('só choca o que ocupa alguém de verdade', async () => {
    const { servico, findMany } = montar();
    await servico.conflitos({
      responsavelId: 'u1',
      pessoas: 'u2, u3,u1',
      inicio: hora('09:30').toISOString(),
      fim: hora('10:30').toISOString(),
      ignorarId: 'a-propria',
    });
    const where = findMany.mock.calls[0][0].where;
    const chocam = AGENDA.filter((a) => casa(a, where)).map((a) => a.id).sort();

    expect(chocam).toEqual(['audiencia-do-robo-u1', 'audiencia-do-u1', 'u3-atua-junto']);
  });

  it('o aviso diz de quem é o choque', async () => {
    const { servico, findMany } = montar();
    await servico.conflitos({ pessoas: 'u2', inicio: hora('09:00').toISOString(), fim: hora('10:00').toISOString() });
    expect(findMany.mock.calls[0][0].select.responsavel).toBeTruthy();
  });

  it('sem ninguém para conferir, nem consulta', async () => {
    const { servico, findMany } = montar();
    expect(await servico.conflitos({ pessoas: ' , ', inicio: hora('09:00').toISOString(), fim: hora('10:00').toISOString() })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('a rota aceita só `pessoas`, sem responsável', async () => {
    const conflitos = jest.fn(async () => []);
    const controller = new AgendaController({ conflitos } as never);
    await controller.conflitos(undefined as never, 'a', 'b', undefined, 'u2,u3');
    expect(conflitos).toHaveBeenCalledWith(expect.objectContaining({ pessoas: 'u2,u3' }));

    conflitos.mockClear();
    expect(await controller.conflitos(undefined as never, 'a', 'b')).toEqual([]);
    expect(conflitos).not.toHaveBeenCalled();
  });
});
