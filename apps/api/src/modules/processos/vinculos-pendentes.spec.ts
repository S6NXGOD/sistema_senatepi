import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { autorQueInforma, nossoPolo } from '../dashboard/dashboard.module';

const RAIZ = path.resolve(__dirname, '../../..');
const SERVICO = readFileSync(
  path.join(RAIZ, 'src/modules/processos/vinculos-pendentes.service.ts'),
  'utf8',
);

/**
 * A FILA "SEM FILIADO" TEM ESPÉCIES DIFERENTES, e tratar tudo como o mesmo
 * problema é o que a fazia nunca zerar.
 *
 * Medido na produção em 04/09/2026 sobre os 30 casos: 25 são pessoas que
 * precisam de vínculo e 5 são o próprio sindicato, outro sindicato ou uma
 * empresa no polo ativo. Para esses 5 não existe filiado dono — são ações
 * institucionais marcadas como individuais, e a resposta é mudar o TIPO.
 */
describe('separar quem tem filiado de quem não pode ter', () => {
  /** A mesma expressão do serviço, para exercitar a regra de verdade. */
  const RE = new RegExp(
    /\b(SINDICATO|SINDSERM|SINDHOSPI|SINSEP|SENATEPI|FEDERACAO|CONFEDERACAO|ASSOCIACAO|MUNICIPIO|ESTADO|UNIAO|MINISTERIO|FUNDACAO|INSTITUTO|AUTARQUIA|PREFEITURA|SECRETARIA|CONSELHO|CAMARA|EMPRESA|LTDA|EIRELI|S\/A|ME$|EPP|HOSPITAL|CLINICA|BANCO|COOPERATIVA|PROFISSIONAIS DE)\b/,
  );
  const semAcento = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const ehEntidade = (nome: string) => RE.test(semAcento(nome));

  /** Nomes REAIS do polo ativo dos casos que não têm filiado dono. */
  it.each([
    'SENATEPI',
    'SINDHOSPI',
    'SINSEP',
    'CRAVEIRO CONTABILIDADE EIRELI - ME',
    'Profissionais de Enfermagem de Palmeirais-PI',
    'SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ',
    'MUNICIPIO DE PARNAIBA-PI',
  ])('"%s" não tem filiado a vincular', (nome) => {
    expect(ehEntidade(nome)).toBe(true);
  });

  /** E as pessoas, que são a razão de a fila existir. */
  it.each([
    'ANDREIA MENDES',
    'MARCOS VICTOR',
    'SARA MACHADO MIRANDA LEAL BARBOSA',
    'KÁTIA OSÓRIO',
    'GIRCÉLIA',
    'ISAAC RODRIGUES PASSOS',
  ])('"%s" é pessoa, e precisa de vínculo', (nome) => {
    expect(ehEntidade(nome)).toBe(false);
  });

  /**
   * A ESPÉCIE OLHA TODAS AS PARTES ATIVAS. Um caso real tem "Profissionais de
   * Enfermagem de Palmeirais-PI" litigando AO LADO do sindicato: se a leitura
   * olhasse só a principal, ele cairia na fila de pessoas e ficaria lá para
   * sempre, porque não há filiado que corresponda a um grupo.
   */
  it('basta uma parte ativa ser entidade', () => {
    // A leitura aparece nos dois lugares: ao montar os alvos da consulta em
    // lote e ao classificar a linha. Se divergirem, um caso ganha candidato
    // que a tela vai esconder.
    expect(
      (SERVICO.match(/ativas\.some\(\(x\) => RE_NAO_E_PESSOA\.test\(semAcento\(x\.nome\)\)\)/g) ?? []).length,
    ).toBe(2);
  });

  /**
   * Procurar candidato para o próprio sindicato é gastar consulta para oferecer
   * uma resposta errada — a entidade nem entra na lista de alvos da busca.
   */
  it('não procura filiado para entidade', () => {
    expect(SERVICO).toContain('if (!entidade && parte) {');
    expect(SERVICO).toContain('candidatos: pareceEntidade || !nome ? [] : (candidatosPorProcesso.get(p.id) ?? [])');
  });
});

