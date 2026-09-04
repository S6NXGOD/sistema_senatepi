import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parecemAMesmaPessoa, tokensDoNome, mascararCpf } from './sugestao-filiado.service';

const RAIZ = path.resolve(__dirname, '../../..');
const PARTES = readFileSync(path.join(RAIZ, 'src/modules/processos/partes.service.ts'), 'utf8');
const EXTERNAS = readFileSync(
  path.join(RAIZ, 'src/modules/processos/partes-externas.service.ts'),
  'utf8',
);

/**
 * O SINDICATO SÓ LITIGA POR SI OU POR UM FILIADO — não há terceira hipótese.
 *
 * Ainda assim, 26 processos individuais da produção tinham no polo ativo uma
 * pessoa sem cadastro vinculado. Os pares abaixo são REAIS: à esquerda o nome
 * como consta nos autos, à direita o nome como está na ficha do filiado. A
 * busca do sistema (que exige todos os termos digitados) devolvia ZERO em todos
 * eles — em nenhum caso porque a pessoa não fosse filiada.
 */
describe('reconhecer a mesma pessoa com nomes diferentes', () => {
  const MESMAS_PESSOAS: [string, string][] = [
    // O cadastro é MAIS CURTO que os autos.
    ['SARA MACHADO MIRANDA LEAL BARBOSA', 'SARA MACHADO MIRANDA'],
    // O cadastro é MAIS LONGO que os autos — o caso mais comum, porque quem
    // lança digita o nome de uso.
    ['MARCOS VICTOR', 'MARCOS VICTOR BARROS SILVA'],
    ['NAIARA PIMENTEL', 'NAIARA DOS SANTOS CARNEIRO PIMENTEL'],
    ['LUSINEIDE ABREU', 'LUSINEIDE ABREU DE FONSECA MELO'],
    ['ERICK RICCELY', 'ERICK RICCELY PEREIRA DO Ó'],
    ['VALQUÍRIA COSTA', 'VALQUIRIA DE ALMEIDA COSTA'],
    // Acento só de um lado, e partícula no meio.
    ['TÁSSIA ROSENO', 'TASSIA DA CONCEIÇÃO ROSENO'],
    ['MAURO JOSÉ', 'MAURO JOSÉ DA SILVA'],
    ['MARTINA SILVA', 'MARTINA PEREIRA DA SILVA'],
    ['ISAAC RODRIGUES PASSOS', 'ISAAC RODRIGUES PASSOS'],
  ];

  it.each(MESMAS_PESSOAS)('"%s" é "%s"', (autos, cadastro) => {
    expect(parecemAMesmaPessoa(autos, cadastro)).toBe(true);
  });

  /**
   * E O QUE NÃO PODE CASAR. Vincular a pessoa errada junta o processo de uma à
   * ficha de outra: não é um erro de listagem, é incidente de privacidade.
   */
  const PESSOAS_DIFERENTES: [string, string][] = [
    // Primeiro nome igual, sobrenomes que se contradizem.
    ['MARIA DE FÁTIMA SOUSA', 'MARIA DE FÁTIMA ALENCAR'],
    ['ANTÔNIA SANDRA', 'ANTÔNIA LUCIA MENDES'],
    // Sobrenome comum, primeiro nome diferente: nunca.
    ['JOSÉ DA SILVA', 'MARIA DA SILVA'],
    // Um nome só não sustenta vínculo nenhum, mesmo idêntico — "GIRCÉLIA"
    // sozinha, na produção, não identifica ninguém.
    ['GIRCÉLIA', 'GIRCÉLIA MARIA DOS SANTOS'],
    // Inversão de ordem não é subconjunto em nenhum dos sentidos.
    ['SILVA MARCOS', 'MARCOS VICTOR BARROS SILVA'],
  ];

  it.each(PESSOAS_DIFERENTES)('"%s" NÃO é "%s"', (a, b) => {
    expect(parecemAMesmaPessoa(a, b)).toBe(false);
  });

  /** Partícula e inicial solta não distinguem ninguém e atrapalham a comparação. */
  it('ignora partículas, acento, pontuação e iniciais soltas', () => {
    expect(tokensDoNome('LIZZIANE TÁTILA M. SOARES ALVES')).toEqual([
      'LIZZIANE', 'TATILA', 'SOARES', 'ALVES',
    ]);
    expect(tokensDoNome('João de Souza e Silva')).toEqual(['JOAO', 'SOUZA', 'SILVA']);
  });

  it('a comparação é simétrica', () => {
    for (const [a, b] of MESMAS_PESSOAS) {
      expect(`${a}|${parecemAMesmaPessoa(b, a)}`).toBe(`${a}|true`);
    }
  });

  it('nome vazio não casa com nada', () => {
    expect(parecemAMesmaPessoa('', 'MARCOS VICTOR BARROS SILVA')).toBe(false);
    expect(parecemAMesmaPessoa('   ', '   ')).toBe(false);
  });
});

