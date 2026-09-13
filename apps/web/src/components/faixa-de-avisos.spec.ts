import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { PENDENCIA, fraseDaFaixa, rotulo, soConhecidas, type Pendencia } from '@/lib/pendencias';

const RAIZ = path.resolve(__dirname, '..');
const ler = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
const FAIXA = ler('components/faixa-de-atraso.tsx');
const TOPO = ler('components/topbar.tsx');
const LIB = ler('lib/pendencias.ts');
const API = (p: string) => readFileSync(path.resolve(RAIZ, '../../api/src/modules/agenda', p), 'utf8');
const SERVICO = API('pendencias.service.ts');
const EQUIPE_UTIL = API('equipe.util.ts');
const CONTROLLER = API('pendencias.controller.ts');

/**
 * "ESSE SINO REALMENTE É ALGO QUE VÃO FICAR OBSERVANDO? ACHO TÃO ISOLADO QUE ATÉ
 * EU MESMO IGNORO." — 12/09/2026.
 *
 * Não vão. Ele repetia o painel numa gaveta que precisava ser aberta, e quem mais
 * precisava do aviso nem entra no sistema. Saiu. O que não pode esperar continua
 * na faixa de toda tela; o dia continua no painel.
 */
describe('o sino saiu', () => {
  it('não existe mais, nem no topo', () => {
    expect(existsSync(path.join(RAIZ, 'components/sino-de-pendencias.tsx'))).toBe(false);
    expect(TOPO).not.toContain('SinoDePendencias');
  });

  /**
   * O nome não bastava: um `<Bell>` recolocado direto no topo, ou dentro de um
   * componente de outro nome, passava verde. A trava mira a LINHA DE IMPORT do
   * ícone — não o comentário "SEM SINO" do topbar — na Topbar, no menu do celular
   * que ela desenha e na casca. Querer de novo um ícone de aviso no topo é uma
   * decisão, e este teste pede que ela seja tomada às claras.
   */
  const IMPORTA_SINO = /import\s*\{[^}]*\bBell\w*\b[^}]*\}\s*from\s*['"]lucide-react['"]/;

  it('nem o ícone volta ao topo por outro caminho', () => {
    // A trava morde (uma regex errada passaria verde para sempre)…
    expect(`import { Moon, BellRing, Sun } from 'lucide-react';`).toMatch(IMPORTA_SINO);
    expect(`import {\r\n  Bell,\r\n  Moon,\r\n} from "lucide-react";`).toMatch(IMPORTA_SINO);
    // …e não morde o que é permitido.
    expect(`import { Moon, Sun } from 'lucide-react';`).not.toMatch(IMPORTA_SINO);
    for (const arquivo of ['components/topbar.tsx', 'components/mobile-nav.tsx', 'components/dashboard-shell.tsx']) {
      expect(ler(arquivo)).not.toMatch(IMPORTA_SINO);
    }
  });

  it('e a faixa só carrega o que não pode esperar', () => {
    expect(Object.keys(PENDENCIA).sort()).toEqual(['ATRASADA', 'PRECISA_DA_EQUIPE', 'PUBLICACAO_SEM_TAREFA']);
  });
});

describe('estado, nunca evento', () => {
  it('não existe tabela, marcação de leitura nem histórico', () => {
    for (const proibido of ['marcarComoLida', 'lidaEm', 'notificacao', 'Notificacao']) {
      expect(SERVICO).not.toContain(proibido);
      expect(FAIXA).not.toContain(proibido);
      expect(LIB).not.toContain(proibido);
    }
  });

  it('só olha o que está em aberto', () => {
    expect(SERVICO).toContain(
      'status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] }',
    );
  });

  it('a identidade vem do token, sem aceitar outra pessoa', () => {
    expect(CONTROLLER).toContain('minhas(@CurrentUser() user: AuthUser)');
    expect(CONTROLLER).toContain('this.pendencias.minhas(user.id)');
    expect(CONTROLLER).not.toContain('@Query');
  });
});

