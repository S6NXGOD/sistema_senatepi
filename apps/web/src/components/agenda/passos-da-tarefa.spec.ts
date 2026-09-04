import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const DRAWER = ler('src/components/agenda/compromisso-drawer.tsx');
const PASSOS = ler('src/components/agenda/passos-da-tarefa.tsx');
const CONCLUIR = ler('src/components/agenda/concluir-modal.tsx');

/**
 * A TAREFA AUTOMÁTICA PRECISA DIZER O QUE SE ESPERA — antes de mostrar a prova.
 *
 * A gaveta abria com o teor do tribunal (o maior acórdão do acervo tem 22 mil
 * caracteres) e a descrição ficava no rodapé, depois de responsável, registrado
 * por e processo. Quem abria lia a intimação inteira para só então descobrir o
 * que o sistema estava pedindo.
 */
describe('a ordem da gaveta', () => {
  it('o que fazer vem antes do teor da publicação', () => {
    const passos = DRAWER.indexOf('<PassosDaTarefa');
    const descricao = DRAWER.indexOf('<Bloco titulo="Descrição">');
    const teor = DRAWER.indexOf('agruparPublicacoes(c.origemComunicacoes');
    expect(passos).toBeGreaterThan(0);
    expect(descricao).toBeGreaterThan(0);
    expect(teor).toBeGreaterThan(0);
    expect(passos).toBeLessThan(teor);
    expect(descricao).toBeLessThan(teor);
  });

  /** Uma descrição só, ou o mesmo texto aparece duas vezes na mesma tela. */
  it('a descrição não é renderizada duas vezes', () => {
    const ocorrencias = DRAWER.split('<Bloco titulo="Descrição">').length - 1;
    expect(ocorrencias).toBe(1);
  });

  /**
   * QUAL ROBÔ, e não "o robô". São dois — o de prazos lê os andamentos do
   * DataJud, o do DJEN lê o teor das publicações. A gaveta creditava o DataJud
   * em toda tarefa automática, e quem fosse conferir a origem de uma tarefa
   * nascida de publicação procuraria na aba errada.
   */
  it('credita o robô certo', () => {
    expect(DRAWER).toContain("? 'Robô de publicações (DJEN)'");
    expect(DRAWER).toContain(": 'Robô de prazos (DataJud)'");
    expect(DRAWER).toContain('c.origemComunicacoes?.length');
  });
});

describe('o passo a passo', () => {
  /**
   * O PRIMEIRO PASSO É O TRABALHO JURÍDICO, e ele muda com a providência —
   * "elabore a manifestação" não serve para uma audiência designada. Os passos
   * 2 e 3 são do sistema e valem para todas.
   */
  it('nomeia o trabalho de cada providência', () => {
    for (const p of [
      'ELABORAR_MANIFESTACAO', 'JUNTAR_DOCUMENTOS', 'ANALISAR_SENTENCA', 'AVALIAR_RECURSO',
      'ANALISAR_INTIMACAO', 'PREPARAR_AUDIENCIA', 'SOLICITAR_DOCUMENTOS_FILIADO',
      'COMUNICAR_FILIADO',
    ]) {
      expect(`${p} tem passo: ${PASSOS.includes(p)}`).toBe(`${p} tem passo: true`);
    }
  });

  /**
   * SEM CAIXA DE MARCAR. O estado da tarefa já é o status (pendente, em
   * andamento, concluída) — uma segunda lista de marcação cria dois lugares
   * para dizer a mesma coisa, e eles divergem no primeiro dia.
   */
  it('não inventa um segundo estado', () => {
    expect(PASSOS).not.toContain('type="checkbox"');
    expect(PASSOS).not.toContain('useState');
  });

  /** Quem só precisa avisar o filiado não protocola peça nenhuma. */
  it('providência de contato não manda anexar peça', () => {
    const conjunto = PASSOS.slice(PASSOS.indexOf('const GERA_PECA'));
    const corpo = conjunto.slice(0, conjunto.indexOf(']'));
    expect(corpo).toContain('ELABORAR_MANIFESTACAO');
    expect(corpo).not.toContain('COMUNICAR_FILIADO');
    expect(corpo).not.toContain('SOLICITAR_DOCUMENTOS_FILIADO');
    expect(corpo).not.toContain('PREPARAR_AUDIENCIA');
  });
});