describe('o CPF na tela', () => {
  it('mostra o bastante para conferir, e não o documento inteiro', () => {
    expect(mascararCpf('01203099398')).toBe('012.***.***-98');
    expect(mascararCpf('012.030.993-98')).toBe('012.***.***-98');
  });

  it('documento que não é CPF não vira máscara', () => {
    expect(mascararCpf('07954605000160')).toBeNull();
    expect(mascararCpf(null)).toBeNull();
    expect(mascararCpf('123')).toBeNull();
  });
});

/**
 * PREVENÇÃO — o vínculo se perdia na hora de lançar a parte, não depois.
 */
describe('quem digita o CPF já disse quem é a pessoa', () => {
  it('a parte com CPF de filiado nasce vinculada', () => {
    expect(PARTES).toContain('if (documento?.length === 11)');
    expect(PARTES).toContain('const filiadoDoCpf = await this.prisma.filiado.findFirst({');
    expect(PARTES).toContain('filiadoId: filiadoDoCpf.id');
  });

  /**
   * SÓ O CPF VINCULA SOZINHO. Nome parecido é sugestão e passa por gente — se
   * um dia esta regra virar automática, "ANGELA MARIA" (quatro filiadas
   * distintas nesta base) escolhe uma delas no escuro.
   */
  it('nome parecido não vincula sozinho em lugar nenhum', () => {
    const semComentarios = PARTES.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(semComentarios).not.toContain('parecemAMesmaPessoa');
  });

  it('o nome que fica é o dos autos, não o do cadastro', () => {
    const trecho = PARTES.slice(PARTES.indexOf('const filiadoDoCpf'));
    expect(trecho.slice(0, 700)).toContain('nome,');
    expect(trecho.slice(0, 700)).not.toContain('nome: filiadoDoCpf.nomeCompleto');
  });

  /** Filiado entra como filiado. O cadastro de partes é para o outro lado. */
  it('não deixa cadastrar um filiado como parte externa', () => {
    expect(EXTERNAS).toContain('await this.recusarSeForFiliado(documento);');
    expect(EXTERNAS).toContain('Filiado entra no processo como filiado');
  });
});

/**
 * IDENTIFICAR A PARTE, e não somar outra.
 *
 * O caminho antigo (`PATCH /processos/:id` com `filiadoId`) resolve o atalho
 * ADICIONANDO uma parte ao polo ativo. Num processo que já tem a pessoa lançada
 * como texto livre, isso produz dois autores que são a mesma pessoa.
 */
describe('vincular sem duplicar', () => {
  it('converte a parte existente no lugar', () => {
    const trecho = PARTES.slice(PARTES.indexOf('async vincularFiliado('));
    expect(trecho.slice(0, 2000)).toContain('parteExternaId: null');
    expect(trecho.slice(0, 2000)).toContain('await this.sincronizarAtalhos(tx, parte.processoId)');
    // Nada de criar parte nova por este caminho.
    expect(trecho.slice(0, 2000)).not.toContain('this.adicionar(');
  });

  it('recusa o mesmo filiado duas vezes no mesmo processo', () => {
    const trecho = PARTES.slice(PARTES.indexOf('async vincularFiliado('));
    expect(trecho.slice(0, 2000)).toContain('já consta neste processo em outra parte');
  });
});