describe('a reserva só é avisada quando ninguém está cuidando', () => {
  it('o que é da pessoa deixa a reserva do robô de fora', () => {
    expect(SERVICO).toContain('const meu: Prisma.CompromissoWhereInput = { ...abertas, ...daPessoa(usuarioId) };');
    expect(EQUIPE_UTIL).toContain('{ equipe: { some: { usuarioId, ...NAO_E_RESERVA } } },');
    // O OR com nulo: `{ not: X }` sozinho descartaria as linhas antigas, de origem NULA.
    expect(EQUIPE_UTIL).toContain('OR: [{ origem: null }, { origem: { not: ORIGEM_RESERVA } }]');
    expect(EQUIPE_UTIL).toContain("export const ORIGEM_RESERVA = 'AUTOMATICA';");
  });

  it('a reserva entra por uma regra só: o responsável sumiu, ou o dia virou', () => {
    expect(SERVICO).toContain('...ondeSouReserva(usuarioId)');
    expect(SERVICO).toContain('motivoParaAvisarAEquipe(c, usos.get(c.responsavel.id), agora)');
    expect(EQUIPE_UTIL).toContain('export const DIAS_SEM_ENTRAR_PARA_AVISAR_A_EQUIPE = 7;');
  });
});

describe('a frase da faixa', () => {
  const grupo = (tipo: Pendencia['tipo'], total: number, exemplos: Pendencia['exemplos'] = []): Pendencia => ({
    tipo,
    total,
    exemplos,
  });
  const item = {
    id: 'c1',
    titulo: 'Elaborar manifestação',
    quando: '2026-09-14T12:00:00.000Z',
    href: '/agenda?compromisso=c1',
  };

  it('um item só leva ao próprio item, dizendo qual é', () => {
    expect(fraseDaFaixa(grupo('ATRASADA', 1, [item]))).toEqual({
      texto: '“Elaborar manifestação” ficou para trás',
      href: '/agenda?compromisso=c1',
    });
  });

  it('o item da equipe diz por que chegou até você', () => {
    const f = fraseDaFaixa(
      grupo('PRECISA_DA_EQUIPE', 1, [{ ...item, detalhe: 'Dr. Carlos Henrique está sem entrar há 39 dias' }]),
    );
    expect(f).toEqual({
      texto: '“Elaborar manifestação” precisa de alguém da equipe — Dr. Carlos Henrique está sem entrar há 39 dias',
      href: '/agenda?compromisso=c1',
    });
  });

  it('vários viram contagem e levam à lista', () => {
    expect(fraseDaFaixa(grupo('ATRASADA', 3, [item]))).toEqual({
      texto: '3 atividades suas ficaram para trás',
      href: '/agenda',
    });
    expect(rotulo(grupo('PRECISA_DA_EQUIPE', 2))).toBe('2 atividades da sua equipe estão sem ninguém cuidando');
  });

  it('não afirma perda de prazo processual', () => {
    for (const r of Object.values(PENDENCIA)) {
      expect(`${r.um} ${r.varios}`).not.toMatch(/prazo vencido|prazo perdido/i);
    }
  });
});

describe('a faixa', () => {
  /** Ela some quando o trabalho é feito — calar sem resolver não é opção. */
  it('não pode ser dispensada', () => {
    for (const proibido of ['dispensar', 'setFechada', 'onClose', 'localStorage']) {
      expect(FAIXA).not.toContain(proibido);
    }
  });

  it('usa a consulta de sempre e fica fora da área que rola', () => {
    expect(FAIXA).toContain("queryKey: ['minhas-pendencias']");
    const SHELL = ler('components/dashboard-shell.tsx');
    // `<main className=` e não `<main`: o comentário do arquivo cita "<main>".
    expect(SHELL.indexOf('<FaixaDeAtraso />')).toBeLessThan(SHELL.indexOf('<main className='));
  });
});

describe('a lista só leva tipos conhecidos', () => {
  /** Uma API de antes ainda manda grupos que a tela nova não desenha — e nada quebra. */
  it('descarta o tipo que a tela não conhece e o nome que só existe no protótipo', () => {
    const lista = [
      { tipo: 'ATRASADA', total: 1, exemplos: [] },
      { tipo: 'HOJE', total: 3, exemplos: [] },
      { tipo: 'toString', total: 1, exemplos: [] },
    ] as unknown as Pendencia[];
    expect(soConhecidas(lista).map((p) => p.tipo)).toEqual(['ATRASADA']);
  });
});
