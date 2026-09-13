import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { FILTRO_RAPIDO } from './processos.service';
import { baseDoAcervo } from './padroes.service';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const SERVICO = ler('src/modules/processos/processos.service.ts');
const PADROES = ler('src/modules/processos/padroes.service.ts');

/**
 * DE QUE LADO O SINDICATO ESTÁ — e são TRÊS respostas, não duas.
 *
 * Medido na produção em 04/09/2026 sobre os 127 processos: AUTOR em 93,
 * REPRESENTANDO em 31 (o filiado é a parte e o sindicato é o patrono) e RÉU em
 * 3. Naquele dia somavam o acervo — 93 + 31 + 3 = 127. Não é regra: processo sem
 * parte nenhuma não entra em "representando", e o sindicato como TERCEIRO não
 * entra em nenhum dos três. Nada deve calcular "sem papel = ativos − soma".
 *
 * A do meio é a que se esquece, e é a segunda maior: "processo do sindicato" e
 * "processo que o sindicato conduz" são coisas diferentes, e a diferença muda
 * quem responde por ele.
 */
describe('o papel do sindicato no processo', () => {
  it('AUTOR é o sindicato no polo ativo', () => {
    expect(FILTRO_RAPIDO.nossoPapel('AUTOR')).toEqual({
      partes: { some: { polo: 'ATIVO', parteExterna: { institucional: true } } },
    });
  });

  it('REU é o sindicato no polo passivo', () => {
    expect(FILTRO_RAPIDO.nossoPapel('REU')).toEqual({
      partes: { some: { polo: 'PASSIVO', parteExterna: { institucional: true } } },
    });
  });

  /**
   * REPRESENTANDO exige TER partes e o sindicato não estar entre elas.
   *
   * Sem o `some: {}`, um processo importado sem parte nenhuma cairia aqui —
   * "o sindicato não está entre as partes" é verdade trivial quando não há
   * partes. Hoje são zero na produção, mas a fila "Sem réu cadastrado" existe
   * justamente porque isso acontece, e o número mentiria em silêncio.
   */
  it('REPRESENTANDO exige ter partes, e o sindicato fora delas', () => {
    expect(FILTRO_RAPIDO.nossoPapel('REPRESENTANDO')).toEqual({
      AND: [
        { partes: { some: {} } },
        { partes: { none: { parteExterna: { institucional: true } } } },
      ],
    });
  });

  /**
   * A IDENTIFICAÇÃO É PELA FLAG, NUNCA POR NOME.
   *
   * As 96 partes que são o sindicato estão todas ligadas ao cadastro marcado
   * `institucional` — conferido na produção, zero em texto solto. Casar por
   * texto erraria nas duas pontas: "SENATEPI", "SINDICATO DOS ENFERMEIROS…" e a
   * razão social inteira são a mesma entidade; e um sindicato PARCEIRO no polo
   * ativo (SINSEP, SINDHOSPI) casaria com "SINDICATO" sem ser nós.
   */
  it('não casa o sindicato por nome em lugar nenhum do filtro', () => {
    const trecho = SERVICO.slice(
      SERVICO.indexOf('nossoPapel: (papel:'),
      SERVICO.indexOf('nossoPapel: (papel:') + 900,
    );
    const semComentarios = trecho.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const proibido of ['SENATEPI', 'sigla', 'nome:', 'contains']) {
      expect(`${proibido} no filtro: ${semComentarios.includes(proibido)}`).toBe(
        `${proibido} no filtro: false`,
      );
    }
  });

  it('o filtro chega da query pela mesma porta dos outros', () => {
    expect(SERVICO).toContain("if (q.nossoPapel) and.push(FILTRO_RAPIDO.nossoPapel(q.nossoPapel));");
  });
});

/**
 * O PANORAMA CONTA OS TRÊS, e é ele que faz a pergunta ser descoberta: ninguém
 * abre painel de filtro para uma pergunta que ainda não fez.
 */
describe('a leitura no panorama', () => {
  it('conta os três papéis com a mesma regra do filtro', () => {
    const trecho = PADROES.slice(PADROES.indexOf('private async deQueLadoEstamos()'));
    expect(trecho).toContain("const somosNos = { parteExterna: { institucional: true } };");
    expect(trecho).toContain("polo: 'ATIVO', ...somosNos");
    expect(trecho).toContain("polo: 'PASSIVO', ...somosNos");
    expect(trecho).toContain('partes: { none: somosNos }');
  });

  it('entra no payload do panorama', () => {
    expect(PADROES).toContain('nossoPapel: { autor: number; reu: number; representando: number };');
    expect(PADROES).toContain('this.deQueLadoEstamos(),');
  });

  /**
   * O CARTÃO CONTA O ACERVO ATIVO — o mesmo recorte do resto da tela.
   *
   * Contava todos os status numa tela que fala em "149 processos ativos": os
   * três cartões somavam 184 em 12/09/2026, e "31 representando" abria uma
   * lista de 27. Número que muda quando se clica nele é pior que número nenhum.
   */
  /**
   * O RÉU DOS CARTÕES ACHA O SINDICATO PELA MESMA FLAG DOS TRÊS PAPÉIS.
   *
   * A CTE `nosso` usava só o CNPJ do tenant, enquanto os três cartões usam a
   * flag. Bastava a linha institucional estar sem documento para o próprio
   * sindicato virar "réu" nas concentrações. O CNPJ fica como rede, e só se o
   * tenant tiver um: `documento = ''` não pode casar ninguém.
   */
  it('o adversário exclui o sindicato pela flag, com o CNPJ como rede', () => {
    const sql = baseDoAcervo('11222333000144').sql.replace(/\s+/g, ' ');
    const nosso = sql.slice(sql.indexOf('nosso AS ('), sql.indexOf('lado AS ('));
    expect(nosso).toContain('WHERE institucional = true');
    expect(nosso).toContain("OR (? <> '' AND documento = ?)");
  });

  it('os três papéis contam só o acervo ativo', () => {
    const trecho = PADROES.slice(PADROES.indexOf('private async deQueLadoEstamos()'));
    const corpo = trecho.slice(0, trecho.indexOf('return { autor, reu, representando };'));
    expect(corpo).toContain("const ativo = { statusInterno: 'ATIVO' as const };");
    expect(corpo.match(/where: \{ \.\.\.ativo,/g)?.length).toBe(3);
  });
});