describe('aplicar as decisões', () => {
  /**
   * UMA A UMA, e não em transação única. São processos diferentes: um erro em
   * um (filiado já vinculado em outra parte) não é motivo para desfazer os
   * vinte que passaram. A tela mostra as duas listas.
   */
  it('uma falha não derruba as outras', () => {
    const trecho = SERVICO.slice(SERVICO.indexOf('async aplicar('));
    expect(trecho.slice(0, 1200)).toContain('try {');
    expect(trecho.slice(0, 1200)).toContain('falhas.push({');
    expect(trecho.slice(0, 1200)).not.toContain('$transaction');
  });

  /**
   * MARCAR INSTITUCIONAL TIRA DA FILA PELA PORTA CERTA: `semFiliado()` só olha
   * INDIVIDUAL. E, se o polo ativo estiver vazio, entra o cadastro do próprio
   * sindicato — senão o processo sai de uma fila e cai em outra ("sem parte"),
   * o que não é progresso.
   */
  it('reclassificar não deixa o processo sem polo ativo', () => {
    const trecho = SERVICO.slice(SERVICO.indexOf('private async marcarInstitucional('));
    expect(trecho).toContain("if (!proc.partes.some((x) => x.polo === 'ATIVO'))");
    expect(trecho).toContain('this.partes.parteInstitucional()');
    expect(trecho).toContain('TipoAcaoProcesso.INSTITUCIONAL');
  });

  it('a reclassificação fica auditada', () => {
    const trecho = SERVICO.slice(SERVICO.indexOf('private async marcarInstitucional('));
    expect(trecho).toContain('this.audit.registrar(');
    expect(trecho).toContain("de: String(proc.tipoAcao), para: 'INSTITUCIONAL'");
  });

  /** Nome parecido nunca vincula sozinho — nem aqui, nem em lote. */
  it('só aplica o que a pessoa marcou', () => {
    const trecho = SERVICO.slice(SERVICO.indexOf('async aplicar('));
    expect(trecho.slice(0, 1200)).toContain('d.parteId && d.filiadoId');
    expect(trecho.slice(0, 1200)).not.toContain('candidatos[0]');
  });
});

/**
 * A LISTA DE PUBLICAÇÕES PRECISA DIZER DE QUEM É O CASO.
 *
 * São 984 atos distintos no acervo: reconhecer um pelo cabeçalho do acórdão é
 * o que a tela obrigava a fazer.
 */
describe('de quem é o processo, no painel', () => {
  const partes = (nomes: [string, string, boolean][]) =>
    nomes.map(([nome, polo, principal]) => ({ nome, polo, principal, parteExternaId: null }));

  /**
   * O AUTOR SÓ APARECE QUANDO NÃO SOMOS NÓS. O sindicato é o autor em 93 dos
   * 127 processos — escrever o nome dele em toda linha gasta espaço para dizer
   * o que já se sabia.
   */
  it('cala quando o autor é o próprio sindicato', () => {
    const p = partes([
      ['SINDICATO DOS ENFERMEIROS ... DO PIAUI - SENATEPI', 'ATIVO', true],
      ['HAPVIDA ASSISTENCIA MEDICA LTDA', 'PASSIVO', true],
    ]);
    expect(autorQueInforma(p, null)).toBeNull();
  });

  it('mostra quando o autor é a filiada', () => {
    const p = partes([
      ['SARA MACHADO MIRANDA LEAL BARBOSA', 'ATIVO', true],
      ['FMS/THE', 'PASSIVO', true],
    ]);
    expect(autorQueInforma(p, null)).toBe('SARA MACHADO MIRANDA LEAL BARBOSA');
  });

  /**
   * EM QUE POLO ESTAMOS muda o que o ato significa: a mesma "intimação para
   * manifestar-se" é ataque quando somos autor e defesa quando somos réu.
   */
  it('diz o polo do sindicato', () => {
    expect(
      nossoPolo(
        partes([
          ['HAPVIDA ASSISTENCIA MEDICA LTDA', 'ATIVO', true],
          ['SINDICATO DOS ENFERMEIROS - SENATEPI', 'PASSIVO', true],
        ]),
        null,
      ),
    ).toBe('PASSIVO');
  });

  /** Sem o sindicato nos autos, não há polo nosso — e chutar seria mentir. */
  it('devolve nulo quando o sindicato não é parte', () => {
    const p = partes([
      ['SARA MACHADO MIRANDA', 'ATIVO', true],
      ['FMS/THE', 'PASSIVO', true],
    ]);
    expect(nossoPolo(p, null)).toBeNull();
  });
});
