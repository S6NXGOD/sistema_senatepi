import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RECADASTRO NA FICHA E NO ENVIO: travas estruturais.
 *
 * O texto e as decisões (mensagem, e-mail, desafio, de-para) têm teste com
 * valores em lib/envio-recadastro.spec.ts e lib/recadastro.spec.ts. Aqui
 * ficam só as decisões de montagem que não cabem numa função pura, e todas
 * miram código (nunca comentário).
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

const FICHA = ler('app/(dashboard)/filiados/[id]/page.tsx');
const ENVIO = ler('components/filiados/enviar-link-recadastro.tsx');
const MODAL = ler('components/filiados/recadastrar-modal.tsx');
const ATUALIZACAO = ler('components/atendimentos/atualizacao-cadastral-modal.tsx');

describe('ficha do filiado', () => {
  /** O advogado só visualiza filiado: Recadastrar e Editar levariam 403 no fim. */
  it('Recadastrar e Editar só para quem edita filiado', () => {
    expect(FICHA).toContain("const podeEditarFiliado = podeEditar(user?.role, user?.permissoes, 'filiados');");
    const gate = FICHA.indexOf('{podeEditarFiliado && (');
    expect(gate).toBeGreaterThan(-1);
    expect(FICHA.indexOf('setRecadastrarAberto(true)')).toBeGreaterThan(gate);
  });

  /** O recadastramento pelo link nascia PENDENTE e nenhuma tela o mostrava. */
  it('mostra o bloco de conferência, e só quem edita marca como conferido', () => {
    expect(FICHA).toContain('<ConferirRecadastramento filiadoId={f.id} podeConferir={podeEditarFiliado} />');
  });

  /** Erro que vira girador eterno esconde o problema. */
  it('erro de leitura aparece e deixa tentar de novo', () => {
    expect(FICHA).toContain('if (isError || !f) {');
    expect(FICHA).toContain('onClick={() => refetch()}');
  });
});

describe('envio do link', () => {
  /**
   * Janela aberta depois de um await não é mais "do clique": o bloqueador de
   * pop-up a barra. A aba sai no gesto; a rota de envio vem depois.
   */
  it('abre a aba do WhatsApp antes de chamar a rota', () => {
    const corpo = ENVIO.slice(ENVIO.indexOf('async function porWhatsApp()'));
    const abre = corpo.indexOf("window.open('', '_blank')");
    const chama = corpo.indexOf("await preparar('WHATSAPP')");
    expect(abre).toBeGreaterThan(-1);
    expect(chama).toBeGreaterThan(abre);
  });

  /** Cada botão passa pela rota (auditoria e reaproveitamento), nunca gera direto. */
  it('os botões usam a rota de envio, e não a de gerar', () => {
    expect(ENVIO).toContain('prepararEnvioRecadastro(filiadoId, meio)');
    expect(ENVIO).not.toContain('gerarLinkRecadastramento');
  });

  it('o recadastramento abre o envio sem mudar as props de quem já o usa', () => {
    expect(MODAL).toContain('semNavegar?: boolean;');
    expect(MODAL).toContain('onRecadastrarPresencial?: (filiadoId: string) => void;');
    expect(MODAL).toContain('<EnviarLinkRecadastro key=');
  });

  /**
   * 14/09/2026: a tela deixou de recalcular o desafio. 15/09/2026: a chave e a
   * função moram numa consulta só (`consultaDaPreviaDoLink`), testada com um
   * QueryClient de verdade em lib/previa-do-link.spec.ts. Aqui só se confere
   * que os dois lugares usam ELA, e não uma cópia montada à mão.
   */
  it('o envio e o modal usam a mesma consulta da prévia', () => {
    expect(ENVIO).toContain('useQuery(consultaDaPreviaDoLink(filiadoId))');
    expect(MODAL).toContain('...consultaDaPreviaDoLink(filiadoId),');
    expect(ENVIO).not.toContain("'previa-do-link'");
    expect(MODAL).not.toContain("'previa-do-link'");
  });

  /** A API recusa o link sem confirmação: nenhum botão que voltaria 400. */
  it('sem como confirmar, os botões de envio e o "Gerar outro" somem', () => {
    const caixa = ENVIO.indexOf("aviso.tipo === 'SEM_CONFIRMACAO' ? (");
    const grade = ENVIO.indexOf('<div className="grid animate-surgir grid-cols-2 gap-2">');
    expect(caixa).toBeGreaterThan(-1);
    expect(grade).toBeGreaterThan(caixa);
    expect(MODAL).toContain('{ativo && !link && !semConfirmacao && (');
  });

  /** 15/09/2026: enquanto a prévia carrega, esqueleto no lugar dos botões ativos. */
  it('a grade de botões só aparece depois do esqueleto da carga', () => {
    const esqueleto = ENVIO.indexOf(') : carregando ? (');
    const grade = ENVIO.indexOf('<div className="grid animate-surgir grid-cols-2 gap-2">');
    expect(esqueleto).toBeGreaterThan(-1);
    expect(grade).toBeGreaterThan(esqueleto);
  });

  /** Desfiliado (14/09/2026): gravar dado na ficha não reativa; o botão some. */
  it('o botão da caixa só aparece com porta, e diz qual', () => {
    expect(ENVIO).toContain('{onCompletarFicha && porta && (');
    expect(ENVIO).toContain('onClick={() => onCompletarFicha(porta)}');
    expect(ENVIO).toContain('{rotuloDaPorta(porta)}');
  });

  it('o modal escolhe a porta, e o presencial continua sem navegar dentro de outro modal', () => {
    expect(MODAL).toContain('onCompletarFicha={completarFicha}');
    expect(MODAL).toContain("if (porta === 'RECADASTRAR') { abrirPresencial(); return; }");
    expect(MODAL).toContain('onClick={abrirPresencial}');
  });

  it('a atualização cadastral do atendimento oferece o link a quem edita filiado, e a caixa tem botão', () => {
    expect(ATUALIZACAO).toContain("podeEditar(user?.role, user?.permissoes, 'filiados')");
    expect(ATUALIZACAO).toContain('{podeMandarLink && !enviarLink && (');
    expect(ATUALIZACAO).toContain("<EnviarLinkRecadastro filiadoId={filiado.id} onCompletarFicha={(porta) => (porta === 'EDITAR'");
  });
});
