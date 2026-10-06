import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const semComentarios = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const LISTA = semComentarios(join(__dirname, 'page.tsx'));
const GAVETA = semComentarios(
  join(__dirname, '../../../components/atendimentos/atendimento-drawer.tsx'),
);
const SERVICO = readFileSync(
  join(__dirname, '../../../../../api/src/modules/atendimentos/atendimentos.service.ts'),
  'utf8',
).replace(/\r/g, '');

/**
 * "COMO SEI QUE HORAS FOI FEITA A TRIAGEM NESSA LISTAGEM E ATÉ MESMO QUEM FOI
 * QUE REALIZOU? NÃO TENHO ESSA INFORMAÇÃO NEM MESMO NO DETALHAMENTO."
 * — o dono, 07/10/2026.
 *
 * O dado SEMPRE existiu: `atendentePorId` é coluna obrigatória e `created_at`
 * guarda o instante inteiro. Medido na produção: **35 triagens, duas pessoas**
 * (Julian Helton 30, Ivo Ramos 5), **nenhuma sem atendente**.
 *
 * O que faltava era a tela:
 *
 *  · na LISTAGEM, a hora morava só no `title` — invisível no celular, onde não
 *    há mouse — e o atendente não era desenhado em lugar nenhum, embora a API
 *    já o mandasse;
 *  · na GAVETA, as duas metades existiam nas PONTAS OPOSTAS: o horário no topo
 *    e "Registrado por" no rodapé, depois do desfecho e das consultas.
 *
 * E a hora não é enfeite: **8 dias da produção têm mais de uma triagem**, todas
 * entre 8h e 13h. Sem ela, duas linhas do mesmo dia são indistinguíveis e a
 * ordem da fila some.
 */
describe('a listagem diz quando e por quem', () => {
  it('a hora entra na linha, não só no title', () => {
    expect(LISTA).toContain('{formatData(a.createdAt)} {formatHora(a.createdAt)}');
  });

  it('e há uma célula de quem registrou', () => {
    expect(LISTA).toContain('const QuemTriouCel = ({ a }: { a: AtendimentoLista }) => {');
    expect(LISTA).toContain('soOPrimeiroNome(nome)');
  });

  /** Nas DUAS telas: a fileira de pastilhas do celular e a coluna da tabela. */
  it('aparece no celular e no desktop', () => {
    expect(LISTA.match(/<QuemTriouCel a=\{a\} \/>/g)).toHaveLength(2);
  });

  /**
   * O NOME CURTO É O VOCABULÁRIO DA CASA, e a foto distingue num relance —
   * com duas pessoas registrando, o avatar resolve antes da leitura.
   */
  it('usa nome de exibição e foto, com o nome inteiro na dica', () => {
    expect(LISTA).toContain('a.atendente.nomeExibicao || a.atendente.nome');
    expect(LISTA).toContain('Triagem registrada por ${a.atendente.nome} em ${formatDataHora(a.createdAt)}.');
  });

  /** Atendimento sem atendente não inventa linha vazia (hoje não há nenhum). */
  it('sem atendente, não desenha nada', () => {
    expect(LISTA).toContain('if (!a.atendente) return null;');
  });
});

describe('a gaveta junta as duas metades', () => {
  it('quem registrou fica junto do horário, no topo', () => {
    const i = GAVETA.indexOf('{formatDataHora(at.createdAt)}');
    expect(i).toBeGreaterThan(0);
    const trecho = GAVETA.slice(i, i + 420);
    expect(trecho).toContain('at.atendente.nomeExibicao || at.atendente.nome');
  });

  /** E não fica mais órfão no rodapé, longe do horário. */
  it('o "Registrado por" do rodapé saiu', () => {
    expect(GAVETA).not.toContain('Registrado por <strong>');
  });
});

describe('a API manda o necessário para isso', () => {
  it('o atendente vem com nome curto e foto nas três respostas', () => {
    expect(SERVICO.match(/atendente: RESPONSAVEL_COM_FOTO/g)?.length).toBeGreaterThanOrEqual(3);
    expect(SERVICO).not.toContain('atendente: { select: { id: true, nome: true } }');
  });
});
