import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  CATEGORIAS_CANCELAMENTO,
  CATEGORIA_CANCELAMENTO_LABEL,
  categoriaCancelamentoValida,
  desfechosDoTipo,
} from './desfechos.catalogo';

const ler = (arquivo: string) => readFileSync(path.join(__dirname, arquivo), 'utf8');
const SERVICE = ler('agenda.service.ts');
const CONTROLLER = ler('agenda.controller.ts');

/**
 * CANCELAR UMA TAREFA DO ROBÔ NÃO PODE DEIXAR A MOVIMENTAÇÃO EM LIMBO.
 *
 * O robô carimba `movimentacao.compromissoId` ao criar a tarefa — é a trava de
 * idempotência dele e, ao mesmo tempo, o que tira o selo "Prazo sem tarefa" da
 * lista e faz o radar parar de cobrar. EXCLUIR a tarefa limpa o carimbo sozinho
 * (a FK é `SetNull`); CANCELAR não limpava nada, e a movimentação ficava presa
 * a uma tarefa cancelada: sem tarefa viva, sem selo e sem voltar ao radar.
 *
 * O ato sumia — e do pior jeito, o que não deixa sintoma.
 */
describe('cancelar não engole a movimentação', () => {
  const helper = SERVICE.slice(
    SERVICE.indexOf('private async dispensarMovimentacaoLigada'),
    SERVICE.indexOf('/** Recarrega o cartão'),
  );

  it('o helper existe (o teste não olha para o vazio)', () => {
    expect(helper.length).toBeGreaterThan(300);
  });

  it('dispensa em vez de só limpar o carimbo', () => {
    // Limpar faria o selo voltar amanhã e o robô recriar a tarefa — um laço em
    // que cancelar não cancela nada. Dispensar registra a decisão humana.
    expect(helper).toContain('dispensadoEm: new Date()');
    expect(helper).toContain('dispensadoPor');
    expect(helper).toContain('dispensadoMotivo');
  });

  it('não redispensa o que já estava dispensado', () => {
    // Sem isto, cancelar sobrescreveria o motivo e o autor de uma dispensa
    // anterior feita no radar — apagando quem realmente decidiu.
    expect(helper).toContain('dispensadoEm: null');
  });

  it.each([
    ['cancelar (pessoa)', 'async cancelar(', 'async cancelarPorSistema('],
    ['cancelarPorSistema (tribunal)', 'async cancelarPorSistema(', 'async remarcar('],
  ])('%s chama o helper na mesma transação', (_nome, de, ate) => {
    const trecho = SERVICE.slice(SERVICE.indexOf(de), SERVICE.indexOf(ate));
    expect(trecho.length).toBeGreaterThan(400);
    expect(trecho).toContain('dispensarMovimentacaoLigada');
    // Na MESMA transação: cancelar sem dispensar deixa o ato invisível;
    // dispensar sem cancelar tira o alerta de algo com tarefa viva.
    expect(trecho).toContain('$transaction');
  });
});

/**
 * CONCLUIR DUAS VEZES NÃO CRIA DOIS SEGUIMENTOS.
 *
 * Produção, 27/08/2026: o Dr. Murilo tinha DOIS "Encaminhamento da reunião"
 * idênticos, ambos 12:00–13:00 do dia 03/09, criados com dezesseis minutos de
 * diferença e com textos que descreviam o mesmo evento de duas formas. Alguém
 * concluiu, reabriu para corrigir o desfecho e concluiu de novo.
 */
