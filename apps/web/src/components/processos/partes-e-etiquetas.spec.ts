import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chaveDaParte, jaEstaNaLista, normalizarNome, type ParteEditavel } from './editor-de-partes';
import { separarComposta } from './etiquetas-input';

const ler = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

/**
 * O CÓDIGO SEM OS COMENTÁRIOS.
 *
 * Senão o próprio texto que EXPLICA a remoção de "Acrescentar outro réu"
 * faz o teste que verifica a remoção falhar — já aconteceu duas vezes neste
 * projeto, e o mais irritante é que o código está certo.
 */
const lerCodigo = (rel: string) =>
  ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * A MESMA EMPRESA NÃO ENTRA DUAS VEZES.
 *
 * Foi o que a tela do usuário mostrou: "PRONTOCARE CLINICA E ATENDIMENTOS LTDA"
 * como Réu principal E como Litisconsorte 1. Uma veio do cadastro (tem id), a
 * outra foi digitada à mão (não tem) — e a comparação de então era por id, que
 * para as duas dá resultados diferentes.
 */
describe('a mesma parte, duas portas', () => {
  const doCadastro: ParteEditavel = {
    tipo: 'ORGANIZACAO',
    nome: 'PRONTOCARE CLINICA E ATENDIMENTOS LTDA',
    parteExternaId: 'org-1',
  };
  const digitada: ParteEditavel = {
    tipo: 'AVULSA',
    nome: 'Prontocare Clínica e Atendimentos Ltda.',
  };

  it('reconhece a repetição mesmo sem id em comum', () => {
    expect(jaEstaNaLista([doCadastro], digitada)).toBe(true);
    expect(jaEstaNaLista([digitada], doCadastro)).toBe(true);
  });

  it('ignora acento, pontuação e caixa', () => {
    expect(normalizarNome('Prontocare Clínica e Atendimentos Ltda.')).toBe(
      normalizarNome('PRONTOCARE CLINICA E ATENDIMENTOS LTDA'),
    );
  });

  it('mas não confunde empresas de nomes diferentes', () => {
    const outra: ParteEditavel = { tipo: 'AVULSA', nome: 'PRONTOMED ADULTO' };
    expect(jaEstaNaLista([doCadastro], outra)).toBe(false);
  });

  /** O mesmo filiado escolhido duas vezes é a mesma pessoa. */
  it('pega a repetição pelo id quando o nome vem grafado de outro jeito', () => {
    const a: ParteEditavel = { tipo: 'FILIADO', nome: 'SARA MACHADO MIRANDA', filiadoId: 'f1' };
    const b: ParteEditavel = { tipo: 'FILIADO', nome: 'Sara M. M. L. Barbosa', filiadoId: 'f1' };
    expect(jaEstaNaLista([a], b)).toBe(true);
  });

  /**
   * O SINDICATO É UM CASO À PARTE: ele pode entrar ao lado de um filiado de
   * nome parecido sem que sejam a mesma parte.
   */
  it('distingue o sindicato de uma parte homônima', () => {
    const sind: ParteEditavel = { tipo: 'INSTITUCIONAL', nome: 'SENATEPI' };
    const avulsa: ParteEditavel = { tipo: 'AVULSA', nome: 'SENATEPI' };
    expect(chaveDaParte(sind)).not.toBe(chaveDaParte(avulsa));
  });
});

/**
 * NÃO EXISTE MAIS "PARTE EM EDIÇÃO" — escolher já é acrescentar.
 *
 * Os três estados (lista + selecionado + digitado) e o botão "Acrescentar outro
 * réu" eram cinco blocos para uma pergunta. E o botão nem era necessário: o réu
 * em edição já ia no envio.
 */
describe('o editor de partes substituiu os três estados', () => {
  const DIALOGO = lerCodigo('importar-processo-dialog.tsx');

  it('o modal não tem mais réu selecionado nem réu digitado', () => {
    expect(DIALOGO).not.toContain('setReuSelecionado');
    expect(DIALOGO).not.toContain('setReuNome');
    expect(DIALOGO).not.toContain('Acrescentar outro réu');
  });

  it('os dois polos usam o mesmo editor', () => {
    expect(DIALOGO).toContain('rotuloPrincipal="Autor principal"');
    expect(DIALOGO).toContain('rotuloPrincipal="Réu principal"');
  });

  /** O aviso amarelo virou resultado da mesma busca. */
  it('os cadastros parecidos entram na lista da busca, não num aviso à parte', () => {
    expect(DIALOGO).not.toContain('Pode ser que esta parte já esteja cadastrada');
    expect(DIALOGO).toContain('MOTIVO_SEMELHANCA_LABEL[c.motivo]');
  });

  /**
   * O polo ativo deixou de ser três botões exclusivos: filiado, sindicato e
   * parte sem cadastro convivem na mesma relação.
   */
  it('o polo ativo aceita tipos misturados', () => {
    expect(DIALOGO).not.toContain('ModoPoloAtivo');
    expect(DIALOGO).toContain("tipo: 'INSTITUCIONAL',");
    expect(DIALOGO).toContain('permitirTextoLivre');
  });

  /**
   * AVISA, NÃO TRAVA. Eu tinha travado o botão com polo ativo vazio; "definir
   * depois" é legítimo, e trancar a porta empurraria a pessoa para digitar
   * qualquer nome só para passar. O que fica é a consequência dita na hora.
   */
  it('avisa da fila em vez de travar o botão', () => {
    expect(DIALOGO).toContain('const poloVazio = poloAtivo.length === 0;');
    expect(DIALOGO).toContain('disabled={importar.isPending}');
    expect(DIALOGO).toContain('o processo entra na fila');
  });

  /**
   * O RESUMO VAI JUNTO DA RELAÇÃO. Web e API sobem separadas: na janela de
   * troca a tela nova fala com o contêiner velho, que só entende `tipo`.
   */
  it('manda os dois formatos de polo ativo', () => {
    expect(DIALOGO).toContain("return { tipo: 'FILIADOS', filiadoIds, partes };");
    expect(DIALOGO).toContain("return { tipo: 'INSTITUCIONAL', partes };");
  });
});

