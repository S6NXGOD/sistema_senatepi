import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trechoDaOrdem } from './utils/trecho-da-ordem.util';

const CAIXA = readFileSync(join(__dirname, 'caixa-de-propostas.service.ts'), 'utf8');
const CORRELACAO = readFileSync(join(__dirname, 'correlacao.service.ts'), 'utf8');
const CONTROLLER = readFileSync(join(__dirname, 'djen.controller.ts'), 'utf8');

/**
 * O ROBÔ PROPÕE, A PESSOA DECIDE.
 *
 * Medido nas 1.433 publicações: ele PROVA que a ordem é nossa em 15,8%, prova
 * que é da outra parte em 4,1%, e nos 80% restantes não sabe. Criar tarefa
 * nesses 80% encheu a agenda de trabalho alheio — das 14 atividades que criou,
 * CINCO já tinham sido canceladas à mão.
 *
 * Volume da caixa (30 dias): 40 propostas para a equipe, 2,6 por semana no pior
 * caso individual, ZERO sem dono identificável.
 */
describe('o que vai direto e o que vira proposta', () => {
  it('só a ordem provada COM prazo vira tarefa sem perguntar', () => {
    expect(CORRELACAO).toContain(
      "const provadaNossaComPrazo = lado === 'NOSSA' && c.prazoMencionadoDias != null;",
    );
    expect(CORRELACAO).toContain('if (!provadaNossaComPrazo) {');
  });

  /** A proposta é endereçada a UMA pessoa: de todos é de ninguém. */
  it('a proposta tem dono', () => {
    expect(CORRELACAO).toContain('tarefaPropostaPara: dono');
    expect(CORRELACAO).toContain('private async donoDaProposta(');
  });

  /**
   * A ordem dos degraus importa: o advogado que o ATO nomeia é sinal mais forte
   * que o responsável pelo processo — a publicação chegou porque a OAB dele
   * estava nela.
   */
  it('prefere quem o ato nomeia ao responsável pelo processo', () => {
    const fn = CORRELACAO.slice(CORRELACAO.indexOf('private async donoDaProposta('));
    expect(fn.indexOf('porOab.get(')).toBeLessThan(fn.indexOf('processo.advogadoId'));
  });

  /** Sem dono a proposta fica órfã e visível, nunca sumida. */
  it('aceita ficar sem dono em vez de inventar um', () => {
    const fn = CORRELACAO.slice(CORRELACAO.indexOf('private async donoDaProposta('));
    expect(fn.slice(0, 2600)).toContain('return null;');
  });
});

/**
 * A REDE: o modo de falhar da caixa é "ninguém abriu".
 *
 * Para uma proposta sem prazo isso é inofensivo — ela espera. Para uma COM
 * prazo é perder prazo, e nenhuma melhoria de ruído vale isso.
 */
describe('a proposta esquecida', () => {
  it('vira tarefa sozinha quando menciona prazo', () => {
    expect(CAIXA).toContain('async escalarEsquecidas()');
    expect(CAIXA).toContain('prazoMencionadoDias: { not: null }');
  });

  /** Sem prazo NUNCA escala: não há relógio para correr. */
  it('mas a sem prazo espera para sempre', () => {
    const fn = CAIXA.slice(CAIXA.indexOf('async escalarEsquecidas()'));
    expect(fn.slice(0, 900)).toContain('prazoMencionadoDias: { not: null }');
  });

  /** Uma proposta que falha não pode travar as outras. */
  it('uma falha não derruba o lote', () => {
    const fn = CAIXA.slice(CAIXA.indexOf('async escalarEsquecidas()'));
    expect(fn).toContain('} catch (err) {');
    expect(fn).toContain('continue;');
  });

  /** Quem lê a agenda precisa saber que o sistema decidiu por ela. */
  it('a escalada se identifica', () => {
    expect(CORRELACAO).toContain('escalada = false');
    expect(CORRELACAO).toContain('ficou três dias sem resposta na caixa de entrada');
  });
});

describe('aceitar e recusar', () => {
  /** Quem aceita fica com a tarefa, mesmo que a proposta fosse de outro. */
  it('o responsável é quem aceitou', () => {
    expect(CAIXA).toContain('criarAtividadeDaProposta(c.id, usuarioId)');
    expect(CORRELACAO).toContain('responsavelForcado ??');
  });

  /** Dois cliques não podem virar duas tarefas. */
  it('a proposta só é decidida uma vez', () => {
    expect(CAIXA).toContain('já virou atividade');
    expect(CAIXA).toContain('já foi decidida');
  });

  it('a recusa grava o motivo', () => {
    expect(CAIXA).toContain("tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO'");
    expect(CAIXA).toContain('motivoDaRecusa:');
  });

  /**
   * O ESCOPO É PESSOAL, e a exceção da coordenação é de NEGÓCIO, não de
   * permissão: é ela que precisa notar a proposta órfã antes do prazo passar.
   *
   * Escrito como função e não como `@Roles` — `@Roles` numa rota atropela a
   * matriz de permissões em silêncio.
   */
  it('cada um vê a própria caixa', () => {
    // O escopo ampliado deixou de ser "sem filtro" — ver o bloco `o escopo
    // ampliado` no fim deste arquivo. O advogado continua no próprio id.
    expect(CAIXA).toContain(': { tarefaPropostaPara: usuarioId }),');
    expect(CONTROLLER).toContain('function podeVerTodasAsPropostas(');
    expect(CONTROLLER).not.toContain("@Roles('ADMINISTRADOR')\n  listarPropostas");
  });

  /** POST porque CRIA — e o guard resolve EDITAR pelo verbo. */
  it('aceitar e recusar exigem EDITAR', () => {
    expect(CONTROLLER).toContain("@Post('propostas/:id/aceitar')");
    expect(CONTROLLER).toContain("@Post('propostas/:id/recusar')");
  });
});

