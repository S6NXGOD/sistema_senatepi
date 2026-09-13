import { ehFimDeSemanaBR } from '../processos/utils/data-br.util';
import {
  DESFECHOS_PADRAO,
  DESFECHOS_POR_TIPO,
  desfechosComSugestao,
  desfechosDoTipo,
  type DesfechoOpcao,
} from './desfechos.catalogo';

/**
 * O BOTÃO DE UM TOQUE DO PAINEL — a REGRA, julgada contra o catálogo real.
 *
 * A versão anterior deste teste conferia uma tabela escrita à mão no front
 * (`DESFECHO_RAPIDO`) contra o catálogo: slug e `exigeObs`. Ficou verde com
 * três defeitos no ar (auditoria de 12/09/2026): a reunião só oferecia "Com
 * encaminhamentos", que cria tarefa obrigatória calada; o PRAZO de análise do
 * robô fechava como "Peça protocolada"; e um dos testes lia `exigeProcesso`,
 * campo que não existe no catálogo — passava para qualquer entrada.
 *
 * Desde a D1 o painel lê o catálogo da API e decide o botão por uma regra só:
 * o primário é a PRIMEIRA opção do tipo, e só se ela não tiver `acao` nem
 * `alerta`. Como a regra depende da ORDEM do catálogo, quem reordenar muda o
 * painel — e é isso que este teste torna visível: a tabela ESPERADO abaixo é a
 * decisão de produto, e o catálogo tem de produzi-la.
 */
function primarioDoPainel(opcoes: Pick<DesfechoOpcao, 'slug' | 'acao' | 'alerta'>[]): string | null {
  const primeira = opcoes[0];
  return primeira && !primeira.acao && !primeira.alerta ? primeira.slug : null;
}

/** null = "Concluir ▾" abre a folha com todas as opções (D1). */
const ESPERADO: Record<string, string | null> = {
  AUDIENCIA: null,
  PRAZO: 'PRAZO_CUMPRIDO',
  CONSULTA_JURIDICA: 'DUVIDA_ESCLARECIDA',
  REUNIAO: null,
  DILIGENCIA: 'DILIGENCIA_CUMPRIDA',
  DESPACHO: 'DESPACHO_OBTIDO',
  PERICIA: null,
  CONTATO: 'CONTATO_CONFIRMADO',
  ACOMPANHAMENTO: 'ACOMPANHAMENTO_CUMPRIDO',
  COMPROMISSO: 'CONCLUIDA',
};

const TIPOS = Object.keys(DESFECHOS_POR_TIPO);

describe('o primário do painel sai do catálogo', () => {
  it('todo tipo do catálogo tem o botão decidido aqui (tipo novo obriga a decidir)', () => {
    expect([...TIPOS].sort()).toEqual(Object.keys(ESPERADO).sort());
  });

  it.each(Object.entries(ESPERADO))('%s → %s', (tipo, esperado) => {
    expect(primarioDoPainel(desfechosDoTipo(tipo))).toBe(esperado);
  });

  it('tipo personalizado cai no padrão, e o padrão fecha com "Concluída"', () => {
    expect(desfechosDoTipo('VISITA_A_BASE')).toBe(DESFECHOS_PADRAO);
    expect(primarioDoPainel(desfechosDoTipo('VISITA_A_BASE'))).toBe('CONCLUIDA');
  });
});

describe('um toque nunca produz efeito que a pessoa não viu', () => {
  it.each(TIPOS)('%s: o primário não cria seguimento, não mexe em processo e não é alerta', (tipo) => {
    const slug = primarioDoPainel(desfechosDoTipo(tipo));
    if (!slug) return;
    const opcao = desfechosDoTipo(tipo).find((d) => d.slug === slug)!;
    expect(opcao.acao).toBeUndefined();
    expect(opcao.alerta).toBeFalsy();
    expect(opcao.seguimento).toBeUndefined();
  });

  /** "Com encaminhamentos" criava tarefa obrigatória em 7 dias e a tela dizia só "Concluída.". */
  it('os tipos cuja primeira opção cria seguimento ficam sem primário — e são exatamente estes', () => {
    const comSeguimentoNaFrente = TIPOS.filter((t) => desfechosDoTipo(t)[0].acao === 'CRIAR_ATIVIDADE');
    for (const t of comSeguimentoNaFrente) expect(primarioDoPainel(desfechosDoTipo(t))).toBeNull();
    expect(comSeguimentoNaFrente.sort()).toEqual(['AUDIENCIA', 'PERICIA', 'REUNIAO']);
  });

  it.each([...TIPOS, 'VISITA_A_BASE'])('%s: a folha sempre tem uma saída sem efeito colateral', (tipo) => {
    expect(desfechosDoTipo(tipo).some((d) => !d.acao && !d.alerta)).toBe(true);
  });
});

describe('PRAZO tem a resposta honesta para "analisei e não cabe peça" (D3)', () => {
  const opcoes = desfechosDoTipo('PRAZO');
  const semPeca = opcoes.find((d) => d.slug === 'PRAZO_SEM_PECA');

  it('existe, pede o porquê, e não tem alerta nem seguimento', () => {
    expect(semPeca).toEqual({
      slug: 'PRAZO_SEM_PECA',
      label: 'Analisado — nada a protocolar',
      ajuda: expect.any(String),
      exigeObs: true,
    });
  });

  it('não é a primeira: o um-toque continua sendo "Peça protocolada"', () => {
    expect(opcoes[0].slug).toBe('PRAZO_CUMPRIDO');
    expect(opcoes.indexOf(semPeca!)).toBeGreaterThan(0);
  });
});

describe('o GET desfechos/:tipo serve o mesmo catálogo, com a data do seguimento', () => {
  const sextaNoite = new Date('2026-09-18T23:00:00Z'); // sexta, 20h em Teresina

  it.each([...TIPOS, 'VISITA_A_BASE'])('%s: mesma ordem, mesmo primário', (tipo) => {
    const servido = desfechosComSugestao(tipo, sextaNoite);
    expect(servido.map((d) => d.slug)).toEqual(desfechosDoTipo(tipo).map((d) => d.slug));
    expect(primarioDoPainel(servido)).toBe(primarioDoPainel(desfechosDoTipo(tipo)));
  });

  it('sugeridoPara só onde há seguimento, sempre às 9h de Teresina e nunca no fim de semana', () => {
    for (const tipo of TIPOS) {
      for (const d of desfechosComSugestao(tipo, sextaNoite)) {
        if (!d.seguimento) continue;
        const quando = new Date(d.seguimento.sugeridoPara);
        expect(quando.toISOString()).toMatch(/T12:00:00\.000Z$/);
        expect(ehFimDeSemanaBR(quando)).toBe(false);
        expect(quando > sextaNoite).toBe(true);
      }
    }
  });

  it('a sugestão não suja o catálogo compartilhado', () => {
    desfechosComSugestao('CONTATO', sextaNoite);
    const comSeguimento = DESFECHOS_POR_TIPO.CONTATO.filter((d) => d.seguimento);
    expect(comSeguimento.length).toBeGreaterThan(0);
    for (const d of comSeguimento) expect(d.seguimento).not.toHaveProperty('sugeridoPara');
  });
});