describe('seguimento do desfecho não duplica', () => {
  const concluir = SERVICE.slice(
    SERVICE.indexOf('async concluir('),
    SERVICE.indexOf('async cancelar('),
  );

  it('o trecho existe', () => {
    expect(concluir.length).toBeGreaterThan(1000);
  });

  it('o seguimento nasce ligado à origem', () => {
    expect(concluir).toMatch(/origemDesfechoId: id/);
  });

  it('a providência anterior é procurada pelo vínculo, não por semelhança', () => {
    // Casar título + tipo + dia erra nos dois sentidos: perde o seguimento cujo
    // título mudou junto com o desfecho e agarra tarefa legítima parecida.
    expect(concluir).toMatch(/origemDesfechoId: id,\s*\n\s*status: \{ in: \[StatusCompromisso\.PENDENTE/);
  });

  it('a anterior é CANCELADA, não apagada — o histórico continua contando', () => {
    expect(concluir).toContain("canceladoCategoria: 'SUBSTITUIDA'");
    expect(concluir).toContain('compromissoHistorico.create');
    expect(concluir).not.toMatch(/compromisso\.delete/);
  });

  /**
   * A substituição roda ANTES do `return` de "não há seguimento a criar":
   * mudar de "com encaminhamentos" para "sem deliberação" tem de DERRUBAR a
   * providência antiga, não deixá-la órfã de um desfecho que não existe mais.
   */
  it('substitui mesmo quando o novo desfecho não gera seguimento', () => {
    const iSubstitui = concluir.indexOf('SUBSTITUIDA');
    const iReturn = concluir.indexOf('if (!criarSeguimento) return');
    expect(iSubstitui).toBeGreaterThan(0);
    expect(iReturn).toBeGreaterThan(0);
    expect(iSubstitui).toBeLessThan(iReturn);
  });
});

/**
 * CHOQUE DE HORÁRIO.
 *
 * Produção, 27/08/2026: a Dra. Margareth tinha TRÊS consultas encadeadas em
 * 31/08 — 12:00–13:00, 12:40–13:40 e 13:20–14:20. Atendimentos de uma hora
 * marcados de quarenta em quarenta minutos, e nada avisou. Um advogado não se
 * divide em dois; numa audiência a consequência é revelia.
 */
describe('conflito de agenda', () => {
  const conflitos = SERVICE.slice(
    SERVICE.indexOf('async conflitos('),
    SERVICE.indexOf('async listar('),
  );

  it('o método existe', () => {
    expect(conflitos.length).toBeGreaterThan(600);
  });

  /**
   * A regra canônica de sobreposição: `a.inicio < b.fim` E `b.inicio < a.fim`.
   * ENCOSTAR NÃO É CRUZAR — 12:00–13:00 e 13:00–14:00 convivem, e tratá-las
   * como choque encheria de aviso falso a agenda de quem trabalha em blocos.
   */
  it('usa a regra canônica, e encostar não conta', () => {
    expect(conflitos).toMatch(/inicio: \{ lt: fim \}/);
    expect(conflitos).toMatch(/fim: \{ gt: inicio \}/);
    expect(conflitos).not.toMatch(/lte: fim|gte: inicio/);
  });

  it('olha a EQUIPE, não só o responsável', () => {
    // O segundo advogado de uma audiência também tem o horário ocupado —
    // conferir só `responsavelId` repete o defeito que já escondeu audiência do
    // painel de quem acompanhava sem responder.
    expect(conflitos).toMatch(/equipe: \{ some: \{ usuarioId: params\.responsavelId \} \}/);
  });

  it('ignora concluída e cancelada — não ocupam ninguém', () => {
    expect(conflitos).toMatch(/status: \{ in: \[StatusCompromisso\.PENDENTE, StatusCompromisso\.EM_ANDAMENTO\] \}/);
  });

  it('na edição, a própria atividade não choca consigo mesma', () => {
    expect(conflitos).toMatch(/ignorarId.*id: \{ not: params\.ignorarId \}/s);
  });

  it('é LEITURA — avisa, não bloqueia', () => {
    expect(conflitos).not.toMatch(/\.update\(|\.create\(|\.delete\(/);
    expect(conflitos).not.toMatch(/throw new (Conflict|Forbidden)/);
  });

  /** Sem isto o Nest casaria "conflitos" como um id e devolveria 404. */
  it('a rota vem antes de `:id` no controller', () => {
    /*
     * Casa o DECORADOR no início da linha, e não a string solta: o comentário
     * que documenta esta ordem cita `@Get(':id')` no texto, e um `indexOf` cru
     * acharia a menção antes da rota — reprovando o arquivo correto.
     */
    const posicao = (re: RegExp) => CONTROLLER.search(re);
    const iConflitos = posicao(/^\s*@Get\('conflitos'\)/m);
    const iPorId = posicao(/^\s*@Get\(':id'\)/m);
    expect(iConflitos).toBeGreaterThan(0);
    expect(iPorId).toBeGreaterThan(0);
    expect(iConflitos).toBeLessThan(iPorId);
  });
});

/**
 * A categoria `SUBSTITUIDA` precisa de RÓTULO (a tela lê o catálogo para exibir
 * qualquer cartão cancelado) mas não pode ser OFERECIDA: ninguém cancela algo
 * "porque foi substituída" — isso é consequência de outra ação.
 */
describe('categorias de cancelamento', () => {
  it('SUBSTITUIDA existe e tem rótulo', () => {
    expect(CATEGORIA_CANCELAMENTO_LABEL.SUBSTITUIDA).toBeTruthy();
  });

  it('SUBSTITUIDA é apenas do sistema', () => {
    const c = CATEGORIAS_CANCELAMENTO.find((x) => x.slug === 'SUBSTITUIDA');
    expect(c?.apenasSistema).toBe(true);
  });

  it('o formulário não oferece categorias de sistema', () => {
    const rota = CONTROLLER.slice(
      CONTROLLER.indexOf("@Get('categorias-cancelamento')"),
      CONTROLLER.indexOf("@Get('conflitos')"),
    );
    expect(rota).toContain('!c.apenasSistema');
  });

  it('as categorias que a pessoa escolhe continuam válidas', () => {
    for (const c of CATEGORIAS_CANCELAMENTO.filter((x) => !x.apenasSistema)) {
      expect(categoriaCancelamentoValida(c.slug)).toBe(true);
    }
  });
});

/**
 * O desfecho mais grave do catálogo não pode terminar em nada além de um texto:
 * prazo perdido exige providência (preliminar, justificativa, ciência ao
 * filiado) e por isso gera seguimento OBRIGATÓRIO.
 */
describe('desfechos que exigem providência', () => {
  it('prazo perdido gera seguimento obrigatório e urgente', () => {
    const perdido = desfechosDoTipo('PRAZO').find((d) => d.slug === 'PRAZO_PERDIDO');
    expect(perdido?.alerta).toBe(true);
    expect(perdido?.exigeObs).toBe(true);
    expect(perdido?.acao).toBe('CRIAR_ATIVIDADE');
    expect(perdido?.seguimento?.obrigatorio).toBe(true);
  });

  it('todo desfecho com CRIAR_ATIVIDADE traz a especificação do seguimento', () => {
    for (const tipo of ['PRAZO', 'AUDIENCIA', 'REUNIAO', 'DILIGENCIA', 'DESPACHO']) {
      for (const d of desfechosDoTipo(tipo)) {
        if (d.acao === 'CRIAR_ATIVIDADE') {
          expect(d.seguimento).toBeTruthy();
          expect(d.seguimento?.titulo).toBeTruthy();
          expect(typeof d.seguimento?.emDias).toBe('number');
        }
      }
    }
  });
});
