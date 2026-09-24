import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** O fonte sem comentários — negativa mira CÓDIGO, nunca a prosa que explica. */
const fonte = readFileSync(join(__dirname, 'anexos-section.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "ONDE A EQUIPE ANEXA — PARA EU APROXIMAR O 'PUXAR DO ACERVO' DO LUGAR CERTO."
 * — o dono, 24/09/2026, delegando a decisão.
 *
 * MEDIDO NA PRODUÇÃO ANTES DE MEXER, e a medição mudou a pergunta:
 *
 *   onde a equipe anexa ......... atividade 55 · atendimento 18 · processo 10
 *   atividade SEM filiado ....... 34 de 55 (112 das 155 são institucionais:
 *                                 audiência, prazo, reunião — não há acervo)
 *   atendimento SEM filiado ..... ZERO
 *   atendimento que TINHA o que
 *     puxar na hora de anexar ... 17 de 18
 *   usos do acervo .............. ZERO
 *   pessoas com acervo .......... 21 na produção inteira
 *
 * O botão não estava no lugar errado: estava no lugar certo com peso errado.
 * O dropzone tracejado ocupa a largura inteira; o acervo era um chip de 11px
 * no canto do cabeçalho, disputando espaço com o título da seção. Dezessete
 * vezes em dezoito havia documento para puxar e ninguém puxou.
 *
 * A correção é de PESO e de MOMENTO, não de lugar: a frase entra entre o
 * dropzone e a lista — onde a pessoa decide de onde vem o arquivo.
 */
describe('o acervo se oferece no momento da escolha', () => {
  it('a frase nomeia o número de documentos, que é o fato que falta', () => {
    expect(fonte).toContain('já entregou {aPuxar} documento');
  });

  /**
   * PORTA ÚNICA NA TELA PARADA. O chip do cabeçalho saiu: duas ofertas do mesmo
   * modal na mesma dobra é o que a régua do painel proíbe — e era a fraca que
   * ninguém achava.
   *
   * O diálogo do arquivo repetido também abre o modal, e ISSO CONTINUA CERTO:
   * não é uma oferta parada competindo por atenção, é a saída certa de um
   * evento ("este arquivo já existe" → "então puxe em vez de subir de novo").
   * Por isso a conta é DUAS, e as duas são nomeadas aqui de propósito.
   */
  it('a oferta parada é uma só, e a outra chamada é a saída do repetido', () => {
    expect(fonte.match(/setPuxarAberto\(true\)/g) ?? []).toHaveLength(2);
    const oferta = fonte.indexOf('{aPuxar > 0 && (');
    const repetido = fonte.indexOf('setRepetido(null);');
    expect(fonte.indexOf('setPuxarAberto(true)')).toBeGreaterThan(oferta);
    expect(fonte.lastIndexOf('setPuxarAberto(true)')).toBeGreaterThan(repetido);
  });

  /**
   * E O CHIP DE 11PX DO CABEÇALHO NÃO VOLTOU.
   *
   * A negativa é RECORTADA no cabeçalho de propósito: "Puxar do acervo"
   * continua no arquivo, e deve continuar — é o rótulo do botão do diálogo do
   * arquivo repetido. Negativa larga demais reprovaria o arquivo certo, que já
   * é o erro mais repetido deste repositório.
   */
  it('o cabeçalho não tem mais botão de acervo', () => {
    const titulo = fonte.indexOf('<h4');
    const fimDoCabecalho = fonte.indexOf('</div>', titulo);
    expect(titulo).toBeGreaterThan(-1);
    expect(fonte.slice(titulo, fimDoCabecalho)).not.toContain('setPuxarAberto');
    expect(fonte.slice(titulo, fimDoCabecalho)).not.toContain('acervo');
  });

  /** Sem nada para puxar, NADA aparece: botão que abre lista vazia é beco. */
  it('a oferta só existe quando há o que puxar', () => {
    expect(fonte).toContain('{aPuxar > 0 && (');
  });

  /**
   * A ORDEM É A MENSAGEM: depois do dropzone (já viu a porta do disco) e antes
   * da lista (ainda não desistiu). Comparação por ÍNDICE, não por fatia — uma
   * janela posicional já reprovou arquivo correto neste repositório.
   */
  it('fica entre o dropzone e a lista de arquivos', () => {
    const dropzone = fonte.indexOf('MIME_ACEITOS');
    const oferta = fonte.indexOf('{aPuxar > 0 && (');
    const lista = fonte.indexOf('anexos.map(');
    expect(dropzone).toBeGreaterThan(-1);
    expect(oferta).toBeGreaterThan(dropzone);
    expect(lista).toBeGreaterThan(oferta);
  });

  /**
   * E O SUBSTANTIVO É O DO CLIENTE. "Este filiado" é certo no SENATEPI e
   * ERRADO no SINDSERM, que chama as mesmas pessoas de servidores. A ponte
   * existe desde sempre; escrever à mão é o defeito que ela existe para evitar.
   */
  it('chama a pessoa como o cliente a chama', () => {
    expect(fonte).toContain('Este {V.filiado} já entregou');
    expect(fonte).not.toMatch(/Este filiado/);
  });
});
