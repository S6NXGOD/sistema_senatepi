import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const FICHA = ler('components/processos/processo-detalhe-sheet.tsx');
const GAVETA = ler('components/agenda/compromisso-drawer.tsx');
/**
 * O cartão da publicação é UM SÓ nas duas telas, e é de propósito: a ficha do
 * processo e a gaveta da atividade mostram o mesmo ato, e mostravam de dois
 * jeitos diferentes. As asserções de conteúdo do cartão moram aqui; as de
 * navegação continuam em quem monta o cartão.
 */
const CARTAO = ler('components/processos/publicacao-djen-card.tsx');
const PAINEL = ler('app/(dashboard)/dashboard/page.tsx');

/**
 * Só o corpo do componente do DJEN. Fatiar até o fim do arquivo arrastaria o
 * `AvisoRobo` logo abaixo — que usa `tom="critico"` com toda a razão, e faria
 * o caso do silêncio brando falhar por causa de código alheio.
 */
const BLOCO_DJEN = PAINEL.slice(
  PAINEL.indexOf('function PublicacoesDjen('),
  PAINEL.indexOf('function AvisoRobo('),
);

/**
 * IDA E VOLTA ENTRE O ATO E O TEOR.
 *
 * O DataJud entrega o rótulo ("Expedição de documento") e o DJEN entrega o
 * texto. Os dois já eram casados no banco — `ComunicacaoDjen.movimentacaoId` —
 * e a tela não contava. Quem lia a linha do tempo tinha de trocar de aba e
 * procurar visualmente qual das publicações correspondia àquele ato.
 */
describe('salto entre linha do tempo e publicações', () => {
  it('o andamento com publicação oferece o salto', () => {
    expect(FICHA).toContain('Ver teor no DJEN');
    expect(FICHA).toContain('onClick={() => onVerPublicacao(item.publicacao!.id)}');
  });

  it('o salto troca de aba E diz para onde rolar', () => {
    expect(FICHA).toContain('function verPublicacao(publicacaoId: string)');
    expect(FICHA).toContain("setAba('publicacoes')");
    expect(FICHA).toContain('setPublicacaoDestacada(publicacaoId)');
  });

  /** O caminho inverso fecha o ciclo: do teor de volta ao ato no histórico. */
  it('a publicação também volta para o andamento', () => {
    expect(FICHA).toContain('function verAndamento(movimentacaoId: string)');
    expect(FICHA).toContain('Ver o ato na linha do tempo');
    expect(FICHA).toContain("setAba('timeline')");
  });

  /** Os dois destaques são exclusivos — chegar num limpa o outro. */
  it('um destaque apaga o outro', () => {
    const ida = FICHA.slice(FICHA.indexOf('function verPublicacao('), FICHA.indexOf('function verAndamento('));
    expect(ida).toContain('setAndamentoDestacado(null)');
    const volta = FICHA.slice(FICHA.indexOf('function verAndamento('));
    expect(volta.slice(0, 300)).toContain('setPublicacaoDestacada(null)');
  });

  /** Sem âncora, a rolagem não tem alvo. */
  it('os dois lados têm âncora no DOM', () => {
    expect(CARTAO).toContain('id={`pub-${pub.id}`}');
    expect(FICHA).toContain('id={`mov-${item.id}`}');
  });

  /**
   * O agrupamento de cópias tira do DOM as publicações irmãs — e o andamento
   * guarda o id de UMA delas, que pode ser justamente a que sumiu. Sem âncora
   * para a cópia, o salto trocaria de aba e não rolaria para lugar nenhum.
   */
  it('a cópia agrupada também tem âncora', () => {
    expect(CARTAO).toContain('{grupo.copias.map((c) => (');
    expect(CARTAO).toContain('id={`pub-${c.id}`}');
  });

  /**
   * `setAba` e a rolagem correm no mesmo ciclo: sem ceder a vez, o elemento
   * ainda não existe no DOM quando `getElementById` procura.
   */
  it('a rolagem espera o próximo quadro', () => {
    const efeito = FICHA.slice(FICHA.indexOf('ROLA ATÉ O ITEM DESTACADO'));
    expect(efeito.slice(0, 900)).toContain('setTimeout(');
    expect(efeito.slice(0, 900)).toContain('scrollIntoView');
  });

  it('o destaque é limpo ao reabrir a ficha', () => {
    expect(FICHA).toContain('setPublicacaoDestacada(null); setAndamentoDestacado(null); }');
  });

  /** "Atividade criada na Agenda" era texto morto: não dizia qual nem abria. */
  it('a publicação abre a atividade que ela gerou', () => {
    expect(FICHA).toContain('href={`/agenda?compromisso=${grupo.principal.compromissoId}`}');
    expect(FICHA).toContain('Abrir a atividade na Agenda');
  });
});

/**
 * A atividade que o robô cria diz "confira o prazo aplicável" e traz o rótulo
 * do ato — porque é só isso que o DataJud manda. O texto que permite decidir
 * estava vinculado no banco e a três cliques de distância na tela.
 */
