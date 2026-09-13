import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAVES_DEPOIS_DE_CONCLUIR,
  DIAS_PARA_PARADO,
  concluirNoResumo,
  linkDaAgenda,
  linkDosPrazosDaSemana,
  mensagemDeAniversario,
  seloDasAudienciasDaSemana,
  textoDoLinkDeRecadastro,
  textoDoRodapeDasAtividades,
  type CompromissoCard,
  type ResumoDashboard,
} from './dashboard';
import { lerUrlDaAgenda } from './agenda';

/** A agenda lê a URL por `lerUrlDaAgenda`; o link do painel precisa sobreviver a ela. */
function abrir(href: string, meuId = 'eu-mesma') {
  const [, query = ''] = href.split('?');
  return lerUrlDaAgenda(new URLSearchParams(query), meuId);
}

/**
 * O NÚMERO LEVA AO RECORTE QUE CONTOU (C11) — conferido do lado de quem chega.
 *
 * O teste não compara a forma da URL: passa cada link pelo leitor da agenda e
 * afirma o recorte que ela vai pedir ao servidor.
 */
describe('os links do painel abrem o mesmo recorte na agenda', () => {
  it('Atrasadas da carteira: dias anteriores, só da pessoa', () => {
    const e = abrir(linkDaAgenda({ aba: 'atrasadas', pessoa: 'eu' }));
    expect(e.aba).toBe('atrasadas');
    expect(e.pessoa).toBe('eu-mesma');
    expect(e.responsaveis).toBeUndefined();
  });

  it('Urgentes da carteira: em aberto, urgentes, da pessoa', () => {
    const e = abrir(linkDaAgenda({ aba: 'aberto', urgentes: true, pessoa: 'eu' }));
    expect(e).toMatchObject({ aba: 'aberto', urgentes: true, pessoa: 'eu-mesma' });
  });

  it('Minhas audiências: sete dias, só audiência, da pessoa', () => {
    const e = abrir(linkDaAgenda({ aba: '7dias', tipo: 'AUDIENCIA', pessoa: 'eu' }));
    expect(e).toMatchObject({ aba: '7dias', tipo: 'AUDIENCIA', pessoa: 'eu-mesma' });
  });

  it('Prazos esta semana: sete dias, só prazo, da casa', () => {
    const e = abrir(linkDaAgenda({ aba: '7dias', tipo: 'PRAZO' }));
    expect(e).toMatchObject({ aba: '7dias', tipo: 'PRAZO', urgentes: false });
    expect(e.pessoa).toBeUndefined();
  });

  /** A tira conta atrasadas + passaram da hora em que a pessoa RESPONDE — sem equipe nem reserva. */
  it('Esperando por: pede atenção, só onde a pessoa é a responsável', () => {
    const e = abrir(linkDaAgenda({ aba: 'atencao', responsavel: 'morgana', somenteResponsavel: true }));
    expect(e).toMatchObject({ aba: 'atencao', responsaveis: 'morgana', somenteResponsavel: true });
  });

  /** A carga conta pela régua `daPessoa`: responde ou foi posta por gente, reserva fora. */
  it('Carga da equipe: em aberto, pela régua da pessoa', () => {
    const e = abrir(linkDaAgenda({ aba: 'aberto', pessoa: 'carlos' }));
    expect(e).toMatchObject({ aba: 'aberto', pessoa: 'carlos', somenteResponsavel: false });
    expect(e.reservaDe).toBeUndefined();
  });

  it('somenteResponsavel sem responsável não vai na URL', () => {
    expect(linkDaAgenda({ aba: 'hoje', somenteResponsavel: true })).toBe('/agenda?aba=hoje');
  });

  it('reserva da própria pessoa', () => {
    const e = abrir(linkDaAgenda({ aba: 'aberto', reservaDe: 'eu' }));
    expect(e).toMatchObject({ aba: 'aberto', reservaDe: 'eu-mesma' });
  });

  /**
   * O CARTÃO "PRAZOS ESTA SEMANA" DO ADVOGADO — revisão de 13/09/2026.
   *
   * A API conta os prazos dele (`daPessoa`) e o link abria os da casa: o cartão
   * dizia 3 e a agenda mostrava 11.
   */
  it('Prazos esta semana no escopo pessoal: só os da pessoa', () => {
    const e = abrir(linkDosPrazosDaSemana('PESSOAL'));
    expect(e).toMatchObject({ aba: '7dias', tipo: 'PRAZO', pessoa: 'eu-mesma' });
  });

  it('Prazos esta semana na gestão: os da casa', () => {
    const e = abrir(linkDosPrazosDaSemana('GLOBAL'));
    expect(e).toMatchObject({ aba: '7dias', tipo: 'PRAZO' });
    expect(e.pessoa).toBeUndefined();
  });
});

