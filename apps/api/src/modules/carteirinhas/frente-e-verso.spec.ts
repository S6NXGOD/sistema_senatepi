import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANTS } from '../../tenant/tenant.config';

/** O fonte sem comentários — negativa mira CÓDIGO, nunca a prosa que explica. */
const fonte = readFileSync(join(__dirname, 'carteirinhas.module.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "COLOQUEI ALGUMAS IDEIAS DE FRENTE E VERSO DA CARTEIRINHA." — o dono,
 * 24/09/2026, com duas referências: a CIPTEA de Cajamar e uma credencial de
 * obreiro. As duas fazem a MESMA divisão, que é a de qualquer documento de
 * identificação: a frente diz quem é a pessoa; o verso é a conferência, a base
 * legal e a assinatura de quem responde pelo documento.
 *
 * O cartão tinha UMA face com nove campos, a assinatura e o QR espremidos.
 */
describe('o cartão tem duas faces', () => {
  it('a segunda página existe e tem o mesmo tamanho da primeira', () => {
    expect(fonte).toContain("doc.addPage({ size: [W, H], margin: 0 })");
  });

  /**
   * Frente = identidade; verso = conferência. A ordem dos blocos é a divisão.
   *
   * O alvo é `campo('CPF'`, e não `mascararCpf`: a rota JSON `dados()` também
   * mascara o CPF, ANTES do desenho no arquivo, e mirar a função reprovava o
   * arquivo certo.
   */
  it('o nome fica na frente e o CPF no verso', () => {
    const virada = fonte.indexOf('doc.addPage(');
    expect(virada).toBeGreaterThan(-1);
    expect(fonte.indexOf('CARTEIRA DE ASSOCIADO')).toBeLessThan(virada);
    for (const daFrente of ["'NOME'", "['Matrícula', filiado.matricula]"]) {
      const onde = fonte.indexOf(daFrente);
      expect(onde).toBeGreaterThan(-1);
      expect(onde).toBeLessThan(virada);
    }
    for (const doVerso of ["campo('CPF'", 'DADOS DO(A) ASSOCIADO(A)', 'Presidência do']) {
      expect(fonte.indexOf(doVerso)).toBeGreaterThan(virada);
    }
  });

  /**
   * O QR FICA NA FRENTE, e o verso não pode prometer o que ele não faz.
   *
   * A primeira versão do texto legal dizia "a autenticidade pode ser conferida
   * pelo QR Code". NÃO PODE: o código carrega `{id, tipo, validacao}` em JSON
   * assinado por HMAC — não é URL, não existe página pública que o resolva, e
   * quem aponta a câmera vê um punhado de texto sem sentido. Frase impressa em
   * milhares de cartões não se corrige com um deploy.
   */
  it('o verso não promete conferência pelo QR', () => {
    expect(fonte).not.toMatch(/autenticidade pode ser conferida/i);
    expect(fonte).toContain('procure a secretaria do sindicato');
  });

  it('e o QR avisa que a leitura é interna', () => {
    expect(fonte).toContain('IDENTIFICAÇÃO INTERNA');
  });
});

/**
 * O QUE O CARTÃO NÃO PODE TER: valor de um cliente escrito à mão. É o defeito
 * que a cor da carteirinha já corrigiu em 24/09 — a carteirinha do SINDSERM
 * sairia verde, com o nome do sindicato dos enfermeiros.
 */
describe('nada do SENATEPI está cravado no desenho', () => {
  it('o nome, a sigla e a cor saem do cliente', () => {
    expect(fonte).toContain('tenant.nomeCurto');
    expect(fonte).toContain('tenant.sigla');
    expect(fonte).not.toMatch(/SENATEPI|SINDSERM/);
    expect(fonte).not.toMatch(/#1B7F0A|#0F4C81/i);
  });

  /** O endereço e os contatos do rodapé também: já vazaram de um PDF para outro. */
  it('o rodapé sai do cliente', () => {
    expect(fonte).toContain('enderecoEmLinha()');
    expect(fonte).toContain('contatosEmLinha()');
  });

  /**
   * E OS CAMPOS QUE O CLIENTE NÃO USA NÃO SAEM IMPRESSOS. O SINDSERM oculta
   * `formacao` e `numeroCoren` — são servidores municipais de toda espécie,
   * sem categoria profissional única e sem conselho de classe. Sem este gate, o
   * cartão deles sairia com "CATEGORIA —" e "COREN —".
   */
  it('respeita os campos ocultos do cliente', () => {
    expect(fonte).toContain("campoVisivel('formacao')");
    expect(fonte).toContain("campoVisivel('numeroCoren')");
  });

  /**
   * A GRADE SE CENTRA porque o número de linhas muda com o cliente: três no
   * SENATEPI, duas no SINDSERM. Ancorada no topo, a face do SINDSERM ficava com
   * 64pt de branco no pé — o cartão inacabado que este desenho veio consertar.
   */
  it('a grade da frente se centra em vez de ancorar no topo', () => {
    expect(fonte).toContain('const inicio = TOPO + Math.max(0, (FAIXA - altura) / 2);');
  });
});

/**
 * E O CONTRATO COM QUEM ENTRAR DEPOIS: um sindicato novo que não declare
 * endereço reprova aqui, e não no verso do cartão de alguém.
 */
describe('todo cliente tem o que o verso precisa', () => {
  it.each(Object.keys(TENANTS))('%s declara endereço', (id) => {
    const e = TENANTS[id].endereco;
    expect(e).toBeTruthy();
    expect(`${e.logradouro ?? ''}${e.cidade ?? ''}`.trim().length).toBeGreaterThan(4);
  });
});
