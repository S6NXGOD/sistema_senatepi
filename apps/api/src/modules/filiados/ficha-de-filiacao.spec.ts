import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANTS } from '../../tenant/tenant.config';

/** O fonte sem comentários — negativa mira CÓDIGO, nunca a prosa que explica. */
const semComentario = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const fonte = semComentario('./filiados.service.ts');

/**
 * "ESSE É O MODELO DA FICHA DE FILIAÇÃO DO SENATEPI. NA HORA DE GERAR O TERMO,
 * O PDF TEM QUE SER IGUAL DA FICHA." — o dono, 25/09/2026, com o formulário
 * oficial em mãos. "Não tem nada a ver com a que está hoje. Totalmente
 * diferente."
 *
 * Era outro documento: texto corrido com linhas pontilhadas, quatro "SEÇÃO N -"
 * e UMA assinatura. O oficial é uma GRADE, com faixas de seção, caixas de
 * marcar no topo e DUAS assinaturas no pé.
 */
describe('a ficha tem a estrutura do formulário oficial', () => {
  it('é uma grade com faixas de seção, e não texto corrido', () => {
    for (const secao of [
      'FICHA DE FILIAÇÃO',
      'INFORMAÇÕES PESSOAIS',
      'ENDEREÇO / CONTATO',
      'INFORMAÇÕES PROFISSIONAIS',
    ]) {
      expect(fonte).toContain(secao);
    }
    // As "SEÇÃO 1 -", "SEÇÃO 2 -" do documento antigo não existem mais.
    expect(fonte).not.toMatch(/SEÇÃO \d+ -/);
  });

  it('tem as caixas de FILIAÇÃO e RECADASTRAMENTO no topo', () => {
    expect(fonte).toContain("caixa(meio - 120, cy, tipo === 'FILIACAO');");
    expect(fonte).toContain("caixa(meio + 10, cy, tipo === 'RECADASTRAMENTO');");
  });

  /** Duas instituições, porque na enfermagem dois vínculos é a regra. */
  it('tem as duas instituições do formulário', () => {
    expect(fonte).toContain("for (const [i, ordinal] of ['1ª', '2ª'].entries())");
  });

  /** Uma autorização de desconto em folha com uma assinatura só é meia via. */
  it('tem DUAS assinaturas', () => {
    expect(fonte).toContain('desenharAssinatura(X, ');
    expect(fonte).toContain('desenharAssinatura(X + metade, `DIRETORIA ${tenant.sigla}`);');
  });

  /**
   * ANCORADAS NO PÉ DA FOLHA. Deixando fluir, a assinatura parava no meio da
   * página e sobravam 20 cm de branco — que numa via para assinar parece
   * documento cortado.
   */
  it('a assinatura fica no pé, e desce se o texto crescer', () => {
    expect(fonte).toContain('const RODAPE_FOLHA = doc.page.height - 150;');
    expect(fonte).toContain('const yData = Math.max(doc.y + 24, RODAPE_FOLHA);');
  });

  /**
   * NUMA FICHA, CAMPO VAZIO É LINHA PARA ESCREVER. `formatarDataBR(null)`
   * devolve "—", que é certo num relatório e errado num formulário: ocupa
   * justamente o espaço onde a pessoa ia escrever a data à mão.
   */
  it('campo sem dado sai em branco, não com travessão', () => {
    expect(fonte).toContain("const dataOuVazio = (v: Date | null | undefined) => (v ? formatarDataBR(v) : '');");
    expect(fonte).toContain("valor: dataOuVazio(f.dataNascimento)");
    expect(fonte).toContain("valor: f.cpf ? mascararCpf(f.cpf) : ''");
  });

  /** Papel branco pede logo COLORIDO — o branco sumiria por completo. */
  it('usa o logo colorido, não o de faixa', () => {
    const trecho = fonte.slice(fonte.indexOf('async gerarTermoPdf('));
    expect(trecho.slice(0, 6000)).toContain('lerLogoColorido()');
  });
});

