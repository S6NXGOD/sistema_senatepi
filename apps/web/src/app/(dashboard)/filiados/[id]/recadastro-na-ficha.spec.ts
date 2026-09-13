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

  it('a atualização cadastral do atendimento oferece o link a quem edita filiado', () => {
    expect(ATUALIZACAO).toContain("podeEditar(user?.role, user?.permissoes, 'filiados')");
    expect(ATUALIZACAO).toContain('{podeMandarLink && !enviarLink && (');
    expect(ATUALIZACAO).toContain('<EnviarLinkRecadastro filiadoId={filiado.id} />');
  });
});
