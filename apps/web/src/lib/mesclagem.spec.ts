import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  camposDaEscolha, camposEmConflito, herdadosSemPerguntar, ladoInicial, oQueEstaPreso, opcoesDoCampo,
} from './mesclagem';
import type { ComparacaoOrganizacoes, LadoDaComparacao } from './partes';

const ler = (relativo: string) => readFileSync(join(__dirname, '..', relativo), 'utf8');

const lado = (over: Partial<LadoDaComparacao>): LadoDaComparacao => ({
  id: 'x', tipo: 'JURIDICA', nome: '', nomeFantasia: null, documento: null, email: null, telefone: null,
  cidade: null, uf: null, observacoes: null, ativo: true, createdAt: '', updatedAt: '',
  enteCodigo: null, enteOrigem: null, ente: null, institucional: false, dossiePatronal: null,
  _count: { participacoes: 0, vinculos: 0 },
  ...over,
});

/** O par da produção em 12/09/2026, como a API o devolve. */
const FMS: ComparacaoOrganizacoes = {
  a: lado({
    id: 'fms', nome: 'FMS/THE', nomeFantasia: 'FMS Teresina', documento: '05522917000170',
    cidade: 'Teresina', uf: 'PI', _count: { participacoes: 10, vinculos: 15 },
  }),
  b: lado({
    id: 'fundacao', tipo: 'ORGAO_PUBLICO', nome: 'Fundação Municipal de Saúde.', nomeFantasia: 'FMS',
    cidade: 'Teresina', uf: 'PI', enteCodigo: 2211001,
    ente: { codigo: 2211001, nome: 'Teresina', uf: 'PI', esfera: 'M' },
    _count: { participacoes: 0, vinculos: 4 },
  }),
  sugestaoFica: 'fms',
  recusaSeFicar: { a: null, b: null },
  descartada: { em: '2026-09-08T14:00:00.000Z', por: 'Dra. Margareth' },
  receita: {
    cnpj: '05522917000170', razaoSocial: 'FUNDACAO MUNICIPAL DE SAUDE', nomeFantasia: null, cep: null,
    logradouro: null, numero: null, complemento: null, bairro: null, cidade: 'TERESINA', uf: 'PI',
    situacao: 'ATIVA', ativaNaReceita: true, naturezaJuridica: 'Fundação Pública de Direito Público Municipal',
    telefone: '(86) 3215-7700', email: null, atividadePrincipal: null, dataAbertura: null,
    tipoSugerido: 'ORGAO_PUBLICO',
  },
  receitaFalhou: false,
};

describe('juntar a FMS sem perder dado', () => {
  it('abre com a sugerida continuando — a não ser que a regra a recuse', () => {
    expect(ladoInicial(FMS)).toBe('fms');
    expect(ladoInicial({ ...FMS, recusaSeFicar: { a: 'as duas têm dossiê', b: null } })).toBe('fundacao');
  });

  /** "Teresina" e "TERESINA" não são escolha; a razão social sem acento da Receita também não. */
  it('só vira escolha o que difere de verdade', () => {
    expect(opcoesDoCampo(FMS, 'nome', 'fms').map((o) => [o.fonte, o.texto])).toEqual([
      ['a', 'FMS/THE'],
      ['b', 'Fundação Municipal de Saúde.'],
    ]);
    expect(opcoesDoCampo(FMS, 'tipo', 'fms').map((o) => o.fonte)).toEqual(['a', 'b']);
    expect(opcoesDoCampo(FMS, 'cidade', 'fms')).toHaveLength(1);
    expect(camposEmConflito(FMS, 'fms').map((x) => x.campo)).toEqual(['nome', 'nomeFantasia', 'tipo']);
  });

  /** Valor que só a Receita tem não é juntar, é cadastrar: fica para a edição. */
  it('a Receita sozinha não vira opção', () => {
    expect(opcoesDoCampo(FMS, 'telefone', 'fms')).toEqual([]);
  });

  it('sem tocar em nada, não manda escolha nenhuma — e o ente vem sozinho', () => {
    expect(camposDaEscolha(FMS, 'fms', {})).toEqual({});
    expect(herdadosSemPerguntar(FMS, 'fms')).toEqual([{ campo: 'ente', texto: 'Teresina-PI' }]);
  });

  it('escolhendo nome, sigla e tipo da fundação, manda exatamente isso', () => {
    expect(camposDaEscolha(FMS, 'fms', { nome: 'b', nomeFantasia: 'b', tipo: 'b' })).toEqual({
      nome: 'Fundação Municipal de Saúde.',
      nomeFantasia: 'FMS',
      tipo: 'ORGAO_PUBLICO',
    });
  });

  /** Invertido, o que era escolha vira o padrão — e o CNPJ passa a ser herança. */
  it('ao inverter, a escolha que virou padrão deixa de ser mandada', () => {
    expect(camposDaEscolha(FMS, 'fundacao', { nome: 'b', tipo: 'b' })).toEqual({});
    expect(herdadosSemPerguntar(FMS, 'fundacao')).toEqual([
      { campo: 'documento', texto: '05.522.917/0001-70' },
    ]);
  });

  it('diz o que está preso a cada uma, por extenso', () => {
    expect(oQueEstaPreso(FMS.a)).toBe('10 processos e 15 vínculos de trabalho');
    expect(oQueEstaPreso(lado({ dossiePatronal: { id: 'e' }, _count: { participacoes: 1, vinculos: 0 } }))).toBe(
      '1 processo e o dossiê patronal',
    );
    expect(oQueEstaPreso(lado({}))).toBeNull();
  });
});

describe('juntar — onde mora', () => {
  it('a tela compara antes e manda só a escolha', () => {
    const MODAL = ler('components/organizacoes/mesclar-modal.tsx');
    expect(MODAL).toContain('compararOrganizacoes(aberta.id, outra.id)');
    expect(MODAL).toContain('mesclarOrganizacoes(continua.id, some.id, campos)');
    expect(MODAL).toContain('{c.descartada && (');
  });

  /** O par descartado some da fila — a porta pela própria linha é o que sobra. */
  it('cada linha de organização tem a porta, só para quem pode juntar', () => {
    const PAGINA = ler('app/(dashboard)/organizacoes/page.tsx');
    expect(PAGINA).toContain('{podeMesclar && (');
    expect(PAGINA).toContain('onClick={() => setMesclando({ fica: p })}');
  });
});
