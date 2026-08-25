import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  ATOS_CRITICOS,
  CODIGOS_IGNORADOS_DE_PROPOSITO,
  DIAS_ATE_DORMENTE,
  VALIDADE_DIAS,
  atoAcionavel,
  atoCritico,
  diasParado,
} from './tpu.util';

/** Uma data a `dias` dias atrás de `agora`. */
const diasAtras = (dias: number, agora: Date) =>
  new Date(agora.getTime() - dias * 86_400_000);

const AGORA = new Date('2026-08-25T12:00:00Z');

/** Movimentação mínima, solta (sem tarefa, sem dispensa). */
const mov = (codigo: number | null, dias: number, detalhe: string | null = null) => ({
  codigoMovimento: codigo,
  dataMovimento: diasAtras(dias, AGORA),
  detalhe,
  compromissoId: null,
  dispensadoEm: null,
});

/**
 * O AVISO DA LISTA VENCE.
 *
 * Estado da produção em 25/08/2026, que motivou tudo isto: 11 selos "Prazo sem
 * tarefa", NENHUM com menos de 15 dias, dez com mais de 30, o mais velho com
 * 252. O selo só mostrava o que a automação já decidira não fazer.
 */
describe('validade do ato', () => {
  it('publicação de ontem ainda pede providência', () => {
    expect(atoAcionavel(mov(92, 1), AGORA)?.nivel).toBe('PRAZO');
  });

  it('publicação no último dia da janela ainda conta', () => {
    expect(atoAcionavel(mov(92, 30), AGORA)?.nivel).toBe('PRAZO');
  });

  it('publicação de 31 dias já não conta', () => {
    expect(atoAcionavel(mov(92, 31), AGORA)).toBeNull();
  });

  /** O caso concreto: o selo mais velho da produção. */
  it('a publicação de 252 dias NÃO acende mais', () => {
    expect(atoAcionavel(mov(92, 252), AGORA)).toBeNull();
  });

  it('decisão vale mais que prazo — 90 dias', () => {
    expect(atoAcionavel(mov(221, 89), AGORA)?.nivel).toBe('DECISAO');
    expect(atoAcionavel(mov(221, 91), AGORA)).toBeNull();
  });

  it('encerramento nunca vira aviso, nem no mesmo dia', () => {
    for (const codigo of [22, 246, 848, 893, 196]) {
      expect(atoAcionavel(mov(codigo, 0), AGORA)).toBeNull();
    }
  });

  it('data no futuro (fuso/typo do tribunal) não invalida o ato', () => {
    expect(atoAcionavel(mov(92, -2), AGORA)?.nivel).toBe('PRAZO');
  });
});

/**
 * O MAIOR GERADOR DE SELO FALSO DO SISTEMA.
 *
 * 509 ocorrências na produção, ZERO tarefas em toda a vida do sistema — 45% de
 * todos os "atos críticos". O complemento explica: 397 "Outros documentos" e 90
 * "Certidão" contra 10 mandados. Certidão não abre prazo para ninguém.
 */
describe('código 60 depende do complemento', () => {
  it('"Outros documentos" não é prazo (397 casos na produção)', () => {
    expect(atoAcionavel(mov(60, 1, 'Outros documentos'), AGORA)).toBeNull();
  });

  it('"Certidão" não é prazo (90 casos na produção)', () => {
    expect(atoAcionavel(mov(60, 1, 'Certidão'), AGORA)).toBeNull();
  });

  it('sem complemento nenhum, cala — na dúvida não alarma', () => {
    expect(atoAcionavel(mov(60, 1, null), AGORA)).toBeNull();
    expect(atoAcionavel(mov(60, 1, ''), AGORA)).toBeNull();
  });

  it('"Mandado" e "Ofício" contam — alcançam alguém de verdade', () => {
    expect(atoAcionavel(mov(60, 1, 'Mandado'), AGORA)?.nivel).toBe('PRAZO');
    expect(atoAcionavel(mov(60, 1, 'Ofício'), AGORA)?.nivel).toBe('PRAZO');
  });

  it('"Aviso de recebimento (AR)" conta — é a citação voltando', () => {
    expect(atoAcionavel(mov(60, 1, 'Aviso de recebimento (AR)'), AGORA)?.nivel).toBe('PRAZO');
  });

  it('o complemento não afeta os OUTROS códigos', () => {
    // 92 vale por si; um complemento inócuo não pode derrubá-lo.
    expect(atoAcionavel(mov(92, 1, 'Outros documentos'), AGORA)?.nivel).toBe('PRAZO');
  });
});

/**
 * A FAMÍLIA DO JULGAMENTO ESTAVA PELA METADE.
 * Na produção: 6 processos com julgamento reconhecido (219) contra 21 com
 * julgamento invisível — e "Procedência em Parte" era o mais comum dos
 * invisíveis, com 13 ocorrências em 13 processos.
 */
