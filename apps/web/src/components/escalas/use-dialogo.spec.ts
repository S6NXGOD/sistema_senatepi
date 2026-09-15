import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { destinoDoTab, fechaComTecla } from './use-dialogo';

/*
  15/09/2026, auditoria das escalas, defeito 7: a folha da cópia e a da troca
  não fechavam com Escape. A regra da tecla é pura; a ligação nos dois diálogos
  é conferida no código (sem comentários nas linhas afirmadas).
*/

describe('fechaComTecla', () => {
  it('Escape fecha quando nada está sendo enviado', () => {
    expect(fechaComTecla({ key: 'Escape' }, false)).toBe(true);
  });

  it('com a cópia ou a troca em envio, Escape não fecha', () => {
    expect(fechaComTecla({ key: 'Escape' }, true)).toBe(false);
  });

  it('outras teclas não fecham, e Escape já tratado por outro também não', () => {
    expect(fechaComTecla({ key: 'Enter' }, false)).toBe(false);
    expect(fechaComTecla({ key: 'Esc' }, false)).toBe(false);
    expect(fechaComTecla({ key: 'Escape', defaultPrevented: true }, false)).toBe(false);
  });
});

/*
  15/09/2026, revisão da rodada 4: o foco ia para dentro ao abrir, mas depois de
  "Criar 3 plantões" o Tab seguia para os botões da página atrás do fundo escuro.
  Painel da cópia com 3 focáveis: [0] mês, [1] Cancelar, [2] Criar 3 plantões.
*/
describe('destinoDoTab: o Tab dá a volta dentro do diálogo', () => {
  it('Tab no último volta ao primeiro; Shift+Tab no primeiro vai ao último', () => {
    expect(destinoDoTab(3, 2, false)).toBe(0);
    expect(destinoDoTab(3, 0, true)).toBe(2);
  });

  it('no meio, o navegador segue a ordem normal', () => {
    expect(destinoDoTab(3, 0, false)).toBeNull();
    expect(destinoDoTab(3, 1, false)).toBeNull();
    expect(destinoDoTab(3, 1, true)).toBeNull();
    expect(destinoDoTab(3, 2, true)).toBeNull();
  });

  it('com o foco no painel (ou fora dele), o Tab entra pela ponta certa', () => {
    expect(destinoDoTab(3, -1, false)).toBe(0);
    expect(destinoDoTab(3, -1, true)).toBe(2);
  });

  it('um focável só: o Tab fica nele; nenhum: o foco fica no painel', () => {
    expect(destinoDoTab(1, 0, false)).toBe(0);
    expect(destinoDoTab(1, 0, true)).toBe(0);
    expect(destinoDoTab(0, -1, false)).toBe(-1);
  });
});

describe('os dois diálogos usam o hook', () => {
  const ler = (arquivo: string) => readFileSync(resolve(__dirname, arquivo), 'utf8');

  it('a cópia fecha com Escape e recebe o foco no painel', () => {
    const copia = ler('copiar-escala-modal.tsx');
    expect(copia).toContain('useDialogo({ painel: painelRef, ocupado: salvar.isPending, onFechar: onClose });');
    expect(copia).toContain('ref={painelRef}');
  });

  it('a troca põe o foco em quem assume', () => {
    const edicao = ler('editar-escala-modal.tsx');
    expect(edicao).toContain('focoInicial: trocar ? seletorRef : undefined');
    expect(edicao).toContain('selectRef={seletorRef}');
  });
});
