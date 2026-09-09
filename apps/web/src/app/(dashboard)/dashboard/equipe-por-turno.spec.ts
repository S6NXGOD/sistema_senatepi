import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TELA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const FILA = readFileSync(
  join(__dirname, '../../../components/dashboard/acoes-sem-cadastro.tsx'),
  'utf8',
);
const ACOES = readFileSync(
  join(__dirname, '../../../components/processos/acoes-encontradas.tsx'),
  'utf8',
);

/**
 * A EQUIPE DE HOJE, POR TURNO.
 *
 * Era uma lista corrida: quatro nomes com "08:00 – 12:00", "08:00 – 12:00",
 * "14:00 – 18:00", "14:00 – 18:00". Quem está de plantão AGORA só saía
 * comparando quatro pares de horas de cabeça.
 */
describe('a equipe disponível é agrupada por turno', () => {
  it('classifica em manhã, dia inteiro e tarde', () => {
    expect(TELA).toContain('const turnoDe = (ini: string, fim: string) =>');
    expect(TELA).toContain("fim <= '13:00' ? 'MANHÃ' : ini >= '12:00' ? 'TARDE' : 'DIA INTEIRO'");
  });

  /**
   * O BALDE DO MEIO EXISTE POR UM MOTIVO: sem ele, um plantão 08:00–18:00
   * cairia em "manhã" e a tarde ficaria mentindo vazia.
   */
  it('plantão de dia inteiro não vira manhã', () => {
    const ordem = TELA.slice(TELA.indexOf('const ordemTurno'));
    expect(ordem.slice(0, 200)).toContain("'DIA INTEIRO': 1");
  });

  /** Com um turno só, o cabeçalho repetiria o que o intervalo já diz. */
  it('o cabeçalho de turno só aparece quando há mais de um', () => {
    expect(TELA).toContain('const mostrarCabecalhoDeTurno = turnos.length > 1;');
    expect(TELA).toContain('{mostrarCabecalhoDeTurno && (');
  });

  /** Dentro do turno, ordem por hora de início — não a ordem que o banco deu. */
  it('ordena por hora de início', () => {
    expect(TELA).toContain('a.horaInicio.localeCompare(b.horaInicio)');
  });

  /**
   * A HORA É DE TERESINA, NÃO A DO NAVEGADOR.
   *
   * `toTimeString()` devolve a hora local de quem abre a tela — coincide no
   * Brasil e coincidia comigo (UTC-3), mas as horas da escala são de Teresina.
   * Quem abrisse de outro fuso veria "No horário" na hora errada. É o mesmo
   * deslocamento fixo que o resto do sistema já usa.
   */
  it('o status do plantão usa o fuso de Teresina', () => {
    expect(TELA).toContain("new Date(Date.now() - 3 * 3_600_000).toISOString().slice(11, 16)");
    expect(TELA).not.toContain("new Date().toTimeString().slice(0, 5)");
  });
});

/**
 * QUEM PEDIU PARA VER A FILA, VÊ A FILA ABERTA.
 *
 * O painel mostra as duas primeiras ações e um rodapé "Ver as outras 22 na
 * fila". O link levava a `/processos` e parava no cabeçalho recolhido: a pessoa
 * clicou EM VER e teve de clicar de novo.
 */
describe('o link "ver as outras na fila"', () => {
  it('leva com o pedido explícito na URL', () => {
    expect(FILA).toContain("href={sobra > 0 ? '/processos?fila=acoes' : '/processos'}");
  });

  it('e a tela de Processos abre a seção por causa dele', () => {
    expect(ACOES).toContain("useSearchParams().get('fila') === 'acoes'");
    expect(ACOES).toContain('if (abrirPelaUrl) {');
  });

  /**
   * CHEGAR POR OUTRO CAMINHO CONTINUA RECOLHIDO — é o padrão medido: a fila é
   * trabalho de passivo e não é o motivo de ninguém abrir Processos.
   */
  it('o padrão continua recolhido', () => {
    expect(ACOES).toContain('const [aberto, setAberto] = useState(false);');
  });

  /**
   * NÃO GRAVA PREFERÊNCIA: vir por este link é intenção DESTA visita. Marcar o
   * `localStorage` aqui deixaria a fila aberta para sempre por causa de um
   * clique.
   */
  it('não grava a preferência ao abrir pela URL', () => {
    const efeito = ACOES.slice(
      ACOES.indexOf('useEffect(() => {'),
      ACOES.indexOf('function alternarAberto'),
    );
    expect(efeito).toContain('setAberto(true);');
    expect(efeito).not.toContain('localStorage.setItem');
  });
});