describe('número só onde o destino conta o mesmo (13/09/2026)', () => {
  /** O selo usava o tamanho da lista (take 8, sem a que ficou para trás). */
  it('o selo das audiências é o total do recorte, ou nenhum número', () => {
    expect(seloDasAudienciasDaSemana({ audienciasSemanaTotal: 4 })).toBe(4);
    expect(seloDasAudienciasDaSemana({ audienciasSemanaTotal: 0 })).toBe(0);
    // Janela de troca do deploy: a API de antes não manda o total.
    expect(seloDasAudienciasDaSemana({})).toBeUndefined();
  });

  /** "Mais 6 da equipe na agenda" abria a aba 7 dias com 20. */
  it('o rodapé para a aba 7 dias não afirma número', () => {
    const gestao = textoDoRodapeDasAtividades({ ocultas: 6, atencaoOculta: 0, pessoal: false });
    const pessoal = textoDoRodapeDasAtividades({ ocultas: 6, atencaoOculta: 0, pessoal: true });
    expect(gestao).toBe('Ver a agenda da equipe nos próximos 7 dias');
    expect(pessoal).toBe('Ver os próximos 7 dias na agenda');
    // O "7" é o nome da aba; a quantidade das ocultas não aparece.
    expect(gestao).not.toContain('6');
    expect(pessoal).not.toContain('6');
  });

  it('o rodapé para "Pedem atenção" mantém a conta pelos totais', () => {
    expect(textoDoRodapeDasAtividades({ ocultas: 14, atencaoOculta: 3, pessoal: false })).toBe('Mais 14 da equipe na agenda');
    expect(textoDoRodapeDasAtividades({ ocultas: 2, atencaoOculta: 1, pessoal: true })).toBe('Mais 2 na agenda');
  });
});

describe('"Parados" usa o número da API', () => {
  it('o mesmo corte de dormência do servidor', () => {
    const tpu = readFileSync(
      join(__dirname, '../../../api/src/modules/processos/utils/tpu.util.ts'),
      'utf8',
    );
    const m = tpu.match(/export const DIAS_ATE_DORMENTE = (\d+);/);
    expect(m).not.toBeNull();
    expect(DIAS_PARA_PARADO).toBe(Number(m![1]));
  });
});

describe('o estado do link de recadastramento na linha', () => {
  // 13/09/2026 10:00 em Teresina.
  const agora = Date.parse('2026-09-13T13:00:00Z');

  it('link valendo hoje: a hora de Teresina', () => {
    expect(textoDoLinkDeRecadastro({ linkAtivoAte: '2026-09-13T18:20:00Z' }, agora)).toBe('link ativo até 15h20');
  });

  it('link que vale até amanhã: dia e hora', () => {
    expect(textoDoLinkDeRecadastro({ linkAtivoAte: '2026-09-14T12:05:00Z' }, agora)).toBe('link ativo até 14/09, 09h05');
  });

  /** 23h30 de Teresina já é o dia seguinte em UTC: o "hoje" é o de Teresina. */
  it('o dia é o de Teresina', () => {
    const noite = Date.parse('2026-09-14T01:00:00Z'); // 13/09 22h00 em Teresina
    expect(textoDoLinkDeRecadastro({ linkAtivoAte: '2026-09-14T02:30:00Z' }, noite)).toBe('link ativo até 23h30');
  });

  it('respondeu pelo link', () => {
    expect(textoDoLinkDeRecadastro({ respondeuPeloLinkEm: '2026-09-12T14:00:00Z' }, agora)).toBe(
      'respondeu pelo link em 12/09',
    );
  });

  it('link vencido não é dito; a resposta, se houve, é', () => {
    expect(textoDoLinkDeRecadastro({ linkAtivoAte: '2026-09-13T12:00:00Z' }, agora)).toBeNull();
    expect(
      textoDoLinkDeRecadastro({ linkAtivoAte: '2026-09-13T12:00:00Z', respondeuPeloLinkEm: '2026-09-10T15:00:00Z' }, agora),
    ).toBe('respondeu pelo link em 10/09');
  });

  it('nunca afirma envio: o sistema não sabe se a mensagem chegou', () => {
    for (const item of [
      { linkAtivoAte: '2026-09-13T18:20:00Z' },
      { respondeuPeloLinkEm: '2026-09-12T14:00:00Z' },
    ]) {
      expect(textoDoLinkDeRecadastro(item, agora)).not.toMatch(/enviad/i);
    }
  });

  it('API de antes (sem os campos): nada', () => {
    expect(textoDoLinkDeRecadastro({}, agora)).toBeNull();
  });
});