describe('família do julgamento', () => {
  const FAMILIA = [219, 220, 221, 237, 238, 239, 235, 236, 242, 198, 200];

  it.each(FAMILIA)('o código %i é reconhecido como decisão', (codigo) => {
    expect(atoCritico(codigo)?.nivel).toBe('DECISAO');
  });

  it('"Procedência em parte" acende — era o campeão dos invisíveis', () => {
    expect(atoAcionavel(mov(221, 10), AGORA)).toEqual({
      nivel: 'DECISAO',
      rotulo: 'Procedência em parte',
    });
  });

  it('os rótulos fogem do juridiquês da TPU quando ele confunde', () => {
    // "Não-Provimento" é o nome oficial; ninguém de fora do foro lê isso rápido.
    expect(atoCritico(239)?.rotulo).toBe('Recurso negado');
  });
});

describe('antecipação de tutela', () => {
  it('é o único nível URGENTE — 17 processos na produção', () => {
    expect(atoAcionavel(mov(785, 3), AGORA)?.nivel).toBe('URGENTE');
    const urgentes = [...ATOS_CRITICOS.values()].filter((a) => a.nivel === 'URGENTE');
    expect(urgentes).toHaveLength(1);
  });

  it('também vence — tutela de dois meses atrás já produziu efeito', () => {
    expect(atoAcionavel(mov(785, 60), AGORA)).toBeNull();
  });
});

describe('o que já tem dono não é pendência', () => {
  it('ato que virou tarefa não alerta', () => {
    expect(atoAcionavel({ ...mov(92, 1), compromissoId: 'c1' }, AGORA)).toBeNull();
  });

  /**
   * A lista ignorava `dispensadoEm` e a ficha também. Quem dispensava o alerta
   * no radar via o mesmo aviso continuar na listagem — e não havia segunda
   * dispensa para dar.
   */
  it('ato dispensado por uma pessoa não volta', () => {
    expect(atoAcionavel({ ...mov(92, 1), dispensadoEm: AGORA }, AGORA)).toBeNull();
  });

  it('código fora do dicionário nunca alerta', () => {
    expect(atoAcionavel(mov(85, 1), AGORA)).toBeNull(); // Petição — 466 na produção
    expect(atoAcionavel(mov(null, 1), AGORA)).toBeNull();
  });
});

describe('códigos ignorados de propósito', () => {
  it('nenhum deles está no dicionário — a lista e a tabela não podem discordar', () => {
    for (const codigo of CODIGOS_IGNORADOS_DE_PROPOSITO) {
      expect(ATOS_CRITICOS.has(codigo)).toBe(false);
    }
  });
});

/**
 * O QUE SUBSTITUIU OS DEZ AVISOS QUE SUMIRAM.
 * Eles estavam mal rotulados, não eram mentira — e apagar sem repor perderia
 * informação verdadeira.
 */
describe('dormência', () => {
  it('processo que andou este mês não está parado', () => {
    expect(diasParado(diasAtras(20, AGORA), AGORA)).toBeNull();
  });

  it('89 dias ainda é tramitação normal', () => {
    expect(diasParado(diasAtras(89, AGORA), AGORA)).toBeNull();
  });

  it('90 dias já é inércia', () => {
    expect(diasParado(diasAtras(90, AGORA), AGORA)).toBe(90);
  });

  it('sem movimento nenhum não afirma inércia — não há de onde contar', () => {
    expect(diasParado(null, AGORA)).toBeNull();
    expect(diasParado(undefined, AGORA)).toBeNull();
  });
});

/**
 * A INVARIANTE QUE IMPEDE O DEFEITO DE VOLTAR.
 *
 * O selo mentia porque a automação tinha janela de 30 dias e o selo não tinha
 * nenhuma. Agora os dois números são o mesmo — e enquanto forem, "ato dentro da
 * janela sem tarefa" significa exatamente uma coisa: o robô falhou. É esse o
 * fato que o selo deve denunciar, e nenhum outro.
 *
 * O teste lê o CÓDIGO da automação de propósito. Duplicar a constante num
 * import faria os dois lados mudarem juntos sem ninguém perceber que o
 * significado do selo mudou junto.
 */
describe('selo e robô na mesma janela', () => {
  const SERVICE = readFileSync(
    path.join(__dirname, '..', 'processos.service.ts'),
    'utf8',
  );

  it('a janela da automação de prazos é de 30 dias', () => {
    const trecho = SERVICE.slice(
      SERVICE.indexOf('private async dispararAutomacao'),
      SERVICE.indexOf('await this.automacao.processar'),
    );
    expect(trecho.length).toBeGreaterThan(100); // o teste não olha para o vazio
    const janela = trecho.match(/const desde = new Date\(Date\.now\(\) - (\d+) \* 24/);
    expect(janela).not.toBeNull();
    expect(Number(janela![1])).toBe(VALIDADE_DIAS.PRAZO);
  });

  it('decisão dura mais que prazo, e prazo mais que encerramento', () => {
    expect(VALIDADE_DIAS.DECISAO).toBeGreaterThan(VALIDADE_DIAS.PRAZO);
    expect(VALIDADE_DIAS.ENCERRAMENTO).toBe(0);
  });

  it('a dormência começa DEPOIS de a decisão vencer', () => {
    // Senão um processo receberia "parado" e "decisão a analisar" ao mesmo
    // tempo, e a lista teria de escolher entre dois avisos verdadeiros.
    expect(DIAS_ATE_DORMENTE).toBeGreaterThanOrEqual(VALIDADE_DIAS.DECISAO);
  });
});