/**
 * "PEÇA PROTOCOLADA" SEM PEÇA é uma afirmação que ninguém confere depois — e é
 * exatamente o registro que se procura quando o tribunal diz que não recebeu.
 */
describe('a conclusão de um prazo', () => {
  it('avisa quando não há documento anexado', () => {
    expect(CONCLUIR).toContain("desfecho === 'PRAZO_CUMPRIDO'");
    expect(CONCLUIR).toContain('Nenhum documento anexado');
  });

  /**
   * E NÃO BLOQUEIA. Há peça que vive só no sistema do tribunal; travar a
   * conclusão por causa disso empurraria a equipe a escolher outro desfecho —
   * e aí o dado fica errado, não incompleto.
   */
  it('o aviso não impede concluir', () => {
    const valido = CONCLUIR.slice(CONCLUIR.indexOf('const valido = useMemo('));
    expect(valido.slice(0, 500)).not.toContain('anexos');
  });
});

/**
 * CADASTRAR FILIADO NO MEIO DE OUTRA TAREFA — o formulário INTEIRO, em passos.
 *
 * A primeira versão disto era um formulário de quatro campos, e estava errada:
 * o cadastro do sindicato exige cidade, estado, formação e COREN, então o
 * "rápido" produzia ficha pela metade que alguém teria de completar depois, sem
 * nada avisando que faltava. Quem pode cadastrar é o balcão, e o balcão tem os
 * dados — a pressa era suposição minha.
 */
describe('o cadastro dentro do modal', () => {
  const MODAL_CADASTRO = ler('src/components/filiados/cadastro-filiado-modal.tsx');
  const FORM = ler('src/components/filiados/filiado-form.tsx');
  const PERMISSAO = ler('src/components/filiados/permissao-cadastro.ts');
  const VINCULAR = ler('src/components/processos/vincular-filiado-modal.tsx');
  const IMPORTAR = ler('src/components/processos/importar-processo-dialog.tsx');

  /** Nada de segundo formulário: é o mesmo de /filiados/novo, em etapas. */
  it('reaproveita o formulário completo', () => {
    expect(MODAL_CADASTRO).toContain("import { FiliadoForm } from '@/components/filiados/filiado-form'");
    expect(MODAL_CADASTRO).toContain('emPassos');
    expect(FORM).toContain('const PASSOS = [');
  });

  /**
   * AVANÇAR VALIDA O PASSO. Sem isso o erro de um campo obrigatório do passo 3
   * só apareceria no fim, num bloco invisível — formulário que não envia e não
   * diz por quê.
   */
  it('cada passo valida o que é dele', () => {
    expect(FORM).toContain('async function avancar()');
    expect(FORM).toContain('await trigger(campos');
  });

  /** O MESMO modal recadastra: mesmos campos, mesmas travas. */
  it('serve também para recadastrar', () => {
    expect(MODAL_CADASTRO).toContain("modo={recadastro ? 'recadastrar' : 'criar'}");
  });

  /**
   * QUEM PODE CADASTRAR NÃO É QUEM MAIS PRECISA. O advogado tem
   * `filiados: VISUALIZAR` e a API recusa o POST — botão que só falha depois do
   * clique faz perder o que foi digitado.
   */
  it('respeita a permissão, e explica a quem pedir', () => {
    expect(PERMISSAO).toContain("podeEditar(user?.role, user?.permissoes, 'filiados')");
    expect(MODAL_CADASTRO).toContain('{!pode ? (');
    expect(MODAL_CADASTRO).toContain('é feito pela secretaria');
    for (const arquivo of [VINCULAR, IMPORTAR]) {
      expect(arquivo).toContain('usePodeCadastrarFiliado()');
    }
    expect(VINCULAR).toContain('peça à secretaria');
    expect(IMPORTAR).toContain('O cadastro é feito pela secretaria');
  });
});