/**
 * A PRÉVIA QUE FAZ A DECISÃO DURAR UM SEGUNDO.
 *
 * O teor tem 2.476 caracteres em média — mostrar tudo é pedir leitura; mostrar
 * só "Elaborar manifestação" é pedir fé. O que resolve é a frase em que o juízo
 * manda alguém fazer algo: é ali que está o "de quem é isto".
 */
describe('o trecho da ordem', () => {
  it('recorta a frase da ordem, não o teor inteiro', () => {
    const teor =
      'PODER JUDICIARIO TRIBUNAL REGIONAL DO TRABALHO DA 22a REGIAO. ' +
      'INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS. NADA MAIS.';
    const t = trechoDaOrdem(teor);
    expect(t).toContain('INTIME-SE A RECLAMADA');
    expect(t).not.toContain('PODER JUDICIARIO');
  });

  /**
   * O CASO QUE A SIMULAÇÃO PEGOU — e que sozinho valia a funcionalidade.
   *
   * O TRT22 escreve "Fica V. Sa. intimado" na maioria dos atos, e a primeira
   * regex usava `[^.;:]` no intervalo: "V. Sa." tem dois pontos. Resultado: 34
   * das 40 propostas sem prévia, mostrando o timbre do tribunal no lugar.
   */
  it('atravessa a abreviação "V. Sa.", que tem pontos no meio', () => {
    const teor =
      'PODER JUDICIARIO TRIBUNAL REGIONAL DO TRABALHO DA 22a REGIAO. ' +
      'INTIMAÇÃO Fica V. Sa. intimado para tomar ciência da Decisão ID 7d684b3 proferida nos autos.';
    const t = trechoDaOrdem(teor);
    expect(t).toContain('Fica V. Sa. intimado');
    expect(t).not.toContain('PODER JUDICIARIO');
  });

  it('pega também "fica intimada"', () => {
    expect(trechoDaOrdem('DESPACHO. FICA INTIMADA A PARTE AUTORA PARA REPLICAR EM 15 DIAS.'))
      .toContain('FICA INTIMADA A PARTE AUTORA');
  });

  /** O verbo da decisão, quando não há ordem dirigida a ninguém. */
  it('cai para o verbo da decisão', () => {
    const t = trechoDaOrdem('DECISÃO RECEBO O RECURSO INOMINADO apenas em seu efeito devolutivo.');
    expect(t).toContain('RECEBO O RECURSO INOMINADO');
  });

  /** 29,9% dos atos não têm ordem escrita — inventar seria pior. */
  it('devolve nulo quando não há ordem, para a tela mostrar o teor', () => {
    expect(trechoDaOrdem('SENTENCA PUBLICADA EM AUDIENCIA. NADA MAIS.')).toBeNull();
    expect(trechoDaOrdem('')).toBeNull();
  });

  /** Um recorte de duas palavras não ajuda ninguém a decidir. */
  it('ignora recorte curto demais para informar', () => {
    expect(trechoDaOrdem('INTIMO.')).toBeNull();
  });
});

/**
 * A CAIXA DA COORDENAÇÃO É A DELA MAIS AS ÓRFÃS — nunca a de todo mundo.
 *
 * `verTodas` estava escrito como "sem filtro", e isso errava nas duas pontas:
 * o painel nunca pedia (logo administrador e coordenação NÃO VIAM NADA, nem as
 * órfãs), e se pedisse despejaria as 40 propostas/mês da equipe em quem não
 * acompanha aqueles processos.
 */
describe('o escopo ampliado', () => {
  it('é "minhas OU sem dono", não "todas"', () => {
    expect(CAIXA).toContain('OR: [{ tarefaPropostaPara: usuarioId }, { tarefaPropostaPara: null }]');
  });

  /** O selo não pode contar o que a lista não mostra. */
  it('a contagem usa o mesmo escopo da listagem', () => {
    const contar = CAIXA.slice(CAIXA.indexOf('contar(usuarioId: string'));
    expect(contar.slice(0, 700)).toContain('tarefaPropostaPara: null');
  });

  it('e o advogado continua vendo só as dele', () => {
    expect(CAIXA).toContain(': { tarefaPropostaPara: usuarioId }),');
  });
});
