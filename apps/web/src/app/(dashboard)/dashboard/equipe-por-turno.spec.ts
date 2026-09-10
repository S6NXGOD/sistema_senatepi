import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as path from 'node:path';

/** Raiz de `apps/web/src` — para alcançar a API e conferir os dois lados. */
const RAIZ_WEB = path.resolve(__dirname, '../../..');

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
 * O ESTADO NÃO SE ESCREVE DUAS VEZES.
 *
 * O cartão tinha um ponto colorido à direita E uma etiqueta ("No horário") ao
 * lado da hora. Quando concordam — o caso normal — a etiqueta é ruído. Agora a
 * COR da hora carrega o estado e a palavra só aparece quando ela não é óbvia.
 */
describe('o estado do plantão fala uma vez só', () => {
  it('quem está no horário não ganha etiqueta de texto', () => {
    expect(TELA).toContain('const estadoPlantao = (ini: string, fim: string) =>');
    // `rotulo: null` é o ramo de quem está no horário.
    expect(TELA).toContain("{ rotulo: null, hora: 'text-emerald-600");
  });

  it('encerrado e aguardando ganham, porque a cor não explica', () => {
    expect(TELA).toContain("rotulo: 'encerrado'");
    expect(TELA).toContain("rotulo: 'aguardando'");
    expect(TELA).toContain('{st.rotulo && (');
  });

  /** Cor não é acessível sozinha: o ponto leva o estado no rótulo do leitor. */
  it('o ponto colorido tem rótulo acessível', () => {
    expect(TELA).toContain("aria-label={st.rotulo ?? 'no horário'}");
  });
});

/**
 * O PRÓXIMO PLANTÃO PASSOU A DIZER QUANDO E A QUE HORAS.
 *
 * A consulta já trazia `horaInicio`/`horaFim`; o objeto da API as descartava, e
 * o cartão escrevia só "segunda-feira, 14/09". Medido em 10/09/2026: a escala
 * pula o fim de semana, então o próximo plantão fica tipicamente a QUATRO dias
 * — a data sozinha não responde quanto tempo ninguém está de plantão.
 */
describe('o próximo plantão informa', () => {
  it('a API leva as horas junto, sem quebrar a forma antiga', () => {
    const api = readFileSync(
      path.resolve(RAIZ_WEB, '../../api/src/modules/dashboard/dashboard.module.ts'),
      'utf8',
    );
    expect(api).toContain('pessoas: doDia.map((e) => ({');
    expect(api).toContain('horaInicio: e.horaInicio,');
    // `advogados` continua saindo: a web antiga ainda o lê na janela de troca.
    expect(api).toContain('advogados: doDia.map((e) => e.advogado),');
  });

  it('e a tela cai para a forma antiga quando a API é a de antes', () => {
    expect(TELA).toContain('proximoPlantao?.pessoas ??');
    expect(TELA).toContain('(proximoPlantao?.advogados ?? []).map((a) => ({');
  });

  it('diz a que distância está, em dias de calendário', () => {
    expect(TELA).toContain('-(diasDesdeDataPura(proximoPlantao.data) ?? 0)');
    expect(TELA).toContain("emQuantosDias <= 1 ? 'amanhã'");
    expect(TELA).toContain('`em ${emQuantosDias} dias`');
  });

  /**
   * Faixa igual para todo mundo vai no CABEÇALHO; só quando as pessoas do dia
   * divergem é que a hora se repete linha a linha.
   */
  it('a faixa única vai no cabeçalho, não por linha', () => {
    expect(TELA).toContain('const faixaUnica =');
    expect(TELA).toContain('{faixaUnica && (');
    expect(TELA).toContain('{!faixaUnica && horaInicio && (');
  });

  /** A data continua sendo pura — foi ela que já apareceu um dia antes. */
  it('a data do próximo plantão usa a regra de data pura', () => {
    expect(TELA).toContain('formatDataPura(proximoPlantao.data, {');
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