describe('a mensagem de aniversário', () => {
  it('sem emoji, com a sigla da instalação e o nome como gente escreve', () => {
    const msg = mensagemDeAniversario('MARIA DO SOCORRO', 'SIGLA');
    expect(msg).toBe('Olá, Maria! O SIGLA deseja a você um feliz aniversário.');
    expect(msg).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('sem nome, não inventa um', () => {
    expect(mensagemDeAniversario('', 'SIGLA')).toBe('Olá! O SIGLA deseja a você um feliz aniversário.');
  });
});

describe('a linha concluída sai da fila na hora', () => {
  const agora = Date.parse('2026-09-13T13:00:00Z'); // 10:00 em Teresina
  const card = (id: string, inicio: string, status: CompromissoCard['status'] = 'PENDENTE'): CompromissoCard => ({
    id, titulo: id, tipo: 'PRAZO', status, inicio, fim: inicio, local: null, urgente: false,
    urgenteMotivo: null, urgenteEm: null, iniciadoEm: null,
    responsavel: { id: 'r', nome: 'R' }, filiado: null, processo: null,
  });
  const resumo = {
    alertas: { atrasadas: 2, passaramDaHora: 1, semMovimentacao: 0, urgentes: 0, audienciasAAgendar: 0 },
    pendenciasAtivas: [card('ontem', '2026-09-12T12:00:00Z'), card('anteontem', '2026-09-11T12:00:00Z')],
    atividadesHoje: [card('cedo', '2026-09-13T11:00:00Z'), card('tarde', '2026-09-13T20:00:00Z')],
    proximasAtividades: [card('amanha', '2026-09-14T12:00:00Z')],
  } as unknown as ResumoDashboard;

  it('atrasada: some da lista e do contador', () => {
    const r = concluirNoResumo(resumo, 'ontem', agora);
    expect(r.pendenciasAtivas.map((c) => c.id)).toEqual(['anteontem']);
    expect(r.alertas.atrasadas).toBe(1);
    expect(r.alertas.passaramDaHora).toBe(1);
  });

  it('de hoje que passou da hora: vira registro do dia e sai do contador', () => {
    const r = concluirNoResumo(resumo, 'cedo', agora);
    expect(r.atividadesHoje.find((c) => c.id === 'cedo')?.status).toBe('CONCLUIDO');
    expect(r.alertas.passaramDaHora).toBe(0);
    expect(r.alertas.atrasadas).toBe(2);
  });

  it('dos próximos dias: some, sem mexer nos contadores', () => {
    const r = concluirNoResumo(resumo, 'amanha', agora);
    expect(r.proximasAtividades).toEqual([]);
    expect(r.alertas).toEqual(resumo.alertas);
  });

  it('não muta o resumo em cache (é a cópia de volta se a API recusar)', () => {
    concluirNoResumo(resumo, 'ontem', agora);
    expect(resumo.pendenciasAtivas).toHaveLength(2);
    expect(resumo.alertas.atrasadas).toBe(2);
  });

  it('id desconhecido ou já fechado: nada muda', () => {
    expect(concluirNoResumo(resumo, 'nao-existe', agora)).toBe(resumo);
  });

  it('as chaves invalidadas são as das consultas que existem', () => {
    expect(CHAVES_DEPOIS_DE_CONCLUIR).toContainEqual(['dashboard-resumo']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).toContainEqual(['compromissos']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).toContainEqual(['minhas-pendencias']);
    // 13/09/2026: a conclusão grava andamento e pode abrir caso — a lista de
    // Processos e a ficha aberta ficavam velhas até o cache vencer.
    expect(CHAVES_DEPOIS_DE_CONCLUIR).toContainEqual(['processos']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).toContainEqual(['processo-dossie']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).not.toContainEqual(['dashboard']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).not.toContainEqual(['agenda']);
  });
});