/**
 * O BOTÃO DE CADASTRAR NÃO PODE FICAR ATRÁS DA LISTA.
 *
 * Era desenhado no fluxo normal, logo abaixo do campo; a lista de resultados é
 * `absolute` e passava por cima. O botão estava na tela e ficava escondido.
 */
describe('cadastrar filiado mora dentro da lista', () => {
  const BUSCA = lerCodigo('../ui/busca-select.tsx');
  const DIALOGO = lerCodigo('importar-processo-dialog.tsx');

  it('a busca aceita ações como opção da lista', () => {
    expect(BUSCA).toContain('export interface AcaoBusca');
    expect(BUSCA).toContain("...acoesVisiveis.map((acao) => ({ acao }))");
  });

  it('a ação é alcançável pelo teclado, como qualquer resultado', () => {
    // Ela entra em `opcoes`, que é o array por onde ↓ ↑ e Enter andam.
    expect(BUSCA).toContain('const opcoes: Opcao[] = [');
  });

  it('o modal oferece o cadastro por ali', () => {
    expect(DIALOGO).toContain('rotulo: (t: string) => `Cadastrar');
    expect(DIALOGO).toContain('setCadastrando(true)');
  });

  /** Sem permissão, nada de botão morto — o preset do advogado não cria filiado. */
  it('some para quem não pode cadastrar', () => {
    expect(DIALOGO).toContain('...(podeCadastrarFiliado');
  });
});

/**
 * RECADASTRAR NO MEIO DO CADASTRO DO PROCESSO — sem perder o que foi digitado.
 */
describe('recadastramento ao vincular o filiado', () => {
  const DIALOGO = lerCodigo('importar-processo-dialog.tsx');
  const MODAL = lerCodigo('../filiados/recadastrar-modal.tsx');

  it('a linha do filiado abre as duas portas', () => {
    expect(DIALOGO).toContain('setRecadastrar({ id: parte.filiadoId!, nome: parte.nome })');
    expect(DIALOGO).toContain('<RecadastrarModal');
  });

  /**
   * O presencial fazia `router.push` — levaria embora o NPU, o tribunal, a
   * equipe e os réus já digitados, sem aviso nenhum.
   */
  it('o presencial não navega quando é chamado de dentro de outro modal', () => {
    expect(MODAL).toContain('semNavegar?: boolean;');
    expect(MODAL).toContain('if (semNavegar) { onRecadastrarPresencial?.(filiadoId); return; }');
    expect(DIALOGO).toContain('semNavegar');
  });

  it('e abre o formulário completo por cima', () => {
    expect(DIALOGO).toContain('filiadoId={filiadoParaRecadastro}');
  });
});

/**
 * ETIQUETA COMPOSTA É CONTAGEM ERRADA.
 *
 * "READAPTAÇÃO + INSALUB." não aparece para quem filtra INSALUBRIDADE — a
 * resposta para "quantas ações de insalubridade temos?" diz 14 quando são 15.
 */
describe('separar a etiqueta composta', () => {
  it.each([
    ['READAPTAÇÃO + INSALUB.', ['READAPTAÇÃO', 'INSALUB']],
    ['ADICIONAIS + GRATIFICAÇÃO', ['ADICIONAIS', 'GRATIFICAÇÃO']],
    ['FÉRIAS, 13º E ADICIONAIS', ['FÉRIAS', '13º', 'ADICIONAIS']],
  ])('%s vira %s', (composta, esperado) => {
    expect(separarComposta(composta)).toEqual(esperado);
  });

  /** Etiqueta simples não vira nada — a oferta não pode aparecer sem motivo. */
  it.each(['INSALUBRIDADE', 'RETALIAÇÃO', 'CCT 2022/2024', '12 x 36'])(
    '%s continua uma só',
    (simples) => {
      expect(separarComposta(simples)).toEqual([]);
    },
  );

  /**
   * "DCG" e "12 x 36" têm menos de três letras em algum pedaço se cortadas
   * errado; o corte só vale quando sobra coisa legível dos dois lados.
   */
  it('não parte o que sobraria em pedaços curtos', () => {
    expect(separarComposta('A + B')).toEqual([]);
  });
});

/**
 * O PERÍODO DA CONVENÇÃO É OUTRO EIXO — 41 dos ~84 usos do acervo.
 */
describe('convenção e pedido são grupos diferentes', () => {
  const CAMPO = lerCodigo('etiquetas-input.tsx');

  it('a lista separa os dois', () => {
    expect(CAMPO).toContain('function ehPeriodoDeConvencao');
    expect(CAMPO).toContain('titulo="Convenção"');
  });

  /** O número é o que distingue vocabulário estabelecido de invenção do dia. */
  it('cada sugestão mostra em quantos processos está', () => {
    expect(CAMPO).toContain('{e.processos}');
  });
});
