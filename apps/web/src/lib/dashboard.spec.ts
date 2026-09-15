import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAVES_DEPOIS_DE_CONCLUIR,
  DIAS_PARA_PARADO,
  STATUS_COMP_COR,
  barraDoAtendimento,
  cartaoDosAtendimentos,
  AJUDA_DA_COPIA_SEM_TAREFA,
  explicacaoDaPublicacaoSemTarefa,
  kpiDoBalcao,
  kpiDosAtendimentos,
  type AtendimentoPendente,
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
import { filtroDaUrl } from './atendimentos';
import { MOTIVO_SEM_TAREFA } from './djen';

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
    // 15/09/2026: concluir ou desfazer a consulta fecha ou devolve o atendimento.
    expect(CHAVES_DEPOIS_DE_CONCLUIR).toContainEqual(['atendimentos']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).toContainEqual(['atendimento']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).not.toContainEqual(['dashboard']);
    expect(CHAVES_DEPOIS_DE_CONCLUIR).not.toContainEqual(['agenda']);
  });
});

describe('atividade cancelada no painel não é alarme', () => {
  it('sem vermelho, rosa ou riscado', () => {
    expect(STATUS_COMP_COR.CANCELADO).not.toMatch(/\b(red|rose)-|line-through/);
    for (const cor of Object.values(STATUS_COMP_COR)) expect(cor).not.toContain('line-through');
  });
});

