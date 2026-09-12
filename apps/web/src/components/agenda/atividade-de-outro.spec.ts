import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const CONCLUIR = ler('components/agenda/concluir-modal.tsx');
const CANCELAR = ler('components/agenda/cancelar-modal.tsx');
const CARTAO = ler('components/agenda/compromisso-card.tsx');
const PAINEL = ler('app/(dashboard)/dashboard/page.tsx');
const LIB_DJEN = ler('lib/djen.ts');

/**
 * CONCLUIR A ATIVIDADE DE OUTRA PESSOA — sempre pôde, e agora avisa.
 *
 * O pedido foi "quero que qualquer perfil que possa editar agenda consiga
 * concluir a atividade de alguém, com um alerta de que não é dele". A primeira
 * metade já era verdade: nem a API nem a tela jamais barraram, e está certo —
 * quem cobriu a audiência é quem sabe o desfecho, e prender o registro ao dono
 * faria o trabalho ficar sem registro ou virar recado de corredor.
 *
 * O que faltava era DIZER. O desfecho entra no histórico com o nome de quem
 * fechou (`concluidoPor`), e quem clica merece saber disso ANTES.
 */
describe('a tela avisa quando a atividade não é sua', () => {
  it('o aviso nomeia o dono e diz que o seu nome vai junto', () => {
    expect(CONCLUIR).toContain('const ehDeOutro =');
    expect(CONCLUIR).toContain('compromisso.responsavel.id !== user.id');
    expect(CONCLUIR).toContain('Esta atividade é de');
    expect(CONCLUIR).toContain('seu nome');
    // Com rosto: numa lista de oito pessoas, a foto é reconhecida antes do texto.
    expect(CONCLUIR).toContain('<AvatarPessoa');
  });

  /** Cancelar é mais forte que concluir: tira trabalho do quadro de outro. */
  it('e vale igual no cancelamento', () => {
    expect(CANCELAR).toContain('const ehDeOutro =');
    expect(CANCELAR).toContain('Esta atividade é de');
    expect(CANCELAR).toContain('sair do quadro dessa pessoa');
  });

  /**
   * AVISA, NÃO BLOQUEIA. Confirmação extra aqui treinaria todo mundo a clicar
   * em "sim" sem ler — e a permissão de concluir é exatamente o que se quer.
   */
  it('o botão de concluir continua para todos que editam a agenda', () => {
    expect(CARTAO).toContain('onClick={() => onConcluir(c)}');
    // Nenhum gate por dono no cartão: quem vê a atividade pode fechá-la.
    expect(CARTAO).not.toContain('ehMinha(c');
  });
});

/**
 * A PRÉVIA DA TAREFA — "não tenho nem um preview de como ela vai ficar".
 *
 * Data, urgência e dono são decididos pelo sistema a partir da providência e da
 * idade do ato. Criar às cegas é pedir confiança agora e conferência depois.
 */
describe('criar tarefa mostra antes o que vai criar', () => {
  const LINHA = PAINEL.slice(PAINEL.indexOf('function LinhaPublicacao('));

  it('o botão abre a prévia em vez de criar direto', () => {
    expect(LINHA).toContain('onClick={() => setVendoPrevia(true)}');
    expect(LINHA).toContain('enabled: vendoPrevia');
    expect(LINHA).toContain('previaDaTarefa(pub.id)');
  });

  it('a prévia mostra quando, para quem e o porquê da urgência', () => {
    expect(LINHA).toContain('Vai entrar assim na agenda');
    expect(LINHA).toContain('formatDataHora(previa.inicio)');
    expect(LINHA).toContain('previa.responsavel');
    expect(LINHA).toContain('previa.urgenteMotivo');
  });

  /** Quem clica não vira dono — dizer isso evita procurar a tarefa e não achar. */
  it('avisa que a tarefa fica com o dono do caso', () => {
    expect(LINHA).toContain('A tarefa fica com o dono do caso, não com você');
  });

  /** Sem providência reconhecida, explica em vez de oferecer um botão que falha. */
  it('quando não há o que planejar, mostra o caminho da agenda', () => {
    expect(LINHA).toContain('não reconheceu uma providência neste ato');
    expect(LINHA).toContain('Ir para a agenda');
  });

  it('e só cria depois do "Criar assim"', () => {
    expect(LINHA).toContain('Criar assim');
    expect(LINHA).toContain('Agora não');
    expect(LINHA).toContain('setVendoPrevia(false)');
  });

  /**
   * A PRÉVIA VEM DO MESMO CÁLCULO DA CRIAÇÃO. Uma prévia que recalcula por
   * conta própria é uma segunda implementação da regra — e prévia que erra por
   * pouco é pior que nenhuma, porque promete.
   */
  it('o contrato diz que o cálculo é o mesmo da API', () => {
    expect(LIB_DJEN).toContain('export async function previaDaTarefa');
    expect(LIB_DJEN).toContain('/previa-da-tarefa');
    expect(LIB_DJEN).toContain('planejarAtividade');
  });
});