/**
 * A CONTRIBUIÇÃO SINDICAL É OPT-IN, E A CAIXA SAI VAZIA.
 *
 * O documento antigo enfiava "Solicito que a Contribuição Sindical… sejam
 * repassadas" DENTRO do parágrafo da mensalidade, como se fosse a mesma
 * autorização. Não é: desde a reforma de 2017 o imposto sindical exige
 * manifestação EXPRESSA, e o formulário oficial reflete isso com uma caixa
 * separada. O sistema não guarda essa escolha — imprimi-la marcada seria o
 * sistema declarando, no lugar da pessoa, que ela autorizou um desconto.
 */
describe('o imposto sindical é uma escolha separada', () => {
  it('sai numa caixa própria, e vazia', () => {
    expect(fonte).toContain('const TEXTO_IMPOSTO = reg');
    expect(fonte).toContain('AUTORIZO que a Contribuição Sindical');
    // `caixa(X, yc)` sem o terceiro argumento = desmarcada.
    expect(fonte).toContain('caixa(X, yc);');
  });

  /** E não está mais grudado no parágrafo da mensalidade. */
  it('não volta para dentro do texto do desconto', () => {
    const ini = fonte.indexOf('const TEXTO_DESCONTO');
    const fim = fonte.indexOf('const TEXTO_LGPD');
    expect(fonte.slice(ini, fim)).not.toContain('579');
  });
});

/**
 * E O REGISTRO LEGAL VEM DO CLIENTE.
 *
 * CNPJ, código sindical, registro no MTb, data de fundação, base territorial e
 * até "O Enfermeiro, Auxiliar em enfermagem e Técnico em enfermagem" estavam
 * escritos à mão dentro de `gerarTermoPdf`: a ficha do SINDSERM sairia com o
 * REGISTRO LEGAL DO SENATEPI, num documento que autoriza desconto em folha.
 */
describe('nada do registro do SENATEPI está cravado no gerador', () => {
  it('os números saem de tenant.registro', () => {
    const trecho = fonte.slice(fonte.indexOf('async gerarTermoPdf('));
    const corpo = trecho.slice(0, trecho.indexOf('// ---- Termo de Desfiliação'));
    expect(corpo).toContain('const reg = tenant.registro;');
    for (const cravado of [
      '11.378.331/0001-86',
      '46214.0005793/2018-86',
      '19020-7',
      '30/11/2009',
      'Estado do Piauí',
      'Enfermeiro, Auxiliar',
    ]) {
      expect(corpo).not.toContain(cravado);
    }
  });

  /**
   * SEM REGISTRO, SEM BLOCO DE DESCONTO. Um cliente que ainda não informou os
   * dados imprime a ficha sem a autorização — o que é visível e alguém
   * conserta. Imprimir com o registro de outra entidade passa despercebido.
   */
  it('o parágrafo do desconto não sai sem registro e sem conta', () => {
    expect(fonte).toContain('reg && conta');
  });

  it('o SENATEPI declara o que a ficha precisa', () => {
    const r = TENANTS.senatepi.registro;
    expect(r?.cnpj).toBe('11.378.331/0001-86');
    expect(r?.sindical).toBe('19020-7');
    expect(r?.rotuloAssinatura).toBe('PROFISSIONAL DE ENFERMAGEM');
  });

  /**
   * O SINDSERM não declara — e é o estado honesto: ninguém informou o CNPJ nem
   * o registro sindical deles. Este teste existe para o dia em que informarem:
   * ele reprova se alguém copiar os números do SENATEPI para cá.
   */
  it('e o SINDSERM não herda os números do SENATEPI', () => {
    const r = TENANTS.sindserm.registro;
    if (r) expect(r.cnpj).not.toBe(TENANTS.senatepi.registro?.cnpj);
  });
});