/*
  O PAINEL PELA FILA DA TRIAGEM (E3, 15/09/2026). Em 14/09 o #13 e o #14
  somavam como "pendentes" com a triagem sem nada a fazer.
*/
describe('atendimentos no painel: o que pede a triagem', () => {
  const atendimento = (numero: number, fila: AtendimentoPendente['fila'], desfecho: AtendimentoPendente['desfecho'] = 'ENCAMINHADO'): AtendimentoPendente => ({
    id: `at${numero}`, numero, canal: 'PRESENCIAL', desfecho, createdAt: '2026-09-14T11:00:00.000Z',
    filiado: { id: `f${numero}`, nomeCompleto: `Filiada ${numero}` }, fila,
  });
  const kpis = (extra: Partial<ResumoDashboard['kpis']> = {}) => ({ atendimentosPendentes: 3, ...extra }) as ResumoDashboard['kpis'];

  it('o KPI conta a fila da triagem e abre a lista no mesmo recorte', () => {
    const k = kpiDosAtendimentos(kpis({ atendimentosComATriagem: 1, atendimentosAguardandoConsulta: 2 }));
    expect(k).toEqual({ label: 'Com a triagem', valor: 1, sub: 'pedem uma ação', href: '/atendimentos?status=PENDENTE&fila=TRIAGEM' });
    expect(filtroDaUrl(new URLSearchParams(k.href.split('?')[1]))).toMatchObject({ status: 'PENDENTE', fila: 'TRIAGEM' });
    // API de antes: o de sempre, sem inventar fila.
    expect(kpiDosAtendimentos(kpis())).toEqual({
      label: 'Atendimentos pendentes', valor: 3, sub: 'aguardando resolução', href: '/atendimentos?status=PENDENTE',
    });
  });

  it('o cartão lista a triagem e resume o que espera a consulta numa linha', () => {
    const r = {
      kpis: kpis({ atendimentosComATriagem: 1, atendimentosAguardandoConsulta: 2 }),
      atendimentosPendentes: [
        atendimento(12, { fila: 'TRIAGEM', motivo: 'SEM_DESFECHO' }, null),
        atendimento(13, { fila: 'CONSULTA', motivo: 'AGUARDANDO' }),
        atendimento(14, 'CONSULTA'),
      ],
    };
    const c = cartaoDosAtendimentos(r);
    expect(c.titulo).toBe('Com a triagem');
    expect(c.contagem).toBe(1);
    expect(c.itens.map((a) => a.numero)).toEqual([12]);
    expect(c.aguardandoConsulta).toBe(2);
    expect(filtroDaUrl(new URLSearchParams(c.hrefAguardando.split('?')[1]))).toMatchObject({ status: 'PENDENTE', fila: 'CONSULTA' });
    expect(c.vazio).toBe('Nenhum atendimento pedindo a triagem.');
    // Sem o KPI novo, a linha conta pela lista.
    expect(cartaoDosAtendimentos({ ...r, kpis: kpis({ atendimentosComATriagem: 1 }) }).aguardandoConsulta).toBe(2);
  });

  it('API de antes: a lista inteira, com o título de sempre', () => {
    const c = cartaoDosAtendimentos({ kpis: kpis(), atendimentosPendentes: [atendimento(13, undefined), atendimento(14, undefined)] });
    expect(c.titulo).toBe('Atendimentos pendentes');
    expect(c.itens).toHaveLength(2);
    expect(c.aguardandoConsulta).toBe(0);
  });

  it('a barra lateral é âmbar só na fila da triagem', () => {
    expect(barraDoAtendimento({ fila: { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' } })).toBe('bg-amber-400');
    expect(barraDoAtendimento({ fila: 'CONSULTA' })).toBe('bg-border');
    expect(barraDoAtendimento({})).toBe('bg-amber-400');
  });

  it('"Meu balcão" conta pela fila quando a API manda, e o link abre só os meus', () => {
    const k = kpiDoBalcao({ registradosHoje: 3, semDesfecho: 4, comATriagem: 1, filiadosHoje: 0 });
    expect(k).toEqual({ label: 'Comigo, com a triagem', valor: 1, sub: 'pedem uma ação', href: '/atendimentos?status=PENDENTE&fila=TRIAGEM&atendente=me' });
    // 15/09/2026: o número conta os da pessoa; a lista abria a fila da casa inteira (1 no número, 5 na lista).
    expect(filtroDaUrl(new URLSearchParams(k.href.split('?')[1]))).toMatchObject({ status: 'PENDENTE', fila: 'TRIAGEM', atendente: 'me' });
    expect(kpiDoBalcao({ registradosHoje: 3, semDesfecho: 4, filiadosHoje: 0 }))
      .toEqual({ label: 'Comigo, em aberto', valor: 4, sub: 'aguardando desfecho', href: '/atendimentos' });
  });
});

/*
  O MOTIVO DO ROBÔ NO PAINEL (auditoria DJEN, defeito 3). Todo motivo que não
  fosse NOTICIA_VELHA virava "a ordem é para a outra parte", e a cópia do mesmo
  ato oferecia "Criar tarefa" com a irmã já tendo tarefa.
*/
describe('publicação sem tarefa no painel', () => {
  it('a cópia do mesmo ato não oferece tarefa repetida, e abre a da irmã quando a API diz qual', () => {
    const comIrma = explicacaoDaPublicacaoSemTarefa({
      temTarefa: false,
      teor: { tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO', tarefaDoMesmoAto: { id: 'cmp-prazo-0915' } },
    });
    expect(comIrma).toEqual({ ajuda: MOTIVO_SEM_TAREFA.COPIA_DO_MESMO_ATO.ajuda, podeCriar: false, tarefaDoMesmoAtoId: 'cmp-prazo-0915' });
  });

  it('a cópia que segue uma proposta ainda aberta oferece "Criar tarefa" e não diz "já decidido" (15/09/2026)', () => {
    // A irmã é proposta na caixa, sem compromisso: a API manda tarefaDoMesmoAto nulo.
    const semIrma = explicacaoDaPublicacaoSemTarefa({ temTarefa: false, teor: { tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO', tarefaDoMesmoAto: null } });
    expect(semIrma).toEqual({ ajuda: AJUDA_DA_COPIA_SEM_TAREFA, podeCriar: true, tarefaDoMesmoAtoId: null });
    expect(semIrma.ajuda).not.toMatch(/já decidid|decisão sobre a primeira/);
    // API de antes, sem o campo: o mesmo.
    expect(explicacaoDaPublicacaoSemTarefa({ temTarefa: false, teor: { tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO' } }).podeCriar).toBe(true);
  });

  it('cada motivo com a sua explicação; fora da janela não diz "outra parte"', () => {
    const fora = explicacaoDaPublicacaoSemTarefa({ temTarefa: false, teor: { tarefaDispensadaMotivo: 'FORA_DA_JANELA' } });
    expect(fora.ajuda).toBe(MOTIVO_SEM_TAREFA.FORA_DA_JANELA.ajuda);
    expect(fora.ajuda).not.toMatch(/outra parte/);
    expect(fora.podeCriar).toBe(true);
    expect(explicacaoDaPublicacaoSemTarefa({ temTarefa: false, teor: { tarefaDispensadaMotivo: 'ORDEM_DA_OUTRA_PARTE' } }).ajuda)
      .toBe(MOTIVO_SEM_TAREFA.ORDEM_DA_OUTRA_PARTE.ajuda);
    expect(explicacaoDaPublicacaoSemTarefa({ temTarefa: false, teor: { tarefaDispensadaMotivo: 'MOTIVO_NOVO' } }))
      .toEqual({ ajuda: null, podeCriar: true, tarefaDoMesmoAtoId: null });
    expect(explicacaoDaPublicacaoSemTarefa({ temTarefa: false, teor: undefined }))
      .toEqual({ ajuda: null, podeCriar: true, tarefaDoMesmoAtoId: null });
  });

  it('com tarefa, nada a explicar nem a criar', () => {
    expect(explicacaoDaPublicacaoSemTarefa({ temTarefa: true, teor: { tarefaDispensadaMotivo: 'NOTICIA_VELHA' } }))
      .toEqual({ ajuda: null, podeCriar: false, tarefaDoMesmoAtoId: null });
  });
});