describe('a agenda mostra o teor que originou a atividade', () => {
  it('a gaveta renderiza a publicação vinculada', () => {
    expect(GAVETA).toContain('agruparPublicacoes(c.origemComunicacoes ?? [])');
    expect(CARTAO).toContain('Teor da publicação');
  });

  it('com o prazo mencionado e a ressalva de que não é vencimento', () => {
    expect(CARTAO).toContain('pub.prazoMencionadoDias');
    expect(CARTAO).toContain('o sistema não calcula vencimento');
  });

  it('e leva ao processo, onde estão as demais', () => {
    expect(GAVETA).toContain('href={`/processos?processo=${grupo.principal.processoId}`}');
  });

  /**
   * O TEOR APARECIA TRÊS VEZES na mesma gaveta: uma na descrição, onde o robô o
   * copiava, e uma por publicação irmã ligada à atividade — e cinco das seis
   * atividades da produção tinham duas irmãs. A descrição passou a dizer só o
   * que fazer; o teor vive no cartão, uma vez, agrupado.
   */
  it('a descrição não repete o teor que o cartão já mostra', () => {
    const CORRELACAO = readFileSync(
      path.resolve(RAIZ, '../../api/src/modules/processos/correlacao.service.ts'),
      'utf8',
    );
    expect(CORRELACAO).not.toContain('blocoTeor');
    expect(CORRELACAO).not.toContain('Publicação (DJEN)');
  });
});

/**
 * O painel já tinha saúde do robô do DataJud porque zero é ambíguo. No DJEN
 * isso não é hipótese: ele devolveu zero por um mês e a tela dizia só "nenhuma
 * publicação encontrada".
 */
describe('o painel', () => {
  it('tem bloco de publicações', () => {
    expect(PAINEL).toContain('function PublicacoesDjen(');
    expect(PAINEL).toContain('<PublicacoesDjen djen={data.djen} />');
  });

  /** Integração desligada não desenha nada — bloco permanente seria ruído. */
  it('some quando a integração está desligada', () => {
    const bloco = BLOCO_DJEN;
    expect(bloco.slice(0, 400)).toContain('if (!djen.ativa) return null;');
  });

  it('distingue "nunca trouxe" de "parou de trazer"', () => {
    const bloco = BLOCO_DJEN;
    expect(bloco).toContain("djen.situacao === 'PRIMEIRA'");
    expect(bloco).toContain("djen.situacao === 'SILENCIOSA'");
  });

  /**
   * Silêncio curto tem explicação inocente — fim de semana, recesso. O aviso
   * informa em vez de acusar.
   */
  it('o aviso de silêncio não grita', () => {
    const bloco = BLOCO_DJEN;
    expect(bloco).toContain('Fim de semana e recesso');
    expect(bloco).not.toMatch(/tom="critico"/);
  });

  it('cada linha leva à atividade ou ao processo', () => {
    const bloco = BLOCO_DJEN;
    expect(bloco).toContain('`/agenda?compromisso=${pub.compromissoId}`');
    expect(bloco).toContain("`/processos?processo=${pub.processo?.id ?? ''}`");
  });

  /**
   * A LINHA LEVA À AGENDA SÓ SE A TAREFA ESTIVER ABERTA.
   *
   * `compromissoId` preenchido não basta: a atividade pode ter sido concluída
   * ou cancelada, e o link levaria a uma tarefa que ninguém vai executar. Nesse
   * caso o destino certo é o processo, onde está o teor e o histórico.
   */
  it('tarefa fechada manda para o processo, não para a agenda', () => {
    expect(BLOCO_DJEN).toContain('pub.compromissoId && pub.temTarefaAberta');
  });

  /**
   * O PAINEL É RESUMO — seis atos de sete dias. A pergunta "e o resto?" tem
   * resposta: /publicacoes, com busca e paginação. Sem o link, o bloco seria um
   * beco: mostra cinco itens e não diz que existem cento e trinta.
   */
  it('oferece o caminho para o acervo inteiro', () => {
    expect(BLOCO_DJEN).toContain('href="/publicacoes"');
    expect(BLOCO_DJEN).toContain('{djen.publicacoes7d} em 7 dias · ver todas');
  });

  /**
   * CONTRA QUEM, e não DE QUEM. Medido em 04/09/2026: só 4 dos 127 processos
   * têm filiado vinculado e o sindicato é o polo ativo em 93 — o nome dele em
   * toda linha não distingue nada. O réu distingue.
   */
  it('cada linha diz contra quem é o processo', () => {
    expect(BLOCO_DJEN).toContain('× {pub.processo.adversario}');
  });

  /** Publicação que pediu algo e ninguém pegou é o único risco desta lista. */
  it('marca a publicação que não virou tarefa', () => {
    expect(BLOCO_DJEN).toContain('· sem tarefa');
    expect(BLOCO_DJEN).toContain('border-2 border-amber-500');
  });
});
