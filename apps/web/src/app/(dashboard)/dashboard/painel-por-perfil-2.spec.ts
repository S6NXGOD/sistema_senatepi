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
  /*
    O BLOCO MUDOU DE CASA — e estas asserções foram com ele.

    Testavam o interior de `AtividadesHoje`, que era um `SectionCard` com duas
    listas empilhadas dentro do próprio `page.tsx`. O usuário disse que aquilo
    ocupava espaço demais e tinha razão: 73px só de moldura, e nenhuma das
    linhas deixava FAZER nada. O bloco virou `AtividadesDoDia`, um componente
    próprio, com resolução em um toque.

    A propriedade que estes testes protegiam continua valendo, e continua
    testada — em `components/dashboard/atividades-do-dia.spec.ts`: as duas
    janelas são lidas, e a leitura é cronológica numa lista só. Aqui fica só o
    que é do PAINEL: que ele passa as duas janelas ao bloco.
  */
  it('o painel entrega as duas janelas ao bloco', () => {
    expect(TELA).toContain('hoje={data.atividadesHoje}');
    expect(TELA).toContain('proximas={data.proximasAtividades ?? []}');
  });

  /** E o bloco antigo não ficou para trás como código morto. */
  it('o bloco antigo saiu do arquivo', () => {
    expect(TELA).not.toContain('function AtividadesHoje');
    expect(TELA).not.toContain('function BlocoDeDia');
  });

  /*
    AS TRÊS ASSERÇÕES QUE MORAVAM AQUI FORAM COM O BLOCO.

    Testavam o interior de `AtividadesHoje`: o `EmptyState` das duas janelas, o
    `count={total}` do SectionCard e o "Nada agendado para hoje" do BlocoDeDia.
    O bloco virou `AtividadesDoDia` e nenhuma dessas peças existe mais — o
    componente novo simplesmente não renderiza quando está vazio, e a linha
    `OQueEstaLimpo` é quem diz que a semana está livre.

    A ÚLTIMA DELAS APONTOU UM BUG DE VERDADE ao cair, e vale registrar: ela
    protegia a ideia de que "09:00" numa linha de amanhã se lê como atraso de
    hoje. A lista nova é cronológica e plana, então a data passou a entrar POR
    LINHA — está testada em `atividades-do-dia.spec.ts`. Sem este teste velho
    quebrando, a regressão teria ido para produção.
  */
  it('e o painel não guarda mais peças do bloco antigo', () => {
    expect(TELA).not.toContain('Nenhuma atividade para hoje nem para os próximos sete dias');
    expect(TELA).not.toContain('vazio="Nada agendado para hoje."');
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

  /**
   * Aniversariantes ficam junto da fila da Triagem — é ela quem liga.
   *
   * A guarda do rodapé ganhou `ehGestao`: parabenizar filiado é relacionamento,
   * função de quem atende e de quem coordena, não de quem litiga. O advogado
   * recebia a lista todo dia entre os prazos dele. A propriedade testada aqui
   * não mudou — o bloco da Triagem continua NA FILA dela, antes do rodapé.
   */
  it('e vê os aniversariantes junto da própria fila, não no rodapé', () => {
    const filaTriagem = TELA.indexOf('texto="Sua fila de hoje"');
    const aniversarioNaFila = TELA.indexOf('<Aniversariantes', filaTriagem);
    const rodape = TELA.indexOf('{!ehTriagem && ehGestao && pode.filiados && (');
    expect(rodape).toBeGreaterThan(-1);
    expect(aniversarioNaFila).toBeGreaterThan(filaTriagem);
    expect(aniversarioNaFila).toBeLessThan(rodape);
  });

  /**
   * E O ADVOGADO DEIXOU DE RECEBÊ-LOS — não é o trabalho dele.
   *
   * A guarda antiga (`!ehTriagem && pode.filiados`) entregava a lista a todo
   * advogado com acesso a filiados, que é a maioria deles.
   */
  it('mas o advogado não recebe mais a lista', () => {
    expect(TELA).not.toContain('{!ehTriagem && pode.filiados && (');
  });

  /**
   * Carga da equipe é instrumento de gestão — e o dado nem chega ao advogado.
   * Ficou em largura inteira quando "Contatos a fazer", que dividia a grade
   * com ela, saiu do painel.
   */
  it('a carga da equipe é só de quem coordena', () => {
    expect(TELA).toContain('{ehGestao && data.cargaEquipe && !vazio.cargaEquipe && <CargaEquipe');
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
