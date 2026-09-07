import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const TELA = lerCodigo('page.tsx');

/**
 * O PAINEL DO ADVOGADO — o que ele precisa ver, e o que faltava.
 *
 * Duas lacunas medidas na produção em 07/09/2026, as duas invisíveis porque a
 * tela mostrava um número certo sem a lista correspondente.
 */
describe('as publicações do advogado', () => {
  /**
   * O TÍTULO PROMETIA O RECORTE ERRADO. "Publicações nos seus processos" deixou
   * de ser verdade quando entrou o ato que NOMEIA o advogado num processo que
   * não está vinculado a ele — que era o caso das 4 intimações da
   * Dra. Jaqueline, invisíveis no painel dela.
   */
  it('o título cobre as duas origens sem prometer a errada', () => {
    expect(TELA).toContain("pessoal ? 'Suas publicações' : 'Publicações que pedem providência'");
    expect(TELA).not.toContain('Publicações nos seus processos');
  });

  /**
   * O PRAZO CORRE PARA QUEM FOI INTIMADO. A lista mistura o ato que nomeia o
   * advogado com o ato do processo dele que intimou outro — sem a marca, as
   * seis linhas parecem ter a mesma urgência. Medido: a Dra. Morgana vê 32
   * publicações e apenas 6 a citam.
   */
  it('marca o que intima quem está olhando', () => {
    expect(TELA).toContain('pub.meCita &&');
    expect(TELA).toContain('Você foi intimado');
  });
});

/**
 * "NENHUMA ATIVIDADE AGENDADA PARA HOJE" — com prazo para amanhã.
 *
 * A home tinha vencido (Pendências), HOJE (Atividades) e audiência da semana.
 * Um PRAZO para amanhã não cabia em nenhuma das três: aparecia só como número
 * no cartão "Prazos esta semana". Medido na produção em 07/09/2026: dos
 * compromissos abertos do sindicato inteiro, **os seis** caíam nessa faixa.
 */
describe('hoje e os próximos dias', () => {
  it('o cartão lê as duas janelas', () => {
    expect(TELA).toContain('const hoje = data.atividadesHoje;');
    expect(TELA).toContain('const proximas = data.proximasAtividades ?? [];');
    expect(TELA).toContain('const total = hoje.length + proximas.length;');
  });

  /**
   * Quem abre a agenda pensa em ordem de TEMPO, não em categoria de janela —
   * duas listas separadas resolveriam o dado e piorariam a leitura.
   */
  it('é uma leitura cronológica só, com separador por trecho', () => {
    expect(TELA).toContain('function BlocoDeDia');
    expect(TELA).toContain('titulo="Hoje"');
    expect(TELA).toContain('titulo="Próximos dias"');
    // A data completa só no trecho futuro: em "Hoje" a hora basta — "09:00"
    // sem data numa linha de amanhã é exatamente como se lê um atraso.
    expect(TELA).toMatch(/titulo="Próximos dias"[^>]*mostrarData/);
    expect(TELA).not.toMatch(/titulo="Hoje"[^>]*mostrarData/);
  });

  /** O vazio agora fala das duas janelas — senão volta a mentir por omissão. */
  it('o estado vazio cobre os sete dias, não só hoje', () => {
    expect(TELA).toContain('Nenhuma atividade para hoje nem para os próximos sete dias');
    expect(TELA).not.toContain('Nenhuma atividade agendada para hoje.');
  });

  /** O contador do cabeçalho tem de somar o que a lista mostra. */
  it('o número do cabeçalho é o total exibido', () => {
    expect(TELA).toContain('count={total}');
  });

  /** "Hoje" vazio com "próximos dias" cheio ainda diz que hoje está livre. */
  it('hoje vazio continua sendo dito', () => {
    expect(TELA).toContain('vazio="Nada agendado para hoje."');
  });
});

/**
 * CADA PERFIL ABRE NO PRÓPRIO TRABALHO — e isso é ordem de tela, não permissão.
 * A permissão continua sendo cortada no backend; aqui é sobre o que vem ANTES.
 */
describe('a ordem por perfil', () => {
  it('o advogado abre na carteira dele', () => {
    expect(TELA).toContain('texto="Minha carteira"');
    expect(TELA.indexOf('texto="Minha carteira"')).toBeLessThan(TELA.indexOf('KpiCard {...c}'));
  });

  it('a triagem abre no balcão e na fila dela', () => {
    expect(TELA).toContain('texto="Meu balcão hoje"');
    expect(TELA).toContain('texto="Sua fila de hoje"');
    expect(TELA.indexOf('texto="Meu balcão hoje"')).toBeLessThan(TELA.indexOf('KpiCard {...c}'));
  });

  /** Aniversariantes ficam junto da fila da Triagem — é ela quem liga. */
  it('e vê os aniversariantes junto da própria fila, não no rodapé', () => {
    const filaTriagem = TELA.indexOf('texto="Sua fila de hoje"');
    const aniversarioNaFila = TELA.indexOf('<Aniversariantes', filaTriagem);
    const rodape = TELA.indexOf('{!ehTriagem && pode.filiados && (');
    expect(aniversarioNaFila).toBeGreaterThan(filaTriagem);
    expect(aniversarioNaFila).toBeLessThan(rodape);
  });

  /** Carga da equipe é instrumento de gestão — e o dado nem chega ao advogado. */
  it('a carga da equipe é só de quem coordena', () => {
    expect(TELA).toContain('{ehGestao && data.cargaEquipe && (');
  });
});

/**
 * A FAIXA DE "AÇÃO NOVA" SAIU DO PAINEL — e o motivo é a regra desta própria tela.
 *
 * Ela dizia "3 ações apareceram no Diário" com um link para /processos. O SINO,
 * que fica no topo de TODA tela (esta inclusive), já mostra o mesmo número em
 * vermelho — e mostra melhor: lista os NPUs, diz de que lado estamos em cada um,
 * e cada linha abre o cadastro já preenchido. A faixa era o caminho pior para a
 * mesma decisão.
 *
 * "A mesma coisa duas vezes não são dois avisos" está escrito no próprio arquivo,
 * sobre o DJEN. Cada faixa a menos é uma chance a mais de as que ficaram serem
 * lidas.
 */
describe('o painel não repete o sino', () => {
  it('não há faixa de ação nova no painel', () => {
    expect(TELA).not.toContain('apareceu no Diário');
    expect(TELA).not.toContain('apareceram no Diário');
    expect(TELA).not.toContain('sugestoesDeProcesso');
  });
});
